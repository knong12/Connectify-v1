import { getUserProfileById } from '../services/userService.js';

const spotifyTimeRanges = ['short_term', 'medium_term', 'long_term'] as const;

function shapeArtistEntry(
  entry: NonNullable<Awaited<ReturnType<typeof getUserProfileById>>>['favoriteArtists'][number]
) {
  return {
    id: entry.artist.id,
    spotifyId: entry.artist.spotifyId,
    name: entry.artist.name,
    imageUrl: entry.artist.imageUrl,
    rank: entry.rank
  };
}

function shapeTrackEntry(
  entry: NonNullable<Awaited<ReturnType<typeof getUserProfileById>>>['favoriteTracks'][number]
) {
  return {
    id: entry.track.id,
    spotifyId: entry.track.spotifyId,
    name: entry.track.name,
    artistName: entry.track.artistName,
    albumName: entry.track.albumName,
    albumArt: entry.track.albumArt,
    previewUrl: entry.track.previewUrl,
    rank: entry.rank
  };
}

export function shapeUserProfile(user: NonNullable<Awaited<ReturnType<typeof getUserProfileById>>>) {
  const mediumTermArtists = user.favoriteArtists.filter((entry) => entry.timeRange === 'medium_term');
  const mediumTermTracks = user.favoriteTracks.filter((entry) => entry.timeRange === 'medium_term');
  const favoriteArtistsByRange = Object.fromEntries(
    spotifyTimeRanges.map((timeRange) => [
      timeRange,
      user.favoriteArtists.filter((entry) => entry.timeRange === timeRange).map(shapeArtistEntry)
    ])
  );
  const favoriteTracksByRange = Object.fromEntries(
    spotifyTimeRanges.map((timeRange) => [
      timeRange,
      user.favoriteTracks.filter((entry) => entry.timeRange === timeRange).map(shapeTrackEntry)
    ])
  );

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    spotifyUserId: user.spotifyUserId,
    spotifyProfileImage: user.spotifyProfileImage,
    spotifyConnected: user.spotifyConnected,
    bio: user.bio,
    favoriteArtistNote: user.favoriteArtistNote,
    musicPrompt: user.musicPrompt,
    followerCount: user.followers.length,
    followingCount: user.following.length,
    followers: user.followers.map((entry) => ({
      id: entry.follower.id,
      displayName: entry.follower.displayName,
      spotifyUserId: entry.follower.spotifyUserId,
      spotifyProfileImage: entry.follower.spotifyProfileImage
    })),
    followingUsers: user.following.map((entry) => ({
      id: entry.following.id,
      displayName: entry.following.displayName,
      spotifyUserId: entry.following.spotifyUserId,
      spotifyProfileImage: entry.following.spotifyProfileImage
    })),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    favoriteArtists: mediumTermArtists.map(shapeArtistEntry),
    favoriteTracks: mediumTermTracks.map(shapeTrackEntry),
    favoriteArtistsByRange,
    favoriteTracksByRange
  };
}
