import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getUserProfileById } from '../services/userService.js';
import { shapeUserProfile } from './userProfileShape.js';

const router = Router();

router.get('/:userId', requireAuth, async (req, res) => {
  const rawUserId = req.params.userId;
  const targetUserId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;

  if (!targetUserId) {
    res.status(400).json({ message: 'A target user id is required.' });
    return;
  }

  const user = await getUserProfileById(targetUserId);

  if (!user) {
    res.status(404).json({ message: 'User not found.' });
    return;
  }

  res.json({
    user: shapeUserProfile(user)
  });
});

export default router;
