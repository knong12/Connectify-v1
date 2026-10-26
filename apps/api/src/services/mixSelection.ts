type Track = { spotifyId: string; name: string; artistName: string; albumArt: string | null }; 
export type MixFavorite = { track: Track; rank: number; timeRange: 'short_term' | 'medium_term' | 'long_term' };
export type MixTrack = Track & { source: 'shared' | 'you' | 'them'; reason: string };
const weights = { short_term: 0.5, medium_term: 0.3, long_term: 0.2 };

// Combine each track's appearances across windows into one selection priority.
// For example, recent #1 plus medium-term #2 contributes 0.5/1 + 0.3/2 = 0.65.
function profile(rows: MixFavorite[]) {
  const map = new Map<string, { track: Track; score: number }>();
  const seen = new Set<string>();
  for (const row of rows) {
    // Count a track once per window, while allowing another window to add weight.
    const key = `${row.track.spotifyId}:${row.timeRange}`;
    if (seen.has(key) || !/^[a-zA-Z0-9]{22}$/.test(row.track.spotifyId) || row.rank < 1) continue;
    seen.add(key);
    const previous = map.get(row.track.spotifyId);
    map.set(row.track.spotifyId, { track: row.track, score: (previous?.score ?? 0) + weights[row.timeRange] / row.rank });
  }
  return map;
}

export function selectMix(yourRows: MixFavorite[], theirRows: MixFavorite[]): MixTrack[] {
  const you = profile(yourRows);
  const them = profile(theirRows);
  // A joint mix needs music from both people; do not disguise a one-person list as a joint mix.
  if (!you.size || !them.size) return [];
  const yourArtists = new Set([...you.values()].map((entry) => entry.track.artistName.trim().toLowerCase()));
  const theirArtists = new Set([...them.values()].map((entry) => entry.track.artistName.trim().toLowerCase()));
  // Build one candidate per Spotify track ID and explain whose stored profile supplied it.
  const all = [...new Set([...you.keys(), ...them.keys()])].map((id) => {
    const a = you.get(id);
    const b = them.get(id);
    const track = (a ?? b)!.track;
    // This compares the entire artist credit, not individual artists in a collaboration.
    const artist = track.artistName.trim().toLowerCase();
    const sharedArtist = yourArtists.has(artist) && theirArtists.has(artist);
    const source = a && b ? 'shared' as const : a ? 'you' as const : 'them' as const;
    return { ...track, source, artist, score: (a?.score ?? 0) + (b?.score ?? 0), sharedArtist,
      reason: source === 'shared' ? 'Appears in both synced top-track profiles.' :
        `From ${source === 'you' ? 'your' : 'their'} synced top tracks.${sharedArtist ? ' The same artist credit appears in both track profiles.' : ''}` };
  // Prefer common artist credits, then listening-list priority; IDs make exact ties deterministic.
  }).sort((a, b) => Number(b.sharedArtist) - Number(a.sharedArtist) || b.score - a.score || a.spotifyId.localeCompare(b.spotifyId));
  const result: MixTrack[] = [];
  const selected = new Set<string>();
  const artistCounts = new Map<string, number>();
  // Every selection path uses the same limits: 20 tracks, no duplicates, three per artist credit.
  const add = (entry: typeof all[number]) => {
    if (result.length >= 20 || selected.has(entry.spotifyId) || (artistCounts.get(entry.artist) ?? 0) >= 3) return false;
    selected.add(entry.spotifyId);
    artistCounts.set(entry.artist, (artistCounts.get(entry.artist) ?? 0) + 1);
    const { artist: _artist, score: _score, sharedArtist: _sharedArtist, ...track } = entry;
    result.push(track);
    return true;
  };
  // Start with up to four mutual favorites, leaving room to introduce each person's own tracks.
  for (const entry of all.filter((item) => item.source === 'shared')) {
    if (result.length >= 4) break;
    add(entry);
  }
  const queues = {
    you: all.filter((item) => item.source === 'you'),
    them: all.filter((item) => item.source === 'them')
  };
  // Alternate unique selections; when one profile runs out, use the other profile's remaining tracks.
  while (result.length < 20 && (queues.you.length || queues.them.length)) {
    for (const source of ['you', 'them'] as const) {
      while (queues[source].length) {
        if (add(queues[source].shift()!)) break;
      }
    }
  }
  // Fill unused slots from remaining candidates without relaxing the limits or padding sparse data.
  for (const entry of all) add(entry);
  return result;
}
