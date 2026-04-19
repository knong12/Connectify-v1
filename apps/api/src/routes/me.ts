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
    message: 'Step 8: shape the response you want the frontend to consume.',
    user
  });
});

export default router;
