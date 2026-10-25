import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { MixError, mixResult, previewMix, saveMix } from '../services/mixService.js';
import { getSpotifyFailure, SpotifyRequestError } from '../services/spotifyService.js';

const router = Router();
router.use(requireAuth);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const uuid = z.string().uuid();
const saveSchema = z.object({ requestId: uuid, targetUserId: uuid, name: z.string().trim().min(1).max(100),
  trackIds: z.array(z.string().regex(/^[a-zA-Z0-9]{22}$/)).min(1).max(20).refine((ids) => new Set(ids).size === ids.length)
}).strict();
const attempts = new Map<string, number[]>();

function report(res: import('express').Response, error: unknown) {
  if (error instanceof MixError) { res.status(error.status).json({ message: error.message, code: error.code, ...(error.playlistUrl ? { playlistUrl: error.playlistUrl } : {}) }); return; }
  if (error instanceof SpotifyRequestError) {
    const failure = error.code === 'permission_required' ? { code: 'permission_required', status: 403 } : getSpotifyFailure(error);
    if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
    const messages: Record<string, string> = {
      permission_required: 'Reconnect Spotify to grant public playlist permissions.',
      reconnect: 'Your Spotify session needs to be reconnected.',
      access_denied: 'Spotify refused this request. Reconnect to grant permissions; your app\'s access restrictions may also apply.',
      rate_limited: 'Spotify is receiving too many requests. Wait before retrying this save.',
      unavailable: 'Spotify could not be reached. Retry this same save in a moment.'
    };
    res.status(failure.status).json({ code: failure.code, message: messages[failure.code] ?? 'Spotify could not complete this save. Retry the same save.' });
    return;
  }
  res.status(500).json({ code: 'save_failed', message: 'Could not complete this mix. Retry the same save in a moment.' });
}

router.get('/preview/:targetUserId', async (req, res) => {
  const target = uuid.safeParse(req.params.targetUserId);
  if (!target.success) { res.status(400).json({ message: 'Invalid listener.', code: 'invalid_request' }); return; }
  try { res.json(await previewMix((req as typeof req & { user: { userId: string } }).user.userId, target.data)); }
  catch (error) { report(res, error); }
});

router.post('/', async (req, res) => {
  const input = saveSchema.safeParse(req.body);
  if (!input.success) { res.status(400).json({ message: 'Choose a name and 1 to 20 distinct preview tracks.', code: 'invalid_request' }); return; }
  const ownerId = (req as typeof req & { user: { userId: string } }).user.userId;
  const now = Date.now();
  for (const [key, times] of attempts) if (!times.some((time) => time > now - 60000)) attempts.delete(key);
  const recent = (attempts.get(ownerId) ?? []).filter((time) => time > now - 60000);
  if (recent.length >= 10) { res.setHeader('Retry-After', '60'); res.status(429).json({ code: 'rate_limited', message: 'Please wait a minute before saving again.' }); return; }
  attempts.set(ownerId, [...recent, now]);
  try { res.json(await saveMix(ownerId, input.data)); } catch (error) { report(res, error); }
});

router.get('/:id', async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ message: 'Invalid mix.', code: 'invalid_request' }); return; }
  try {
    const row = await prisma.mixSave.findFirst({ where: { id: id.data, ownerId: (req as typeof req & { user: { userId: string } }).user.userId } });
    if (!row) { res.status(404).json({ message: 'Mix not found.', code: 'not_found' }); return; }
    res.json(mixResult(row));
  } catch (error) { report(res, error); }
});
export default router;
