import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import type { SpotifyProfile, SpotifyTokenResponse } from '../types/auth.js';

const spotifyScopes = [
  'user-read-email',
  'user-read-private',
  'user-top-read'
];

const spotifyTimeRanges = ['short_term', 'medium_term', 'long_term'] as const;
type SpotifyTimeRange = (typeof spotifyTimeRanges)[number];

type SpotifyArtist = {
  id: string;
  name: string;
  genres?: string[];
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

type SpotifyArtistsLookupResponse = {
  artists: SpotifyArtist[];
};

type SpotifyClientCredentialsResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type SpotifyTopItemsByRange<T> = Record<SpotifyTimeRange, T[]>;

export function buildSpotifyAuthorizeUrl(state: string) {
  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', env.SPOTIFY_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', env.SPOTIFY_REDIRECT_URI);
  authUrl.searchParams.set('scope', spotifyScopes.join(' '));
  authUrl.searchParams.set('state', state);

  return authUrl.toString();
}

async function parseSpotifyResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();
  let data: unknown = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!response.ok) {
        const error = new Error(
          `${fallbackMessage} Response was not valid JSON: ${text.slice(0, 160)}`
        ) as Error & {
          status?: number;
          spotifyBody?: unknown;
        };
        error.status = response.status;
        error.spotifyBody = text;
        throw error;
      }

      const error = new Error(
        `Spotify returned a non-JSON success response: ${text.slice(0, 160)}`
      ) as Error & {
        status?: number;
        spotifyBody?: unknown;
      };
      error.status = response.status;
      error.spotifyBody = text;
      throw error;
    }
  }

  if (!response.ok) {
    const spotifyObject = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const nestedError =
      spotifyObject && spotifyObject.error && typeof spotifyObject.error === 'object'
        ? (spotifyObject.error as Record<string, unknown>)
        : null;
    const message =
      (spotifyObject &&
        typeof spotifyObject.error_description === 'string' &&
        spotifyObject.error_description) ||
      (nestedError && typeof nestedError.message === 'string' && nestedError.message) ||
      (spotifyObject && typeof spotifyObject.error === 'string' && spotifyObject.error) ||
      fallbackMessage;

    const error = new Error(message) as Error & {
      status?: number;
      spotifyBody?: unknown;
    };
    error.status = response.status;
    error.spotifyBody = data;
    throw error;
  }

  return data as T;
}

async function fetchSpotifyResource<T>(accessToken: string, url: string, fallbackMessage: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  return parseSpotifyResponse<T>(response, fallbackMessage);
}

async function fetchSpotifyAppAccessToken() {
  const basicAuth = Buffer.from(
    `${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`,
    'utf8'
  ).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'client_credentials'
  });

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const tokenResponse = await parseSpotifyResponse<SpotifyClientCredentialsResponse>(
    response,
    'Spotify app token fetch failed.'
  );

  return tokenResponse.access_token;
}

async function fetchArtistsByIds(accessToken: string, artistIds: string[]) {
  if (artistIds.length === 0) {
    return [];
  }

  console.log('[spotify sync] artist ids for detail lookup:', artistIds);

  const params = new URLSearchParams({
    ids: artistIds.join(',')
  });

  const response = await fetchSpotifyResource<SpotifyArtistsLookupResponse>(
    accessToken,
    `https://api.spotify.com/v1/artists?${params.toString()}`,
    'Spotify artist details fetch failed.'
  );

  return response.artists;
}

function slugifyGenre(genre: string) {
  return genre
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleCaseGenre(genre: string) {
  return genre
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function deriveTopGenres(artists: SpotifyArtist[], limit = 10) {
  const genreCounts = new Map<string, number>();

  for (const artist of artists) {
    for (const genre of artist.genres ?? []) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    }
  }

  return [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([genre]) => ({
      slug: slugifyGenre(genre),
      label: titleCaseGenre(genre)
    }));
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

  const response = await fetch('https://accounts.spotify.com/api/token', {
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

export async function syncTopMusicData(userId: string, accessToken: string): Promise<void> {
  const artistResponses = await Promise.all(
    spotifyTimeRanges.map(async (timeRange) => ({
      timeRange,
      response: await fetchSpotifyResource<SpotifyPagingResponse<SpotifyArtist>>(
        accessToken,
        `https://api.spotify.com/v1/me/top/artists?limit=10&time_range=${timeRange}`,
        `Spotify top artists fetch failed for ${timeRange}.`
      )
    }))
  );

  const trackResponses = await Promise.all(
    spotifyTimeRanges.map(async (timeRange) => ({
      timeRange,
      response: await fetchSpotifyResource<SpotifyPagingResponse<SpotifyTrack>>(
        accessToken,
        `https://api.spotify.com/v1/me/top/tracks?limit=10&time_range=${timeRange}`,
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

  const mediumTermArtists = topArtistsByRange.medium_term;
  console.log(
    '[spotify sync] top artists raw genres:',
    mediumTermArtists.map((artist) => ({
      id: artist.id,
      name: artist.name,
      genres: artist.genres ?? []
    }))
  );

  let fullArtists: SpotifyArtist[] = [];

  try {
    const appAccessToken = await fetchSpotifyAppAccessToken();
    const uniqueArtistIds = [
      ...new Set(
        Object.values(topArtistsByRange)
          .flat()
          .map((artist) => artist.id)
      )
    ];
    fullArtists = await fetchArtistsByIds(
      appAccessToken,
      uniqueArtistIds
    );
  } catch (error) {
    const enrichedError = error as Error & {
      status?: number;
      spotifyBody?: unknown;
    };
    console.warn(
      'Spotify artist details lookup failed; continuing with top artists payload only.',
      {
        message: enrichedError.message,
        status: enrichedError.status,
        spotifyBody: enrichedError.spotifyBody
      }
    );
  }

  const fullArtistsById = new Map(fullArtists.map((artist) => [artist.id, artist]));
  const normalizeArtist = (artist: SpotifyArtist) => {
    const fullArtist = fullArtistsById.get(artist.id);

    return {
      ...artist,
      genres: fullArtist?.genres ?? artist.genres ?? [],
      images: fullArtist?.images ?? artist.images ?? []
    };
  };

  const normalizedArtistsByRange = spotifyTimeRanges.reduce(
    (accumulator, timeRange) => {
      accumulator[timeRange] = topArtistsByRange[timeRange].map(normalizeArtist);
      return accumulator;
    },
    {} as SpotifyTopItemsByRange<SpotifyArtist>
  );

  console.log(
    '[spotify sync] normalized artist genres:',
    normalizedArtistsByRange.medium_term.map((artist) => ({
      id: artist.id,
      name: artist.name,
      genres: artist.genres ?? []
    }))
  );
  const topGenres = deriveTopGenres(normalizedArtistsByRange.medium_term);
  console.log('[spotify sync] derived top genres:', topGenres);

  const uniqueNormalizedArtists = [
    ...new Map(
      Object.values(normalizedArtistsByRange)
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
    await tx.userFavoriteGenre.deleteMany({ where: { userId } });
    await tx.userFavoriteArtist.deleteMany({ where: { userId } });
    await tx.userFavoriteTrack.deleteMany({ where: { userId } });

    for (const genre of topGenres) {
      await tx.genre.upsert({
        where: { slug: genre.slug },
        update: { label: genre.label },
        create: genre
      });
    }

    for (const artist of uniqueNormalizedArtists) {
      await tx.artist.upsert({
        where: { spotifyId: artist.id },
        update: {
          name: artist.name,
          imageUrl: artist.images?.[0]?.url ?? null,
          genres: artist.genres ?? []
        },
        create: {
          spotifyId: artist.id,
          name: artist.name,
          imageUrl: artist.images?.[0]?.url ?? null,
          genres: artist.genres ?? []
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

    for (const [index, genre] of topGenres.entries()) {
      const savedGenre = await tx.genre.findUniqueOrThrow({
        where: { slug: genre.slug }
      });

      await tx.userFavoriteGenre.create({
        data: {
          userId,
          genreId: savedGenre.id,
          rank: index + 1
        }
      });
    }

    for (const timeRange of spotifyTimeRanges) {
      for (const [index, artist] of normalizedArtistsByRange[timeRange].entries()) {
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
  });
}
