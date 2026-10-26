import { prisma } from '../lib/prisma.js';
import { compareMusicProfiles, type MusicProfile } from './matchScoring.js';

export async function rankMatches(userId: string) {
  const users = await prisma.user.findMany({
    //quries to the database for favorite artists and tracks
    select: {
      id: true, displayName: true, spotifyUserId: true, spotifyProfileImage: true,
      bio: true, favoriteArtistNote: true,
      following: { select: { followingId: true } },
      favoriteArtists: {
        select: { rank: true, timeRange: true, artist: { select: { spotifyId: true, name: true, imageUrl: true } } }
      },
      favoriteTracks: {
        select: { rank: true, timeRange: true, track: { select: { spotifyId: true, name: true, albumArt: true } } }
      }
    }
  });
  const current = users.find((user) => user.id === userId); //id check
  if (!current) return []; //if not return empty list of no matches

  //fetch all current tracks and artists from all time ranges
  //toProfile is a helper function that converts database results into simpler format
  const toProfile = (user: typeof current): MusicProfile => ({
    artists: user.favoriteArtists.map(({ artist, rank, timeRange }) => ({ ...artist, rank, timeRange })),
    tracks: user.favoriteTracks.map(({ track, rank, timeRange }) => ({ spotifyId: track.spotifyId, name: track.name, imageUrl: track.albumArt, rank, timeRange
    }))
  });

  const yourProfile = toProfile(current);
  const following = new Set(current.following.map((entry) => entry.followingId));

  return users.filter((user) => user.id !== userId).map((user) => {
    const comparison = compareMusicProfiles(yourProfile, toProfile(user));
    return {
      userId: user.id, displayName: user.displayName, spotifyUserId: user.spotifyUserId,
      spotifyProfileImage: user.spotifyProfileImage, bio: user.bio,
      favoriteArtistNote: user.favoriteArtistNote, isFollowing: following.has(user.id),
      ...comparison,
      sharedArtists: comparison.explanation.sharedArtists.length,
      sharedTracks: comparison.explanation.sharedTracks.length,
      sharedArtistNames: comparison.explanation.sharedArtists.slice(0, 4).map((item) => item.name),
      sharedTrackNames: comparison.explanation.sharedTracks.slice(0, 4).map((item) => item.name)
    };
  }).sort((a, b) => b.score - a.score || b.sharedArtists - a.sharedArtists || b.sharedTracks - a.sharedTracks || a.userId.localeCompare(b.userId)).map(({ rawScore: _rawScore, ...match }) => match);
}

export type MatchPreview = Awaited<ReturnType<typeof rankMatches>>[number];
