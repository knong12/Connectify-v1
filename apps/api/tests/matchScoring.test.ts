import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareMusicProfiles, timeRanges, type MusicItem, type MusicProfile, type TimeRange } from '../src/services/matchScoring.js';

const items = (ids: string[], timeRange: TimeRange = 'short_term'): MusicItem[] =>
  ids.map((spotifyId, index) => ({ spotifyId, name: spotifyId, imageUrl: null, rank: index + 1, timeRange }));
const profile = (artists: string[] = [], tracks: string[] = []): MusicProfile => ({ artists: items(artists), tracks: items(tracks) });
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('identical fully populated lists score 100 without the old fixed-point cap', () => {
  const data = { artists: timeRanges.flatMap((range) => items(['a', 'b'], range)), tracks: timeRanges.flatMap((range) => items(['x'], range)) };
  const result = compareMusicProfiles(data, data);
  assert.equal(result.score, 100);
  assert.equal(result.explanation.sharedArtists.length, 2);
  assert.equal(result.explanation.sharedArtists[0].windows.length, 3);
});

test('disjoint populated profiles earn zero, not an eight-point floor', () => {
  const result = compareMusicProfiles(profile(['a'], ['x']), profile(['b'], ['y']));
  assert.equal(result.score, 0);
  assert.equal(result.explanation.status, 'ready');
});

test('one or two completely empty profiles are explicitly unscored', () => {
  for (const [a, b] of [[profile(), profile()], [profile(['a']), profile()], [profile(), profile(['a'])]]) {
    const result = compareMusicProfiles(a, b);
    assert.equal(result.score, 0);
    assert.equal(result.explanation.status, 'insufficient_data');
    assert.equal(result.explanation.limitedData, true);
    assert.ok(result.explanation.signals.every((signal) => Number.isFinite(signal.contribution)));
  }
});

test('partial overlap uses union size and the 60/40 artist/track weights', () => {
  const result = compareMusicProfiles(profile(['a', 'b'], ['x']), profile(['a', 'c'], ['x']));
  // Artists: 1/3 * 60 = 20. Tracks: 1/1 * 40 = 40.
  assert.equal(result.score, 60);
  close(result.rawScore, 60);
});

test('unequal list sizes are normalized instead of rewarding raw overlap', () => {
  const result = compareMusicProfiles(profile(['a']), profile(['a', 'b', 'c', 'd']));
  assert.equal(result.score, 25);
  assert.equal(result.explanation.signals[0].yourCount, 1);
  assert.equal(result.explanation.signals[0].theirCount, 4);
});

test('50-item lists sharing 25 artists score 33.3 instead of saturating at 100', () => {
  const ids = Array.from({ length: 75 }, (_, index) => `artist-${index}`);
  assert.equal(compareMusicProfiles(profile(ids.slice(0, 50)), profile(ids.slice(25))).score, 33.3);
});

test('recent listening carries more weight than longer-term overlap', () => {
  const yours = { artists: timeRanges.flatMap((range) => items(['a'], range)), tracks: [] };
  const recent = { artists: [...items(['a']), ...items(['b'], 'medium_term'), ...items(['c'], 'long_term')], tracks: [] };
  const older = { artists: [...items(['b']), ...items(['c'], 'medium_term'), ...items(['a'], 'long_term')], tracks: [] };
  assert.equal(compareMusicProfiles(yours, recent).score, 50);
  assert.equal(compareMusicProfiles(yours, older).score, 20);
});

test('cross-window shared music is displayed as evidence but does not earn points', () => {
  const result = compareMusicProfiles(profile(['a']), { artists: items(['a'], 'long_term'), tracks: [] });
  assert.equal(result.score, 0);
  assert.equal(result.explanation.sharedArtists.length, 1);
  assert.deepEqual(result.explanation.sharedArtists[0].windows, []);
});

test('duplicate rows cannot inflate similarity, counts, or displayed ranks', () => {
  const duplicate = { artists: [...items(['a']), { ...items(['a'])[0], rank: 9 }], tracks: [] };
  const result = compareMusicProfiles(duplicate, profile(['a']));
  assert.equal(result.score, 100);
  assert.equal(result.explanation.counts.yourArtists, 1);
  assert.equal(result.explanation.signals[0].sharedCount, 1);
  assert.equal(result.explanation.sharedArtists[0].windows[0].yourRank, 1);
});

test('a jointly missing signal is omitted but a one-sided list earns zero', () => {
  const yours = profile(['a']);
  assert.equal(compareMusicProfiles(yours, yours).score, 100);
  assert.equal(compareMusicProfiles(yours, profile(['a'], ['x'])).score, 60);
  const emptyWindow = compareMusicProfiles(yours, yours).explanation.signals.find((signal) => signal.timeRange === 'long_term');
  assert.equal(emptyWindow?.maxPoints, 0);
});

test('small perfect matches are labeled limited, not presented as strong statistical evidence', () => {
  const result = compareMusicProfiles(profile(['a']), profile(['a']));
  assert.equal(result.score, 100);
  assert.equal(result.explanation.limitedData, true);
});

test('rank changes do not secretly change the similarity formula', () => {
  const reversed = { artists: items(['b', 'a']), tracks: [] };
  const result = compareMusicProfiles(profile(['a', 'b']), reversed);
  assert.equal(result.score, 100);
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
    assert.ok(forward.score >= 0 && forward.score <= 100);
    close(forward.explanation.signals.reduce((sum, signal) => sum + signal.maxPoints, 0), 100);
    close(forward.explanation.signals.reduce((sum, signal) => sum + signal.contribution, 0), forward.rawScore);
    for (const signal of forward.explanation.signals) {
      close(signal.contribution, signal.similarity * signal.maxPoints);
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
