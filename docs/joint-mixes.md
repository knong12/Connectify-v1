# Joint Mixes

## User workflow

Open Matches, choose **Create a mix**, review the tracklist, edit its name, and optionally remove tracks. The preview does not call Spotify or create a playlist. **Save to Spotify** explicitly creates a **public**, owner-controlled, non-collaborative playlist; the other listener's Spotify credentials are never used. **Public warning:** the exported mix is not private and may be visible to other Spotify users. No external manual privacy change is required to complete a save.

The target is up to 20 tracks, not a promise that every profile combination has 20 eligible tracks. Both listeners must have at least one valid synced track. This is a tracklist preview, not automatic audio playback or Spotify's Blend product.

## Selection algorithm

`mixSelection.ts` is deterministic and operates on the existing short-, medium-, and long-term top-track snapshots:

1. Deduplicate each profile by Spotify track ID. Score each unique track by summing time-window weight divided by rank: recent 0.5, medium 0.3, long 0.2. A repeated row for the same track and window counts once.
2. Mark tracks appearing in both profiles as shared, even if their listening windows differ. This is distinct from the matching score, which compares the same window.
3. Prefer tracks whose exact normalized artist credit appears in both track profiles, then rank evidence, then Spotify ID for stable ties. Artist credits are strings, not individual artist IDs; collaborators and alternate credits can prevent a match.
4. Select up to four shared tracks. Alternate unique selections from each person, redistributing unused spaces if one profile runs out. Fill remaining spaces from eligible tracks, including additional shared tracks.
5. Enforce a maximum of three tracks with the same normalized full artist credit and a maximum of 20 distinct track IDs. Sparse or concentrated profiles can produce a shorter mix.

The UI explains whether each track came from both profiles, the owner, or the other listener. These are synced listening signals, not inferred audio similarity, exact play counts, or proof that a song is unfamiliar.

## API and storage

All endpoints require the Connectify bearer JWT and return `Cache-Control: no-store`:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/mixes/preview/:targetUserId` | Read-only preview and permission readiness |
| `POST /api/mixes` | Save with UUID `requestId`, target, name, and 1-20 selected IDs |
| `GET /api/mixes/:id` | Owner-only save status |

The server validates that submitted tracks belong to a freshly generated preview for new saves. It rejects duplicates, arbitrary injected IDs, invalid UUIDs, and self-mixes. Existing save attempts require the exact same target, name, track order, and owner. Ten save attempts per user per minute are allowed by the single-process development limiter.

`MixSave` durably stores the request ID, owner/target IDs, selected track IDs, name, Spotify playlist ID, timestamps, and save state. Other users cannot inspect the save status. This data is internal to Connectify; Spotify controls access to the exported playlist.

## Spotify authorization and visibility

Joint mixes require only `playlist-modify-public` for preview save readiness and `spotifyPlaylistRequest`, including writes and read-back verification. Neither `playlist-read-private` nor `playlist-modify-private` is required. Existing accounts without the public scope must reconnect; a refresh token cannot add scopes that were never approved. Granted scopes are saved on the user and no Spotify access or refresh token is returned to the browser.

The backend uses the current endpoints:

- `POST /v1/me/playlists` with `public: true` and `collaborative: false`.
- `GET /v1/playlists/{id}` to verify the owner before writing any songs.
- If `public` is not exactly `true` or the playlist is collaborative, `PUT /v1/playlists/{id}` with `public: true` and `collaborative: false`, then GET details again. Both public and non-collaborative status must be confirmed before writing tracks.
- `PUT /v1/playlists/{id}/items` to set the complete selected URI list. Replacement is intentional: retrying cannot append duplicate songs.
- `GET /v1/playlists/{id}/items?limit=50` and another playlist-details read to verify contents, order, owner, `public: true`, and `collaborative: false` before reporting success.

Spotify's API `public` property concerns profile publication. It is not a guarantee of end-to-end privacy or the same thing as an application-level access-control policy. Spotify's own client controls sharing and access. A match or Connectify follow does not grant Spotify collaboration rights.

Historically, live testing returned `public: true` despite explicit private settings on creation and update; the test tracks were cleared. That mismatch motivated the change to explicitly public joint mixes.

Live public-mode verification succeeded on 2026-10-18: a fresh playlist created with `public: true` returned a verified `saved` response, with the correct owner, 20 ordered tracks, public visibility, and collaboration disabled. Retrying the older private-intent test playlist with public-only authorization returned Spotify's `Insufficient client scope` on track writes despite a public details response; it was left empty. The successful test used a fresh public-intent playlist, not a blind retry or a false success for the old one.

If the automatic details update still cannot confirm public, non-collaborative status, the app returns HTTP 502 with `visibility_unverified` before writing any tracks in that attempt. The error may include `playlistUrl`. Retry the same save ID to repeat automatic verification and repair on the existing playlist; there is no instruction or requirement to make it private manually in Spotify.

## Failure and retry behavior

- `prepared` / `failed`: a request can claim creation atomically. Concurrent requests do not create another playlist.
- `creating`: another request is in flight. Return pending. A stale creation after two minutes becomes uncertain rather than repeating a possibly committed POST.
- `uncertain`: a timeout, invalid response, 5xx, or local interruption after creation can leave the outcome unknown. Check Spotify before starting another save; the app does not automatically create a replacement.
- `adding`: the playlist ID is already stored. Retry public visibility checks and automatic repair, then replace contents on that same playlist.
- `saved`: return the existing link without repeating external writes.

Spotify 401 triggers one refresh retry. Missing scopes, revoked authorization, 403 app restrictions, 429 rate limits, unavailable services, and verification failures receive controlled user-facing errors. Session storage preserves a save request across reloads in the same browser tab; it does not contain credentials. This is not a full playlist-management or multi-instance distributed-job system.

## References

- [Spotify: Create Playlist](https://developer.spotify.com/documentation/web-api/reference/create-playlist)
- [Spotify: Change Playlist Details](https://developer.spotify.com/documentation/web-api/reference/change-playlist-details)
- [Spotify: Update Playlist Items](https://developer.spotify.com/documentation/web-api/reference/reorder-or-replace-playlists-items)
- [Spotify: Get Playlist Items](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items)
- [Spotify: Playlist Concepts](https://developer.spotify.com/documentation/web-api/concepts/playlists)
