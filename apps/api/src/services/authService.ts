import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { syncUserMusicData } from './spotifyService.js';
import type { SpotifyProfile, SpotifyTokenResponse } from '../types/auth.js';

export { createSpotifyAuthState } from './oauthState.js';

export async function upsertUserFromSpotify(
  profile: SpotifyProfile,
  tokens: SpotifyTokenResponse
) {
  // Step 5:
  // Keep this function as the only place that writes Spotify user identity data.
  return prisma.user.upsert({
    where: {
      spotifyUserId: profile.id
    },
    update: {
      email: profile.email,
      displayName: profile.display_name,
      spotifyProfileImage: profile.images[0]?.url ?? null,
      spotifyAccessToken: tokens.access_token,
      spotifyRefreshToken: tokens.refresh_token ?? undefined,
      spotifyConnected: true,
      spotifyScopes: tokens.scope?.split(/\s+/).filter(Boolean) ?? []
    },
    create: {
      email: profile.email,
      displayName: profile.display_name,
      spotifyUserId: profile.id,
      spotifyProfileImage: profile.images[0]?.url ?? null,
      spotifyAccessToken: tokens.access_token,
      spotifyRefreshToken: tokens.refresh_token ?? null,
      spotifyConnected: true,
      spotifyScopes: tokens.scope?.split(/\s+/).filter(Boolean) ?? []
    }
  });
}

export async function finishSpotifyLogin(profile: SpotifyProfile, tokens: SpotifyTokenResponse) {
  const user = await upsertUserFromSpotify(profile, tokens);

  await syncUserMusicData(user.id);

  const appToken = jwt.sign(
    {
      userId: user.id,
      email: user.email
    },
    env.JWT_SECRET,
    {
      expiresIn: '7d'
    }
  );

  return {
    user,
    appToken
  };
}
