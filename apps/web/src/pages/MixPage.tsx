import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Check, Globe, ListMusic, Music2, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { getApiUrl } from '../lib/api';
import { clearFrozenMix, fetchMixPreview, fetchMixStatus, MixRequestError, persistFrozenMix, readFrozenMix, saveMix, spotifyPlaylistUrl, type MixPreview, type MixRequest, type MixResult } from '../lib/mixes';

const reconnectCodes = ['reconnect', 'permission_required', 'access_denied'];
const sourceLabels = { shared: 'Shared', you: 'You', them: 'Them' };
type LoadState = { status: 'loading' } | { status: 'error'; error: MixRequestError } | { status: 'ready'; preview: MixPreview };

export default function MixPage() {
  const { userId } = useParams();
  return <MixEditor key={userId} userId={userId || ''} />;
}

function MixEditor({ userId }: { userId: string }) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [name, setName] = useState('');
  const [trackIds, setTrackIds] = useState<string[]>([]);
  const [frozen, setFrozen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [sessionOnly, setSessionOnly] = useState(false);
  const [result, setResult] = useState<MixResult | null>(null);
  const [error, setError] = useState<MixRequestError | null>(null);
  const payload = useRef<MixRequest | null>(null);
  const inFlight = useRef(false);
  const oauthUrl = `${getApiUrl()}/api/auth/spotify`;

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    const token = localStorage.getItem('connectify_app_token');
    if (!token || !userId) {
      setLoad({ status: 'error', error: new MixRequestError('unavailable', token ? 404 : 401,
        token ? 'No listener was selected.' : 'Sign in with Spotify to create a mix.') });
      return;
    }
    fetchMixPreview(token, userId).then(async (preview) => {
      if (cancelled) return;
      const stored = readFrozenMix(preview.owner.id, userId);
      payload.current = stored;
      setFrozen(Boolean(stored));
      setName(stored?.name ?? preview.name);
      setTrackIds(stored?.trackIds ?? preview.tracks.map((track) => track.spotifyId));
      setError(null);
      setResult(null);
      setLoad({ status: 'ready', preview });
      if (stored) {
        setSessionOnly(!persistFrozenMix(preview.owner.id, stored));
        setRecovering(true);
        // The backend uses requestId as the durable mix ID, even if POST's response was lost.
        try {
          const recovered = await fetchMixStatus(token, stored.requestId);
          if (!cancelled) setResult(recovered);
        } catch (cause) {
          if (!cancelled) {
            if (cause instanceof MixRequestError && cause.status === 404) {
              setResult({ id: stored.requestId, status: 'pending', playlistUrl: null });
            } else {
              setError(cause instanceof MixRequestError ? cause : new MixRequestError('unavailable', 0, 'Could not check the saved request. Retry this same save.'));
            }
          }
        } finally {
          if (!cancelled) setRecovering(false);
        }
      }
    }).catch((cause: unknown) => {
      if (!cancelled) setLoad({ status: 'error', error: cause instanceof MixRequestError ? cause : new MixRequestError('unavailable', 0, 'Could not load this mix.') });
    });
    return () => { cancelled = true; };
  }, [userId, reload]);

  async function handleSave() {
    if (inFlight.current || recovering || result?.status === 'saved' || result?.status === 'uncertain' || error?.code === 'save_uncertain'
      || load.status !== 'ready' || (!payload.current && !load.preview.canSave) || !name.trim() || !trackIds.length || trackIds.length > 20) return;
    const token = localStorage.getItem('connectify_app_token');
    if (!token) { setError(new MixRequestError('unavailable', 401, 'Your session ended. Please sign in again.')); return; }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      // Capture once: all retries must use the exact same key and content.
      const retrying = Boolean(payload.current);
      if (!payload.current) payload.current = { targetUserId: userId, name: name.trim(), trackIds: [...trackIds], requestId: crypto.randomUUID() };
      setFrozen(true);
      setSessionOnly(!persistFrozenMix(load.preview.owner.id, payload.current));
      if (retrying) {
        try {
          const recovered = await fetchMixStatus(token, result?.id || payload.current.requestId);
          setResult(recovered);
          if (recovered.status !== 'pending') return;
        } catch (cause) {
          if (!(cause instanceof MixRequestError && cause.status === 404)) throw cause;
        }
      }
      setResult(await saveMix(token, payload.current));
    } catch (cause) {
      setError(cause instanceof MixRequestError ? cause : new MixRequestError('save_pending', 0, 'The save could not be confirmed. Retry this same save.'));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function handleNewMix() {
    if (load.status !== 'ready' || result?.status !== 'saved' || saving || recovering) return;
    if (!clearFrozenMix(load.preview.owner.id, userId)) {
      setSessionOnly(true);
      setError(new MixRequestError('unavailable', 0, 'Browser storage could not be cleared. Your existing save is still retained.'));
      return;
    }
    payload.current = null;
    setFrozen(false);
    setResult(null);
    setError(null);
    setSessionOnly(false);
    setReload((value) => value + 1);
  }

  const activeError = load.status === 'error' ? load.error : error;
  const needsReconnect = activeError?.status === 403
    || reconnectCodes.includes(activeError?.code || '') || (load.status === 'ready' && !load.preview.canSave);
  const uncertain = result?.status === 'uncertain' || error?.code === 'save_uncertain';
  const pending = result?.status === 'pending' || error?.code === 'save_pending';
  const saved = result?.status === 'saved';
  const playlistUrl = spotifyPlaylistUrl(result?.playlistUrl);
  const canRetry = !uncertain && !saved && !needsReconnect && activeError?.status !== 401;
  const availableTracks = load.status === 'ready' ? load.preview.tracks : [];
  const removedCount = frozen ? 0 : availableTracks.length - trackIds.length;
  const missingCount = frozen ? trackIds.filter((id) => !availableTracks.some((track) => track.spotifyId === id)).length : 0;

  return <section className="mix-page stack" aria-labelledby="mix-heading">
    <Link className="mix-back" to="/matches"><ArrowLeft size={16} aria-hidden="true" />Matches</Link>
    <header className="mix-header">
      <p className="eyebrow">Joint mix</p>
      <h2 id="mix-heading">{load.status === 'ready' ? `You + ${load.preview.target.displayName || 'your connection'}` : 'Your joint mix'}</h2>
      <p className="mix-meta"><Globe size={16} aria-hidden="true" />Public on Spotify. Shareable with a link. Only you can edit.</p>
    </header>
    {load.status === 'loading' && <p role="status">Loading tracklist...</p>}
    {activeError && <div className="mix-notice mix-error" role="alert">
      <p>{activeError.message}</p>
      {activeError.code === 'rate_limited' && <p>Spotify is rate limiting requests. Wait before retrying.</p>}
      {activeError.status === 401 && <Link to="/">Sign in again</Link>}
      {load.status === 'error' && activeError.status !== 401 && !needsReconnect && <button type="button" className="button button-ghost" onClick={() => setReload((value) => value + 1)}><RotateCcw size={16} />Retry preview</button>}
    </div>}
    {needsReconnect && <div className="mix-notice"><p>Reconnect Spotify to allow saving public playlists.</p><a className="button button-secondary" href={oauthUrl}><ArrowUpRight size={16} />Reconnect Spotify</a></div>}
    {load.status === 'ready' && <>
      {sessionOnly && <p className="mix-notice" role="status">Browser storage is unavailable. This request is retained in memory only; keep this page open until the save is resolved.</p>}
      {recovering && <p role="status">Checking your previous save...</p>}
      {frozen ? <div className="mix-editor"><span className="mix-muted">Playlist name</span><strong>{name}</strong></div> : <div className="mix-editor">
        <label htmlFor="mix-name">Playlist name</label>
        <input id="mix-name" value={name} maxLength={100} disabled={frozen} onChange={(event) => setName(event.target.value)} aria-describedby="mix-name-count" />
        <span id="mix-name-count" className="mix-muted">{name.length}/100</span>
      </div>}
      <div className="mix-toolbar"><h3><ListMusic size={20} aria-hidden="true" />Tracklist <span className="mix-muted">{trackIds.length}/20</span></h3>
        {!frozen && <button type="button" className="button button-ghost" disabled={name === load.preview.name && trackIds.length === load.preview.tracks.length} onClick={() => {
          setName(load.preview.name); setTrackIds(load.preview.tracks.map((track) => track.spotifyId));
        }}><RotateCcw size={16} aria-hidden="true" />Restore original</button>}
      </div>
      {!availableTracks.length && !frozen && <p>No tracks available from these listening profiles yet. Sync listening data and return later.</p>}
      {availableTracks.length > 0 && availableTracks.length < 20 && <p className="mix-muted">Only {availableTracks.length} of 20 tracks are available from the current listening profiles.</p>}
      {removedCount > 0 && <p className="mix-muted">{removedCount} {removedCount === 1 ? 'track removed' : 'tracks removed'} from this preview.</p>}
      {missingCount > 0 && <p className="mix-notice">The current preview is out of date for this save: details for {missingCount} saved {missingCount === 1 ? 'track are' : 'tracks are'} unavailable. Your original name, track IDs, and save request are unchanged.</p>}
      <ol className="mix-tracks">
        {load.preview.tracks.filter((track) => trackIds.includes(track.spotifyId)).map((track) => <li key={track.spotifyId}>
          <a className="mix-track-link" href={`https://open.spotify.com/track/${encodeURIComponent(track.spotifyId)}`} target="_blank" rel="noreferrer" aria-label={`${track.name || 'Untitled track'} on Spotify`}>
            {track.albumArt ? <img src={track.albumArt} alt="" loading="lazy" /> : <span className="mix-art-fallback"><Music2 size={22} aria-hidden="true" /></span>}
            <span><strong>{track.name || 'Untitled track'}</strong><span className="mix-muted">{track.artistName || 'Artist unavailable'}</span></span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>
          {!frozen && <button type="button" className="mix-remove" title={`Remove ${track.name || 'track'}`} aria-label={`Remove ${track.name || 'track'}`} disabled={trackIds.length <= 1} onClick={() => setTrackIds((ids) => ids.filter((id) => id !== track.spotifyId))}><Trash2 size={18} aria-hidden="true" /></button>}
          <p className="mix-reason"><strong data-source={track.source}>{sourceLabels[track.source]}</strong> {track.reason || 'No further selection details available.'}</p>
        </li>)}
      </ol>
      <p className="mix-credit">Music data and artwork from <a href="https://open.spotify.com" target="_blank" rel="noreferrer">Spotify</a>.</p>
      <footer className="mix-save">
        {saved ? <div role="status"><p><Check size={18} aria-hidden="true" />Saved as a public Spotify playlist.</p>{playlistUrl ? <a className="button" href={playlistUrl} target="_blank" rel="noreferrer">Open playlist<ArrowUpRight size={16} /></a> : <a href="https://open.spotify.com/collection/playlists" target="_blank" rel="noreferrer">Check your Spotify library</a>}
          <button type="button" className="button button-ghost" disabled={saving || recovering} onClick={handleNewMix}><Plus size={16} aria-hidden="true" />New mix</button>
        </div> : <>
          {uncertain && <div className="mix-notice" role="status"><p>The save outcome is uncertain. Check your Spotify library before taking any further action. Do not start a new mix save; a playlist may already exist.</p><a href="https://open.spotify.com/collection/playlists" target="_blank" rel="noreferrer">Check Spotify<ArrowUpRight size={16} /></a></div>}
          {pending && !uncertain && <p role="status">Save is pending. Retry this same request to check or finish it; the name and tracks remain locked.</p>}
          {result?.message && <p role="status">{result.message}</p>}
          {!uncertain && <button type="button" className="button" onClick={handleSave} disabled={saving || recovering || !load.preview.canSave || !canRetry || !name.trim() || trackIds.length < 1 || trackIds.length > 20}>
            {frozen ? <RotateCcw size={17} aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}{saving ? 'Saving...' : frozen ? 'Retry same save' : 'Save to Spotify'}
          </button>}
          {frozen && !uncertain && <p className="mix-muted">Name and tracks are locked to this save request.</p>}
        </>}
      </footer>
    </>}
  </section>;
}
