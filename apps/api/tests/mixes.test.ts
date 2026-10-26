import assert from 'node:assert/strict'; // Import assertions that fail the test when actual behavior differs from expectations.
import { randomUUID } from 'node:crypto'; // Import random UUID generation for disposable records and save-operation IDs.
import { createServer } from 'node:http'; // Import the HTTP server used to exercise the real routes locally.
import { test, type TestContext } from 'node:test'; // Import Node's test runner and the TypeScript test-context type.
import express from 'express'; // Import Express to build a temporary API app for integration tests.
import jwt from 'jsonwebtoken'; // Import JWT signing so local API requests can authenticate as fixture users.
import { selectMix, type MixFavorite } from '../src/services/mixSelection.js'; // Import track selection and its TypeScript input shape for the selection tests.

const scopes = ['playlist-modify-public']; // Use only the public-playlist permission in these test fixtures.
type FetchInput = Parameters<typeof fetch>[0]; // Reuse fetch's input type so the mock accepts the same input shape.
const trackId = (n: number) => String(n).padStart(22, '0'); // Generate deterministic 22-character test IDs; these are not real Spotify tracks.
const favorite = (n: number, rank = 1, timeRange: MixFavorite['timeRange'] = 'short_term', artistName = `Artist ${n}`): MixFavorite => ({ // Create a small fake favorite with overridable rank, window, and artist credit.
  track: { spotifyId: trackId(n), name: `Track ${n}`, artistName, albumArt: null }, rank, timeRange // Fill the fixture track metadata and attach its ranking/time-window information.
}); // Finish this callback, object-based call, or test scenario.

test('selection aggregates windows, deduplicates repeated rows, and labels shared tracks truthfully', () => { // Start this named scenario; the title states the behavior its assertions check.
  const a = favorite(1, 2); // Prepare the specific fixture inputs used by this named selection or API scenario.
  const b = favorite(2, 1); // Prepare the specific fixture inputs used by this named selection or API scenario.
  const rows = [a, a, { ...a, timeRange: 'medium_term' as const }, { ...a, timeRange: 'long_term' as const }, b]; // Prepare the specific fixture inputs used by this named selection or API scenario.
  const result = selectMix(rows, [favorite(1, 1, 'long_term')]); // Run the real selection logic against these fake profiles and capture its result.
  assert.deepEqual(result.map((track) => track.spotifyId), [trackId(1), trackId(2)]); // Compare ordered selected track data with the exact expected structure/order: [trackId(1), trackId(2)].
  assert.equal(result[0].source, 'shared'); // Check first song's source label equals 'shared'.
  assert.equal(result[0].reason, 'Appears in both synced top-track profiles.'); // Check shared-song explanation equals 'Appears in both synced top-track profiles.'.
  assert.equal(result[1].source, 'you'); // Check second song's source label equals 'you'.
  assert.match(result[1].reason, /^From your synced top tracks\./); // Check other-person or owner explanation has the required explanation wording.
  assert.deepEqual(result, selectMix(rows.filter((_, index) => index !== 1), [favorite(1, 1, 'long_term')])); // Compare result with the exact expected structure/order.
  assert.equal(selectMix([favorite(3, 2), favorite(3, 2, 'medium_term'), favorite(3, 2, 'long_term'), favorite(4, 1, 'medium_term')], [favorite(5)])[0].spotifyId, trackId(3)); // Check selection behavior for these fixture inputs equals trackId(3).
  const duplicate = favorite(6, 4); // Prepare the specific fixture inputs used by this named selection or API scenario.
  assert.equal(selectMix([duplicate, duplicate, duplicate, duplicate, favorite(7, 1, 'medium_term')], [favorite(8)])[0].spotifyId, trackId(7)); // Check selection behavior for these fixture inputs equals trackId(7).
}); // Finish this callback, object-based call, or test scenario.

test('selection balances both listeners, is deterministic, and never exceeds 20', () => { // Start this named scenario; the title states the behavior its assertions check.
  const you = Array.from({ length: 30 }, (_, i) => favorite(i + 1, i + 1)); // Prepare the specific fixture inputs used by this named selection or API scenario.
  const them = Array.from({ length: 30 }, (_, i) => favorite(i + 101, 100 + i)); // Prepare the specific fixture inputs used by this named selection or API scenario.
  const result = selectMix(you, them); // Run the real selection logic against these fake profiles and capture its result.
  assert.equal(result.length, 20); // Check number of selected songs equals 20.
  assert.equal(new Set(result.map((track) => track.spotifyId)).size, 20); // Check ordered selected track data equals 20.
  assert.deepEqual(result.map((track) => track.source), Array.from({ length: 20 }, (_, i) => i % 2 ? 'them' : 'you')); // Compare ordered selected track data with the exact expected structure/order.
  assert.deepEqual(result, selectMix([...you].reverse(), [...them].reverse())); // Compare result with the exact expected structure/order.
  const tied = [favorite(9), favorite(8), favorite(7)]; // Prepare the specific fixture inputs used by this named selection or API scenario.
  assert.deepEqual(selectMix(tied, [favorite(100)]), selectMix([...tied].reverse(), [favorite(100)])); // Compare selection behavior for these fixture inputs with the exact expected structure/order.
}); // Finish this callback, object-based call, or test scenario.

test('selection caps normalized artist credits at three across shared and exclusive tracks', () => { // Start this named scenario; the title states the behavior its assertions check.
  const you = Array.from({ length: 10 }, (_, i) => favorite(i + 1, i + 1, 'short_term', i % 2 ? ' SAME Artist ' : 'same artist')); // Prepare the specific fixture inputs used by this named selection or API scenario.
  const them = [favorite(1, 1, 'short_term', 'Same Artist'), ...Array.from({ length: 8 }, (_, i) => favorite(i + 101, i + 1, 'long_term', 'SAME ARTIST'))]; // Prepare the specific fixture inputs used by this named selection or API scenario.
  const result = selectMix(you, them); // Run the real selection logic against these fake profiles and capture its result.
  assert.equal(result.length, 3); // Check number of selected songs equals 3.
  assert.equal(result.filter((track) => track.artistName.trim().toLowerCase() === 'same artist').length, 3); // Check result.filter((track) => track.artistName.trim().toLowerCase() === 'same artist').len equals 3.
}); // Finish this callback, object-based call, or test scenario.

test('selection returns empty when either profile is empty and never pads sparse profiles', () => { // Start this named scenario; the title states the behavior its assertions check.
  assert.deepEqual(selectMix([], []), []); // Compare selection behavior for these fixture inputs with the exact expected structure/order: [].
  assert.deepEqual(selectMix([favorite(1)], []), []); // Compare selection behavior for these fixture inputs with the exact expected structure/order: [].
  assert.deepEqual(selectMix([], [favorite(1)]), []); // Compare selection behavior for these fixture inputs with the exact expected structure/order: [].
  const result = selectMix([favorite(1)], [favorite(2)]); // Run the real selection logic against these fake profiles and capture its result.
  assert.deepEqual(result.map((track) => [track.spotifyId, track.source]), [[trackId(1), 'you'], [trackId(2), 'them']]); // Compare ordered selected track data with the exact expected structure/order: [[trackId(1), 'you'], [trackId(2), 'them']].
  assert.match(result[1].reason, /^From their synced top tracks\./); // Check other-person or owner explanation has the required explanation wording.
  assert.equal(selectMix([favorite(1, 0), { ...favorite(2), track: { ...favorite(2).track, spotifyId: 'invalid' } }], [favorite(3)]).length, 0); // Check selection behavior for these fixture inputs equals 0.
}); // Finish this callback, object-based call, or test scenario.

async function spotifyModules() { // Load the Spotify helper and Prisma after setting appropriate test configuration.
  if (process.env.RUN_MIX_DB_TESTS !== '1') { // Use dummy settings for unit tests; real-database tests require an explicit opt-in.
    process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'; // Provide a test-only default only if this setting is absent; this line is not a production secret.
    process.env.JWT_SECRET ??= 'mix-tests-only'; // Provide a test-only default only if this setting is absent; this line is not a production secret.
    process.env.CLIENT_URL ??= 'http://localhost:5173'; // Provide a test-only default only if this setting is absent; this line is not a production secret.
    process.env.SPOTIFY_CLIENT_ID ??= 'mix-tests-only'; // Provide a test-only default only if this setting is absent; this line is not a production secret.
    process.env.SPOTIFY_CLIENT_SECRET ??= 'mix-tests-only'; // Provide a test-only default only if this setting is absent; this line is not a production secret.
    process.env.SPOTIFY_REDIRECT_URI ??= 'http://localhost:5001/callback'; // Provide a test-only default only if this setting is absent; this line is not a production secret.
  } // Close the current block and continue in its enclosing function or scenario.
  const service = await import('../src/services/spotifyService.js'); // Import the Spotify service after its configuration is prepared.
  const { prisma } = await import('../src/lib/prisma.js'); // Load the shared Prisma client for mocking or temporary-fixture integration checks.
  return { service, prisma }; // Return the imported service and database client to the test helper.
} // Close the current block and continue in its enclosing function or scenario.

async function mockCredentials(t: TestContext, overrides: Record<string, unknown> = {}) { // Replace credential database calls with controlled test doubles for this test.
  const { service, prisma } = await spotifyModules(); // Load the Spotify helper and shared Prisma client before replacing credential methods.
  const originalFind = prisma.user.findUnique, originalUpdate = prisma.user.update; // Save the real Prisma methods so they can be restored after the test.
  t.after(() => { prisma.user.findUnique = originalFind; prisma.user.update = originalUpdate; }); // Restore the original methods after this test, including when an assertion fails.
  const find = t.mock.fn(async () => ({ // Mock the credential lookup and record calls for later assertions.
    spotifyAccessToken: 'fixture-expired', spotifyRefreshToken: 'fixture-refresh', spotifyScopes: scopes, ...overrides // Supply deliberately fake credentials and apply any scenario-specific overrides.
  })); // Close the current block and continue in its enclosing function or scenario.
  const update = t.mock.fn(async () => ({})); // Mock credential updates rather than writing to a database in these unit tests.
  prisma.user.findUnique = find as unknown as typeof originalFind; // Install the mocked credential lookup for this test.
  prisma.user.update = update as unknown as typeof originalUpdate; // Install the mocked credential update for this test.
  return { service, find, update }; // Return the service plus mocks so the test can inspect what it did.
} // Close the current block and continue in its enclosing function or scenario.

test('playlist requests refresh once, preserve omitted refresh tokens, and retry the exact endpoint/body', async (t) => { // Start this named scenario; the title states the behavior its assertions check.
  const { service, find, update } = await mockCredentials(t); // Prepare mocked stored credentials and capture the methods needed for assertions.
  const paths: string[] = []; // Record the requested URLs to prove the refresh/retry sequence.
  const body = JSON.stringify({ uris: [`spotify:track:${trackId(1)}`] }); // Prepare the exact ordered track-write payload the retry must preserve.
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: FetchInput, options?: RequestInit) => { // Intercept external fetch calls; the test never contacts a real Spotify account.
    const url = String(input); paths.push(url); // Record this mock request URL so the test can check request order.
    assert.ok(options?.signal); // Require presence of a request timeout signal to be present/true before the test continues.
    if (url === 'https://accounts.spotify.com/api/token') { // Return a simulated token-refresh response for the Spotify Accounts endpoint.
      assert.equal(options?.method, 'POST'); // Check external HTTP method equals 'POST'.
      assert.equal(new URLSearchParams(String(options?.body)).get('refresh_token'), 'fixture-refresh'); // Check external request body equals 'fixture-refresh'.
      return Response.json({ access_token: 'fixture-new', expires_in: 3600, token_type: 'Bearer' }); // Return a fake refreshed token rather than calling Spotify.
    } // Close the current block and continue in its enclosing function or scenario.
    assert.equal(url, `https://api.spotify.com/v1/playlists/${trackId(90)}/items`); // Check url equals `https://api.spotify.com/v1/playlists/${trackId(90)}/items`.
    assert.equal(options?.method, 'PUT'); assert.equal(options?.body, body); // Check external HTTP method equals 'PUT'; also check the remaining assertions on this line.
    const headers = new Headers(options?.headers); // Normalize request headers before checking authorization and content type.
    assert.equal(headers.get('content-type'), 'application/json'); // Check request content type equals 'application/json'.
    assert.equal(headers.get('authorization'), paths.length === 1 ? 'Bearer fixture-expired' : 'Bearer fixture-new'); // Check Spotify authorization header equals paths.length === 1 ? 'Bearer fixture-expired' : 'Bearer fixture-new'.
    return paths.length === 1 ? Response.json({}, { status: 401 }) : Response.json({ snapshot_id: 'fixture' }); // Make the first attempt expire with 401 and the retry succeed with a fake snapshot.
  }); // Finish this callback, object-based call, or test scenario.
  assert.deepEqual(await service.spotifyPlaylistRequest('fixture-user', `/playlists/${trackId(90)}/items`, { method: 'PUT', body }), { snapshot_id: 'fixture' }); // Compare await service.spotifyPlaylistRequest('fixture-user', `/playlists/${trackId(90)}/items with the exact expected structure/order: { snapshot_id: 'fixture' }.
  assert.equal(fetchMock.mock.callCount(), 3); // Check number of mocked external requests equals 3.
  assert.deepEqual((find.mock.calls[0].arguments as unknown as [{ where: unknown }])[0].where, { id: 'fixture-user' }); // Compare recorded mock call arguments with the exact expected structure/order: { id: 'fixture-user' }.
  assert.deepEqual((update.mock.calls[0].arguments as unknown[])[0], { where: { id: 'fixture-user' }, data: { // Compare recorded mock call arguments with the exact expected structure/order.
    spotifyAccessToken: 'fixture-new', spotifyRefreshToken: 'fixture-refresh' // Expect the new access token but preserve the earlier refresh token when none is returned.
  } }); // Close the current block and continue in its enclosing function or scenario.
}); // Finish this callback, object-based call, or test scenario.

test('playlist requests require playlist-modify-public before any fetch, even with private scopes', async (t) => { // Start this named scenario; the title states the behavior its assertions check.
  const { service } = await mockCredentials(t, { spotifyScopes: ['playlist-modify-private', 'playlist-read-private'] }); // Prepare mocked stored credentials and capture the methods needed for assertions.
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external request'); }); // Intercept external fetch calls; the test never contacts a real Spotify account.
  await assert.rejects(service.spotifyPlaylistRequest('fixture-user', '/me/playlists', { method: 'POST' }), { code: 'permission_required', status: 403 }); // Expect the asynchronous Spotify operation to fail with the specified controlled error, not silently succeed.
  assert.equal(fetchMock.mock.callCount(), 0); // Check number of mocked external requests equals 0.
}); // Finish this callback, object-based call, or test scenario.

test('playlist refresh never loops on a second 401', async (t) => { // Start this named scenario; the title states the behavior its assertions check.
  const { service } = await mockCredentials(t); // Prepare mocked stored credentials and capture the methods needed for assertions.
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: FetchInput) => String(input).includes('/api/token') // Intercept external fetch calls; the test never contacts a real Spotify account.
    ? Response.json({ access_token: 'fixture-new', scope: scopes.join(' ') }) : Response.json({}, { status: 401 })); // Choose the simulated refresh or API response according to the requested URL.
  await assert.rejects(service.spotifyPlaylistRequest('fixture-user', '/me/playlists', { method: 'POST' }), { status: 401 }); // Expect the asynchronous Spotify operation to fail with the specified controlled error, not silently succeed.
  assert.equal(fetchMock.mock.callCount(), 3); // Check number of mocked external requests equals 3.
}); // Finish this callback, object-based call, or test scenario.

test('revoked refresh clears credentials and scopes without retrying the playlist write', async (t) => { // Start this named scenario; the title states the behavior its assertions check.
  const { service, update } = await mockCredentials(t); // Prepare mocked stored credentials and capture the methods needed for assertions.
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: FetchInput) => String(input).includes('/api/token') // Intercept external fetch calls; the test never contacts a real Spotify account.
    ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : Response.json({}, { status: 401 })); // Choose the simulated refresh or API response according to the requested URL.
  await assert.rejects(service.spotifyPlaylistRequest('fixture-user', '/me/playlists', { method: 'POST' }), { code: 'invalid_grant' }); // Expect the asynchronous Spotify operation to fail with the specified controlled error, not silently succeed.
  assert.equal(fetchMock.mock.callCount(), 2); // Check number of mocked external requests equals 2.
  assert.deepEqual((update.mock.calls[0].arguments as unknown as [{ data: unknown }])[0].data, { // Compare recorded mock call arguments with the exact expected structure/order.
    spotifyAccessToken: null, spotifyRefreshToken: null, spotifyConnected: false, spotifyScopes: [] // Expect revoked Spotify credentials and granted scopes to be cleared.
  }); // Finish this callback, object-based call, or test scenario.
}); // Finish this callback, object-based call, or test scenario.

test('refresh must recheck returned scopes before retrying an external playlist write', async (t) => { // Start this named scenario; the title states the behavior its assertions check.
  const { service } = await mockCredentials(t); // Prepare mocked stored credentials and capture the methods needed for assertions.
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: FetchInput) => String(input).includes('/api/token') // Intercept external fetch calls; the test never contacts a real Spotify account.
    ? Response.json({ access_token: 'fixture-new', scope: 'user-top-read' }) // Choose the simulated refresh or API response according to the requested URL.
    : Response.json({}, { status: 401 })); // Choose the simulated refresh or API response according to the requested URL.
  await assert.rejects(service.spotifyPlaylistRequest('fixture-user', '/me/playlists', { method: 'POST' }), { code: 'permission_required', status: 403 }); // Expect the asynchronous Spotify operation to fail with the specified controlled error, not silently succeed.
  assert.equal(fetchMock.mock.callCount(), 2); // Check number of mocked external requests equals 2.
}); // Finish this callback, object-based call, or test scenario.

test('mix routes and service with isolated real database fixtures and mocked Spotify', { // Start this named scenario; the title states the behavior its assertions check.
  skip: process.env.RUN_MIX_DB_TESTS !== '1', timeout: 60_000 // Skip database integration unless explicitly enabled; bound its runtime to 60 seconds.
}, async (t) => { // Begin the integration-test callback after its skip/timeout options.
  const { prisma } = await spotifyModules(); // Load the database client for isolated temporary fixture records.
  const { env } = await import('../src/config/env.js'); // Load test configuration, including the secret used to sign short-lived test JWTs.
  const { default: router } = await import('../src/routes/mixes.js'); // Load the real mixes router so requests exercise the actual HTTP/service flow.
  const app = express(); app.use(express.json()); app.use('/api/mixes', router); // Build a test Express app with JSON parsing and the real mixes routes.
  const server = createServer(app); // Wrap the test app in an HTTP server on a temporary local port.
  const localFetch = globalThis.fetch; // Keep the real fetch for local HTTP requests before external Spotify fetch is mocked.
  const createdUsers: string[] = [], createdTracks: string[] = []; // Track only records created by this test so cleanup cannot delete unrelated user data.
  type Call = { path: string; method: string; body: any }; // Describe the method, URL path, and parsed body recorded for each mock Spotify call.
  let calls: Call[] = [], mode: 'ok' | 'put-failure' | 'timeout' | 'bad-contents' | 'private' | 'repairable' | 'collaborative' | 'final-private' | 'wrong-owner' = 'ok'; // Choose the mock failure mode and keep a log of Spotify requests for assertions.
  let visibilityRepaired = false; // Track whether a simulated visibility repair has been applied.
  let expectedUris: string[] = [], spotifyOwner = ''; // Hold the expected ordered songs and the simulated Spotify owner ID.
  const playlistId = trackId(900); // Use a fixed fake playlist ID to prove retries reuse the same external resource.
  t.mock.method(globalThis, 'fetch', async (input: FetchInput, options?: RequestInit) => { // Intercept external fetch calls; the test never contacts a real Spotify account.
    const url = new URL(String(input)); // Parse the intercepted Spotify URL to route it to the right mock response.
    assert.equal(url.origin, 'https://api.spotify.com'); // Check external destination origin equals 'https://api.spotify.com'.
    const method = options?.method ?? 'GET'; // Treat an omitted HTTP method as GET, matching fetch behavior.
    const body = options?.body ? JSON.parse(String(options.body)) : undefined; // Parse any JSON payload so tests can examine playlist flags and track URIs.
    calls.push({ path: `${url.pathname}${url.search}`, method, body }); // Record the external request before returning its simulated response.
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer mix-fixture-access'); // Check new Headers(options?.headers).get('authorization') equals 'Bearer mix-fixture-access'.
    if (url.pathname === '/v1/me/playlists' && method === 'POST') { // Handle the simulated playlist-creation endpoint.
      if (mode === 'timeout') throw new DOMException('Fixture timeout', 'TimeoutError'); // Simulate a lost creation response, where Spotify's actual outcome would be unknown.
      return Response.json({ id: playlistId }); // Pretend Spotify successfully created the playlist and returned its ID.
    } // Close the current block and continue in its enclosing function or scenario.
    if (url.pathname === `/v1/playlists/${playlistId}/items` && method === 'PUT') { // Handle replacing songs in the simulated playlist.
      if (mode === 'put-failure') return Response.json({}, { status: 503 }); // Fail song writing with 503 AFTER the playlist has already been created.
      return Response.json({ snapshot_id: 'fixture' }); // Return a fake successful song-write snapshot.
    } // Close the current block and continue in its enclosing function or scenario.
    if (url.pathname === `/v1/playlists/${playlistId}` && method === 'GET') { // Handle a simulated playlist-details read used for ownership/visibility verification.
      const tracksWritten = calls.some((call) => call.method === 'PUT' && call.path.endsWith('/items')); // Detect whether this scenario has reached the song-write step.
      return Response.json({ public: !(mode === 'private' || (mode === 'repairable' && !visibilityRepaired) || (mode === 'final-private' && tracksWritten)), // Simulate private visibility, repair progress, or visibility changing after song writing.
        collaborative: mode === 'collaborative' && !visibilityRepaired, // Simulate collaborative mode until a requested repair takes effect.
        owner: { id: mode === 'wrong-owner' ? 'not-the-fixture-owner' : spotifyOwner } }); // Return the expected owner or deliberately return the wrong owner for the safety test.
    } // Close the current block and continue in its enclosing function or scenario.
    if (url.pathname === `/v1/playlists/${playlistId}` && method === 'PUT') { // Handle a simulated playlist-details update, distinct from changing its songs.
      assert.deepEqual(body, { public: true, collaborative: false }); // Compare body with the exact expected structure/order: { public: true, collaborative: false }.
      if (mode === 'repairable' || mode === 'collaborative') visibilityRepaired = true; // Allow only the repairable scenarios to change the simulated playlist flags.
      return new Response(null, { status: 200 }); // Simulate Spotify accepting the playlist-details update.
    } // Close the current block and continue in its enclosing function or scenario.
    if (`${url.pathname}${url.search}` === `/v1/playlists/${playlistId}/items?limit=50` && method === 'GET') { // Handle the paged track-list read used to verify final contents.
      return Response.json({ items: (mode === 'bad-contents' ? [] : expectedUris).map((uri) => ({ item: { uri } })), next: null }); // Return expected songs, or deliberately return the wrong contents for a verification-failure test.
    } // Close the current block and continue in its enclosing function or scenario.
    throw new Error('Unexpected Spotify endpoint'); // Fail the test if the service calls an endpoint the scenario did not expect.
  }); // Finish this callback, object-based call, or test scenario.
  async function user(connected = true) { // Create one disposable test user, optionally without playlist permissions.
    const id = randomUUID(); // Give each temporary user a unique local identity to avoid existing records.
    await prisma.user.create({ data: { id, email: `${id}@mix-tests.invalid`, displayName: 'Mix Fixture', // Insert a fixture user with a reserved invalid-domain email address.
      spotifyUserId: `mix-test-${id}`, spotifyConnected: connected, spotifyScopes: connected ? scopes : [], // Give the fixture a fake Spotify identity and connected/scope settings for this scenario.
      spotifyAccessToken: 'mix-fixture-access', spotifyRefreshToken: 'mix-fixture-refresh' } }); // Store fake fixture credentials accepted only by the mock Spotify handler.
    createdUsers.push(id); return id; // Record this successfully created user for cleanup and return its ID.
  } // Close the current block and continue in its enclosing function or scenario.
  async function request(who: string | null, path = '', body?: unknown) { // Send a real local HTTP request as a chosen test user or without authentication.
    const address = server.address(); assert.ok(address && typeof address !== 'string'); // Require address && typeof address !== 'string' to be present/true before the test continues.
    const response = await localFetch(`http://127.0.0.1:${address.port}/api/mixes${path}`, { // Call the local Express test server, not Spotify, using the saved real fetch.
      method: body === undefined ? 'GET' : 'POST', // Use GET for reads and POST when the helper receives a request body.
      headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${jwt.sign({ userId: who }, env.JWT_SECRET, { expiresIn: '5m' })}` } : {}) }, // Attach a short-lived signed fixture JWT only when an authenticated user was supplied.
      body: body === undefined ? undefined : JSON.stringify(body) // Serialize the local API payload, leaving GET requests without a body.
    }); // Finish this callback, object-based call, or test scenario.
    return { status: response.status, data: await response.json(), headers: response.headers }; // Return parsed JSON, HTTP status, and headers for assertions.
  } // Close the current block and continue in its enclosing function or scenario.
  try { // Attempt this work while allowing the following catch/finally block to handle failure or cleanup.
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); // Start on an available loopback port instead of interfering with the running app.
    const owner = await user(), target = await user(), outsider = await user(), unprivileged = await user(false); // Create separate owner, target, outsider, and unprivileged fixtures for access-control checks.
    const ids: string[] = []; // Collect the fake Spotify IDs used in the 20-song preview.
    for (let i = 0; i < 20; i++) { // Create 20 distinct fixture songs so the full-size mix can be exercised.
      const spotifyId = randomUUID().replaceAll('-', '').slice(0, 22); // Generate a unique plausible-format Spotify ID without using a real song.
      const track = await prisma.track.create({ data: { spotifyId, name: `Fixture ${i}`, artistName: `Fixture artist ${i}` } }); // Insert one temporary catalog track with a different artist credit.
      createdTracks.push(track.id); ids.push(spotifyId); // Record the database track for cleanup and its Spotify ID for expected results.
      await prisma.userFavoriteTrack.createMany({ data: [owner, target, unprivileged].map((userId) => ({ userId, trackId: track.id, rank: i + 1, timeRange: 'short_term' })) }); // Give the relevant fixture users the same ranked set of tracks for this preview.
    } // Close the current block and continue in its enclosing function or scenario.
    const input = (trackIds = ids) => ({ requestId: randomUUID(), targetUserId: target, name: 'Fixture Mix', trackIds }); // Create a save payload with a fresh operation UUID unless an existing body is reused.
    spotifyOwner = `mix-test-${owner}`; expectedUris = ids.map((id) => `spotify:track:${id}`); // Set the expected external owner and exact track URIs for this scenario.

    await t.test('auth, self selection, preview privacy and zero Spotify calls', async () => { // Start this named scenario; the title states the behavior its assertions check.
      assert.equal((await request(null, `/preview/${target}`)).status, 401); // Check HTTP response status equals 401.
      assert.equal((await request(null, '', input())).status, 401); // Check HTTP response status equals 401.
      assert.equal((await request(null, `/${randomUUID()}`)).status, 401); // Check HTTP response status equals 401.
      assert.equal((await request(owner, `/preview/${owner}`)).status, 400); // Check HTTP response status equals 400.
      assert.equal((await request(owner, '', { ...input(), targetUserId: owner })).status, 400); // Check HTTP response status equals 400.
      const preview = await request(owner, `/preview/${target}`); // Request this API resource as the fixture user and capture the response.
      assert.equal(preview.status, 200); assert.equal(preview.headers.get('cache-control'), 'no-store'); // Check HTTP response status equals 200; also check the remaining assertions on this line.
      assert.equal(preview.data.canSave, true); assert.equal(preview.data.tracks.length, 20); // Check permission-readiness flag equals true; also check the remaining assertions on this line.
      assert.deepEqual(Object.keys(preview.data.owner).sort(), ['displayName', 'id']); // Compare Object.keys(preview.data.owner).sort() with the exact expected structure/order: ['displayName', 'id'].
      assert.equal(JSON.stringify(preview.data).includes('mix-fixture-access'), false); // Check JSON.stringify(preview.data).includes('mix-fixture-access') equals false.
      assert.equal((await request(unprivileged, `/preview/${target}`)).data.canSave, false); // Check permission-readiness flag equals false.
      await prisma.user.update({ where: { id: unprivileged }, data: { // Change only the disposable user's permissions to test a denied save.
        spotifyConnected: true, spotifyScopes: ['playlist-modify-private', 'playlist-read-private'] // Supply private-playlist scopes alone to prove they do not authorize public playlist creation.
      } }); // Close the current block and continue in its enclosing function or scenario.
      assert.equal((await request(unprivileged, `/preview/${target}`)).data.canSave, false); // Check permission-readiness flag equals false.
      assert.equal(calls.length, 0); // Check number of recorded Spotify requests equals 0.
    }); // Finish this callback, object-based call, or test scenario.

    await t.test('1..20 distinct preview tracks enforced, forged IDs rejected, permissions required', async () => { // Start this named scenario; the title states the behavior its assertions check.
      for (const trackIds of [[], [...ids, trackId(888)], [ids[0], ids[0]], ['invalid']]) { // Try empty, oversized, duplicate, and malformed track selections.
        const response = await request(owner, '', input(trackIds)); // Exercise the API with this scenario's user and payload.
        assert.equal(response.status, 400); assert.equal(response.data.code, 'invalid_request'); // Check HTTP response status equals 400; also check the remaining assertions on this line.
      } // Close the current block and continue in its enclosing function or scenario.
      const forged = await request(owner, '', input([trackId(889)])); // Submit a valid-format song ID that was never part of the allowed preview.
      assert.equal(forged.status, 400); assert.equal(forged.data.code, 'invalid_tracks'); // Check HTTP response status equals 400; also check the remaining assertions on this line.
      const denied = await request(unprivileged, '', input([ids[0]])); // Try saving as a user lacking the required public-playlist permission.
      assert.equal(denied.status, 403); assert.equal(denied.data.code, 'permission_required'); // Check HTTP response status equals 403; also check the remaining assertions on this line.
      assert.equal(calls.length, 0); // Check number of recorded Spotify requests equals 0.
    }); // Finish this callback, object-based call, or test scenario.

    await t.test('20-track save with only public scope creates public noncollaborative playlist, PUTs exact URIs, verifies, and is idempotent', async () => { // Start this named scenario; the title states the behavior its assertions check.
      calls = []; const body = input(); // Reset the request log and capture one payload to reuse unchanged for retries.
      const saved = await request(owner, '', body); // Submit the save and inspect the API's reported outcome.
      assert.equal(saved.status, 200); assert.equal(saved.data.status, 'saved'); // Check HTTP response status equals 200; also check the remaining assertions on this line.
      assert.equal(saved.data.playlistUrl, `https://open.spotify.com/playlist/${playlistId}`); // Check returned Spotify playlist link equals `https://open.spotify.com/playlist/${playlistId}`.
      assert.deepEqual(calls.map(({ path, method }) => [method, path]), [ // Compare calls.map(({ path, method }) => [method, path]) with the exact expected structure/order.
        ['POST', '/v1/me/playlists'], ['GET', `/v1/playlists/${playlistId}`], ['PUT', `/v1/playlists/${playlistId}/items`], // Expect exactly one external playlist creation followed by the specified checks/writes.
        ['GET', `/v1/playlists/${playlistId}`], ['GET', `/v1/playlists/${playlistId}/items?limit=50`] // Expect the service to read back the playlist details or contents at this stage.
      ]); // Finish the array argument and wait for the grouped operations or comparison call.
      assert.equal(calls[0].body.name, body.name); assert.equal(calls[0].body.public, true); assert.equal(calls[0].body.collaborative, false); // Check calls[0].body.name equals body.name; also check the remaining assertions on this line.
      assert.deepEqual(calls.find((call) => call.method === 'PUT' && call.path.endsWith('/items'))?.body, { uris: expectedUris }); // Compare calls.find((call) => call.method === 'PUT' && call.path.endsWith('/items'))?.body with the exact expected structure/order: { uris: expectedUris }.
      assert.equal((await prisma.mixSave.findUniqueOrThrow({ where: { id: body.requestId } })).status, 'saved'); // Confirm the database operation is marked saved after successful verification.
      assert.deepEqual((await request(owner, '', body)).data, saved.data); assert.equal(calls.length, 5); // Repeat the same save: require the same result and no extra Spotify requests beyond the original five.
      assert.deepEqual((await request(owner, `/${body.requestId}`)).data, saved.data); // Compare (await request(owner, `/${body.requestId}`)).data with the exact expected structure/order: saved.data.
      assert.equal((await request(outsider, `/${body.requestId}`)).status, 404); // Check HTTP response status equals 404.
      assert.equal((await request(target, `/${body.requestId}`)).status, 404); // Check HTTP response status equals 404.
      assert.equal((await request(outsider, '', body)).status, 404); // Check HTTP response status equals 404.
      assert.equal((await request(owner, '', { ...body, name: 'Conflicting mix' })).status, 409); // Check HTTP response status equals 409.
      assert.equal(calls.length, 5); // Check number of recorded Spotify requests equals 5.
    }); // Finish this callback, object-based call, or test scenario.

    await t.test('partial PUT failure reuses the existing playlist on the same request retry', async () => { // Start this named scenario; the title states the behavior its assertions check.
      const retryOwner = await user(); // Create a separate disposable owner so this failure scenario cannot reuse another scenario's operation.
      await prisma.userFavoriteTrack.create({ data: { userId: retryOwner, trackId: createdTracks[0], rank: 1, timeRange: 'short_term' } }); // Give this scenario's owner one stored track so a valid mix can be generated.
      spotifyOwner = `mix-test-${retryOwner}`; expectedUris = [`spotify:track:${ids[0]}`]; // Set the expected external owner and exact track URIs for this scenario.
      calls = []; mode = 'put-failure'; const body = input([ids[0]]); // Clear prior calls and enable the simulated failure mode; keep one retry payload where supplied.
      assert.notEqual((await request(retryOwner, '', body)).status, 200); // Ensure HTTP response status is NOT 200; partial failure must not look successful.
      const row = await prisma.mixSave.findUniqueOrThrow({ where: { id: body.requestId } }); // Inspect durable save progress after the simulated failure.
      assert.equal(row.spotifyPlaylistId, playlistId); assert.equal(row.status, 'adding'); // Check stored external playlist ID equals playlistId; also check the remaining assertions on this line.
      assert.equal((await request(retryOwner, `/${body.requestId}`)).data.status, 'pending'); // Check reported save state equals 'pending'.
      mode = 'ok'; const retried = await request(retryOwner, '', body); // Restore successful Spotify responses and retry the exact same operation body.
      assert.equal(retried.status, 200); assert.equal(retried.data.status, 'saved'); // Check HTTP response status equals 200; also check the remaining assertions on this line.
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1); // Prove only one playlist was created across both attempts.
      assert.equal(calls.filter((call) => call.method === 'PUT').length, 2); // Expect two song writes: the failed attempt and the successful retry on that same playlist.
      for (const call of calls.filter((call) => call.method === 'PUT')) assert.deepEqual(call.body, { uris: expectedUris }); // Compare call.body with the exact expected structure/order: { uris: expectedUris }.
    }); // Finish this callback, object-based call, or test scenario.

    await t.test('creation timeout stays uncertain and never retries POST', async () => { // Start this named scenario; the title states the behavior its assertions check.
      const uncertainOwner = await user(); // Create a separate disposable owner so this failure scenario cannot reuse another scenario's operation.
      await prisma.userFavoriteTrack.create({ data: { userId: uncertainOwner, trackId: createdTracks[0], rank: 1, timeRange: 'short_term' } }); // Give this scenario's owner one stored track so a valid mix can be generated.
      calls = []; mode = 'timeout'; const body = input([ids[0]]); // Clear prior calls and enable the simulated failure mode; keep one retry payload where supplied.
      for (let i = 0; i < 2; i++) { // Try the same uncertain save twice to prove creation is not blindly repeated.
        const response = await request(uncertainOwner, '', body); // Exercise the API with this scenario's user and payload.
        assert.equal(response.status, 409); assert.equal(response.data.code, 'save_uncertain'); // Check HTTP response status equals 409; also check the remaining assertions on this line.
      } // Close the current block and continue in its enclosing function or scenario.
      assert.equal(calls.length, 1); assert.equal(calls[0].method, 'POST'); // Check number of recorded Spotify requests equals 1; also check the remaining assertions on this line.
      assert.equal((await request(uncertainOwner, `/${body.requestId}`)).data.status, 'uncertain'); // Check reported save state equals 'uncertain'.
      assert.equal((await request(outsider, `/${body.requestId}`)).status, 404); // Check HTTP response status equals 404.
    }); // Finish this callback, object-based call, or test scenario.

    await t.test('failed contents verification is not reported as saved and retry reuses playlist', async () => { // Start this named scenario; the title states the behavior its assertions check.
      const verifyOwner = await user(); // Create a separate disposable owner so this failure scenario cannot reuse another scenario's operation.
      await prisma.userFavoriteTrack.create({ data: { userId: verifyOwner, trackId: createdTracks[0], rank: 1, timeRange: 'short_term' } }); // Give this scenario's owner one stored track so a valid mix can be generated.
      spotifyOwner = `mix-test-${verifyOwner}`; expectedUris = [`spotify:track:${ids[0]}`]; // Set the expected external owner and exact track URIs for this scenario.
      calls = []; mode = 'bad-contents'; const body = input([ids[0]]); // Clear prior calls and enable the simulated failure mode; keep one retry payload where supplied.
      const failed = await request(verifyOwner, '', body); // Capture the failure response instead of treating a partially created playlist as success.
      assert.equal(failed.status, 502); assert.equal(failed.data.code, 'verification_failed'); // Check HTTP response status equals 502; also check the remaining assertions on this line.
      assert.equal((await request(verifyOwner, `/${body.requestId}`)).data.status, 'pending'); // Check reported save state equals 'pending'.
      mode = 'ok'; assert.equal((await request(verifyOwner, '', body)).data.status, 'saved'); // Check reported save state equals 'saved'.
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1); // Check number of creation or write attempts equals 1.
    }); // Finish this callback, object-based call, or test scenario.

    await t.test('private visibility blocks all track writes and retries reuse playlist without manual privacy changes', async () => { // Start this named scenario; the title states the behavior its assertions check.
      const visibilityOwner = await user(); // Create a separate disposable owner so this failure scenario cannot reuse another scenario's operation.
      await prisma.userFavoriteTrack.create({ data: { userId: visibilityOwner, trackId: createdTracks[0], rank: 1, timeRange: 'short_term' } }); // Give this scenario's owner one stored track so a valid mix can be generated.
      spotifyOwner = `mix-test-${visibilityOwner}`; expectedUris = [`spotify:track:${ids[0]}`]; // Set the expected external owner and exact track URIs for this scenario.
      calls = []; mode = 'private'; const body = input([ids[0]]); // Clear prior calls and enable the simulated failure mode; keep one retry payload where supplied.
      const failed = await request(visibilityOwner, '', body); // Capture the failure response instead of treating a partially created playlist as success.
      assert.equal(failed.status, 502); assert.equal(failed.data.code, 'visibility_unverified'); // Check HTTP response status equals 502; also check the remaining assertions on this line.
      if (failed.data.playlistUrl !== undefined) assert.equal(failed.data.playlistUrl, `https://open.spotify.com/playlist/${playlistId}`); // Check returned Spotify playlist link equals `https://open.spotify.com/playlist/${playlistId}`.
      assert.doesNotMatch(failed.data.message, /make.*private|change.*privacy|manually/i); // Ensure the error does not send users to manually change playlist privacy in Spotify.
      assert.deepEqual(calls.map(({ path, method }) => [method, path]), [ // Compare calls.map(({ path, method }) => [method, path]) with the exact expected structure/order.
        ['POST', '/v1/me/playlists'], ['GET', `/v1/playlists/${playlistId}`], // Expect exactly one external playlist creation followed by the specified checks/writes.
        ['PUT', `/v1/playlists/${playlistId}`], ['GET', `/v1/playlists/${playlistId}`] // Expect an explicit flags or full-track-list replacement before later verification.
      ]); // Finish the array argument and wait for the grouped operations or comparison call.
      assert.equal(calls.some((call) => call.path.includes('/items')), false); // Check whether a track write happened equals false.
      assert.equal((await request(visibilityOwner, `/${body.requestId}`)).data.status, 'pending'); // Check reported save state equals 'pending'.
      assert.equal((await request(outsider, `/${body.requestId}`)).status, 404); // Check HTTP response status equals 404.
      const repeated = await request(visibilityOwner, '', body); // Retry while the flags are still wrong and ensure the safety check continues blocking writes.
      assert.equal(repeated.status, 502); assert.equal(repeated.data.code, 'visibility_unverified'); // Check HTTP response status equals 502; also check the remaining assertions on this line.
      assert.equal(calls.some((call) => call.path.includes('/items')), false); // Check whether a track write happened equals false.
      mode = 'repairable'; visibilityRepaired = false; // Let the simulated external service accept and apply visibility repair on the next retry.
      const recovered = await request(visibilityOwner, '', body); // Resume the same request after repair becomes possible.
      assert.equal(recovered.status, 200); assert.equal(recovered.data.status, 'saved'); // Check HTTP response status equals 200; also check the remaining assertions on this line.
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1); // Check number of creation or write attempts equals 1.
      assert.equal(calls.filter((call) => call.method === 'PUT' && call.path.endsWith('/items')).length, 1); // Check number of creation or write attempts equals 1.
    }); // Finish this callback, object-based call, or test scenario.

    for (const repairMode of ['repairable', 'collaborative'] as const) { // Exercise both private-to-public and collaborative-to-noncollaborative repair cases.
      await t.test(`successful ${repairMode} visibility repair must be GET-verified before writing tracks`, async () => { // Start this named scenario; the title states the behavior its assertions check.
        const repairOwner = await user(); // Create a separate disposable owner so this failure scenario cannot reuse another scenario's operation.
        await prisma.userFavoriteTrack.create({ data: { userId: repairOwner, trackId: createdTracks[0], rank: 1, timeRange: 'short_term' } }); // Give this scenario's owner one stored track so a valid mix can be generated.
        spotifyOwner = `mix-test-${repairOwner}`; expectedUris = [`spotify:track:${ids[0]}`]; // Set the expected external owner and exact track URIs for this scenario.
        calls = []; mode = repairMode; visibilityRepaired = false; // Clear prior calls and enable the simulated failure mode; keep one retry payload where supplied.
        const saved = await request(repairOwner, '', input([ids[0]])); // Submit the save and inspect the API's reported outcome.
        assert.equal(saved.status, 200); assert.equal(saved.data.status, 'saved'); // Check HTTP response status equals 200; also check the remaining assertions on this line.
        assert.deepEqual(calls.map(({ path, method }) => [method, path]), [ // Compare calls.map(({ path, method }) => [method, path]) with the exact expected structure/order.
          ['POST', '/v1/me/playlists'], ['GET', `/v1/playlists/${playlistId}`], // Expect exactly one external playlist creation followed by the specified checks/writes.
          ['PUT', `/v1/playlists/${playlistId}`], ['GET', `/v1/playlists/${playlistId}`], // Expect an explicit flags or full-track-list replacement before later verification.
          ['PUT', `/v1/playlists/${playlistId}/items`], // Expect an explicit flags or full-track-list replacement before later verification.
          ['GET', `/v1/playlists/${playlistId}`], ['GET', `/v1/playlists/${playlistId}/items?limit=50`] // Expect the service to read back the playlist details or contents at this stage.
        ]); // Finish the array argument and wait for the grouped operations or comparison call.
      }); // Finish this callback, object-based call, or test scenario.
    } // Close the current block and continue in its enclosing function or scenario.

    await t.test('final private visibility is not reported as saved even with verified contents', async () => { // Start this named scenario; the title states the behavior its assertions check.
      const verifyOwner = await user(); // Create a separate disposable owner so this failure scenario cannot reuse another scenario's operation.
      await prisma.userFavoriteTrack.create({ data: { userId: verifyOwner, trackId: createdTracks[0], rank: 1, timeRange: 'short_term' } }); // Give this scenario's owner one stored track so a valid mix can be generated.
      spotifyOwner = `mix-test-${verifyOwner}`; expectedUris = [`spotify:track:${ids[0]}`]; // Set the expected external owner and exact track URIs for this scenario.
      calls = []; mode = 'final-private'; const body = input([ids[0]]); // Clear prior calls and enable the simulated failure mode; keep one retry payload where supplied.
      const failed = await request(verifyOwner, '', body); // Capture the failure response instead of treating a partially created playlist as success.
      assert.equal(failed.status, 502); assert.equal(failed.data.code, 'verification_failed'); // Check HTTP response status equals 502; also check the remaining assertions on this line.
      assert.equal(calls.some((call) => call.method === 'PUT' && call.path.endsWith('/items')), true); // Check whether a track write happened equals true.
      assert.equal((await request(verifyOwner, `/${body.requestId}`)).data.status, 'pending'); // Check reported save state equals 'pending'.
      mode = 'ok'; assert.equal((await request(verifyOwner, '', body)).data.status, 'saved'); // Check reported save state equals 'saved'.
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1); // Check number of creation or write attempts equals 1.
    }); // Finish this callback, object-based call, or test scenario.

    await t.test('unverified ownership blocks any track write', async () => { // Start this named scenario; the title states the behavior its assertions check.
      const wrongOwner = await user(); // Create a separate disposable owner so this failure scenario cannot reuse another scenario's operation.
      await prisma.userFavoriteTrack.create({ data: { userId: wrongOwner, trackId: createdTracks[0], rank: 1, timeRange: 'short_term' } }); // Give this scenario's owner one stored track so a valid mix can be generated.
      calls = []; mode = 'wrong-owner'; // Clear prior calls and enable the simulated failure mode; keep one retry payload where supplied.
      const response = await request(wrongOwner, '', input([ids[0]])); // Exercise the API with this scenario's user and payload.
      assert.equal(response.status, 502); // Check HTTP response status equals 502.
      assert.equal(calls.some((call) => call.path.includes('/items')), false); // Check whether a track write happened equals false.
    }); // Finish this callback, object-based call, or test scenario.
  } finally { // Run cleanup whether the preceding work succeeded or threw an error.
    try { // Attempt this work while allowing the following catch/finally block to handle failure or cleanup.
      server.closeAllConnections(); // Close test HTTP connections so they cannot keep the test process running.
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); // Wait until the temporary server closes, propagating shutdown errors.
    } finally { // Run cleanup whether the preceding work succeeded or threw an error.
      try { // Attempt this work while allowing the following catch/finally block to handle failure or cleanup.
        await prisma.user.deleteMany({ where: { id: { in: createdUsers } } }); // Delete ONLY fixture users whose IDs were successfully recorded by this test.
        await prisma.track.deleteMany({ where: { id: { in: createdTracks } } }); // Delete ONLY catalog tracks created by this test; do not remove existing app data.
      } finally { await prisma.$disconnect(); } // Disconnect the test database client even if fixture cleanup fails.
    } // Close the current block and continue in its enclosing function or scenario.
  } // Close the current block and continue in its enclosing function or scenario.
}); // Finish this callback, object-based call, or test scenario.
