import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getUserProfileById } from '../services/userService.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const userId = (req as typeof req & { user?: { userId: string } }).user?.userId;

  if (!userId) {
    res.status(401).json({ message: 'Not authenticated.' });
    return;
  }

  const user = await getUserProfileById(userId);

  if (!user) {
    res.status(404).json({ message: 'User not found.' });
    return;
  }

  res.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      spotifyUserId: user.spotifyUserId,
      spotifyProfileImage: user.spotifyProfileImage,
      spotifyConnected: user.spotifyConnected,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      favoriteGenres: user.favoriteGenres.map((entry) => ({
        id: entry.genre.id,
        slug: entry.genre.slug,
        label: entry.genre.label,
        rank: entry.rank
      })),
      favoriteArtists: user.favoriteArtists.map((entry) => ({
        id: entry.artist.id,
        spotifyId: entry.artist.spotifyId,
        name: entry.artist.name,
        imageUrl: entry.artist.imageUrl,
        genres: entry.artist.genres,
        rank: entry.rank
      })),
      favoriteTracks: user.favoriteTracks.map((entry) => ({
        id: entry.track.id,
        spotifyId: entry.track.spotifyId,
        name: entry.track.name,
        artistName: entry.track.artistName,
        albumName: entry.track.albumName,
        albumArt: entry.track.albumArt,
        previewUrl: entry.track.previewUrl,
        rank: entry.rank
      }))
    }
  });
});

export default router;
