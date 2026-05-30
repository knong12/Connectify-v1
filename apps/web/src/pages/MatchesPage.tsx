import { useEffect, useState } from 'react';
import {
  fetchMatches,
  followUser,
  type MatchesResponse,
  unfollowUser
} from '../lib/api';

const tokenStorageKey = 'connectify_app_token';

type MatchLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; matches: MatchesResponse['matches'] };

function getStoredToken() {
  return localStorage.getItem(tokenStorageKey);
}

function joinPreview(values: string[]) {
  return values.filter(Boolean).join(' • ');
}

export default function MatchesPage() {
  const [state, setState] = useState<MatchLoadState>({ status: 'idle' });
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  useEffect(() => {
    const token = getStoredToken();

    if (!token) {
      setState({
        status: 'error',
        message: 'Log in with Spotify first so Connectify can compare your saved music profile.'
      });
      return;
    }

    setState({ status: 'loading' });

    fetchMatches(token)
      .then((data) => {
        setState({
          status: 'ready',
          matches: data.matches
        });
      })
      .catch((error) => {
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to load matches.'
        });
      });
  }, []);

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <section className="card">
        <h2>Matches</h2>
        <p>Loading compatibility results from your saved music profile...</p>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="card">
        <h2>Matches</h2>
        <p>{state.message}</p>
      </section>
    );
  }

  if (state.matches.length === 0) {
    return (
      <section className="card">
        <h2>Matches</h2>
        <p>
          No matches have been found yet. Add more synced users to the system so Connectify can
          compare artist and track overlap.
        </p>
      </section>
    );
  }

  async function handleFollowToggle(targetUserId: string, isFollowing: boolean) {
    const token = getStoredToken();

    if (!token || state.status !== 'ready') {
      return;
    }

    setPendingUserId(targetUserId);

    try {
      if (isFollowing) {
        await unfollowUser(token, targetUserId);
      } else {
        await followUser(token, targetUserId);
      }

      setState({
        status: 'ready',
        matches: state.matches.map((match) =>
          match.userId === targetUserId ? { ...match, isFollowing: !isFollowing } : match
        )
      });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to update follow state.'
      });
    } finally {
      setPendingUserId(null);
    }
  }

  return (
    <div className="stack">
      <section className="card matches-hero">
        <div>
          <p className="eyebrow">Compatibility View</p>
          <h2>Music overlap matches</h2>
          <p>
            Current Test / Demo of Compatability Score and Results
          </p>
        </div>
        <div className="pill-row">
          <span className="pill">Artist overlap</span>
          <span className="pill">Track overlap</span>
          <span className="pill pill-success">Ranked results</span>
        </div>
      </section>

      <section className="matches-grid">
        {state.matches.map((match) => (
          <article className="card match-card" key={match.userId}>
            <div className="match-header">
              <div className="match-identity">
                {match.spotifyProfileImage ? (
                  <img
                    alt={`${match.displayName} Spotify profile`}
                    className="avatar"
                    src={match.spotifyProfileImage}
                  />
                ) : (
                  <div className="avatar avatar-fallback">{match.displayName.slice(0, 1)}</div>
                )}
                <div>
                  <p className="eyebrow">Potential Match</p>
                  <h3>{match.displayName}</h3>
                  <p className="muted">@{match.spotifyUserId}</p>
                  {match.bio ? <p className="muted">{match.bio}</p> : null}
                  {match.favoriteArtistNote ? (
                    <p className="muted">Favorite artist note: {match.favoriteArtistNote}</p>
                  ) : null}
                </div>
              </div>
              <div className="score-badge">
                <span>Score</span>
                <strong>{match.score}</strong>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat">
                <span className="stat-label">Shared Artists</span>
                <strong>{match.sharedArtists}</strong>
              </div>
              <div className="stat">
                <span className="stat-label">Shared Tracks</span>
                <strong>{match.sharedTracks}</strong>
              </div>
            </div>

            <div className="match-details">
              <div>
                <p className="eyebrow">Artist Overlap</p>
                <p className="muted">
                  {match.sharedArtistNames.length > 0
                    ? joinPreview(match.sharedArtistNames)
                    : 'No shared artists yet'}
                </p>
              </div>
              <div>
                <p className="eyebrow">Track Overlap</p>
                <p className="muted">
                  {match.sharedTrackNames.length > 0
                    ? joinPreview(match.sharedTrackNames)
                    : 'No shared tracks yet'}
                </p>
              </div>
            </div>

            <div className="match-actions">
              <button
                className={match.isFollowing ? 'button button-secondary' : 'button'}
                disabled={pendingUserId === match.userId}
                onClick={() => handleFollowToggle(match.userId, match.isFollowing)}
                type="button"
              >
                {pendingUserId === match.userId
                  ? 'Updating...'
                  : match.isFollowing
                    ? 'Following'
                    : 'Follow'}
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
