import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareMusicProfiles, timeRanges, type MusicItem, type MusicProfile, type TimeRange } from '../src/services/matchScoring.js';

const items = (ids: string[], timeRange: TimeRange = 'short_term'): MusicItem[] =>
  ids.map((spotifyId, index) => ({ spotifyId, name: spotifyId, imageUrl: null, rank: index + 1, timeRange }));
const profile = (artists: string[] = [], tracks: string[] = []): MusicProfile => ({ artists: items(artists), tracks: items(tracks) });
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('all six shared-item point values match the original algorithm', () => {
  const expected = { artists: [16, 12, 9], tracks: [10, 8, 6] };
  for (const kind of ['artists', 'tracks'] as const) {
    for (const [index, range] of timeRanges.entries()) {
      const data: MusicProfile = { artists: [], tracks: [], [kind]: items(['shared'], range) };
      const result = compareMusicProfiles(data, data);
      assert.equal(result.rawScore, expected[kind][index]);
      assert.equal(result.score, Math.max(8, expected[kind][index]));
    }
  }
});

test('fixed points accumulate across windows without percentage normalization', () => {
  const data = { artists: timeRanges.flatMap((range) => items(['a', 'b'], range)), tracks: timeRanges.flatMap((range) => items(['x'], range)) };
  const result = compareMusicProfiles(data, data);
  assert.equal(result.score, 98);
  assert.equal(result.rawScore, 2 * (16 + 12 + 9) + 10 + 8 + 6);
  assert.equal(result.explanation.version, 'fixed-overlap-v1');
  assert.equal(result.explanation.sharedArtists.length, 2);
  assert.equal(result.explanation.sharedArtists[0].windows.length, 3);
});

test('disjoint populated profiles retain the original eight-point floor', () => {
  const result = compareMusicProfiles(profile(['a'], ['x']), profile(['b'], ['y']));
  assert.equal(result.score, 8);
  assert.equal(result.rawScore, 0);
  assert.equal(result.explanation.status, 'ready');
});

test('empty profiles retain the floor but remain explicitly labeled insufficient data', () => {
  for (const [a, b] of [[profile(), profile()], [profile(['a']), profile()], [profile(), profile(['a'])]]) {
    const result = compareMusicProfiles(a, b);
    assert.equal(result.score, 8);
    assert.equal(result.rawScore, 0);
    assert.equal(result.explanation.status, 'insufficient_data');
    assert.equal(result.explanation.limitedData, true);
    assert.ok(result.explanation.signals.every((signal) => Number.isFinite(signal.contribution)));
  }
});

test('each shared recent artist earns 16 points and each shared recent track earns 10', () => {
  const result = compareMusicProfiles(profile(['a', 'b'], ['x']), profile(['a', 'c'], ['x']));
  assert.equal(result.score, 26);
  close(result.rawScore, 26);
});

test('list sizes do not dilute fixed points for a shared artist', () => {
  const result = compareMusicProfiles(profile(['a']), profile(['a', 'b', 'c', 'd']));
  assert.equal(result.score, 16);
  assert.equal(compareMusicProfiles(profile(['a']), profile(['a'])).score, result.score);
  assert.equal(result.explanation.signals[0].yourCount, 1);
  assert.equal(result.explanation.signals[0].theirCount, 4);
});

test('large overlaps reach the original 100-point cap', () => {
  const ids = Array.from({ length: 75 }, (_, index) => `artist-${index}`);
  const result = compareMusicProfiles(profile(ids.slice(0, 50)), profile(ids.slice(25)));
  assert.equal(result.rawScore, 25 * 16);
  assert.equal(result.score, 100);
});

test('recent listening carries more weight than longer-term overlap', () => {
  const yours = { artists: timeRanges.flatMap((range) => items(['a'], range)), tracks: [] };
  const recent = { artists: [...items(['a']), ...items(['b'], 'medium_term'), ...items(['c'], 'long_term')], tracks: [] };
  const older = { artists: [...items(['b']), ...items(['c'], 'medium_term'), ...items(['a'], 'long_term')], tracks: [] };
  assert.equal(compareMusicProfiles(yours, recent).score, 16);
  assert.equal(compareMusicProfiles(yours, older).score, 9);
});

test('cross-window shared music is displayed as evidence but does not earn points', () => {
  const result = compareMusicProfiles(profile(['a']), { artists: items(['a'], 'long_term'), tracks: [] });
  assert.equal(result.score, 8);
  assert.equal(result.rawScore, 0);
  assert.equal(result.explanation.sharedArtists.length, 1);
  assert.deepEqual(result.explanation.sharedArtists[0].windows, []);
});

test('duplicate rows cannot inflate points, shared counts, or displayed ranks', () => {
  const duplicate = { artists: [...items(['a']), { ...items(['a'])[0], rank: 9 }], tracks: [] };
  const result = compareMusicProfiles(duplicate, profile(['a']));
  assert.equal(result.score, 16);
  assert.equal(result.explanation.counts.yourArtists, 1);
  assert.equal(result.explanation.signals[0].sharedCount, 1);
  assert.equal(result.explanation.sharedArtists[0].windows[0].yourRank, 1);
});

test('missing windows contribute zero without rescaling other fixed-point signals', () => {
  const yours = profile(['a']);
  assert.equal(compareMusicProfiles(yours, yours).score, 16);
  assert.equal(compareMusicProfiles(yours, profile(['a'], ['x'])).score, 16);
  const emptyWindow = compareMusicProfiles(yours, yours).explanation.signals.find((signal) => signal.timeRange === 'long_term');
  assert.equal(emptyWindow?.contribution, 0);
  assert.equal(emptyWindow?.pointsPerItem, 9);
});

test('small overlapping profiles keep the limited-data warning', () => {
  const result = compareMusicProfiles(profile(['a']), profile(['a']));
  assert.equal(result.score, 16);
  assert.equal(result.explanation.limitedData, true);
});

test('rank changes do not change fixed-point overlap', () => {
  const reversed = { artists: items(['b', 'a']), tracks: [] };
  const result = compareMusicProfiles(profile(['a', 'b']), reversed);
  assert.equal(result.score, 32);
  assert.deepEqual(result.explanation.sharedArtists[0].windows[0], { timeRange: 'short_term', yourRank: 1, theirRank: 2 });
});

test('seeded profile comparisons are symmetric, bounded, and have auditable contributions', () => {
  let seed = 71;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const makeProfile = (): MusicProfile => ({
    artists: timeRanges.flatMap((range) => items(Array.from({ length: 20 }, (_, index) => `a${index}`).filter(() => random() > 0.5), range)),
    tracks: timeRanges.flatMap((range) => items(Array.from({ length: 20 }, (_, index) => `t${index}`).filter(() => random() > 0.5), range))
  });
  for (let index = 0; index < 100; index++) {
    const a = makeProfile(); const b = makeProfile();
    const forward = compareMusicProfiles(a, b); const reverse = compareMusicProfiles(b, a);
    close(forward.rawScore, reverse.rawScore);
    // Independent reconstruction of the original per-item, same-window summation.
    let legacyPoints = 0;
    for (const [kind, weights] of [['artists', [16, 12, 9]], ['tracks', [10, 8, 6]]] as const) {
      for (const [index, range] of timeRanges.entries()) {
        const yours = new Set(a[kind].filter((item) => item.timeRange === range).map((item) => item.spotifyId));
        const theirs = new Set(b[kind].filter((item) => item.timeRange === range).map((item) => item.spotifyId));
        legacyPoints += [...yours].filter((id) => theirs.has(id)).length * weights[index];
      }
    }
    assert.equal(forward.score, Math.min(100, Math.max(8, legacyPoints)));
    assert.ok(forward.score >= 8 && forward.score <= 100);
    assert.equal(forward.score, Math.min(100, Math.max(8, forward.rawScore)));
    close(forward.explanation.signals.reduce((sum, signal) => sum + signal.contribution, 0), forward.rawScore);
    for (const signal of forward.explanation.signals) {
      close(signal.contribution, signal.sharedCount * signal.pointsPerItem);
      assert.ok(signal.sharedCount <= Math.min(signal.yourCount, signal.theirCount));
    }
  }
});

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-secret';
process.env.CLIENT_URL ??= 'http://localhost:5173';
process.env.SPOTIFY_CLIENT_ID ??= 'test-client';
process.env.SPOTIFY_CLIENT_SECRET ??= 'test-secret';
process.env.SPOTIFY_REDIRECT_URI ??= 'http://127.0.0.1:5000/api/auth/spotify/callback';

test('ranking excludes self, preserves following, and breaks exact ties deterministically', async (t) => {
  const { prisma } = await import('../src/lib/prisma.js');
  const { rankMatches } = await import('../src/services/matchService.js');
  const user = (id: string) => ({ id, displayName: id, spotifyUserId: id, spotifyProfileImage: null, bio: null,
    favoriteArtistNote: null, following: id === 'self' ? [{ followingId: 'b' }] : [],
    favoriteArtists: [{ rank: 1, timeRange: 'short_term', artist: { spotifyId: 'a', name: 'A', imageUrl: null } }], favoriteTracks: [] });
  const original = prisma.user.findMany;
  t.after(() => { prisma.user.findMany = original; });
  prisma.user.findMany = t.mock.fn(async () => [user('self'), user('b'), user('a')]) as typeof original;
  const results = await rankMatches('self');
  assert.deepEqual(results.map((entry) => entry.userId), ['a', 'b']);
  assert.equal(results[1].isFollowing, true);
  assert.equal(Object.hasOwn(results[0], 'rawScore'), false);
  assert.deepEqual(await rankMatches('missing'), []);
});

test('capped score ties rank by shared artists, not the uncapped point total', async (t) => {
  const { prisma } = await import('../src/lib/prisma.js');
  const { rankMatches } = await import('../src/services/matchService.js');
  const favorites = (ids: string[], ranges: readonly TimeRange[]) => ranges.flatMap((timeRange) =>
    ids.map((spotifyId, index) => ({ rank: index + 1, timeRange, artist: { spotifyId, name: spotifyId, imageUrl: null } })));
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const user = (id: string, favoriteArtists: ReturnType<typeof favorites>, sharedTrack = false) => ({
    id, displayName: id, spotifyUserId: id, spotifyProfileImage: null, bio: null, favoriteArtistNote: null,
    following: [], favoriteArtists, favoriteTracks: sharedTrack ? [{ rank: 1, timeRange: 'short_term',
      track: { spotifyId: 'track', name: 'Track', albumArt: null } }] : []
  });
  const original = prisma.user.findMany;
  t.after(() => { prisma.user.findMany = original; });
  prisma.user.findMany = t.mock.fn(async () => [
    user('self', favorites(ids, timeRanges), true),
    user('five-artists', favorites(ids.slice(0, 5), timeRanges)), // 185 uncapped points.
    user('six-artists', favorites(ids, ['short_term']), true) // 106 uncapped points.
  ]) as typeof original;
  const results = await rankMatches('self');
  assert.deepEqual(results.map((entry) => [entry.userId, entry.score]), [['six-artists', 100], ['five-artists', 100]]);
  assert.equal(results[0].explanation.version, 'fixed-overlap-v1');
  assert.equal(results[0].explanation.sharedArtists.length, 6);
});
