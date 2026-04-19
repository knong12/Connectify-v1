import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { syncTopMusicData } from './spotifyService.js';
import type { SpotifyProfile, SpotifyTokenResponse } from '../types/auth.js';

export function createSpotifyAuthState() {
  // Step 1:
  // Replace this with crypto.randomBytes(16).toString('hex')
  // after you are ready to validate state values end to end.
  return 'replace-this-state';
}

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
      spotifyRefreshToken: tokens.refresh_token ?? null,
      spotifyConnected: true
    },
    create: {
      email: profile.email,
      displayName: profile.display_name,
      spotifyUserId: profile.id,
      spotifyProfileImage: profile.images[0]?.url ?? null,
      spotifyAccessToken: tokens.access_token,
      spotifyRefreshToken: tokens.refresh_token ?? null,
      spotifyConnected: true
    }
  });
}

export async function finishSpotifyLogin(profile: SpotifyProfile, tokens: SpotifyTokenResponse) {
  const user = await upsertUserFromSpotify(profile, tokens);

  // Step 6:
  // After you have Spotify fetch code working, uncomment this call.
  // await syncTopMusicData(user.id, tokens.access_token);

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

