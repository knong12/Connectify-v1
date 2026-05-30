import { prisma } from '../lib/prisma.js';

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

function normalizeScore(sharedArtists: number, sharedTracks: number) {
  const artistWeight = sharedArtists * 12;
  const trackWeight = sharedTracks * 8;
  return Math.min(100, Math.max(8, artistWeight + trackWeight));
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

  return users
    .filter((candidate) => candidate.id !== userId)
    .map((candidate) => {
      const sharedArtists = candidate.favoriteArtists.filter((favorite) =>
        currentArtistIds.has(favorite.artist.spotifyId)
      );
      const sharedTracks = candidate.favoriteTracks.filter((favorite) =>
        currentTrackIds.has(favorite.track.spotifyId)
      );

      return {
        userId: candidate.id,
        displayName: candidate.displayName,
        spotifyUserId: candidate.spotifyUserId,
        spotifyProfileImage: candidate.spotifyProfileImage,
        bio: candidate.bio,
        favoriteArtistNote: candidate.favoriteArtistNote,
        isFollowing: currentFollowingIds.has(candidate.id),
        score: normalizeScore(sharedArtists.length, sharedTracks.length),
        sharedArtists: sharedArtists.length,
        sharedTracks: sharedTracks.length,
        sharedArtistNames: sharedArtists.slice(0, 4).map((favorite) => favorite.artist.name),
        sharedTrackNames: sharedTracks.slice(0, 4).map((favorite) => favorite.track.name)
      };
    })
    .sort((a, b) => b.score - a.score || b.sharedArtists - a.sharedArtists || b.sharedTracks - a.sharedTracks);
}
