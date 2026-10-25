import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSpotifyAuthState, consumeSpotifyAuthState, oauthStateLifetimeMs } from '../src/services/oauthState.js';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-secret';
process.env.CLIENT_URL ??= 'http://localhost:5173';
process.env.SPOTIFY_CLIENT_ID ??= 'test-client';
process.env.SPOTIFY_CLIENT_SECRET ??= 'test-secret';
process.env.SPOTIFY_REDIRECT_URI ??= 'http://127.0.0.1:5000/api/auth/spotify/callback';

test('Spotify login shows authorization again while preserving OAuth state', async () => {
  const { buildSpotifyAuthorizeUrl } = await import('../src/services/spotifyService.js');
  const state = createSpotifyAuthState();
  const url = new URL(buildSpotifyAuthorizeUrl(state));
  assert.equal(url.origin, 'https://accounts.spotify.com');
  assert.equal(url.searchParams.get('show_dialog'), 'true');
  assert.equal(url.searchParams.get('state'), state);
  assert.equal(url.searchParams.get('response_type'), 'code');
  const scopes = url.searchParams.get('scope')!.split(' ');
  assert.ok(scopes.includes('playlist-modify-public'));
  assert.equal(scopes.includes('playlist-modify-private'), false);
  assert.equal(scopes.includes('playlist-read-private'), false);
});

for (const itemCount of [0, 7, 50]) {
  test(`music sync requests up to 50 items and persists ${itemCount} per range`, async (t) => {
    const service = await import('../src/services/spotifyService.js');
    const { prisma } = await import('../src/lib/prisma.js');
    const originalTransaction = prisma.$transaction;
    t.after(() => { prisma.$transaction = originalTransaction; });
    t.mock.method(console, 'log', () => {});
    const artistRows: { rank: number; timeRange: string; artistId: string }[] = [];
    const trackRows: { rank: number; timeRange: string; trackId: string }[] = [];
    const topRequests: string[] = [];
    const entity = {
      deleteMany: async () => ({}),
      upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        assert.equal(Object.hasOwn(create, 'genres'), false);
        assert.equal(Object.hasOwn(update, 'genres'), false);
        if (Object.hasOwn(create, 'imageUrl')) {
          assert.equal(create.imageUrl, 'https://example.com/artist.jpg');
          assert.equal(update.imageUrl, 'https://example.com/artist.jpg');
        }
        return {};
      },
      findUniqueOrThrow: async ({ where }: { where: { spotifyId: string } }) => ({ id: where.spotifyId })
    };
    prisma.$transaction = (async (callback: (tx: unknown) => Promise<void>) => callback({
      artist: entity, track: entity,
      userFavoriteArtist: { ...entity, create: async ({ data }: { data: typeof artistRows[number] }) => { artistRows.push(data); } },
      userFavoriteTrack: { ...entity, create: async ({ data }: { data: typeof trackRows[number] }) => { trackRows.push(data); } }
    })) as typeof originalTransaction;
    t.mock.method(globalThis, 'fetch', async (input: string) => {
      const url = new URL(String(input));
      assert.ok(['/v1/me/top/artists', '/v1/me/top/tracks'].includes(url.pathname));
      assert.equal(url.searchParams.get('limit'), '50');
      topRequests.push(url.pathname);
      const range = url.searchParams.get('time_range');
      const artists = url.pathname.endsWith('/artists');
      return Response.json({ items: Array.from({ length: itemCount }, (_, index) => ({
        id: `${artists ? 'artist' : 'track'}-${range}-${index}`,
        name: `Item ${index}`, images: [{ url: 'https://example.com/artist.jpg' }],
        album: { name: 'Album', images: [] }, artists: [], preview_url: null
      })) });
    });
    await service.syncTopMusicData('test-user', 'test-access');
    assert.equal(topRequests.length, 6);
    for (const range of ['short_term', 'medium_term', 'long_term']) {
      const expectedRanks = Array.from({ length: itemCount }, (_, index) => index + 1);
      assert.deepEqual(artistRows.filter((row) => row.timeRange === range).map((row) => row.rank), expectedRanks);
      assert.deepEqual(trackRows.filter((row) => row.timeRange === range).map((row) => row.rank), expectedRanks);
    }
  });
}

test('OAuth state is random, bound to the cookie, and single-use', () => {
  const state = createSpotifyAuthState();
  const otherState = createSpotifyAuthState();
  assert.notEqual(state, otherState);
  assert.equal(consumeSpotifyAuthState(state, undefined), false);
  assert.equal(consumeSpotifyAuthState(state, otherState), false);
  assert.equal(consumeSpotifyAuthState(state, state), true);
  assert.equal(consumeSpotifyAuthState(state, state), false);
  assert.equal(consumeSpotifyAuthState(['bad'], state), false);
});

test('sync refreshes only once and preserves an omitted refresh token', async (t) => {
  const service = await import('../src/services/spotifyService.js');
  const { prisma } = await import('../src/lib/prisma.js');
  const originalFind = prisma.user.findUnique;
  const originalUpdate = prisma.user.update;
  t.after(() => { prisma.user.findUnique = originalFind; prisma.user.update = originalUpdate; });
  prisma.user.findUnique = t.mock.fn(async () => ({
    spotifyAccessToken: 'expired-access', spotifyRefreshToken: 'existing-refresh'
  })) as typeof originalFind;
  const update = t.mock.fn(async () => ({}));
  prisma.user.update = update as typeof originalUpdate;
  let refreshRequests = 0;
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    if (String(input).includes('/api/token')) {
      refreshRequests += 1;
      return Response.json({ access_token: 'new-access', expires_in: 3600, token_type: 'Bearer' });
    }
    return Response.json({ error: { status: 401 } }, { status: 401 });
  });
  await assert.rejects(service.syncUserMusicData('test-user'), (error: unknown) =>
    service.getSpotifyFailure(error).code === 'reconnect');
  assert.equal(refreshRequests, 1);
  assert.deepEqual(update.mock.calls[0].arguments[0], {
    where: { id: 'test-user' },
    data: { spotifyAccessToken: 'new-access', spotifyRefreshToken: 'existing-refresh' }
  });
});

test('revoked refresh authorization clears stored Spotify credentials', async (t) => {
  const service = await import('../src/services/spotifyService.js');
  const { prisma } = await import('../src/lib/prisma.js');
  const originalFind = prisma.user.findUnique;
  const originalUpdate = prisma.user.update;
  t.after(() => { prisma.user.findUnique = originalFind; prisma.user.update = originalUpdate; });
  prisma.user.findUnique = t.mock.fn(async () => ({
    spotifyAccessToken: 'expired-access', spotifyRefreshToken: 'revoked-refresh'
  })) as typeof originalFind;
  const update = t.mock.fn(async () => ({}));
  prisma.user.update = update as typeof originalUpdate;
  t.mock.method(globalThis, 'fetch', async (input: string) =>
    String(input).includes('/api/token')
      ? Response.json({ error: 'invalid_grant' }, { status: 400 })
      : Response.json({ error: { status: 401 } }, { status: 401 }));
  await assert.rejects(service.syncUserMusicData('test-user'), (error: unknown) =>
    service.getSpotifyFailure(error).code === 'reconnect');
  assert.deepEqual(update.mock.calls[0].arguments[0], {
    where: { id: 'test-user' },
    data: { spotifyAccessToken: null, spotifyRefreshToken: null, spotifyConnected: false }
  });
});

test('OAuth state expires on the server even if the cookie survives', () => {
  const originalNow = Date.now;
  const now = originalNow();
  const state = createSpotifyAuthState();
  try {
    Date.now = () => now + oauthStateLifetimeMs + 100;
    assert.equal(consumeSpotifyAuthState(state, state), false);
  } finally {
    Date.now = originalNow;
  }
});

test('refresh request and Spotify failures are handled without exposing credentials', async () => {
  const service = await import('../src/services/spotifyService.js');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, options) => {
      assert.equal(options?.method, 'POST');
      assert.equal(new URLSearchParams(String(options?.body)).get('grant_type'), 'refresh_token');
      assert.ok(options?.signal);
      return Response.json({ access_token: 'new-access', expires_in: 3600, token_type: 'Bearer' });
    };
    assert.equal((await service.refreshSpotifyTokens('test-refresh')).access_token, 'new-access');
    globalThis.fetch = async () => Response.json({ error: 'invalid_grant' }, { status: 400 });
    await assert.rejects(service.refreshSpotifyTokens('expired'), (error: unknown) =>
      service.getSpotifyFailure(error).code === 'reconnect');
    globalThis.fetch = async () => Response.json({ error: { status: 429 } }, {
      status: 429, headers: { 'Retry-After': '30' }
    });
    await assert.rejects(service.fetchSpotifyProfile('test'), (error: unknown) =>
      error instanceof service.SpotifyRequestError && error.retryAfter === 30);
    globalThis.fetch = async () => { throw new DOMException('Timed out', 'TimeoutError'); };
    await assert.rejects(service.fetchSpotifyProfile('test'), (error: unknown) =>
      service.getSpotifyFailure(error).code === 'unavailable');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
