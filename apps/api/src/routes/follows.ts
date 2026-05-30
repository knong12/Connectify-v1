import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { followUser, unfollowUser } from '../services/userService.js';

const router = Router();

router.post('/:targetUserId', requireAuth, async (req, res) => {
  const followerId = (req as typeof req & { user?: { userId: string } }).user?.userId;
  const targetUserId = typeof req.params.targetUserId === 'string' ? req.params.targetUserId : '';

  if (!followerId) {
    res.status(401).json({ message: 'Not authenticated.' });
    return;
  }

  try {
    await followUser(followerId, targetUserId);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : 'Failed to follow user.'
    });
  }
});

router.delete('/:targetUserId', requireAuth, async (req, res) => {
  const followerId = (req as typeof req & { user?: { userId: string } }).user?.userId;
  const targetUserId = typeof req.params.targetUserId === 'string' ? req.params.targetUserId : '';

  if (!followerId) {
    res.status(401).json({ message: 'Not authenticated.' });
    return;
  }

  await unfollowUser(followerId, targetUserId);
  res.json({ success: true });
});

export default router;
