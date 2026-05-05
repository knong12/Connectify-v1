import { useEffect, useState } from 'react';
import { fetchProfile, type ProfileResponse } from '../lib/api';

const tokenStorageKey = 'connectify_app_token';

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

export default function ProfilePage() {
  const [state, setState] = useState<LoadState>({ status: 'idle' });

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

  return (
    <div className="stack">
      <section className="card profile-hero">
        {profile.spotifyProfileImage ? (
          <img
            alt={`${profile.displayName} Spotify profile`}
            className="avatar"
            src={profile.spotifyProfileImage}
          />
        ) : null}
        <div>
          <p className="eyebrow">Synced Profile</p>
          <h2>{profile.displayName}</h2>
          <p className="muted">@{profile.spotifyUserId}</p>
          <p>
            Spotify is connected and your top artists and tracks are now loading
            directly from the saved backend data.
          </p>
        </div>
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
        </div>
      </section>

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
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
