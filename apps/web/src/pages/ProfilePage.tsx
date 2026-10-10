import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  fetchProfile,
  fetchUserProfile,
  type ProfileResponse,
  type SpotifyTimeRange,
  updateProfile
} from '../lib/api';

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

type ProfileFormState = {
  bio: string;
  favoriteArtistNote: string;
  musicPrompt: string;
};

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
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [form, setForm] = useState<ProfileFormState>({
    bio: '',
    favoriteArtistNote: '',
    musicPrompt: ''
  });
  const [saveState, setSaveState] = useState<{
    status: 'idle' | 'saving' | 'saved' | 'error';
    message?: string;
  }>({ status: 'idle' });
  const [activeTimeRange, setActiveTimeRange] = useState<SpotifyTimeRange>('medium_term');
  const isViewingOtherProfile = Boolean(routeUserId);

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

    const profileRequest = routeUserId ? fetchUserProfile(token, routeUserId) : fetchProfile(token);

    profileRequest
      .then((data) => {
        setForm({
          bio: data.user.bio ?? '',
          favoriteArtistNote: data.user.favoriteArtistNote ?? '',
          musicPrompt: data.user.musicPrompt ?? ''
        });
        setState({
          status: 'ready',
          profile: data.user
        });
      })
      .catch((error) => {
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to load profile.'
        });
      });
  }, [routeUserId]);

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <section className="card">
        <h2>Profile</h2>
        <p>Loading your synced Spotify profile...</p>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="card">
        <h2>Profile</h2>
        <p>{state.message}</p>
      </section>
    );
  }

  const { profile } = state;
  const topGenreLabels = profile.favoriteGenres.map((genre) => genre.label).slice(0, 5);
  const displayedArtists = profile.favoriteArtistsByRange[activeTimeRange] ?? [];
  const displayedTracks = profile.favoriteTracksByRange[activeTimeRange] ?? [];

  async function handleProfileSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const token = getStoredToken();

    if (!token) {
      setSaveState({
        status: 'error',
        message: 'No login token was found. Please sign in again.'
      });
      return;
    }

    setSaveState({ status: 'saving' });

    try {
      const updated = await updateProfile(token, form);
      setState({
        status: 'ready',
        profile: updated.user
      });
      setForm({
        bio: updated.user.bio ?? '',
        favoriteArtistNote: updated.user.favoriteArtistNote ?? '',
        musicPrompt: updated.user.musicPrompt ?? ''
      });
      setSaveState({
        status: 'saved',
        message: 'Profile details saved.'
      });
    } catch (error) {
      setSaveState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to save profile.'
      });
    }
  }

  return (
    <div className="stack">
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

      {isViewingOtherProfile ? (
        <section className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Shared Profile View</p>
              <h2>Back to your own profile when you are ready</h2>
            </div>
          </div>
          <p className="section-intro">
            You are currently viewing another Connectify profile in read-only mode.
          </p>
          <Link className="button button-ghost" to="/profile">
            Return to my profile
          </Link>
        </section>
      ) : (
        <section className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Profile Customization</p>
              <h2>Make your profile feel personal</h2>
            </div>
            {saveState.status === 'saved' ? (
              <span className="pill pill-success">Saved</span>
            ) : null}
          </div>

          <p className="section-intro">
            Add a short read on your taste so your matches get more context than just a score.
          </p>

          <form className="profile-form" onSubmit={handleProfileSave}>
            <label className="field">
              <span className="field-label">Short bio</span>
              <textarea
                maxLength={240}
                onChange={(event) =>
                  setForm((current) => ({ ...current, bio: event.target.value }))
                }
                placeholder="Say a little bit about your music taste."
                rows={4}
                value={form.bio}
              />
            </label>

            <div className="form-grid">
              <label className="field">
                <span className="field-label">Favorite artist highlight</span>
                <input
                  maxLength={120}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      favoriteArtistNote: event.target.value
                    }))
                  }
                  placeholder="Who always makes it into your rotation?"
                  type="text"
                  value={form.favoriteArtistNote}
                />
              </label>

              <label className="field">
                <span className="field-label">Music prompt</span>
                <input
                  maxLength={180}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      musicPrompt: event.target.value
                    }))
                  }
                  placeholder="A perfect late-night album is..."
                  type="text"
                  value={form.musicPrompt}
                />
              </label>
            </div>

            <div className="form-actions">
              <button className="button" disabled={saveState.status === 'saving'} type="submit">
                {saveState.status === 'saving' ? 'Saving...' : 'Save profile'}
              </button>
              {saveState.status === 'error' ? (
                <p className="muted">{saveState.message}</p>
              ) : null}
            </div>
          </form>
        </section>
      )}

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
        <section className="card">
          <h2>Followers</h2>
          <p className="section-intro">You got fans.</p>
          <div className="list-grid">
            {profile.followers.length > 0 ? (
              profile.followers.map((follower) => (
                <article className="mini-user-card" key={follower.id}>
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
                </article>
              ))
            ) : (
              <p className="muted">No followers yet.</p>
            )}
          </div>
        </section>

        <section className="card">
          <h2>Following</h2>
          <p className="section-intro">Keep that following count low.</p>
          <div className="list-grid">
            {profile.followingUsers.length > 0 ? (
              profile.followingUsers.map((followedUser) => (
                <article className="mini-user-card" key={followedUser.id}>
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
                </article>
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
