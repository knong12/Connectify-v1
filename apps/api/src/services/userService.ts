import { prisma } from '../lib/prisma.js';

export async function getUserProfileById(userId: string) {
  // Step 8:
  // Once auth middleware is in place, this will power GET /api/me.
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
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

