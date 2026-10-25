import { getApiUrl } from './api';

export type MixTrack = {
  spotifyId: string; name: string; artistName: string; albumArt: string | null;
  source: 'shared' | 'you' | 'them'; reason: string;
};
export type MixPreview = {
  target: { id: string; displayName: string }; owner: { id: string; displayName: string };
  name: string; tracks: MixTrack[]; canSave: boolean;
};
export type MixRequest = { targetUserId: string; name: string; trackIds: string[]; requestId: string };
export type MixResult = { id: string; status: 'saved' | 'pending' | 'uncertain'; playlistUrl: string | null; message?: string };

export class MixRequestError extends Error {
  public playlistUrl: string | null;
  constructor(public code: string, public status: number, message: string, playlistUrl?: string | null) {
    super(message);
    this.playlistUrl = spotifyPlaylistUrl(playlistUrl);
  }
}

async function request(token: string, path: string, payload?: MixRequest): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${getApiUrl()}/api/mixes${path}`, {
      method: payload ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(30_000)
    });
  } catch {
    throw new MixRequestError(payload ? 'save_pending' : 'unavailable', 0,
      payload ? 'The save response was not received.' : 'Could not load this mix. Please try again.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new MixRequestError(data?.code ?? (payload ? 'save_pending' : 'unavailable'), response.status,
    response.status === 401 ? 'Your session ended. Please sign in again.' : data?.message || 'Mixes are temporarily unavailable.', data?.playlistUrl);
  return data;
}

export async function fetchMixPreview(token: string, targetUserId: string): Promise<MixPreview> {
  const data = await request(token, `/preview/${encodeURIComponent(targetUserId)}`) as MixPreview | null;
  if (!data?.target?.id || !data.owner?.id || !Array.isArray(data.tracks)) {
    throw new MixRequestError('unavailable', 0, 'This mix is missing listening data. Please try again later.');
  }
  const seen = new Set<string>();
  const tracks = data.tracks.filter((track) => {
    if (!track || typeof track.spotifyId !== 'string' || !track.spotifyId || seen.has(track.spotifyId)
      || !['shared', 'you', 'them'].includes(track.source)) return false;
    seen.add(track.spotifyId);
    return true;
  }).slice(0, 20);
  return { ...data, name: typeof data.name === 'string' ? data.name.slice(0, 100) : 'Connectify mix', tracks, canSave: data.canSave === true };
}

function parseResult(value: unknown, saving: boolean): MixResult {
  const data = value as MixResult | null;
  if (!data?.id || !['saved', 'pending', 'uncertain'].includes(data.status)) {
    throw new MixRequestError(saving ? 'save_pending' : 'unavailable', 0, 'The save status could not be read. Retry this same save.');
  }
  return data;
}

export async function saveMix(token: string, payload: MixRequest): Promise<MixResult> {
  return parseResult(await request(token, '', payload), true);
}

export async function fetchMixStatus(token: string, id: string): Promise<MixResult> {
  return parseResult(await request(token, `/${encodeURIComponent(id)}`), false);
}

// The in-memory copy also keeps retries stable if sessionStorage is unavailable.
const frozenRequests = new Map<string, MixRequest>();
const storageKey = (ownerId: string, targetUserId: string) =>
  `connectify_mix:${encodeURIComponent(ownerId)}:${encodeURIComponent(targetUserId)}`;

export function readFrozenMix(ownerId: string, targetUserId: string): MixRequest | null {
  const key = storageKey(ownerId, targetUserId);
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null') as MixRequest | null;
    if (value?.targetUserId === targetUserId && typeof value.name === 'string' && value.name.trim() && value.name.length <= 100
      && typeof value.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)
      && Array.isArray(value.trackIds) && value.trackIds.length >= 1 && value.trackIds.length <= 20
      && value.trackIds.every((id) => typeof id === 'string' && id.length > 0)
      && new Set(value.trackIds).size === value.trackIds.length) {
      const payload = { targetUserId, name: value.name, trackIds: [...value.trackIds], requestId: value.requestId };
      frozenRequests.set(key, payload);
      return payload;
    }
  } catch { /* Retain the in-memory request when storage is unavailable. */ }
  return frozenRequests.get(key) || null;
}

export function persistFrozenMix(ownerId: string, payload: MixRequest): boolean {
  const key = storageKey(ownerId, payload.targetUserId);
  frozenRequests.set(key, payload);
  try { sessionStorage.setItem(key, JSON.stringify(payload)); return true; }
  catch { return false; }
}

export function clearFrozenMix(ownerId: string, targetUserId: string): boolean {
  const key = storageKey(ownerId, targetUserId);
  try { sessionStorage.removeItem(key); }
  catch { return false; }
  frozenRequests.delete(key);
  return true;
}

export function spotifyPlaylistUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'open.spotify.com' && url.pathname.startsWith('/playlist/') ? url.href : null;
  } catch { return null; }
}
