import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSpotifyAuthState, consumeSpotifyAuthState, oauthStateLifetimeMs } from '../src/services/oauthState.js';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-secret';
process.env.CLIENT_URL ??= 'http://localhost:5173';
process.env.SPOTIFY_CLIENT_ID ??= 'test-client';
process.env.SPOTIFY_CLIENT_SECRET ??= 'test-secret';
process.env.SPOTIFY_REDIRECT_URI ??= 'http://127.0.0.1:5000/api/auth/spotify/callback';

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
