import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { listConversations, listMessages, startConversation, sendMessage, markConversationRead, conversationPreview, MessagingError } from '../services/messageService.js';

type Notify = (userIds: string[], event: 'message:new' | 'inbox:changed', payload?: unknown) => void;
const idSchema = z.string().uuid();
const pageCursor = z.coerce.number().int().positive().max(2_147_483_647);

export function createConversationRoutes(notify: Notify) {
  const router = Router();
  const attempts = new Map<string, { count: number; until: number }>();
  router.use(requireAuth);
  const userId = (req: Request) => {
    const id = (req as Request & { user?: { userId?: string } }).user?.userId;
    if (!id) throw new MessagingError(401, 'unauthorized', 'Please sign in again.');
    return id;
  };
  function throttle(id: string) {
    const now = Date.now();
    for (const [key, record] of attempts) if (record.until <= now) attempts.delete(key);
    const record = attempts.get(id) ?? { count: 0, until: now + 60_000 };
    if (record.count >= 30 || attempts.size > 10_000) throw new MessagingError(429, 'rate_limited', 'Please wait a minute before sending more messages.');
    record.count++; attempts.set(id, record);
  }
  router.get('/', async (req, res) => {
    const before = req.query.before === undefined ? undefined : idSchema.parse(req.query.before);
    res.set('Cache-Control', 'no-store').json(await listConversations(userId(req), before));
  });
  router.post('/', async (req, res) => {
    const { targetUserId } = z.object({ targetUserId: idSchema }).strict().parse(req.body);
    throttle(userId(req));
    const conversation = await startConversation(userId(req), targetUserId);
    notify([userId(req), targetUserId], 'inbox:changed', { conversationId: conversation.id });
    res.status(201).json({ conversation });
  });
  router.get('/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ conversation: await conversationPreview(userId(req), idSchema.parse(req.params.id)) });
  });
  router.get('/:id/messages', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const before = req.query.before === undefined ? undefined : pageCursor.parse(req.query.before);
    res.set('Cache-Control', 'no-store').json(await listMessages(userId(req), id, before));
  });
  router.post('/:id/messages', async (req, res) => {
    throttle(userId(req));
    const result = await sendMessage(userId(req), idSchema.parse(req.params.id), req.body);
    // Persist first, then publish. A retry uses the same client ID and cannot create a duplicate.
    notify(result.members, 'message:new', result.message);
    res.status(201).json({ message: result.message });
  });
  router.post('/:id/read', async (req, res) => {
    const { throughMessageId } = z.object({ throughMessageId: pageCursor }).strict().parse(req.body);
    await markConversationRead(userId(req), idSchema.parse(req.params.id), throughMessageId);
    notify([userId(req)], 'inbox:changed', { conversationId: req.params.id });
    res.json({ success: true });
  });
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) { res.status(400).json({ code: 'invalid_input', message: 'Check your message and try again. Messages must contain 1-2000 characters.' }); return; }
    if (error instanceof MessagingError) {
      if (error.status === 429) res.set('Retry-After', '60');
      res.status(error.status).json({ code: error.code, message: error.message }); return;
    }
    res.status(500).json({ code: 'unavailable', message: 'Messaging is temporarily unavailable. Please try again.' });
  });
  return router;
}
