import { randomBytes, timingSafeEqual } from 'node:crypto';

export const oauthStateLifetimeMs = 10 * 60 * 1000;
const pendingStates = new Map<string, number>();

export function createSpotifyAuthState() {
  const now = Date.now();
  for (const [state, expiresAt] of pendingStates) {
    if (expiresAt <= now) pendingStates.delete(state);
  }
  if (pendingStates.size >= 10000) {
    throw new Error('Too many pending login attempts.');
  }
  const state = randomBytes(32).toString('hex');
  pendingStates.set(state, now + oauthStateLifetimeMs);
  return state;
}

export function consumeSpotifyAuthState(state: unknown, cookieState: unknown) {
  if (typeof state !== 'string' || typeof cookieState !== 'string' ||
      !/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(cookieState)) {
    return false;
  }
  if (!timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))) return false;
  const expiresAt = pendingStates.get(state);
  pendingStates.delete(state);
  return expiresAt !== undefined && expiresAt > Date.now();
}
