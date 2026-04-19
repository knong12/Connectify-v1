import { env } from '../config/env.js';
import { NotImplementedError } from '../lib/errors.js';
import type { SpotifyProfile, SpotifyTokenResponse } from '../types/auth.js';

const spotifyScopes = [
  'user-read-email',
  'user-read-private',
  'user-top-read'
];

export function buildSpotifyAuthorizeUrl(state: string) {
  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', env.SPOTIFY_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', env.SPOTIFY_REDIRECT_URI);
  authUrl.searchParams.set('scope', spotifyScopes.join(' '));
  authUrl.searchParams.set('state', state);

  return authUrl.toString();
}

export async function exchangeCodeForTokens(_code: string): Promise<SpotifyTokenResponse> {
  // Step 3:
  // POST to Spotify's /api/token endpoint with:
  // - grant_type=authorization_code
  // - code
  // - redirect_uri
  // - basic auth header using client id + secret
  throw new NotImplementedError('Implement Spotify code exchange in exchangeCodeForTokens().');
}

export async function fetchSpotifyProfile(_accessToken: string): Promise<SpotifyProfile> {
  // Step 4:
  // GET https://api.spotify.com/v1/me with Authorization: Bearer <accessToken>
  throw new NotImplementedError('Implement Spotify profile fetch in fetchSpotifyProfile().');
}

export async function syncTopMusicData(_userId: string, _accessToken: string): Promise<void> {
  // Step 6:
  // 1. Fetch top artists
  // 2. Fetch top tracks
  // 3. Derive top genres from artists
  // 4. Upsert Artist / Track / Genre records
  // 5. Replace this user's ranked favorites
  throw new NotImplementedError('Implement Spotify sync in syncTopMusicData().');
}

