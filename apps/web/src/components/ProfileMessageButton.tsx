import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { useMessaging } from './MessagingProvider';

export default function ProfileMessageButton({ userId }: { userId: string }) {
  const messaging = useMessaging();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (messaging.userId === userId) return null;
  return <div className="profile-message-action">
    <button className="button" type="button" disabled={pending} onClick={async () => {
      setPending(true); setError('');
      try { const conversation = await messaging.openConversation(userId); navigate(`/messages/${conversation.id}`); }
      catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not open conversation.'); }
      finally { setPending(false); }
    }}><MessageCircle size={16} aria-hidden="true" />{pending ? 'Opening...' : 'Message'}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
