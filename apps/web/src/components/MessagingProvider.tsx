import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { io } from 'socket.io-client';
import { getApiUrl } from '../lib/api';
import { createConversation, getConversation, getInbox, type Conversation, type ChatMessage } from '../lib/messaging';

type MessagingState = {
  userId: string | null; conversations: Conversation[]; unreadTotal: number; loading: boolean; loadingMore: boolean;
  error: string; connected: boolean; expired: boolean; version: number;
  nextCursor: string | null;
  initialized: boolean;
  requests: Conversation[];
  requestTotal: number;
  requestCursor: string | null;
};
const initial: MessagingState = { userId: null, conversations: [], unreadTotal: 0, loading: true, loadingMore: false,
  error: '', connected: false, expired: false, version: 0, nextCursor: null, initialized: false,
  requests: [], requestTotal: 0, requestCursor: null };
type MessagingContext = MessagingState & {
  token: string | null;
  refresh: (conversationId?: string) => Promise<void>;
  loadMore: (folder?: 'inbox' | 'requests') => Promise<void>;
  openConversation: (userId: string) => Promise<Conversation>;
  subscribe: (listener: (message: ChatMessage) => void) => () => void;
};
const Context = createContext<MessagingContext | null>(null);
export function useMessaging() {
  const context = useContext(Context);
  if (!context) throw new Error('MessagingProvider is required.');
  return context;
}

const mergeConversations = (previous: Conversation[], incoming: Conversation[]) => {
  const indexed = new Map(previous.map((conversation) => [conversation.id, conversation]));
  for (const conversation of incoming) indexed.set(conversation.id, conversation);
  return [...indexed.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
};
const isRequest = (conversation: Conversation) => conversation.status === 'pending' && conversation.requestDirection === 'incoming';
const isInbox = (conversation: Conversation) => !isRequest(conversation) &&
  !(conversation.status === 'declined' && conversation.requestDirection === 'incoming');

export function MessagingProvider({ token, children }: { token: string | null; children: ReactNode }) {
  const [state, setState] = useState(initial);
  const activeToken = useRef(token);
  activeToken.current = token;
  const requestNumber = useRef(0);
  const listeners = useRef(new Set<(message: ChatMessage) => void>());
  const subscribe = useCallback((listener: (message: ChatMessage) => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);
  const refresh = useCallback(async (conversationId?: string) => {
    if (!token) return;
    const sequence = ++requestNumber.current;
    try {
      const [inbox, requests, detail] = await Promise.all([
        getInbox(token), getInbox(token, undefined, 'requests'), conversationId ? getConversation(token, conversationId) : null
      ]);
      if (activeToken.current !== token || sequence !== requestNumber.current) return;
      setState((previous) => ({ ...previous, userId: inbox.userId, unreadTotal: inbox.unreadTotal, requestTotal: inbox.requestTotal, loading: false, error: '', initialized: true,
        nextCursor: previous.nextCursor ?? inbox.nextCursor,
        requestCursor: previous.requestCursor ?? requests.nextCursor,
        conversations: mergeConversations([...previous.conversations, ...previous.requests], [...inbox.conversations, ...requests.conversations, ...(detail ? [detail.conversation] : [])]).filter(isInbox),
        requests: mergeConversations([...previous.requests, ...previous.conversations], [...inbox.conversations, ...requests.conversations, ...(detail ? [detail.conversation] : [])]).filter(isRequest) }));
    } catch (error) {
      if (activeToken.current === token && sequence === requestNumber.current) {
        setState((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : 'Could not load messages.' }));
      }
    }
  }, [token]);

  useEffect(() => {
    setState(initial);
    if (!token) { setState({ ...initial, loading: false }); return; }
    void refresh();
    const socket = io(getApiUrl() || window.location.origin, { auth: { token }, reconnectionDelayMax: 5000 });
    socket.on('connect', () => {
      setState((previous) => ({ ...previous, connected: true, expired: false, version: previous.version + 1 }));
      void refresh();
    });
    socket.on('disconnect', (reason) => {
      setState((previous) => ({ ...previous, connected: false, expired: reason === 'io server disconnect' }));
    });
    socket.on('connect_error', (error) => {
      if (error.message === 'Please sign in again.') setState((previous) => ({ ...previous, expired: true, connected: false }));
    });
    socket.on('message:new', (message: ChatMessage) => {
      for (const listener of listeners.current) listener(message);
      void refresh(message.conversationId);
    });
    socket.on('inbox:changed', (payload?: { conversationId?: string }) => { void refresh(payload?.conversationId); });
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => { socket.disconnect(); window.removeEventListener('focus', focus); };
  }, [token, refresh]);

  async function loadMore(folder: 'inbox' | 'requests' = 'inbox') {
    const cursor = folder === 'requests' ? state.requestCursor : state.nextCursor;
    if (!token || !cursor || state.loadingMore) return;
    setState((previous) => ({ ...previous, loadingMore: true }));
    try {
      const inbox = await getInbox(token, cursor, folder);
      if (activeToken.current !== token) return;
      setState((previous) => {
        const key = folder === 'requests' ? 'requests' : 'conversations';
        return { ...previous, loadingMore: false, [folder === 'requests' ? 'requestCursor' : 'nextCursor']: inbox.nextCursor,
          [key]: mergeConversations(previous[key], inbox.conversations.filter((incoming) => !previous[key].some((existing) => existing.id === incoming.id))) };
      });
    } catch { if (activeToken.current === token) setState((previous) => ({ ...previous, loadingMore: false, error: 'Could not load older conversations.' })); }
  }
  async function openConversation(userId: string) {
    if (!token) throw new Error('Please sign in to message someone.');
    const { conversation } = await createConversation(token, userId);
    if (activeToken.current !== token) throw new Error('Your session changed. Please try again.');
    setState((previous) => ({ ...previous,
      conversations: mergeConversations(previous.conversations, [conversation]).filter(isInbox),
      requests: mergeConversations(previous.requests, [conversation]).filter(isRequest) }));
    return conversation;
  }
  return <Context.Provider value={{ ...state, token, refresh, loadMore, openConversation, subscribe }}>{children}</Context.Provider>;
}

export function MessagesNavLink() {
  const { unreadTotal, requestTotal } = useMessaging();
  const total = unreadTotal + requestTotal;
  return <NavLink to="/messages">Messages{total > 0 && <span className="message-nav-count" aria-label={`${unreadTotal} unread messages and ${requestTotal} requests`}>{total > 99 ? '99+' : total}</span>}</NavLink>;
}
