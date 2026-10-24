import { getApiUrl } from './api';

export type ChatPerson = { id: string; displayName: string; spotifyProfileImage: string | null };
export type ChatMessage = {
  id: number; conversationId: string; senderId: string; clientMessageId: string;
  body: string; createdAt: string; readAt: string | null;
};
export type Conversation = {
  id: string; otherUser: ChatPerson; updatedAt: string; lastMessage: ChatMessage | null;
  unreadCount: number; canSend: boolean;
};
export type InboxResponse = { userId: string; conversations: Conversation[]; unreadTotal: number; nextCursor: string | null };
export class ChatRequestError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}

async function request<T>(token: string, path: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(`${getApiUrl()}/api/conversations${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000)
    });
  } catch { throw new ChatRequestError('network', 0, 'Could not reach messaging. Please try again.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ChatRequestError(data.code ?? 'unavailable', response.status,
    response.status === 401 ? 'Your session ended. Please sign in again.' : data.message ?? 'Messaging is temporarily unavailable.');
  return data as T;
}

export const getInbox = (token: string, before?: string) => request<InboxResponse>(token, before ? `?before=${encodeURIComponent(before)}` : '');
export const getConversation = (token: string, id: string) => request<{ conversation: Conversation }>(token, `/${encodeURIComponent(id)}`);
export const createConversation = (token: string, targetUserId: string) => request<{ conversation: Conversation }>(token, '', { targetUserId });
export const getMessages = (token: string, id: string, before?: number) => request<{ messages: ChatMessage[]; nextCursor: number | null }>(token,
  `/${encodeURIComponent(id)}/messages${before ? `?before=${before}` : ''}`);
export const postMessage = (token: string, id: string, body: string, clientMessageId: string) => request<{ message: ChatMessage }>(token,
  `/${encodeURIComponent(id)}/messages`, { body, clientMessageId });
export const markRead = (token: string, id: string, throughMessageId: number) => request<{ success: boolean }>(token,
  `/${encodeURIComponent(id)}/read`, { throughMessageId });
