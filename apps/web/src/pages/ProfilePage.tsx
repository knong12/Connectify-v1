import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  fetchProfile,
  fetchUserProfile,
  type ProfileResponse,
  type SpotifyTimeRange
} from '../lib/api';
import ProfileActions from '../components/ProfileActions';

const tokenStorageKey = 'connectify_app_token';
const timeRangeLabels: Record<SpotifyTimeRange, string> = {
  short_term: 'Recent',
  medium_term: '6 Months',
  long_term: '1 Year'
};

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; profile: ProfileResponse['user'] };

function saveTokenFromUrl() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');

  if (!token) {
    return null;
  }

  localStorage.setItem(tokenStorageKey, token);
  url.searchParams.delete('token');
  url.searchParams.delete('userId');
  window.history.replaceState({}, document.title, url.toString());
  return token;
}

function getStoredToken() {
  return localStorage.getItem(tokenStorageKey);
}

function formatJoinedNames(values: string[]) {
  return values.filter(Boolean).join(', ');
}

export default function ProfilePage() {
  const { userId: routeUserId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [activeTimeRange, setActiveTimeRange] = useState<SpotifyTimeRange>('medium_term');
  const isViewingOtherProfile = Boolean(routeUserId);
  const backButton = isViewingOtherProfile ? (
    <button
      className="profile-back-button"
      type="button"
      onClick={() => location.key === 'default' ? navigate('/profile', { replace: true }) : navigate(-1)}
    >
      <span aria-hidden="true">&larr;</span> Back
    </button>
  ) : null;

  useEffect(() => {
    const token = saveTokenFromUrl() ?? getStoredToken();

    if (!token) {
      setState({
        status: 'error',
        message: 'No app token found yet. Start with Spotify login from the home page.'
      });
      return;
    }

    setState({ status: 'loading' });
    let cancelled = false;

    const profileRequest = routeUserId ? fetchUserProfile(token, routeUserId) : fetchProfile(token);

    profileRequest
      .then((data) => {
        if (cancelled) return;
        setState({
          status: 'ready',
          profile: data.user
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to load profile.'
        });
      });
    return () => { cancelled = true; };
  }, [routeUserId]);

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className="stack">
      {backButton}
      <section className="card">
        <h2>Profile</h2>
        <p>Loading your synced Spotify profile...</p>
      </section>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="stack">
      {backButton}
      <section className="card">
        <h2>Profile</h2>
        <p>{state.message}</p>
      </section>
      </div>
    );
  }

  const { profile } = state;
  const topGenreLabels = profile.favoriteGenres.map((genre) => genre.label).slice(0, 5);
  const displayedArtists = profile.favoriteArtistsByRange[activeTimeRange] ?? [];
  const displayedTracks = profile.favoriteTracksByRange[activeTimeRange] ?? [];

  return (
    <div className="stack">
      {backButton}
      {!isViewingOtherProfile && (
        <div className="profile-toolbar">
          {location.state?.profileSaved ? <p role="status" className="profile-save-notice">Profile changes saved.</p> : <span />}
          <ProfileActions />
        </div>
      )}
      <section className="card profile-hero profile-hero-rich">
        <div className="profile-identity">
          {profile.spotifyProfileImage ? (
            <img
              alt={`${profile.displayName} Spotify profile`}
              className="avatar avatar-large"
              src={profile.spotifyProfileImage}
            />
          ) : (
            <div className="avatar avatar-large avatar-fallback">
              {profile.displayName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="profile-copy">
            <p className="eyebrow">Synced Profile</p>
            <h2>{profile.displayName}</h2>
            <p className="profile-description">
              {isViewingOtherProfile
                ? `${profile.displayName}'s page blends synced Spotify favorites with personal notes so you can understand their music taste faster.`
                : ''}
            </p>
            {profile.bio ? <p className="profile-bio">{profile.bio}</p> : null}
            <div className="pill-row">
              <span className="pill pill-success">
                {isViewingOtherProfile ? 'Shared profile view' : 'Spotify Connected'}
              </span>
              <span className="pill">{timeRangeLabels[activeTimeRange]} artists: {displayedArtists.length}</span>
              <span className="pill">{timeRangeLabels[activeTimeRange]} tracks: {displayedTracks.length}</span>
            </div>
          </div>
        </div>
        <div className="profile-sidecard">
          <p className="eyebrow">Quick Read</p>
          <h3>{isViewingOtherProfile ? `${profile.displayName}'s taste profile` : 'Your taste profile'}</h3>
          <p className="muted">
            {isViewingOtherProfile
              ? 'What defines me?'
              : 'What defines you?'}
          </p>
          {topGenreLabels.length > 0 ? (
            <div className="tag-cloud">
              {topGenreLabels.map((label) => (
                <span className="tag" key={label}>
                  {label}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted">
              
            </p>
          )}
          {profile.favoriteArtistNote ? (
            <div className="side-note">
              <p className="eyebrow">Favorite Artist Note</p>
              <p className="muted">{profile.favoriteArtistNote}</p>
            </div>
          ) : null}
          {profile.musicPrompt ? (
            <div className="side-note">
              <p className="eyebrow">Music Prompt</p>
              <p className="muted">{profile.musicPrompt}</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="card">
        <h2>Profile Snapshot</h2>
        <p className="section-intro">
          A quick read on how much music data and social activity is tied to your account right now.
        </p>
        <div className="stats-grid">
          <div className="stat">
            <span className="stat-label">Top Artists</span>
            <strong>{profile.favoriteArtists.length}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Top Tracks</span>
            <strong>{profile.favoriteTracks.length}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Genre Entries</span>
            <strong>{profile.favoriteGenres.length}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Member Since</span>
            <strong className="stat-detail">
              {new Date(profile.createdAt).toLocaleDateString()}
            </strong>
          </div>
          <div className="stat">
            <span className="stat-label">Followers</span>
            <strong>{profile.followerCount}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Following</span>
            <strong>{profile.followingCount}</strong>
          </div>
        </div>
      </section>

      <div className="profile-grid">
        <section className="card profile-social-section">
          <h2>Followers</h2>
          <div className="list-grid profile-social-list">
            {profile.followers.length > 0 ? (
              profile.followers.map((follower) => (
                <Link
                  className="mini-user-card mini-user-link"
                  key={follower.id}
                  to={`/profile/${encodeURIComponent(follower.id)}`}
                  aria-label={`View ${follower.displayName}'s profile`}
                >
                  {follower.spotifyProfileImage ? (
                    <img
                      alt={`${follower.displayName} Spotify profile`}
                      className="mini-avatar"
                      src={follower.spotifyProfileImage}
                    />
                  ) : (
                    <div className="mini-avatar avatar-fallback">
                      {follower.displayName.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h3>{follower.displayName}</h3>
                  </div>
                </Link>
              ))
            ) : (
              <p className="muted">No followers yet.</p>
            )}
          </div>
        </section>

        <section className="card profile-social-section">
          <h2>Following</h2>
          <div className="list-grid profile-social-list">
            {profile.followingUsers.length > 0 ? (
              profile.followingUsers.map((followedUser) => (
                <Link
                  className="mini-user-card mini-user-link"
                  key={followedUser.id}
                  to={`/profile/${encodeURIComponent(followedUser.id)}`}
                  aria-label={`View ${followedUser.displayName}'s profile`}
                >
                  {followedUser.spotifyProfileImage ? (
                    <img
                      alt={`${followedUser.displayName} Spotify profile`}
                      className="mini-avatar"
                      src={followedUser.spotifyProfileImage}
                    />
                  ) : (
                    <div className="mini-avatar avatar-fallback">
                      {followedUser.displayName.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h3>{followedUser.displayName}</h3>
                  </div>
                </Link>
              ))
            ) : (
              <p className="muted">Not following anyone yet.</p>
            )}
          </div>
        </section>
      </div>

      <div className="profile-grid">
        <section className="card">
          <h2>Top Artists</h2>
          <p className="section-intro">
            Switch between Spotify time windows to see how your artist identity changes over time.
          </p>
          <div className="time-range-tabs" role="tablist" aria-label="Artist time range">
            {Object.entries(timeRangeLabels).map(([timeRange, label]) => (
              <button
                key={timeRange}
                className={timeRange === activeTimeRange ? 'tab-button active' : 'tab-button'}
                onClick={() => setActiveTimeRange(timeRange as SpotifyTimeRange)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="list-grid">
            {displayedArtists.map((artist) => (
              <article className="music-card" key={artist.id}>
                {artist.imageUrl ? (
                  <img alt={artist.name} className="cover-art" src={artist.imageUrl} />
                ) : (
                  <div className="cover-fallback">#{artist.rank}</div>
                )}
                <div>
                  <p className="eyebrow">Rank #{artist.rank}</p>
                  <h3>{artist.name}</h3>
                  {artist.genres.length > 0 ? (
                    <p className="muted">{formatJoinedNames(artist.genres.slice(0, 3))}</p>
                  ) : (
                    <p className="muted">Genre labels Place Holder</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Top Tracks</h2>
          <p className="section-intro">
            Here are your top tracks.
          </p>
          <div className="list-grid">
            {displayedTracks.map((track) => (
              <article className="music-card" key={track.id}>
                {track.albumArt ? (
                  <img alt={track.name} className="cover-art" src={track.albumArt} />
                ) : (
                  <div className="cover-fallback">#{track.rank}</div>
                )}
                <div>
                  <p className="eyebrow">Rank #{track.rank}</p>
                  <h3>{track.name}</h3>
                  <p className="muted">{track.artistName}</p>
                  {track.albumName ? <p className="muted">{track.albumName}</p> : null}
                  {track.previewUrl ? (
                    <a
                      className="preview-link"
                      href={track.previewUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Preview clip
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
