import { Prisma } from '@prisma/client'; // Import Prisma's runtime error classes and query types.
import { prisma } from '../lib/prisma.js'; // Import the shared database client rather than creating a new connection client here.
import { selectMix } from './mixSelection.js'; // Import the pure function that chooses tracks from two stored profiles.
import { SpotifyRequestError, spotifyPlaylistRequest } from './spotifyService.js'; // Import controlled Spotify errors and the authorized playlist request helper.

export class MixError extends Error { // Represent a playlist-workflow error with a user-facing message and HTTP status.
  constructor(public code: string, message: string, public status = 400, public playlistUrl?: string) { super(message); } // Keep an error code, message, status, and optional playlist link for the route to report.
} // Close the current block and continue in its enclosing function or scenario.

const profileSelect = { // Define the limited profile fields needed for previews; do not select Spotify tokens.
  id: true, displayName: true, // Fetch the local user ID and display name.
  favoriteTracks: { select: { rank: true, timeRange: true, // Include favorite-track ranks and windows alongside the associated track details.
    track: { select: { spotifyId: true, name: true, artistName: true, albumArt: true } } } } // Fetch track IDs, titles, artist credits, and artwork used by the preview.
} satisfies Prisma.UserSelect; // Type-check this field selection against Prisma's User query shape.

export async function previewMix(ownerId: string, targetUserId: string) { // Read both stored profiles and build a preview without creating anything on Spotify.
  if (ownerId === targetUserId) throw new MixError('self_mix', 'Choose another listener for a mix.'); // Reject mixing a user with their own profile.
  const [owner, target, credentials] = await Promise.all([ // Load both profiles and the owner's permission readiness concurrently.
    prisma.user.findUnique({ where: { id: ownerId }, select: profileSelect }), // Read the playlist owner's stored top-track profile.
    prisma.user.findUnique({ where: { id: targetUserId }, select: profileSelect }), // Read the other listener's stored top-track profile, not their credentials.
    prisma.user.findUnique({ where: { id: ownerId }, select: { spotifyScopes: true, spotifyConnected: true } }) // Check the owner's connection flag and granted scopes without exposing tokens.
  ]); // Finish the array argument and wait for the grouped operations or comparison call.
  if (!owner || !target) throw new MixError('not_found', 'This listener could not be found.', 404); // Return not-found if either required user no longer exists.
  return { // Return the preview object that the route will send as JSON to the browser.
    owner: { id: owner.id, displayName: owner.displayName }, target: { id: target.id, displayName: target.displayName }, // Expose only basic identity details for the two preview participants.
    name: `${owner.displayName} + ${target.displayName}: Connectify Mix`.slice(0, 100), // Suggest a joint playlist name capped at 100 characters.
    tracks: selectMix(owner.favoriteTracks, target.favoriteTracks), // Generate the preview using both users' stored favorites.
    canSave: Boolean(credentials?.spotifyConnected && credentials.spotifyScopes.includes('playlist-modify-public')) // Report readiness only if the owner is connected and granted public-playlist modification.
  }; // Finish this object definition, helper function, or returned object.
} // Close the current block and continue in its enclosing function or scenario.

export function mixResult(row: { id: string; status: string; spotifyPlaylistId: string | null }) { // Translate stored workflow progress into the simpler result the frontend displays.
  return { id: row.id, status: row.status === 'saved' ? 'saved' : row.status === 'uncertain' ? 'uncertain' : 'pending', // Map internal stages to saved, uncertain, or pending for the browser.
    playlistUrl: row.spotifyPlaylistId ? `https://open.spotify.com/playlist/${row.spotifyPlaylistId}` : null }; // Provide a Spotify playlist URL when its external ID is known, otherwise null.
} // Close the current block and continue in its enclosing function or scenario.

export type SaveMixInput = { requestId: string; targetUserId: string; name: string; trackIds: string[] }; // Describe a save's retry UUID, other user, name, and ordered track IDs.

export async function saveMix(ownerId: string, input: SaveMixInput) { // Create or resume one durable playlist operation for the authenticated owner.
  let row = await prisma.mixSave.findUnique({ where: { id: input.requestId } }); // Look up the operation by its stable request ID so retries reuse prior progress.
  if (!row) { // Validate and record a new save only when this request ID has not been seen before.
    const preview = await previewMix(ownerId, input.targetUserId); // Rebuild the allowed preview from current database data before accepting a new operation.
    if (!preview.canSave) throw new MixError('permission_required', 'Reconnect Spotify to allow public playlist creation.', 403); // Reject a new save if Spotify connection or public-playlist permission is missing.
    const allowed = new Set(preview.tracks.map((track) => track.spotifyId)); // Index preview track IDs to check the browser's requested selection.
    if (!input.trackIds.every((id) => allowed.has(id))) { // Require every submitted song to belong to the current preview; removals are allowed.
      throw new MixError('invalid_tracks', 'The preview has changed. Reload it before saving.'); // Reject tracks outside the preview and ask the browser to reload it.
    } // Close the current block and continue in its enclosing function or scenario.
    try { // Attempt this work while allowing the following catch/finally block to handle failure or cleanup.
      row = await prisma.mixSave.create({ data: { // Persist the operation before contacting Spotify so its intent survives an interrupted request.
        id: input.requestId, ownerId, targetUserId: input.targetUserId, name: input.name, trackIds: input.trackIds // Freeze the owner, partner, name, ordered tracks, and retry ID for this operation.
      } }); // Close the current block and continue in its enclosing function or scenario.
    } catch (error) { // Handle a failure from the preceding asynchronous operation.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error; // Handle only duplicate-key races here; let unrelated database failures propagate.
      row = await prisma.mixSave.findUniqueOrThrow({ where: { id: input.requestId } }); // Reuse the operation another simultaneous request inserted first.
    } // Close the current block and continue in its enclosing function or scenario.
  } // Close the current block and continue in its enclosing function or scenario.
  if (row.ownerId !== ownerId) throw new MixError('not_found', 'Mix not found.', 404); // Hide operations belonging to another user; knowing a request ID is not authorization.
  if (row.name !== input.name || row.targetUserId !== input.targetUserId || JSON.stringify(row.trackIds) !== JSON.stringify(input.trackIds)) { // Reject reuse of this request ID for a different name, partner, or ordered track list.
    throw new MixError('conflict', 'This save request was already used for a different mix.', 409); // Return a conflict rather than changing the contents of an existing operation.
  } // Close the current block and continue in its enclosing function or scenario.
  if (row.status === 'saved') return mixResult(row); // Return an already verified result without sending more Spotify requests.
  if (row.status === 'uncertain') throw new MixError('save_uncertain', // Block a blind creation retry when Spotify may already have created the playlist.
    'Spotify may have created this playlist, but did not confirm it. Check your Spotify library before creating another mix.', 409); // Explain why the user must check Spotify rather than start another automatic creation.
  if (row.status === 'creating') { // Treat an operation currently being created as pending instead of starting another creation.
    if (Date.now() - row.updatedAt.getTime() > 120000) { // After two minutes, treat an interrupted creation as uncertain, not definitely failed.
      await prisma.mixSave.updateMany({ where: { id: row.id, status: 'creating', updatedAt: row.updatedAt }, data: { status: 'uncertain' } }); // Mark stale creation uncertain only if its status and timestamp have not changed meanwhile.
      throw new MixError('save_uncertain', 'The previous save was interrupted. Check your Spotify library before creating another mix.', 409); // Stop here because the earlier external creation outcome cannot be trusted.
    } // Close the current block and continue in its enclosing function or scenario.
    return mixResult(row); // Return this operation's current public status and any known Spotify link.
  } // Close the current block and continue in its enclosing function or scenario.
  if (!row.spotifyPlaylistId) { // Create a Spotify playlist only when no external playlist ID has been recorded.
    const claim = await prisma.mixSave.updateMany({ where: { id: row.id, status: { in: ['prepared', 'failed'] } }, data: { status: 'creating' } }); // Atomically claim prepared/failed creation work so two callers cannot both start a creation.
    if (!claim.count) return mixResult(await prisma.mixSave.findUniqueOrThrow({ where: { id: row.id } })); // If another caller won the claim, return its current stored progress instead.
    try { // Attempt this work while allowing the following catch/finally block to handle failure or cleanup.
      const playlist = await spotifyPlaylistRequest<{ id: string }>(ownerId, '/me/playlists', { // Create the playlist using only the authenticated owner's stored Spotify credentials.
        method: 'POST', body: JSON.stringify({ name: row.name, public: true, collaborative: false, // Request a public, noncollaborative playlist; joint selection does not grant joint editing.
          description: 'A Connectify mix of two listeners\' synced top tracks. Selected and saved by the playlist owner.' }) // Describe the mix truthfully as selected from stored top tracks by its owner.
      }); // Finish this callback, object-based call, or test scenario.
      if (!/^[a-zA-Z0-9]{22}$/.test(playlist?.id ?? '')) throw new SpotifyRequestError('invalid_response'); // Require a plausible returned Spotify playlist ID before saving it.
      row = await prisma.mixSave.update({ where: { id: row.id }, data: { spotifyPlaylistId: playlist.id, status: 'adding' } }); // Save the external ID BEFORE adding songs, so a failed song write can reuse this playlist.
    } catch (error) { // Handle a failure from the preceding asynchronous operation.
      const safeFailure = error instanceof SpotifyRequestError && error.status !== undefined && error.status >= 400 && error.status < 500; // Treat an explicit Spotify 4xx rejection as failed; transport/server/DB failures may be ambiguous.
      await prisma.mixSave.update({ where: { id: row.id }, data: { status: safeFailure ? 'failed' : 'uncertain' } }); // Persist failed or uncertain so a later request knows whether creation can be attempted again.
      if (!safeFailure) throw new MixError('save_uncertain', 'Spotify did not confirm playlist creation. Check your Spotify library before trying a new mix.', 409); // Stop automatic creation retries when the external outcome is unknown.
      throw error; // Propagate the failure for the route's controlled error handling.
    } // Close the current block and continue in its enclosing function or scenario.
  } // Close the current block and continue in its enclosing function or scenario.
  const playlistId = row.spotifyPlaylistId!; // Continue with the known external ID, whether this request created it or resumed an earlier save.
  const uris = row.trackIds.map((id) => `spotify:track:${id}`); // Convert plain track IDs into Spotify resource URIs such as spotify:track:<id>.
  type PlaylistDetails = { public: boolean; collaborative: boolean; owner: { id: string } }; // Describe the ownership, public, and collaborative fields needed for verification.
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: { spotifyUserId: true } }); // Load the owner's Spotify account ID to compare against the playlist owner.
  let details = await spotifyPlaylistRequest<PlaylistDetails>(ownerId, `/playlists/${playlistId}`); // Read the playlist before writing any tracks to verify ownership and visibility.
  if (details.owner?.id !== owner.spotifyUserId) throw new MixError('verification_failed', 'Spotify did not confirm playlist ownership.', 502); // Reject a playlist that Spotify does not identify as belonging to this owner.
  if (details.public !== true || details.collaborative !== false) { // Require the playlist to be explicitly public and noncollaborative.
    await spotifyPlaylistRequest(ownerId, `/playlists/${playlistId}`, { // Ask Spotify to repair the playlist flags before adding songs.
      method: 'PUT', body: JSON.stringify({ public: true, collaborative: false }) // Set public visibility and disable collaborative editing.
    }); // Finish this callback, object-based call, or test scenario.
    details = await spotifyPlaylistRequest<PlaylistDetails>(ownerId, `/playlists/${playlistId}`); // Read the flags back; a successful update response alone is not verification.
    if (details.public !== true || details.collaborative !== false) { // Require the playlist to be explicitly public and noncollaborative.
      throw new MixError('visibility_unverified', 'Spotify has not confirmed this playlist as public and noncollaborative. Retry this same save in a moment. No tracks were added by this attempt.', 502, // Keep the save pending if the required flags still cannot be confirmed; do not write tracks.
        `https://open.spotify.com/playlist/${playlistId}`); // Include the known playlist link with this controlled error.
    } // Close the current block and continue in its enclosing function or scenario.
  } // Close the current block and continue in its enclosing function or scenario.
  await spotifyPlaylistRequest(ownerId, `/playlists/${playlistId}/items`, { method: 'PUT', body: JSON.stringify({ uris }) }); // Replace the complete track list; retrying identical contents does not append duplicate songs.
  const [finalDetails, contents] = await Promise.all([ // Read final playlist details and track contents concurrently after the write.
    spotifyPlaylistRequest<PlaylistDetails>(ownerId, `/playlists/${playlistId}`), // Fetch the final owner and visibility flags for the success check.
    spotifyPlaylistRequest<{ items: { item?: { uri: string }; track?: { uri: string } }[]; next: string | null }>(ownerId, `/playlists/${playlistId}/items?limit=50`) // Read up to 50 items, enough for this mix's 20-track maximum, and check for another page.
  ]); // Finish the array argument and wait for the grouped operations or comparison call.
  const actual = contents.items.map((entry) => (entry.item ?? entry.track)?.uri); // Extract ordered track URIs from either supported response shape.
  if (finalDetails.public !== true || finalDetails.collaborative !== false || finalDetails.owner.id !== owner.spotifyUserId || contents.next || JSON.stringify(actual) !== JSON.stringify(uris)) { // Reject success if ownership, flags, pagination, track identities, or track order differ.
    throw new MixError('verification_failed', 'The playlist was created, but its visibility or tracks could not be verified. Retry this save to check again.', 502); // Report an unverified save; a known-ID retry can check or replace the same playlist again.
  } // Close the current block and continue in its enclosing function or scenario.
  row = await prisma.mixSave.update({ where: { id: row.id }, data: { status: 'saved' } }); // Mark saved only after reading back and verifying Spotify's actual result.
  return mixResult(row); // Return this operation's current public status and any known Spotify link.
} // Close the current block and continue in its enclosing function or scenario.
