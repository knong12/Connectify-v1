import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { shapeUserProfile } from './userProfileShape.js';
import { getUserProfileById, updateUserProfile } from '../services/userService.js';

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
