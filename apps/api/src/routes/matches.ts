import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { rankMatches } from '../services/matchService.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const userId = (req as typeof req & { user?: { userId: string } }).user?.userId;

  if (!userId) {
    res.status(401).json({ message: 'Not authenticated.' });
    return;
  }

  res.json({
    matches: await rankMatches(userId)
  });
});

export default router;
