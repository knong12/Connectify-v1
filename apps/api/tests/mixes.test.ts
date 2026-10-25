import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test, type TestContext } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import { selectMix, type MixFavorite } from '../src/services/mixSelection.js';

const scopes = ['playlist-modify-public'];
type FetchInput = Parameters<typeof fetch>[0];
const trackId = (n: number) => String(n).padStart(22, '0');
const favorite = (n: number, rank = 1, timeRange: MixFavorite['timeRange'] = 'short_term', artistName = `Artist ${n}`): MixFavorite => ({
  track: { spotifyId: trackId(n), name: `Track ${n}`, artistName, albumArt: null }, rank, timeRange
});

test('selection aggregates windows, deduplicates repeated rows, and labels shared tracks truthfully', () => {
  const a = favorite(1, 2);
  const b = favorite(2, 1);
  const rows = [a, a, { ...a, timeRange: 'medium_term' as const }, { ...a, timeRange: 'long_term' as const }, b];
  const result = selectMix(rows, [favorite(1, 1, 'long_term')]);
  assert.deepEqual(result.map((track) => track.spotifyId), [trackId(1), trackId(2)]);
  assert.equal(result[0].source, 'shared');
  assert.equal(result[0].reason, 'Appears in both synced top-track profiles.');
  assert.equal(result[1].source, 'you');
  assert.match(result[1].reason, /^From your synced top tracks\./);
  assert.deepEqual(result, selectMix(rows.filter((_, index) => index !== 1), [favorite(1, 1, 'long_term')]));
  // Both entries are exclusive here, so their order observes the aggregate score directly.
  assert.equal(selectMix([favorite(3, 2), favorite(3, 2, 'medium_term'), favorite(3, 2, 'long_term'), favorite(4, 1, 'medium_term')], [favorite(5)])[0].spotifyId, trackId(3));
  const duplicate = favorite(6, 4);
  assert.equal(selectMix([duplicate, duplicate, duplicate, duplicate, favorite(7, 1, 'medium_term')], [favorite(8)])[0].spotifyId, trackId(7));
});

test('selection balances both listeners, is deterministic, and never exceeds 20', () => {
  const you = Array.from({ length: 30 }, (_, i) => favorite(i + 1, i + 1));
  const them = Array.from({ length: 30 }, (_, i) => favorite(i + 101, 100 + i));
  const result = selectMix(you, them);
  assert.equal(result.length, 20);
  assert.equal(new Set(result.map((track) => track.spotifyId)).size, 20);
  assert.deepEqual(result.map((track) => track.source), Array.from({ length: 20 }, (_, i) => i % 2 ? 'them' : 'you'));
  assert.deepEqual(result, selectMix([...you].reverse(), [...them].reverse()));
  const tied = [favorite(9), favorite(8), favorite(7)];
  assert.deepEqual(selectMix(tied, [favorite(100)]), selectMix([...tied].reverse(), [favorite(100)]));
});

test('selection caps normalized artist credits at three across shared and exclusive tracks', () => {
  const you = Array.from({ length: 10 }, (_, i) => favorite(i + 1, i + 1, 'short_term', i % 2 ? ' SAME Artist ' : 'same artist'));
  const them = [favorite(1, 1, 'short_term', 'Same Artist'), ...Array.from({ length: 8 }, (_, i) => favorite(i + 101, i + 1, 'long_term', 'SAME ARTIST'))];
  const result = selectMix(you, them);
  assert.equal(result.length, 3);
  assert.equal(result.filter((track) => track.artistName.trim().toLowerCase() === 'same artist').length, 3);
});

test('selection returns empty when either profile is empty and never pads sparse profiles', () => {
  assert.deepEqual(selectMix([], []), []);
  assert.deepEqual(selectMix([favorite(1)], []), []);
  assert.deepEqual(selectMix([], [favorite(1)]), []);
  const result = selectMix([favorite(1)], [favorite(2)]);
  assert.deepEqual(result.map((track) => [track.spotifyId, track.source]), [[trackId(1), 'you'], [trackId(2), 'them']]);
  assert.match(result[1].reason, /^From their synced top tracks\./);
  assert.equal(selectMix([favorite(1, 0), { ...favorite(2), track: { ...favorite(2).track, spotifyId: 'invalid' } }], [favorite(3)]).length, 0);
});

async function spotifyModules() {
  // Unit runs need no database or real OAuth configuration. Opt-in runs load the API's .env.
  if (process.env.RUN_MIX_DB_TESTS !== '1') {
    process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test';
    process.env.JWT_SECRET ??= 'mix-tests-only';
    process.env.CLIENT_URL ??= 'http://localhost:5173';
    process.env.SPOTIFY_CLIENT_ID ??= 'mix-tests-only';
    process.env.SPOTIFY_CLIENT_SECRET ??= 'mix-tests-only';
    process.env.SPOTIFY_REDIRECT_URI ??= 'http://localhost:5001/callback';
  }
  const service = await import('../src/services/spotifyService.js');
  const { prisma } = await import('../src/lib/prisma.js');
  return { service, prisma };
}

async function mockCredentials(t: TestContext, overrides: Record<string, unknown> = {}) {
  const { service, prisma } = await spotifyModules();
  const originalFind = prisma.user.findUnique, originalUpdate = prisma.user.update;
  t.after(() => { prisma.user.findUnique = originalFind; prisma.user.update = originalUpdate; });
  const find = t.mock.fn(async () => ({
    spotifyAccessToken: 'fixture-expired', spotifyRefreshToken: 'fixture-refresh', spotifyScopes: scopes, ...overrides
  }));
  const update = t.mock.fn(async () => ({}));
  prisma.user.findUnique = find as unknown as typeof originalFind;
  prisma.user.update = update as unknown as typeof originalUpdate;
  return { service, find, update };
}

test('playlist requests refresh once, preserve omitted refresh tokens, and retry the exact endpoint/body', async (t) => {
  const { service, find, update } = await mockCredentials(t);
  const paths: string[] = [];
  const body = JSON.stringify({ uris: [`spotify:track:${trackId(1)}`] });
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: FetchInput, options?: RequestInit) => {
    const url = String(input); paths.push(url);
    assert.ok(options?.signal);
    if (url === 'https://accounts.spotify.com/api/token') {
      assert.equal(options?.method, 'POST');
      assert.equal(new URLSearchParams(String(options?.body)).get('refresh_token'), 'fixture-refresh');
      return Response.json({ access_token: 'fixture-new', expires_in: 3600, token_type: 'Bearer' });
    }
    assert.equal(url, `https://api.spotify.com/v1/playlists/${trackId(90)}/items`);
    assert.equal(options?.method, 'PUT'); assert.equal(options?.body, body);
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(headers.get('authorization'), paths.length === 1 ? 'Bearer fixture-expired' : 'Bearer fixture-new');
    return paths.length === 1 ? Response.json({}, { status: 401 }) : Response.json({ snapshot_id: 'fixture' });
  });
  assert.deepEqual(await service.spotifyPlaylistRequest('fixture-user', `/playlists/${trackId(90)}/items`, { method: 'PUT', body }), { snapshot_id: 'fixture' });
  assert.equal(fetchMock.mock.callCount(), 3);
  assert.deepEqual((find.mock.calls[0].arguments as unknown as [{ where: unknown }])[0].where, { id: 'fixture-user' });
  assert.deepEqual((update.mock.calls[0].arguments as unknown[])[0], { where: { id: 'fixture-user' }, data: {
    spotifyAccessToken: 'fixture-new', spotifyRefreshToken: 'fixture-refresh'
  } });
});

test('playlist requests require playlist-modify-public before any fetch, even with private scopes', async (t) => {
  const { service } = await mockCredentials(t, { spotifyScopes: ['playlist-modify-private', 'playlist-read-private'] });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external request'); });
  await assert.rejects(service.spotifyPlaylistRequest('fixture-user', '/me/playlists', { method: 'POST' }), { code: 'permission_required', status: 403 });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('playlist refresh never loops on a second 401', async (t) => {
  const { service } = await mockCredentials(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: FetchInput) => String(input).includes('/api/token')
    ? Response.json({ access_token: 'fixture-new', scope: scopes.join(' ') }) : Response.json({}, { status: 401 }));
  await assert.rejects(service.spotifyPlaylistRequest('fixture-user', '/me/playlists', { method: 'POST' }), { status: 401 });
  assert.equal(fetchMock.mock.callCount(), 3);
});

test('revoked refresh clears credentials and scopes without retrying the playlist write', async (t) => {
  const { service, update } = await mockCredentials(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: FetchInput) => String(input).includes('/api/token')
    ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : Response.json({}, { status: 401 }));
  await assert.rejects(service.spotifyPlaylistRequest('fixture-user', '/me/playlists', { method: 'POST' }), { code: 'invalid_grant' });
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.deepEqual((update.mock.calls[0].arguments as unknown as [{ data: unknown }])[0].data, {
    spotifyAccessToken: null, spotifyRefreshToken: null, spotifyConnected: false, spotifyScopes: []
  });
});

test('refresh must recheck returned scopes before retrying an external playlist write', async (t) => {
  const { service } = await mockCredentials(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: FetchInput) => String(input).includes('/api/token')
    ? Response.json({ access_token: 'fixture-new', scope: 'user-top-read' })
    : Response.json({}, { status: 401 }));
  await assert.rejects(service.spotifyPlaylistRequest('fixture-user', '/me/playlists', { method: 'POST' }), { code: 'permission_required', status: 403 });
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('mix routes and service with isolated real database fixtures and mocked Spotify', {
  skip: process.env.RUN_MIX_DB_TESTS !== '1', timeout: 60_000
}, async (t) => {
  const { prisma } = await spotifyModules();
  const { env } = await import('../src/config/env.js');
  const { default: router } = await import('../src/routes/mixes.js');
  const app = express(); app.use(express.json()); app.use('/api/mixes', router);
  const server = createServer(app);
  const localFetch = globalThis.fetch;
  const createdUsers: string[] = [], createdTracks: string[] = [];
  type Call = { path: string; method: string; body: any };
  let calls: Call[] = [], mode: 'ok' | 'put-failure' | 'timeout' | 'bad-contents' | 'private' | 'repairable' | 'collaborative' | 'final-private' | 'wrong-owner' = 'ok';
  let visibilityRepaired = false;
  let expectedUris: string[] = [], spotifyOwner = '';
  const playlistId = trackId(900);
  t.mock.method(globalThis, 'fetch', async (input: FetchInput, options?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.spotify.com');
    const method = options?.method ?? 'GET';
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ path: `${url.pathname}${url.search}`, method, body });
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer mix-fixture-access');
    if (url.pathname === '/v1/me/playlists' && method === 'POST') {
      if (mode === 'timeout') throw new DOMException('Fixture timeout', 'TimeoutError');
      return Response.json({ id: playlistId });
    }
    if (url.pathname === `/v1/playlists/${playlistId}/items` && method === 'PUT') {
      if (mode === 'put-failure') return Response.json({}, { status: 503 });
      return Response.json({ snapshot_id: 'fixture' });
    }
    if (url.pathname === `/v1/playlists/${playlistId}` && method === 'GET') {
      const tracksWritten = calls.some((call) => call.method === 'PUT' && call.path.endsWith('/items'));
      return Response.json({ public: !(mode === 'private' || (mode === 'repairable' && !visibilityRepaired) || (mode === 'final-private' && tracksWritten)),
        collaborative: mode === 'collaborative' && !visibilityRepaired,
        owner: { id: mode === 'wrong-owner' ? 'not-the-fixture-owner' : spotifyOwner } });
    }
    if (url.pathname === `/v1/playlists/${playlistId}` && method === 'PUT') {
      assert.deepEqual(body, { public: true, collaborative: false });
      if (mode === 'repairable' || mode === 'collaborative') visibilityRepaired = true;
      return new Response(null, { status: 200 });
    }
    if (`${url.pathname}${url.search}` === `/v1/playlists/${playlistId}/items?limit=50` && method === 'GET') {
      return Response.json({ items: (mode === 'bad-contents' ? [] : expectedUris).map((uri) => ({ item: { uri } })), next: null });
    }
    throw new Error('Unexpected Spotify endpoint');
  });
  async function user(connected = true) {
    const id = randomUUID();
    await prisma.user.create({ data: { id, email: `${id}@mix-tests.invalid`, displayName: 'Mix Fixture',
      spotifyUserId: `mix-test-${id}`, spotifyConnected: connected, spotifyScopes: connected ? scopes : [],
      spotifyAccessToken: 'mix-fixture-access', spotifyRefreshToken: 'mix-fixture-refresh' } });
    createdUsers.push(id); return id;
  }
  async function request(who: string | null, path = '', body?: unknown) {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const response = await localFetch(`http://127.0.0.1:${address.port}/api/mixes${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${jwt.sign({ userId: who }, env.JWT_SECRET, { expiresIn: '5m' })}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const owner = await user(), target = await user(), outsider = await user(), unprivileged = await user(false);
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const spotifyId = randomUUID().replaceAll('-', '').slice(0, 22);
      const track = await prisma.track.create({ data: { spotifyId, name: `Fixture ${i}`, artistName: `Fixture artist ${i}` } });
      createdTracks.push(track.id); ids.push(spotifyId);
      await prisma.userFavoriteTrack.createMany({ data: [owner, target, unprivileged].map((userId) => ({ userId, trackId: track.id, rank: i + 1, timeRange: 'short_term' })) });
    }
    const input = (trackIds = ids) => ({ requestId: randomUUID(), targetUserId: target, name: 'Fixture Mix', trackIds });
    spotifyOwner = `mix-test-${owner}`; expectedUris = ids.map((id) => `spotify:track:${id}`);

    await t.test('auth, self selection, preview privacy and zero Spotify calls', async () => {
      assert.equal((await request(null, `/preview/${target}`)).status, 401);
      assert.equal((await request(null, '', input())).status, 401);
      assert.equal((await request(null, `/${randomUUID()}`)).status, 401);
      assert.equal((await request(owner, `/preview/${owner}`)).status, 400);
      assert.equal((await request(owner, '', { ...input(), targetUserId: owner })).status, 400);
      const preview = await request(owner, `/preview/${target}`);
      assert.equal(preview.status, 200); assert.equal(preview.headers.get('cache-control'), 'no-store');
      assert.equal(preview.data.canSave, true); assert.equal(preview.data.tracks.length, 20);
      assert.deepEqual(Object.keys(preview.data.owner).sort(), ['displayName', 'id']);
      assert.equal(JSON.stringify(preview.data).includes('mix-fixture-access'), false);
      assert.equal((await request(unprivileged, `/preview/${target}`)).data.canSave, false);
      await prisma.user.update({ where: { id: unprivileged }, data: {
        spotifyConnected: true, spotifyScopes: ['playlist-modify-private', 'playlist-read-private']
      } });
      assert.equal((await request(unprivileged, `/preview/${target}`)).data.canSave, false);
      assert.equal(calls.length, 0);
    });

    await t.test('1..20 distinct preview tracks enforced, forged IDs rejected, permissions required', async () => {
      for (const trackIds of [[], [...ids, trackId(888)], [ids[0], ids[0]], ['invalid']]) {
        const response = await request(owner, '', input(trackIds));
        assert.equal(response.status, 400); assert.equal(response.data.code, 'invalid_request');
      }
      const forged = await request(owner, '', input([trackId(889)]));
      assert.equal(forged.status, 400); assert.equal(forged.data.code, 'invalid_tracks');
      const denied = await request(unprivileged, '', input([ids[0]]));
      assert.equal(denied.status, 403); assert.equal(denied.data.code, 'permission_required');
      assert.equal(calls.length, 0);
    });

    await t.test('20-track save with only public scope creates public noncollaborative playlist, PUTs exact URIs, verifies, and is idempotent', async () => {
      calls = []; const body = input();
      const saved = await request(owner, '', body);
      assert.equal(saved.status, 200); assert.equal(saved.data.status, 'saved');
      assert.equal(saved.data.playlistUrl, `https://open.spotify.com/playlist/${playlistId}`);
      assert.deepEqual(calls.map(({ path, method }) => [method, path]), [
        ['POST', '/v1/me/playlists'], ['GET', `/v1/playlists/${playlistId}`], ['PUT', `/v1/playlists/${playlistId}/items`],
        ['GET', `/v1/playlists/${playlistId}`], ['GET', `/v1/playlists/${playlistId}/items?limit=50`]
      ]);
      assert.equal(calls[0].body.name, body.name); assert.equal(calls[0].body.public, true); assert.equal(calls[0].body.collaborative, false);
      assert.deepEqual(calls.find((call) => call.method === 'PUT' && call.path.endsWith('/items'))?.body, { uris: expectedUris });
      assert.equal((await prisma.mixSave.findUniqueOrThrow({ where: { id: body.requestId } })).status, 'saved');
      assert.deepEqual((await request(owner, '', body)).data, saved.data); assert.equal(calls.length, 5);
      assert.deepEqual((await request(owner, `/${body.requestId}`)).data, saved.data);
      assert.equal((await request(outsider, `/${body.requestId}`)).status, 404);
      assert.equal((await request(target, `/${body.requestId}`)).status, 404);
      assert.equal((await request(outsider, '', body)).status, 404);
      assert.equal((await request(owner, '', { ...body, name: 'Conflicting mix' })).status, 409);
      assert.equal(calls.length, 5);
    });

    await t.test('partial PUT failure reuses the existing playlist on the same request retry', async () => {
      const retryOwner = await user();
      await prisma.userFavoriteTrack.create({ data: { userId: retryOwner, trackId: createdTracks[0], rank: 1, timeRange: 'short_term' } });
      spotifyOwner = `mix-test-${retryOwner}`; expectedUris = [`spotify:track:${ids[0]}`];
      calls = []; mode = 'put-failure'; const body = input([ids[0]]);
      assert.notEqual((await request(retryOwner, '', body)).status, 200);
      const row = await prisma.mixSave.findUniqueOrThrow({ where: { id: body.requestId } });
      assert.equal(row.spotifyPlaylistId, playlistId); assert.equal(row.status, 'adding');
      assert.equal((await request(retryOwner, `/${body.requestId}`)).data.status, 'pending');
      mode = 'ok'; const retried = await request(retryOwner, '', body);
      assert.equal(retried.status, 200); assert.equal(retried.data.status, 'saved');
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
      assert.equal(calls.filter((call) => call.method === 'PUT').length, 2);
      for (const call of calls.filter((call) => call.method === 'PUT')) assert.deepEqual(call.body, { uris: expectedUris });
    });

    await t.test('creation timeout stays uncertain and never retries POST', async () => {
      const uncertainOwner = await user();
      await prisma.userFavoriteTrack.create({ data: { userId: uncertainOwner, trackId: createdTracks[0], rank: 1, timeRange: 'short_term' } });
      calls = []; mode = 'timeout'; const body = input([ids[0]]);
      for (let i = 0; i < 2; i++) {
        const response = await request(uncertainOwner, '', body);
        assert.equal(response.status, 409); assert.equal(response.data.code, 'save_uncertain');
      }
      assert.equal(calls.length, 1); assert.equal(calls[0].method, 'POST');
      assert.equal((await request(uncertainOwner, `/${body.requestId}`)).data.status, 'uncertain');
      assert.equal((await request(outsider, `/${body.requestId}`)).status, 404);
    });

    await t.test('failed contents verification is not reported as saved and retry reuses playlist', async () => {
      const verifyOwner = await user();
      await prisma.userFavoriteTrack.create({ data: { userId: verifyOwner, trackId: createdTracks[0], rank: 1, timeRange: 'short_term' } });
      spotifyOwner = `mix-test-${verifyOwner}`; expectedUris = [`spotify:track:${ids[0]}`];
      calls = []; mode = 'bad-contents'; const body = input([ids[0]]);
      const failed = await request(verifyOwner, '', body);
      assert.equal(failed.status, 502); assert.equal(failed.data.code, 'verification_failed');
      assert.equal((await request(verifyOwner, `/${body.requestId}`)).data.status, 'pending');
      mode = 'ok'; assert.equal((await request(verifyOwner, '', body)).data.status, 'saved');
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
    });

    await t.test('private visibility blocks all track writes and retries reuse playlist without manual privacy changes', async () => {
      const visibilityOwner = await user();
      await prisma.userFavoriteTrack.create({ data: { userId: visibilityOwner, trackId: createdTracks[0], rank: 1, timeRange: 'short_term' } });
      spotifyOwner = `mix-test-${visibilityOwner}`; expectedUris = [`spotify:track:${ids[0]}`];
      calls = []; mode = 'private'; const body = input([ids[0]]);
      const failed = await request(visibilityOwner, '', body);
      assert.equal(failed.status, 502); assert.equal(failed.data.code, 'visibility_unverified');
      if (failed.data.playlistUrl !== undefined) assert.equal(failed.data.playlistUrl, `https://open.spotify.com/playlist/${playlistId}`);
      assert.doesNotMatch(failed.data.message, /make.*private|change.*privacy|manually/i);
      assert.deepEqual(calls.map(({ path, method }) => [method, path]), [
        ['POST', '/v1/me/playlists'], ['GET', `/v1/playlists/${playlistId}`],
        ['PUT', `/v1/playlists/${playlistId}`], ['GET', `/v1/playlists/${playlistId}`]
      ]);
      assert.equal(calls.some((call) => call.path.includes('/items')), false);
      assert.equal((await request(visibilityOwner, `/${body.requestId}`)).data.status, 'pending');
      assert.equal((await request(outsider, `/${body.requestId}`)).status, 404);
      const repeated = await request(visibilityOwner, '', body);
      assert.equal(repeated.status, 502); assert.equal(repeated.data.code, 'visibility_unverified');
      assert.equal(calls.some((call) => call.path.includes('/items')), false);
      mode = 'repairable'; visibilityRepaired = false;
      const recovered = await request(visibilityOwner, '', body);
      assert.equal(recovered.status, 200); assert.equal(recovered.data.status, 'saved');
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
      assert.equal(calls.filter((call) => call.method === 'PUT' && call.path.endsWith('/items')).length, 1);
    });

    for (const repairMode of ['repairable', 'collaborative'] as const) {
      await t.test(`successful ${repairMode} visibility repair must be GET-verified before writing tracks`, async () => {
        const repairOwner = await user();
        await prisma.userFavoriteTrack.create({ data: { userId: repairOwner, trackId: createdTracks[0], rank: 1, timeRange: 'short_term' } });
        spotifyOwner = `mix-test-${repairOwner}`; expectedUris = [`spotify:track:${ids[0]}`];
        calls = []; mode = repairMode; visibilityRepaired = false;
        const saved = await request(repairOwner, '', input([ids[0]]));
        assert.equal(saved.status, 200); assert.equal(saved.data.status, 'saved');
        assert.deepEqual(calls.map(({ path, method }) => [method, path]), [
          ['POST', '/v1/me/playlists'], ['GET', `/v1/playlists/${playlistId}`],
          ['PUT', `/v1/playlists/${playlistId}`], ['GET', `/v1/playlists/${playlistId}`],
          ['PUT', `/v1/playlists/${playlistId}/items`],
          ['GET', `/v1/playlists/${playlistId}`], ['GET', `/v1/playlists/${playlistId}/items?limit=50`]
        ]);
      });
    }

    await t.test('final private visibility is not reported as saved even with verified contents', async () => {
      const verifyOwner = await user();
      await prisma.userFavoriteTrack.create({ data: { userId: verifyOwner, trackId: createdTracks[0], rank: 1, timeRange: 'short_term' } });
      spotifyOwner = `mix-test-${verifyOwner}`; expectedUris = [`spotify:track:${ids[0]}`];
      calls = []; mode = 'final-private'; const body = input([ids[0]]);
      const failed = await request(verifyOwner, '', body);
      assert.equal(failed.status, 502); assert.equal(failed.data.code, 'verification_failed');
      assert.equal(calls.some((call) => call.method === 'PUT' && call.path.endsWith('/items')), true);
      assert.equal((await request(verifyOwner, `/${body.requestId}`)).data.status, 'pending');
      mode = 'ok'; assert.equal((await request(verifyOwner, '', body)).data.status, 'saved');
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
    });

    await t.test('unverified ownership blocks any track write', async () => {
      const wrongOwner = await user();
      await prisma.userFavoriteTrack.create({ data: { userId: wrongOwner, trackId: createdTracks[0], rank: 1, timeRange: 'short_term' } });
      calls = []; mode = 'wrong-owner';
      const response = await request(wrongOwner, '', input([ids[0]]));
      assert.equal(response.status, 502);
      assert.equal(calls.some((call) => call.path.includes('/items')), false);
    });
  } finally {
    try {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    } finally {
      try {
        // IDs are recorded only after successful creates; no existing rows are updated or deleted.
        await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
        await prisma.track.deleteMany({ where: { id: { in: createdTracks } } });
      } finally { await prisma.$disconnect(); }
    }
  }
});
