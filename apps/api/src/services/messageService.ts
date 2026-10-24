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

export async function areMutualFollowers(userId: string, otherId: string) {
  const follows = await prisma.follow.count({ where: { OR: [
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
    lastMessage: conversation.messages[0] ?? null, unreadCount: conversation._count.messages,
    canSend: await areMutualFollowers(userId, otherUser.id)
  };
}

export async function listConversations(userId: string, before?: string) {
  if (before) await requireConversation(userId, before);
  // Conversation creation time is stable, unlike last-message time, so paging cannot skip bumped threads.
  const rows = await prisma.conversation.findMany({
    where: memberWhere(userId), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 31, ...(before ? { cursor: { id: before }, skip: 1 } : {})
  });
  const page = rows.slice(0, 30);
  const conversations = await Promise.all(page.map((row) => conversationPreview(userId, row.id)));
  const unreadTotal = await prisma.message.count({
    where: { senderId: { not: userId }, readAt: null, conversation: memberWhere(userId) }
  });
  return { userId, conversations, unreadTotal, nextCursor: rows.length > 30 ? page.at(-1)!.id : null };
}

export async function startConversation(userId: string, otherId: string) {
  if (userId === otherId) throw new MessagingError(400, 'self_message', 'Choose another person to message.');
  if (!await areMutualFollowers(userId, otherId)) {
    throw new MessagingError(403, 'mutual_follow_required', 'You must follow each other before starting a conversation.');
  }
  const [memberAId, memberBId] = [userId, otherId].sort();
  const pair = { memberAId_memberBId: { memberAId, memberBId } };
  let conversation;
  try {
    conversation = await prisma.conversation.upsert({ where: pair, create: { memberAId, memberBId }, update: {} });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    conversation = await prisma.conversation.findUniqueOrThrow({ where: pair });
  }
  return conversationPreview(userId, conversation.id);
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
  if (!await areMutualFollowers(userId, otherId)) {
    throw new MessagingError(403, 'mutual_follow_required', 'Messaging is paused because you no longer follow each other.');
  }
  const existing = await prisma.message.findUnique({ where: { senderId_clientMessageId: {
    senderId: userId, clientMessageId: data.clientMessageId
  } } });
  if (existing) {
    if (existing.conversationId !== conversationId || existing.body !== data.body) throw new MessagingError(409, 'duplicate_id', 'Please start a new message.');
    return { message: existing, members: [userId, otherId] };
  }
  try {
    const message = await prisma.$transaction(async (tx) => {
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
