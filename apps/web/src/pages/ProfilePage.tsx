import { useEffect, useState } from 'react';
import { fetchProfile, type ProfileResponse, updateProfile } from '../lib/api';

const tokenStorageKey = 'connectify_app_token';

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
  return values.filter(Boolean).join(' • ');
}

export default function ProfilePage() {
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

    fetchProfile(token)
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
  }, []);

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
            <p className="muted muted-handle">@{profile.spotifyUserId}</p>
            <p className="profile-description">
              Profile currently displays top 10 songs and top 10 artists
            </p>
            {profile.bio ? <p className="profile-bio">{profile.bio}</p> : null}
            <div className="pill-row">
              <span className="pill pill-success">Spotify Connected</span>
              <span className="pill">Top {profile.favoriteArtists.length} Artists</span>
              <span className="pill">Top {profile.favoriteTracks.length} Tracks</span>
            </div>
          </div>
        </div>
        <div className="profile-sidecard">
          <p className="eyebrow">Quick Read</p>
          <h3>Your taste profile</h3>
          <p className="muted">
            Right now this profile shows your synced music and artists
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
              Great Taste!
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
        <div className="section-heading">
          <div>
            <p className="eyebrow">Profile Customization</p>
            <h2>Make the profile more social</h2>
          </div>
          {saveState.status === 'saved' ? (
            <span className="pill pill-success">Saved</span>
          ) : null}
        </div>

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

      <section className="card">
        <h2>Profile Snapshot</h2>
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
                    <p className="muted">@{follower.spotifyUserId}</p>
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
                    <p className="muted">@{followedUser.spotifyUserId}</p>
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
          <div className="list-grid">
            {profile.favoriteArtists.map((artist) => (
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
                    <p className="muted">default</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Top Tracks</h2>
          <div className="list-grid">
            {profile.favoriteTracks.map((track) => (
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
