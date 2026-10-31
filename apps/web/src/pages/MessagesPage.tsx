import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowDown, ArrowUpRight, Check, X, MessageCircle, RefreshCw, Send } from 'lucide-react';
import { useMessaging } from '../components/MessagingProvider';
import { ChatRequestError, getConversation, getMessages, markRead, postMessage, respondToRequest, type ChatMessage, type ChatPerson, type Conversation } from '../lib/messaging';

type Outgoing = { clientMessageId: string; body: string; conversationId: string; status: 'sending' | 'failed' };
type Thread = { id: string; conversation: Conversation | null; messages: ChatMessage[]; nextCursor: number | null;
  loading: boolean; loadingOlder: boolean; error: string };
const emptyThread: Thread = { id: '', conversation: null, messages: [], nextCursor: null, loading: false, loadingOlder: false, error: '' };
const mergeMessages = (previous: ChatMessage[], incoming: ChatMessage[]) => {
  const indexed = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) indexed.set(message.id, message);
  return [...indexed.values()].sort((a, b) => a.id - b.id);
};
const dateLabel = (date: string) => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const timeLabel = (date: string) => new Date(date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function PersonAvatar({ person }: { person: ChatPerson }) {
  return person.spotifyProfileImage ? <img src={person.spotifyProfileImage} alt="" className="chat-avatar" /> :
    <span className="chat-avatar chat-avatar-fallback">{person.displayName.slice(0, 1).toUpperCase()}</span>;
}

export default function MessagesPage() {
  const { conversationId } = useParams();
  const { token, userId, conversations, requests, requestTotal, requestCursor, connected, expired, version, subscribe, refresh,
    loading, loadingMore, nextCursor, loadMore, error: inboxError } = useMessaging();
  const [folder, setFolder] = useState<'inbox' | 'requests'>('inbox');
  const [deciding, setDeciding] = useState(false);
  const [thread, setThread] = useState<Thread>(emptyThread);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [sendError, setSendError] = useState('');
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const preserveScroll = useRef<{ height: number; top: number } | null>(null);
  const activeId = useRef(conversationId);
  const activeToken = useRef(token);
  const activeUser = useRef(userId);
  activeId.current = conversationId;
  activeToken.current = token;
  activeUser.current = userId;
  const lastRead = useRef(0);
  const view = thread.id === conversationId ? thread : emptyThread;
  const cachedConversation = [...conversations, ...requests].find((entry) => entry.id === conversationId);
  const knownConversation = view.conversation && (!cachedConversation || view.conversation.updatedAt > cachedConversation.updatedAt)
    ? view.conversation : cachedConversation ?? view.conversation;
  const draft = drafts[conversationId ?? ''] ?? '';
  const pending = outbox.filter((message) => message.conversationId === conversationId);
  const canSend = !!knownConversation?.canSend && !!userId && !expired;
  const incomingRequest = knownConversation?.status === 'pending' && knownConversation.requestDirection === 'incoming';
  const outgoingRequest = knownConversation?.status === 'pending' && knownConversation.requestDirection === 'outgoing';
  const canCompose = canSend && !(outgoingRequest && (view.messages.length > 0 || pending.length > 0));
  const visibleConversations = folder === 'requests' ? requests : conversations;
  const folderCursor = folder === 'requests' ? requestCursor : nextCursor;

  useEffect(() => {
    if (incomingRequest) setFolder('requests');
  }, [conversationId, incomingRequest]);

  useEffect(() => subscribe((message) => {
    if (message.conversationId !== activeId.current) return;
    setThread((previous) => previous.id === message.conversationId ? {
      ...previous, messages: mergeMessages(previous.messages, [message])
    } : previous);
    if (message.senderId === activeUser.current) {
      setOutbox((previous) => previous.filter((entry) => entry.clientMessageId !== message.clientMessageId));
    }
    lastRead.current = 0;
    if (!nearBottom.current) setHasNewMessages(true);
  }), [subscribe]);

  useEffect(() => {
    setSendError(''); setHasNewMessages(false); lastRead.current = 0; nearBottom.current = true;
    preserveScroll.current = null;
    if (!conversationId || !token) { setThread(emptyThread); return; }
    let cancelled = false;
    setThread({ ...emptyThread, id: conversationId, loading: true });
    Promise.all([getConversation(token, conversationId), getMessages(token, conversationId)])
      .then(([detail, history]) => {
        if (cancelled) return;
        const savedIds = new Set(history.messages.filter((message) => message.senderId === activeUser.current).map((message) => message.clientMessageId));
        setOutbox((previous) => previous.filter((message) => !savedIds.has(message.clientMessageId)));
        setThread((previous) => ({ ...previous, id: conversationId, loading: false, conversation: detail.conversation,
          messages: mergeMessages(history.messages, previous.id === conversationId ? previous.messages : []), nextCursor: history.nextCursor }));
      }).catch((error) => {
        if (!cancelled) setThread({ ...emptyThread, id: conversationId, error: error instanceof Error ? error.message : 'Could not load conversation.' });
      });
    return () => { cancelled = true; };
  }, [conversationId, token, version]);

  const acknowledgeRead = useCallback(() => {
    const newest = view.messages[view.messages.length - 1]?.id;
    if (!token || !conversationId || !newest || !nearBottom.current || document.visibilityState !== 'visible' || lastRead.current === newest) return;
    lastRead.current = newest;
    void markRead(token, conversationId, newest).then(() => refresh(conversationId)).catch(() => {
      if (activeId.current === conversationId) lastRead.current = 0;
    });
  }, [token, conversationId, view.messages, refresh]);

  useEffect(() => {
    if (preserveScroll.current && scroller.current) {
      const previous = preserveScroll.current;
      scroller.current.scrollTop = scroller.current.scrollHeight - previous.height + previous.top;
      preserveScroll.current = null;
    } else if (nearBottom.current && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
    acknowledgeRead();
  }, [view.messages, pending.length, acknowledgeRead]);

  useEffect(() => {
    window.addEventListener('focus', acknowledgeRead);
    document.addEventListener('visibilitychange', acknowledgeRead);
    return () => { window.removeEventListener('focus', acknowledgeRead); document.removeEventListener('visibilitychange', acknowledgeRead); };
  }, [acknowledgeRead]);

  async function loadOlder() {
    if (!token || !conversationId || !view.nextCursor || view.loadingOlder) return;
    const id = conversationId;
    setThread((previous) => ({ ...previous, loadingOlder: true, error: '' }));
    try {
      const older = await getMessages(token, id, view.nextCursor);
      if (activeId.current !== id || activeToken.current !== token) return;
      if (scroller.current) preserveScroll.current = { height: scroller.current.scrollHeight, top: scroller.current.scrollTop };
      setThread((previous) => ({ ...previous, loadingOlder: false, messages: mergeMessages(older.messages, previous.messages), nextCursor: older.nextCursor }));
    } catch { if (activeId.current === id) setThread((previous) => ({ ...previous, loadingOlder: false, error: 'Could not load older messages. Please try again.' })); }
  }

  async function send(outgoing: Outgoing) {
    if (!token) return;
    setSendError('');
    setOutbox((previous) => [...previous.filter((entry) => entry.clientMessageId !== outgoing.clientMessageId), { ...outgoing, status: 'sending' }]);
    try {
      const { message } = await postMessage(token, outgoing.conversationId, outgoing.body, outgoing.clientMessageId);
      if (activeToken.current !== token) return;
      if (activeId.current === outgoing.conversationId) {
        setThread((previous) => ({ ...previous, messages: mergeMessages(previous.messages, [message]) }));
      }
      setOutbox((previous) => previous.filter((entry) => entry.clientMessageId !== outgoing.clientMessageId));
      void refresh(outgoing.conversationId);
    } catch (error) {
      if (activeToken.current !== token) return;
      setOutbox((previous) => previous.map((entry) => entry.clientMessageId === outgoing.clientMessageId ? { ...entry, status: 'failed' } : entry));
      if (activeId.current === outgoing.conversationId) setSendError(error instanceof Error ? error.message : 'Message not sent. Please retry.');
      if (error instanceof ChatRequestError && ['mutual_follow_required', 'request_pending', 'request_declined'].includes(error.code)) void refresh(outgoing.conversationId);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversationId || !canCompose || !draft.trim() || draft.trim().length > 2000) return;
    const outgoing: Outgoing = { conversationId, body: draft.trim(), clientMessageId: crypto.randomUUID(), status: 'sending' };
    setDrafts((previous) => ({ ...previous, [conversationId]: '' }));
    nearBottom.current = true; setHasNewMessages(false);
    void send(outgoing);
  }

  async function decide(decision: 'accepted' | 'declined') {
    if (!token || !conversationId || deciding) return;
    const id = conversationId;
    setDeciding(true); setSendError('');
    try {
      const result = await respondToRequest(token, id, decision);
      if (activeToken.current !== token || activeId.current !== id) return;
      setThread((previous) => previous.id === id ? { ...previous, conversation: result.conversation } : previous);
      await refresh(id);
      setFolder(decision === 'accepted' ? 'inbox' : 'requests');
    } catch (error) {
      if (activeToken.current === token && activeId.current === id) {
        setSendError(error instanceof Error ? error.message : 'Could not update this request.');
        void refresh(id);
      }
    } finally { setDeciding(false); }
  }

  if (!token) return <section><h2>Messages</h2><p><Link to="/">Sign in with Spotify</Link> to see your conversations.</p></section>;

  return <div className="messaging-page">
    <header className="messaging-title"><h2>Messages</h2><span className={`chat-connection ${connected ? 'is-live' : ''}`} role="status">
      <span aria-hidden="true" />{expired ? 'Session ended' : connected ? 'Connected' : 'Reconnecting...'}</span></header>
    {expired && <p role="alert"><Link to="/">Sign in again</Link> to reconnect to messaging.</p>}
    <div className={`chat-workspace ${conversationId ? 'has-active-thread' : ''}`}>
      <aside className="chat-inbox" aria-label="Conversations">
        <div className="chat-inbox-heading"><h3>Conversations</h3><button type="button" className="chat-icon-button" title="Refresh conversations" aria-label="Refresh conversations" onClick={() => void refresh()}><RefreshCw size={16} /></button></div>
        <div className="chat-folder-tabs" role="group" aria-label="Message folders">
          <button type="button" aria-pressed={folder === 'inbox'} onClick={() => setFolder('inbox')}>Inbox</button>
          <button type="button" aria-pressed={folder === 'requests'} onClick={() => setFolder('requests')}>Requests{requestTotal > 0 ? ` (${requestTotal})` : ''}</button>
        </div>
        {loading && <p role="status" className="chat-inbox-note">Loading conversations...</p>}
        {inboxError && <p role="alert" className="chat-inbox-note">{inboxError}</p>}
        {!loading && !visibleConversations.length && <div className="chat-inbox-empty"><MessageCircle size={24} aria-hidden="true" /><p>{folder === 'requests' ? 'No message requests.' : 'No conversations yet.'}</p>{folder === 'inbox' && <Link to="/matches">Find a connection</Link>}</div>}
        <nav className="chat-conversation-list" aria-label="Choose a conversation">
          {visibleConversations.map((conversation) => <Link key={conversation.id} to={`/messages/${conversation.id}`} className={`chat-conversation ${conversation.id === conversationId ? 'is-active' : ''}`} aria-current={conversation.id === conversationId ? 'page' : undefined}>
            <PersonAvatar person={conversation.otherUser} />
            <span className="chat-conversation-copy"><strong>{conversation.otherUser.displayName}</strong><span>{conversation.lastMessage ? `${conversation.lastMessage.senderId === userId ? 'You: ' : ''}${conversation.lastMessage.body}` : 'Start a conversation'}</span></span>
            {conversation.status === 'pending' && <span className="chat-request-label">{conversation.requestDirection === 'outgoing' ? 'Pending' : 'New'}</span>}
            {conversation.status === 'declined' && <span className="chat-request-label">Declined</span>}
            {conversation.unreadCount > 0 && <span className="chat-unread-count" aria-label={`${conversation.unreadCount} unread`}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</span>}
          </Link>)}
        </nav>
        {folderCursor && <button className="chat-load-more" type="button" disabled={loadingMore} onClick={() => void loadMore(folder)}>{loadingMore ? 'Loading...' : 'More conversations'}</button>}
      </aside>
      <section className="chat-thread" aria-label="Message thread">
        {!conversationId ? <div className="chat-thread-empty"><MessageCircle size={36} aria-hidden="true" /><h3>A conversation starts here</h3><p>Choose a conversation or review a message request.</p></div> : <>
          <header className="chat-thread-header"><Link to="/messages" className="chat-icon-button chat-mobile-back" aria-label="Back to conversations" title="Back to conversations"><ArrowLeft size={18} /></Link>
            {knownConversation && <><PersonAvatar person={knownConversation.otherUser} /><div><h3>{knownConversation.otherUser.displayName}</h3><span className="muted">{knownConversation.status === 'accepted' ? 'Request accepted' : knownConversation.status === 'pending' ? 'Message request' : knownConversation.status === 'declined' ? 'Request declined' : knownConversation.canSend ? 'Mutual followers' : 'Messaging paused'}</span></div>
              <Link to={`/profile/${knownConversation.otherUser.id}`} className="chat-icon-button" title="View profile" aria-label={`View ${knownConversation.otherUser.displayName}'s profile`}><ArrowUpRight size={18} /></Link></>}
          </header>
          <div className="chat-history" ref={scroller} onScroll={() => {
            const element = scroller.current;
            nearBottom.current = !!element && element.scrollHeight - element.scrollTop - element.clientHeight < 70;
            if (nearBottom.current) { setHasNewMessages(false); acknowledgeRead(); }
          }}>
            {view.loading && <p role="status">Loading messages...</p>}
            {view.error && <p role="alert">{view.error}</p>}
            {view.nextCursor && <button className="chat-load-more" type="button" disabled={view.loadingOlder} onClick={() => void loadOlder()}>{view.loadingOlder ? 'Loading...' : 'Load older messages'}</button>}
            {!view.loading && !view.error && !view.messages.length && !pending.length && <p className="chat-first-message">No messages yet. Say hello.</p>}
            <ol className="chat-message-list" aria-label="Messages" aria-live={view.loading ? 'off' : 'polite'} aria-relevant="additions">
              {view.messages.map((message, index) => {
                const showDate = !index || dateLabel(view.messages[index - 1].createdAt) !== dateLabel(message.createdAt);
                return <li key={message.id} className={`chat-message-entry ${message.senderId === userId ? 'is-mine' : ''}`}>
                  {showDate && <p className="chat-day-divider">{dateLabel(message.createdAt)}</p>}
                  <div className="chat-bubble"><span className="chat-sender-label">{message.senderId === userId ? 'You' : knownConversation?.otherUser.displayName}</span><p>{message.body}</p><time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time></div>
                </li>;
              })}
              {pending.map((message) => <li className="chat-message-entry is-mine" key={message.clientMessageId}><div className="chat-bubble chat-pending"><p>{message.body}</p><span>{message.status === 'sending' ? 'Sending...' : 'Not sent'}</span>
                {message.status === 'failed' && <button type="button" disabled={!canSend} onClick={() => void send(message)}>Retry</button>}</div></li>)}
            </ol>
          </div>
          {hasNewMessages && <button className="chat-new-messages" type="button" onClick={() => { nearBottom.current = true; if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; setHasNewMessages(false); acknowledgeRead(); }}><ArrowDown size={14} />New messages</button>}
          {incomingRequest && <div className="chat-request-actions">
            <p>{knownConversation.otherUser.displayName} wants to message you.</p>
            <div><button className="button" type="button" disabled={deciding || expired} onClick={() => void decide('accepted')}><Check size={16} aria-hidden="true" />Accept</button>
              <button className="chat-decline-button" type="button" disabled={deciding || expired} onClick={() => void decide('declined')}><X size={16} aria-hidden="true" />Decline</button></div>
          </div>}
          {outgoingRequest && <p className="chat-paused" role="status">{canCompose ? 'Send one introduction with your request.' : 'Request pending. You can send more messages once it is accepted.'}</p>}
          {knownConversation?.status === 'declined' && <p className="chat-paused" role="status">This request was declined. New messages are disabled.</p>}
          {knownConversation?.status === 'mutual' && !knownConversation.canSend && <p className="chat-paused" role="status">You must follow each other to send new messages. Your history is still available.</p>}
          {sendError && <p role="alert" className="chat-send-error">{sendError}</p>}
          {knownConversation && !incomingRequest && knownConversation.status !== 'declined' && <form className="chat-composer" onSubmit={submit}>
            <label htmlFor="chat-message" className="chat-sender-label">Message {knownConversation.otherUser.displayName}</label>
            <textarea id="chat-message" rows={2} maxLength={2000} value={draft} disabled={!canCompose} placeholder={canCompose ? 'Write a message...' : outgoingRequest ? 'Waiting for acceptance' : 'Messaging is paused'}
              onChange={(event) => setDrafts((previous) => ({ ...previous, [conversationId]: event.target.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
            <div><span className="muted">{draft.length}/2000</span><button className="button" type="submit" disabled={!canCompose || !draft.trim()}><Send size={16} aria-hidden="true" />{outgoingRequest ? 'Send request' : 'Send'}</button></div>
          </form>}
        </>}
      </section>
    </div>
  </div>;
}
