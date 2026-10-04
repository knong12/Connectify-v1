import { prisma } from '../lib/prisma.js';

const artistRangeWeights = {
  short_term: 16,
  medium_term: 12,
  long_term: 9
} as const;

const trackRangeWeights = {
  short_term: 10,
  medium_term: 8,
  long_term: 6
} as const;

export type MatchPreview = {
  userId: string;
  displayName: string;
  spotifyUserId: string;
  spotifyProfileImage: string | null;
  bio: string | null;
  favoriteArtistNote: string | null;
  isFollowing: boolean;
  score: number;
  sharedArtists: number;
  sharedTracks: number;
  sharedArtistNames: string[];
  sharedTrackNames: string[];
};

function buildRangeMap<T extends { timeRange: keyof typeof artistRangeWeights }>(
  entries: T[],
  getSpotifyId: (entry: T) => string
) {
  const map = new Map<string, Set<T['timeRange']>>();

  for (const entry of entries) {
    const key = getSpotifyId(entry);
    const set = map.get(key) ?? new Set<T['timeRange']>();
    set.add(entry.timeRange);
    map.set(key, set);
  }

  return map;
}

function computeWeightedOverlap(
  currentRanges: Set<keyof typeof artistRangeWeights> | undefined,
  candidateRanges: Set<keyof typeof artistRangeWeights> | undefined,
  weights: Record<keyof typeof artistRangeWeights, number>
) {
  if (!currentRanges || !candidateRanges) {
    return 0;
  }

  let score = 0;

  for (const timeRange of currentRanges) {
    if (candidateRanges.has(timeRange)) {
      score += weights[timeRange];
    }
  }

  return score;
}

function normalizeScore(weightedArtistOverlap: number, weightedTrackOverlap: number) {
  return Math.min(100, Math.max(8, weightedArtistOverlap + weightedTrackOverlap));
}

export async function rankMatches(userId: string): Promise<MatchPreview[]> {
  const users = await prisma.user.findMany({
    include: {
      following: true,
      favoriteArtists: {
        include: { artist: true },
        orderBy: { rank: 'asc' }
      },
      favoriteTracks: {
        include: { track: true },
        orderBy: { rank: 'asc' }
      }
    }
  });

  const currentUser = users.find((user) => user.id === userId);

  if (!currentUser) {
    return [];
  }

  const currentArtistIds = new Set(
    currentUser.favoriteArtists.map((favorite) => favorite.artist.spotifyId)
  );
  const currentTrackIds = new Set(
    currentUser.favoriteTracks.map((favorite) => favorite.track.spotifyId)
  );
  const currentFollowingIds = new Set(currentUser.following.map((entry) => entry.followingId));
  const currentArtistRanges = buildRangeMap(
    currentUser.favoriteArtists,
    (favorite) => favorite.artist.spotifyId
  );
  const currentTrackRanges = buildRangeMap(
    currentUser.favoriteTracks,
    (favorite) => favorite.track.spotifyId
  );

  return users
    .filter((candidate) => candidate.id !== userId)
    .map((candidate) => {
      const sharedArtists = candidate.favoriteArtists.filter((favorite) =>
        currentArtistIds.has(favorite.artist.spotifyId)
      );
      const sharedTracks = candidate.favoriteTracks.filter((favorite) =>
        currentTrackIds.has(favorite.track.spotifyId)
      );
      const candidateArtistRanges = buildRangeMap(
        candidate.favoriteArtists,
        (favorite) => favorite.artist.spotifyId
      );
      const candidateTrackRanges = buildRangeMap(
        candidate.favoriteTracks,
        (favorite) => favorite.track.spotifyId
      );
      const uniqueSharedArtistIds = [...new Set(sharedArtists.map((favorite) => favorite.artist.spotifyId))];
      const uniqueSharedTrackIds = [...new Set(sharedTracks.map((favorite) => favorite.track.spotifyId))];
      const weightedArtistOverlap = uniqueSharedArtistIds.reduce(
        (total, spotifyId) =>
          total +
          computeWeightedOverlap(
            currentArtistRanges.get(spotifyId),
            candidateArtistRanges.get(spotifyId),
            artistRangeWeights
          ),
        0
      );
      const weightedTrackOverlap = uniqueSharedTrackIds.reduce(
        (total, spotifyId) =>
          total +
          computeWeightedOverlap(
            currentTrackRanges.get(spotifyId),
            candidateTrackRanges.get(spotifyId),
            trackRangeWeights
          ),
        0
      );

      return {
        userId: candidate.id,
        displayName: candidate.displayName,
        spotifyUserId: candidate.spotifyUserId,
        spotifyProfileImage: candidate.spotifyProfileImage,
        bio: candidate.bio,
        favoriteArtistNote: candidate.favoriteArtistNote,
        isFollowing: currentFollowingIds.has(candidate.id),
        score: normalizeScore(weightedArtistOverlap, weightedTrackOverlap),
        sharedArtists: uniqueSharedArtistIds.length,
        sharedTracks: uniqueSharedTrackIds.length,
        sharedArtistNames: [
          ...new Map(
            sharedArtists.map((favorite) => [favorite.artist.spotifyId, favorite.artist.name])
          ).values()
        ].slice(0, 4),
        sharedTrackNames: [
          ...new Map(
            sharedTracks.map((favorite) => [favorite.track.spotifyId, favorite.track.name])
          ).values()
        ].slice(0, 4)
      };
    })
    .sort((a, b) => b.score - a.score || b.sharedArtists - a.sharedArtists || b.sharedTracks - a.sharedTracks);
}
