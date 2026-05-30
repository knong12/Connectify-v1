import { prisma } from '../lib/prisma.js';

export async function getUserProfileById(userId: string) {
  // Step 8:
  // Once auth middleware is in place, this will power GET /api/me.
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      followers: {
        include: {
          follower: true
        }
      },
      following: {
        include: {
          following: true
        }
      },
      favoriteGenres: {
        include: { genre: true },
        orderBy: { rank: 'asc' }
      },
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
}

export async function updateUserProfile(
  userId: string,
  payload: {
    bio: string;
    favoriteArtistNote: string;
    musicPrompt: string;
  }
) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      bio: payload.bio || null,
      favoriteArtistNote: payload.favoriteArtistNote || null,
      musicPrompt: payload.musicPrompt || null
    }
  });
}

export async function followUser(followerId: string, followingId: string) {
  if (followerId === followingId) {
    throw new Error('You cannot follow yourself.');
  }

  return prisma.follow.upsert({
    where: {
      followerId_followingId: {
        followerId,
        followingId
      }
    },
    update: {},
    create: {
      followerId,
      followingId
    }
  });
}

export async function unfollowUser(followerId: string, followingId: string) {
  return prisma.follow.deleteMany({
    where: {
      followerId,
      followingId
    }
  });
}
