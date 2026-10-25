import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { selectMix } from './mixSelection.js';
import { SpotifyRequestError, spotifyPlaylistRequest } from './spotifyService.js';

export class MixError extends Error {
  constructor(public code: string, message: string, public status = 400, public playlistUrl?: string) { super(message); }
}

const profileSelect = {
  id: true, displayName: true,
  favoriteTracks: { select: { rank: true, timeRange: true,
    track: { select: { spotifyId: true, name: true, artistName: true, albumArt: true } } } }
} satisfies Prisma.UserSelect;

export async function previewMix(ownerId: string, targetUserId: string) {
  if (ownerId === targetUserId) throw new MixError('self_mix', 'Choose another listener for a mix.');
  const [owner, target, credentials] = await Promise.all([
    prisma.user.findUnique({ where: { id: ownerId }, select: profileSelect }),
    prisma.user.findUnique({ where: { id: targetUserId }, select: profileSelect }),
    prisma.user.findUnique({ where: { id: ownerId }, select: { spotifyScopes: true, spotifyConnected: true } })
  ]);
  if (!owner || !target) throw new MixError('not_found', 'This listener could not be found.', 404);
  return {
    owner: { id: owner.id, displayName: owner.displayName }, target: { id: target.id, displayName: target.displayName },
    name: `${owner.displayName} + ${target.displayName}: Connectify Mix`.slice(0, 100),
    tracks: selectMix(owner.favoriteTracks, target.favoriteTracks),
    canSave: Boolean(credentials?.spotifyConnected && credentials.spotifyScopes.includes('playlist-modify-public'))
  };
}

export function mixResult(row: { id: string; status: string; spotifyPlaylistId: string | null }) {
  return { id: row.id, status: row.status === 'saved' ? 'saved' : row.status === 'uncertain' ? 'uncertain' : 'pending',
    playlistUrl: row.spotifyPlaylistId ? `https://open.spotify.com/playlist/${row.spotifyPlaylistId}` : null };
}

export type SaveMixInput = { requestId: string; targetUserId: string; name: string; trackIds: string[] };

export async function saveMix(ownerId: string, input: SaveMixInput) {
  let row = await prisma.mixSave.findUnique({ where: { id: input.requestId } });
  if (!row) {
    const preview = await previewMix(ownerId, input.targetUserId);
    if (!preview.canSave) throw new MixError('permission_required', 'Reconnect Spotify to allow public playlist creation.', 403);
    const allowed = new Set(preview.tracks.map((track) => track.spotifyId));
    if (!input.trackIds.every((id) => allowed.has(id))) {
      throw new MixError('invalid_tracks', 'The preview has changed. Reload it before saving.');
    }
    try {
      row = await prisma.mixSave.create({ data: {
        id: input.requestId, ownerId, targetUserId: input.targetUserId, name: input.name, trackIds: input.trackIds
      } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      row = await prisma.mixSave.findUniqueOrThrow({ where: { id: input.requestId } });
    }
  }
  if (row.ownerId !== ownerId) throw new MixError('not_found', 'Mix not found.', 404);
  if (row.name !== input.name || row.targetUserId !== input.targetUserId || JSON.stringify(row.trackIds) !== JSON.stringify(input.trackIds)) {
    throw new MixError('conflict', 'This save request was already used for a different mix.', 409);
  }
  if (row.status === 'saved') return mixResult(row);
  if (row.status === 'uncertain') throw new MixError('save_uncertain',
    'Spotify may have created this playlist, but did not confirm it. Check your Spotify library before creating another mix.', 409);
  if (row.status === 'creating') {
    if (Date.now() - row.updatedAt.getTime() > 120000) {
      await prisma.mixSave.updateMany({ where: { id: row.id, status: 'creating', updatedAt: row.updatedAt }, data: { status: 'uncertain' } });
      throw new MixError('save_uncertain', 'The previous save was interrupted. Check your Spotify library before creating another mix.', 409);
    }
    return mixResult(row);
  }
  if (!row.spotifyPlaylistId) {
    const claim = await prisma.mixSave.updateMany({ where: { id: row.id, status: { in: ['prepared', 'failed'] } }, data: { status: 'creating' } });
    if (!claim.count) return mixResult(await prisma.mixSave.findUniqueOrThrow({ where: { id: row.id } }));
    try {
      const playlist = await spotifyPlaylistRequest<{ id: string }>(ownerId, '/me/playlists', {
        method: 'POST', body: JSON.stringify({ name: row.name, public: true, collaborative: false,
          description: 'A Connectify mix of two listeners\' synced top tracks. Selected and saved by the playlist owner.' })
      });
      if (!/^[a-zA-Z0-9]{22}$/.test(playlist?.id ?? '')) throw new SpotifyRequestError('invalid_response');
      row = await prisma.mixSave.update({ where: { id: row.id }, data: { spotifyPlaylistId: playlist.id, status: 'adding' } });
    } catch (error) {
      // A timeout/5xx/DB failure after POST may mean Spotify created a playlist. Never blindly repeat that POST.
      const safeFailure = error instanceof SpotifyRequestError && error.status !== undefined && error.status >= 400 && error.status < 500;
      await prisma.mixSave.update({ where: { id: row.id }, data: { status: safeFailure ? 'failed' : 'uncertain' } });
      if (!safeFailure) throw new MixError('save_uncertain', 'Spotify did not confirm playlist creation. Check your Spotify library before trying a new mix.', 409);
      throw error;
    }
  }
  const playlistId = row.spotifyPlaylistId!;
  const uris = row.trackIds.map((id) => `spotify:track:${id}`);
  type PlaylistDetails = { public: boolean; collaborative: boolean; owner: { id: string } };
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: { spotifyUserId: true } });
  let details = await spotifyPlaylistRequest<PlaylistDetails>(ownerId, `/playlists/${playlistId}`);
  if (details.owner?.id !== owner.spotifyUserId) throw new MixError('verification_failed', 'Spotify did not confirm playlist ownership.', 502);
  if (details.public !== true || details.collaborative !== false) {
    await spotifyPlaylistRequest(ownerId, `/playlists/${playlistId}`, {
      method: 'PUT', body: JSON.stringify({ public: true, collaborative: false })
    });
    details = await spotifyPlaylistRequest<PlaylistDetails>(ownerId, `/playlists/${playlistId}`);
    if (details.public !== true || details.collaborative !== false) {
      throw new MixError('visibility_unverified', 'Spotify has not confirmed this playlist as public and noncollaborative. Retry this same save in a moment. No tracks were added by this attempt.', 502,
        `https://open.spotify.com/playlist/${playlistId}`);
    }
  }
  // Replacing the complete contents is idempotent: retrying an interrupted write cannot append duplicates.
  await spotifyPlaylistRequest(ownerId, `/playlists/${playlistId}/items`, { method: 'PUT', body: JSON.stringify({ uris }) });
  const [finalDetails, contents] = await Promise.all([
    spotifyPlaylistRequest<PlaylistDetails>(ownerId, `/playlists/${playlistId}`),
    spotifyPlaylistRequest<{ items: { item?: { uri: string }; track?: { uri: string } }[]; next: string | null }>(ownerId, `/playlists/${playlistId}/items?limit=50`)
  ]);
  const actual = contents.items.map((entry) => (entry.item ?? entry.track)?.uri);
  if (finalDetails.public !== true || finalDetails.collaborative !== false || finalDetails.owner.id !== owner.spotifyUserId || contents.next || JSON.stringify(actual) !== JSON.stringify(uris)) {
    throw new MixError('verification_failed', 'The playlist was created, but its visibility or tracks could not be verified. Retry this save to check again.', 502);
  }
  row = await prisma.mixSave.update({ where: { id: row.id }, data: { status: 'saved' } });
  return mixResult(row);
}
