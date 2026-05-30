import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getUserProfileById, updateUserProfile } from '../services/userService.js';

const router = Router();

function shapeUserProfile(user: NonNullable<Awaited<ReturnType<typeof getUserProfileById>>>) {
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
  };
}

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
    user: shapeUserProfile(user)
  });
});

router.put('/', requireAuth, async (req, res) => {
  const userId = (req as typeof req & { user?: { userId: string } }).user?.userId;

  if (!userId) {
    res.status(401).json({ message: 'Not authenticated.' });
    return;
  }

  const bio = typeof req.body.bio === 'string' ? req.body.bio.trim().slice(0, 240) : '';
  const favoriteArtistNote =
    typeof req.body.favoriteArtistNote === 'string'
      ? req.body.favoriteArtistNote.trim().slice(0, 120)
      : '';
  const musicPrompt =
    typeof req.body.musicPrompt === 'string'
      ? req.body.musicPrompt.trim().slice(0, 180)
      : '';

  await updateUserProfile(userId, {
    bio,
    favoriteArtistNote,
    musicPrompt
  });

  const updatedUser = await getUserProfileById(userId);

  if (!updatedUser) {
    res.status(404).json({ message: 'User not found.' });
    return;
  }

  res.json({
    user: shapeUserProfile(updatedUser)
  });
});

export default router;
