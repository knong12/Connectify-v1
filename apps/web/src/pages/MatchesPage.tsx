import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown, Headphones, Info, ListMusic, Music2, UserCheck, UserPlus } from 'lucide-react';
import { fetchMatches, followUser, type MatchesResponse, type SharedMusicItem, unfollowUser } from '../lib/api';

type Match = MatchesResponse['matches'][number];
type LoadState = { status: 'loading' } | { status: 'error'; message: string } |
  { status: 'ready'; matches: Match[] };
const windows = { short_term: 'Recent', medium_term: '6 months', long_term: '1 year' } as const;
function matchSummary(match: Match) {
  const explanation = match.explanation;
  if (explanation.status === 'insufficient_data') return 'One of you has no synced music yet. Shared favorites will appear when both profiles have listening data.';
  const artists = explanation.sharedArtists.slice(0, 2).map((item) => item.name);
  if (artists.length) return `You both listen to ${artists.join(' and ')}.`;
  const track = explanation.sharedTracks[0];
  if (track) return `You both have ${track.name} in your top tracks.`;
  return 'No shared favorites in your synced top lists yet. Explore their profile to discover something new.';
}

function Evidence({ items, kind }: { items: SharedMusicItem[]; kind: 'artists' | 'tracks' }) {
  if (!items.length) return <p className="muted overlap-empty">No shared {kind} in the synced lists.</p>;
  return <ul className="overlap-evidence-list">
    {items.map((item) => <li key={item.spotifyId}>
      <a href={`https://open.spotify.com/${kind === 'artists' ? 'artist' : 'track'}/${encodeURIComponent(item.spotifyId)}`}
        target="_blank" rel="noreferrer" className="overlap-music-link" title={`Open ${item.name} in Spotify`}>
        {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : <span className="overlap-art-fallback"><Music2 size={18} /></span>}
        <span>{item.name}</span><ArrowUpRight size={14} aria-hidden="true" />
      </a>
      <div className="overlap-ranks">
        {item.windows.length ? item.windows.map((window) => <span key={window.timeRange}>
          {windows[window.timeRange]} <strong>#{window.yourRank}</strong> you / <strong>#{window.theirRank}</strong> them
        </span>) : <span>Appears in both profiles at different listening windows</span>}
      </div>
    </li>)}
  </ul>;
}

function MatchCard({ match, pending, error, onFollow }: {
  match: Match; pending: boolean; error?: string; onFollow: () => void;
}) {
  const [musicKind, setMusicKind] = useState<'artists' | 'tracks'>(match.sharedArtists > 0 ? 'artists' : 'tracks');
  const { explanation } = match;
  const ready = explanation.status === 'ready';
  const samples = [...explanation.sharedArtists, ...explanation.sharedTracks].slice(0, 3);
  return <article className="card overlap-card" aria-label={`Music connection with ${match.displayName}`}>
    <header className="overlap-card-header">
      <Link to={`/profile/${encodeURIComponent(match.userId)}`} className="overlap-person">
        {match.spotifyProfileImage ? <img src={match.spotifyProfileImage} className="overlap-avatar" alt="" /> :
          <span className="overlap-avatar overlap-avatar-fallback">{match.displayName.slice(0, 1).toUpperCase()}</span>}
        <div><h3>{match.displayName}</h3><span className="muted">{match.isFollowing ? 'Following' : 'Music connection'}</span></div>
      </Link>
    </header>

    <div className="overlap-summary">
      <h4>What connects you</h4><p>{matchSummary(match)}</p>
      <div className="overlap-counts"><span><Headphones size={15} aria-hidden="true" />{match.sharedArtists} shared {match.sharedArtists === 1 ? 'artist' : 'artists'}</span>
        <span><Music2 size={15} aria-hidden="true" />{match.sharedTracks} shared {match.sharedTracks === 1 ? 'track' : 'tracks'}</span></div>
      {samples.length > 0 && <p className="overlap-sample-names">{samples.map((item) => item.name).join(' · ')}</p>}
    </div>

    {explanation.limitedData && <p className="overlap-data-note"><Info size={16} aria-hidden="true" />
      {ready ? 'Some listening data is missing, so there may be more music you share.' : 'Both people need synced listening data to find shared favorites.'}
    </p>}

    <details className="overlap-disclosure">
      <summary>Explore shared music <span className="overlap-disclosure-count">{match.sharedArtists + match.sharedTracks}</span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="overlap-kind-tabs" role="group" aria-label="Shared music type">
        <button type="button" aria-pressed={musicKind === 'artists'} onClick={() => setMusicKind('artists')}><Headphones size={15} />Artists ({match.sharedArtists})</button>
        <button type="button" aria-pressed={musicKind === 'tracks'} onClick={() => setMusicKind('tracks')}><Music2 size={15} />Tracks ({match.sharedTracks})</button>
      </div>
      <Evidence items={musicKind === 'artists' ? explanation.sharedArtists : explanation.sharedTracks} kind={musicKind} />
      <p className="overlap-spotify-credit">Music data and artwork from <a href="https://open.spotify.com" target="_blank" rel="noreferrer">Spotify</a>.</p>
    </details>

    {match.bio && <p className="overlap-profile-note">{match.bio}</p>}
    {match.favoriteArtistNote && <p className="overlap-profile-note"><strong>In their rotation:</strong> {match.favoriteArtistNote}</p>}
    <footer className="overlap-actions">
      <Link to={`/mix/${encodeURIComponent(match.userId)}`} className="button button-ghost"><ListMusic size={16} aria-hidden="true" />Create a mix</Link>
      <Link to={`/profile/${encodeURIComponent(match.userId)}`} className="button button-ghost">View profile<ArrowUpRight size={16} aria-hidden="true" /></Link>
      <button className={match.isFollowing ? 'button button-secondary' : 'button'} type="button" disabled={pending} onClick={onFollow}>
        {match.isFollowing ? <UserCheck size={16} aria-hidden="true" /> : <UserPlus size={16} aria-hidden="true" />}
        {pending ? 'Updating...' : match.isFollowing ? 'Unfollow' : 'Follow'}
      </button>
    </footer>
    {error && <p role="alert" className="overlap-action-error">{error}</p>}
  </article>;
}

export default function MatchesPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const carousel = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState({ previous: false, next: false });
  const matchCount = state.status === 'ready' ? state.matches.length : 0;

  useEffect(() => {
    const element = carousel.current;
    if (!element) return;
    const update = () => setScrollable({
      previous: element.scrollLeft > 2,
      next: element.scrollLeft + element.clientWidth < element.scrollWidth - 2
    });
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { element.removeEventListener('scroll', update); observer.disconnect(); };
  }, [matchCount]);

  function scrollMatches(direction: -1 | 1) {
    const element = carousel.current;
    const card = element?.firstElementChild;
    if (!element || !(card instanceof HTMLElement)) return;
    const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
    element.scrollBy({ left: direction * (card.offsetWidth + gap),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem('connectify_app_token');
    if (!token) {
      setState({ status: 'error', message: 'Sign in with Spotify to view your music connections.' });
      return;
    }
    fetchMatches(token).then((data) => {
      if (!cancelled) setState({ status: 'ready', matches: data.matches });
    }).catch(() => {
      if (!cancelled) setState({ status: 'error', message: 'Could not load matches. Please refresh or sign in again.' });
    });
    return () => { cancelled = true; };
  }, []);

  async function handleFollow(match: Match) {
    const token = localStorage.getItem('connectify_app_token');
    if (!token) { setErrors((previous) => ({ ...previous, [match.userId]: 'Please sign in again.' })); return; }
    if (pending.has(match.userId)) return;
    setPending((previous) => new Set(previous).add(match.userId));
    setErrors((previous) => ({ ...previous, [match.userId]: '' }));
    try {
      await (match.isFollowing ? unfollowUser(token, match.userId) : followUser(token, match.userId));
      setState((previous) => previous.status !== 'ready' ? previous : {
        ...previous, matches: previous.matches.map((entry) => entry.userId === match.userId ? { ...entry, isFollowing: !match.isFollowing } : entry)
      });
    } catch {
      setErrors((previous) => ({ ...previous, [match.userId]: 'Could not update following. Please try again.' }));
    } finally {
      setPending((previous) => { const next = new Set(previous); next.delete(match.userId); return next; });
    }
  }

  return <div className="stack overlap-page">
    <header className="overlap-page-header">
      <div><p className="eyebrow">People & music</p><h2>Your listening connections</h2></div>
      {state.status === 'ready' && <span className="overlap-result-count">{state.matches.length} profiles</span>}
    </header>
    <p className="overlap-page-intro">Find your common ground through the artists and tracks you both love.</p>
    {state.status === 'loading' && <p role="status">Comparing listening profiles...</p>}
    {state.status === 'error' && <p role="alert">{state.message} <Link to="/">Go to sign in</Link></p>}
    {state.status === 'ready' && (state.matches.length ? <section className="overlap-carousel" aria-label="Music matches">
      <div className="overlap-carousel-controls">
        <button type="button" className="overlap-scroll-button" aria-label="Previous connections" title="Previous connections"
          aria-controls="match-cards" disabled={!scrollable.previous} onClick={() => scrollMatches(-1)}><ArrowLeft size={20} aria-hidden="true" /></button>
        <button type="button" className="overlap-scroll-button" aria-label="Next connections" title="Next connections"
          aria-controls="match-cards" disabled={!scrollable.next} onClick={() => scrollMatches(1)}><ArrowRight size={20} aria-hidden="true" /></button>
      </div>
      <div id="match-cards" className="overlap-carousel-track" ref={carousel} tabIndex={0} role="region" aria-label="Listening connections"
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault(); scrollMatches(event.key === 'ArrowLeft' ? -1 : 1);
          }
        }}>
        {state.matches.map((match) => <MatchCard key={match.userId} match={match} pending={pending.has(match.userId)} error={errors[match.userId]} onFollow={() => handleFollow(match)} />)}
      </div>
    </section> : <p>No other profiles to compare yet. Invite another listener to Connectify.</p>)}
  </div>;
}
