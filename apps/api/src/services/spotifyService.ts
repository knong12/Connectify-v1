import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import type { SpotifyProfile, SpotifyTokenResponse } from '../types/auth.js';

const spotifyScopes = [
  'user-read-email',
  'user-read-private',
  'user-top-read'
];

const spotifyTimeRanges = ['short_term', 'medium_term', 'long_term'] as const;
const spotifyTopItemsLimit = 50;
type SpotifyTimeRange = (typeof spotifyTimeRanges)[number];

type SpotifyArtist = {
  id: string;
  name: string;
  images?: { url: string }[];
};

type SpotifyTrack = {
  id: string;
  name: string;
  preview_url: string | null;
  album: {
    name: string;
    images?: { url: string }[];
  };
  artists?: { name: string }[];
};

type SpotifyPagingResponse<T> = {
  items: T[];
};

type SpotifyTopItemsByRange<T> = Record<SpotifyTimeRange, T[]>;

export class SpotifyRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly status?: number,
    public readonly retryAfter?: number
  ) {
    super(code);
  }
}

export function getSpotifyFailure(error: unknown) {
  if (error instanceof SpotifyRequestError) {
    if (error.status === 429) return { code: 'rate_limited', status: 429 };
    if (error.status === 401 || error.code === 'invalid_grant' || error.code === 'reconnect') {
      return { code: 'reconnect', status: 401 };
    }
    if (error.status === 403) return { code: 'access_denied', status: 403 };
    if (error.code === 'timeout' || error.code === 'network') {
      return { code: 'unavailable', status: 503 };
    }
  }
  return { code: 'login_failed', status: 500 };
}

async function requestSpotify(url: string, options: RequestInit = {}) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    return new Response(text || null, {
      status: response.status,
      headers: response.headers
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    throw new SpotifyRequestError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
  }
}

export function buildSpotifyAuthorizeUrl(state: string) {
  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', env.SPOTIFY_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', env.SPOTIFY_REDIRECT_URI);
  authUrl.searchParams.set('scope', spotifyScopes.join(' '));
  authUrl.searchParams.set('state', state);

  return authUrl.toString();
}

async function parseSpotifyResponse<T>(response: Response, _fallbackMessage: string): Promise<T> {
  const text = await response.text();
  let data: unknown = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new SpotifyRequestError('invalid_response', response.status);
    }
  }

  if (!response.ok) {
    const spotifyObject = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new SpotifyRequestError(
      spotifyObject?.error === 'invalid_grant' ? 'invalid_grant' : 'spotify_error',
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined
    );
  }

  return data as T;
}

async function fetchSpotifyResource<T>(accessToken: string, url: string, fallbackMessage: string) {
  const response = await requestSpotify(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  return parseSpotifyResponse<T>(response, fallbackMessage);
}

export async function exchangeCodeForTokens(code: string): Promise<SpotifyTokenResponse> {
  const basicAuth = Buffer.from(
    `${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`,
    'utf8'
  ).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.SPOTIFY_REDIRECT_URI
  });

  const response = await requestSpotify('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  return parseSpotifyResponse<SpotifyTokenResponse>(
    response,
    'Spotify token exchange failed.'
  );
}

export async function fetchSpotifyProfile(accessToken: string): Promise<SpotifyProfile> {
  return fetchSpotifyResource<SpotifyProfile>(
    accessToken,
    'https://api.spotify.com/v1/me',
    'Spotify profile fetch failed.'
  );
}

export async function refreshSpotifyTokens(refreshToken: string): Promise<SpotifyTokenResponse> {
  const credentials = Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const response = await requestSpotify('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
  });
  return parseSpotifyResponse<SpotifyTokenResponse>(response, 'Spotify refresh failed.');
}

export async function syncUserMusicData(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.spotifyAccessToken) throw new SpotifyRequestError('reconnect', 401);
  try {
    await syncTopMusicData(userId, user.spotifyAccessToken);
    return;
  } catch (error) {
    if (!(error instanceof SpotifyRequestError) || error.status !== 401) throw error;
  }
  if (!user.spotifyRefreshToken) throw new SpotifyRequestError('reconnect', 401);
  let tokens: SpotifyTokenResponse;
  try {
    tokens = await refreshSpotifyTokens(user.spotifyRefreshToken);
  } catch (error) {
    if (error instanceof SpotifyRequestError && error.code === 'invalid_grant') {
      await prisma.user.update({ where: { id: userId }, data: {
        spotifyAccessToken: null, spotifyRefreshToken: null, spotifyConnected: false
      } });
    }
    throw error;
  }
  await prisma.user.update({ where: { id: userId }, data: {
    spotifyAccessToken: tokens.access_token,
    spotifyRefreshToken: tokens.refresh_token ?? user.spotifyRefreshToken
  } });
  await syncTopMusicData(userId, tokens.access_token);
}

export async function syncTopMusicData(userId: string, accessToken: string): Promise<void> {
  const artistResponses = await Promise.all(
    spotifyTimeRanges.map(async (timeRange) => ({
      timeRange,
      response: await fetchSpotifyResource<SpotifyPagingResponse<SpotifyArtist>>(
        accessToken,
        `https://api.spotify.com/v1/me/top/artists?limit=${spotifyTopItemsLimit}&time_range=${timeRange}`,
        `Spotify top artists fetch failed for ${timeRange}.`
      )
    }))
  );

  const trackResponses = await Promise.all(
    spotifyTimeRanges.map(async (timeRange) => ({
      timeRange,
      response: await fetchSpotifyResource<SpotifyPagingResponse<SpotifyTrack>>(
        accessToken,
        `https://api.spotify.com/v1/me/top/tracks?limit=${spotifyTopItemsLimit}&time_range=${timeRange}`,
        `Spotify top tracks fetch failed for ${timeRange}.`
      )
    }))
  );

  const topArtistsByRange = artistResponses.reduce(
    (accumulator, entry) => {
      accumulator[entry.timeRange] = entry.response.items;
      return accumulator;
    },
    {} as SpotifyTopItemsByRange<SpotifyArtist>
  );

  const topTracksByRange = trackResponses.reduce(
    (accumulator, entry) => {
      accumulator[entry.timeRange] = entry.response.items;
      return accumulator;
    },
    {} as SpotifyTopItemsByRange<SpotifyTrack>
  );

  const uniqueArtists = [
    ...new Map(
      Object.values(topArtistsByRange)
        .flat()
        .map((artist) => [artist.id, artist])
    ).values()
  ];

  const uniqueTracks = [
    ...new Map(
      Object.values(topTracksByRange)
        .flat()
        .map((track) => [track.id, track])
    ).values()
  ];

  await prisma.$transaction(async (tx) => {
    await tx.userFavoriteArtist.deleteMany({ where: { userId } });
    await tx.userFavoriteTrack.deleteMany({ where: { userId } });

    for (const artist of uniqueArtists) {
      await tx.artist.upsert({
        where: { spotifyId: artist.id },
        update: {
          name: artist.name,
          imageUrl: artist.images?.[0]?.url ?? null
        },
        create: {
          spotifyId: artist.id,
          name: artist.name,
          imageUrl: artist.images?.[0]?.url ?? null
        }
      });
    }

    for (const track of uniqueTracks) {
      await tx.track.upsert({
        where: { spotifyId: track.id },
        update: {
          name: track.name,
          artistName: (track.artists ?? []).map((artist) => artist.name).join(', '),
          albumName: track.album.name,
          albumArt: track.album.images?.[0]?.url ?? null,
          previewUrl: track.preview_url
        },
        create: {
          spotifyId: track.id,
          name: track.name,
          artistName: (track.artists ?? []).map((artist) => artist.name).join(', '),
          albumName: track.album.name,
          albumArt: track.album.images?.[0]?.url ?? null,
          previewUrl: track.preview_url
        }
      });
    }

    for (const timeRange of spotifyTimeRanges) {
      for (const [index, artist] of topArtistsByRange[timeRange].entries()) {
        const savedArtist = await tx.artist.findUniqueOrThrow({
          where: { spotifyId: artist.id }
        });

        await tx.userFavoriteArtist.create({
          data: {
            userId,
            artistId: savedArtist.id,
            rank: index + 1,
            timeRange
          }
        });
      }

      for (const [index, track] of topTracksByRange[timeRange].entries()) {
        const savedTrack = await tx.track.findUniqueOrThrow({
          where: { spotifyId: track.id }
        });

        await tx.userFavoriteTrack.create({
          data: {
            userId,
            trackId: savedTrack.id,
            rank: index + 1,
            timeRange
          }
        });
      }
    }
  }, { timeout: 60000 });
}
