import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export class MessagingError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  clientMessageId: z.string().uuid()
}).strict();
export const personSelect = { id: true, displayName: true, spotifyProfileImage: true } as const;
const memberWhere = (userId: string) => ({ OR: [{ memberAId: userId }, { memberBId: userId }] });

export async function requireConversation(userId: string, id: string) {
  const conversation = await prisma.conversation.findFirst({ where: { id, ...memberWhere(userId) } });
  if (!conversation) throw new MessagingError(404, 'not_found', 'Conversation not found.');
  return conversation;
}

export async function areMutualFollowers(userId: string, otherId: string, db: Pick<Prisma.TransactionClient, 'follow'> = prisma) {
  const follows = await db.follow.count({ where: { OR: [
    { followerId: userId, followingId: otherId }, { followerId: otherId, followingId: userId }
  ] } });
  return follows === 2;
}

export async function conversationPreview(userId: string, id: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, ...memberWhere(userId) },
    include: {
      memberA: { select: personSelect }, memberB: { select: personSelect },
      messages: { orderBy: { id: 'desc' }, take: 1 },
      _count: { select: { messages: { where: { senderId: { not: userId }, readAt: null } } } }
    }
  });
  if (!conversation) throw new MessagingError(404, 'not_found', 'Conversation not found.');
  const otherUser = conversation.memberAId === userId ? conversation.memberB : conversation.memberA;
  return {
    id: conversation.id, otherUser, updatedAt: conversation.updatedAt,
    status: conversation.status,
    requestDirection: conversation.requesterId ? (conversation.requesterId === userId ? 'outgoing' : 'incoming') : null,
    lastMessage: conversation.messages[0] ?? null, unreadCount: conversation._count.messages,
    canSend: conversation.status === 'accepted' ||
      (conversation.status === 'mutual' && await areMutualFollowers(userId, otherUser.id)) ||
      (conversation.status === 'pending' && conversation.requesterId === userId && conversation.messages.length === 0)
  };
}

export async function listConversations(userId: string, before?: string, folder: 'inbox' | 'requests' = 'inbox') {
  // Conversation creation time is stable, unlike last-message time, so paging cannot skip bumped threads.
  const incomingRequest = { status: 'pending' as const, requesterId: { not: userId } };
  const folderWhere: Prisma.ConversationWhereInput = folder === 'requests' ? incomingRequest : {
    NOT: { status: { in: ['pending', 'declined'] }, requesterId: { not: userId } }
  };
  const cursor = before ? await requireConversation(userId, before) : null;
  // A resolved request may leave its folder; its creation-time position remains valid.
  const rows = await prisma.conversation.findMany({
    where: { AND: [memberWhere(userId), folderWhere, ...(cursor ? [{ OR: [
      { createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }
    ] }] : [])] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 31
  });
  const page = rows.slice(0, 30);
  const conversations = await Promise.all(page.map((row) => conversationPreview(userId, row.id)));
  const unreadTotal = await prisma.message.count({
    where: { senderId: { not: userId }, readAt: null, conversation: { ...memberWhere(userId), status: { in: ['mutual', 'accepted'] } } }
  });
  const requestTotal = await prisma.conversation.count({ where: { ...memberWhere(userId), ...incomingRequest } });
  return { userId, conversations, unreadTotal, requestTotal, nextCursor: rows.length > 30 ? page.at(-1)!.id : null };
}

export async function startConversation(userId: string, otherId: string) {
  if (userId === otherId) throw new MessagingError(400, 'self_message', 'Choose another person to message.');
  if (!await prisma.user.findUnique({ where: { id: otherId }, select: { id: true } })) {
    throw new MessagingError(404, 'not_found', 'User not found.');
  }
  const mutual = await areMutualFollowers(userId, otherId);
  const [memberAId, memberBId] = [userId, otherId].sort();
  const pair = { memberAId_memberBId: { memberAId, memberBId } };
  let conversation;
  try {
    conversation = await prisma.conversation.upsert({ where: pair, create: {
      memberAId, memberBId, status: mutual ? 'mutual' : 'pending', requesterId: mutual ? null : userId
    }, update: {} });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    conversation = await prisma.conversation.findUniqueOrThrow({ where: pair });
  }
  return conversationPreview(userId, conversation.id);
}

export async function respondToRequest(userId: string, id: string, decision: 'accepted' | 'declined') {
  const conversation = await requireConversation(userId, id);
  if (!conversation.requesterId || conversation.requesterId === userId) {
    throw new MessagingError(403, 'recipient_required', 'Only the recipient can respond to this request.');
  }
  const result = await prisma.conversation.updateMany({
    where: { id, status: 'pending', requesterId: conversation.requesterId }, data: { status: decision }
  });
  if (!result.count) {
    const current = await requireConversation(userId, id);
    if (current.status !== decision) throw new MessagingError(409, 'request_resolved', 'This request has already been resolved.');
  }
  return { conversation: await conversationPreview(userId, id), members: [conversation.memberAId, conversation.memberBId] };
}

export async function listMessages(userId: string, conversationId: string, before?: number) {
  await requireConversation(userId, conversationId);
  const rows = await prisma.message.findMany({
    where: { conversationId, ...(before ? { id: { lt: before } } : {}) },
    orderBy: { id: 'desc' }, take: 51
  });
  const page = rows.slice(0, 50);
  return { messages: page.reverse(), nextCursor: rows.length > 50 ? page[0].id : null };
}

export async function sendMessage(userId: string, conversationId: string, input: unknown) {
  const data = sendMessageSchema.parse(input);
  const conversation = await requireConversation(userId, conversationId);
  const otherId = conversation.memberAId === userId ? conversation.memberBId : conversation.memberAId;
  const existing = await prisma.message.findUnique({ where: { senderId_clientMessageId: {
    senderId: userId, clientMessageId: data.clientMessageId
  } } });
  if (existing) {
    if (existing.conversationId !== conversationId || existing.body !== data.body) throw new MessagingError(409, 'duplicate_id', 'Please start a new message.');
    return { message: existing, members: [userId, otherId] };
  }
  try {
    const message = await prisma.$transaction(async (tx) => {
      // Serialize sends and request decisions so only one introduction can be saved.
      await tx.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${conversationId} FOR UPDATE`;
      const current = await tx.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      const retry = await tx.message.findUnique({ where: { senderId_clientMessageId: {
        senderId: userId, clientMessageId: data.clientMessageId
      } } });
      if (retry) {
        if (retry.conversationId !== conversationId || retry.body !== data.body) throw new MessagingError(409, 'duplicate_id', 'Please start a new message.');
        return retry;
      }
      if (current.status === 'declined') throw new MessagingError(403, 'request_declined', 'This message request was declined.');
      if (current.status === 'pending') {
        if (current.requesterId !== userId) throw new MessagingError(403, 'request_pending', 'Accept this request before replying.');
        if (await tx.message.count({ where: { conversationId } })) {
          throw new MessagingError(403, 'request_pending', 'Your request is pending. Wait for it to be accepted before sending another message.');
        }
      } else if (current.status === 'mutual' && !await areMutualFollowers(userId, otherId, tx)) {
        throw new MessagingError(403, 'mutual_follow_required', 'Messaging is paused because you no longer follow each other.');
      }
      const saved = await tx.message.create({ data: { ...data, senderId: userId, conversationId } });
      await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      return saved;
    });
    return { message, members: [userId, otherId] };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const saved = await prisma.message.findUnique({ where: { senderId_clientMessageId: {
        senderId: userId, clientMessageId: data.clientMessageId
      } } });
      if (saved?.conversationId === conversationId && saved.body === data.body) return { message: saved, members: [userId, otherId] };
    }
    throw error;
  }
}

export async function markConversationRead(userId: string, conversationId: string, throughMessageId: number) {
  await requireConversation(userId, conversationId);
  const boundary = await prisma.message.findFirst({ where: { id: throughMessageId, conversationId } });
  if (!boundary) throw new MessagingError(400, 'invalid_boundary', 'Read position is not part of this conversation.');
  await prisma.message.updateMany({
    where: { conversationId, senderId: { not: userId }, readAt: null, id: { lte: boundary.id } },
    data: { readAt: new Date() }
  });
}
