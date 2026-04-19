import { Router } from 'express';
import { rankMatches } from '../services/matchService.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    matches: rankMatches()
  });
});

export default router;

