type Track = { spotifyId: string; name: string; artistName: string; albumArt: string | null };
export type MixFavorite = { track: Track; rank: number; timeRange: 'short_term' | 'medium_term' | 'long_term' };
export type MixTrack = Track & { source: 'shared' | 'you' | 'them'; reason: string };
const weights = { short_term: 0.5, medium_term: 0.3, long_term: 0.2 };

function profile(rows: MixFavorite[]) {
  const map = new Map<string, { track: Track; score: number }>();
  const seen = new Set<string>();
  for (const row of rows) {
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
  if (!you.size || !them.size) return [];
  const yourArtists = new Set([...you.values()].map((entry) => entry.track.artistName.trim().toLowerCase()));
  const theirArtists = new Set([...them.values()].map((entry) => entry.track.artistName.trim().toLowerCase()));
  const all = [...new Set([...you.keys(), ...them.keys()])].map((id) => {
    const a = you.get(id);
    const b = them.get(id);
    const track = (a ?? b)!.track;
    const artist = track.artistName.trim().toLowerCase();
    const sharedArtist = yourArtists.has(artist) && theirArtists.has(artist);
    const source = a && b ? 'shared' as const : a ? 'you' as const : 'them' as const;
    return { ...track, source, artist, score: (a?.score ?? 0) + (b?.score ?? 0), sharedArtist,
      reason: source === 'shared' ? 'Appears in both synced top-track profiles.' :
        `From ${source === 'you' ? 'your' : 'their'} synced top tracks.${sharedArtist ? ' The same artist credit appears in both track profiles.' : ''}` };
  }).sort((a, b) => Number(b.sharedArtist) - Number(a.sharedArtist) || b.score - a.score || a.spotifyId.localeCompare(b.spotifyId));
  const result: MixTrack[] = [];
  const selected = new Set<string>();
  const artistCounts = new Map<string, number>();
  const add = (entry: typeof all[number]) => {
    if (result.length >= 20 || selected.has(entry.spotifyId) || (artistCounts.get(entry.artist) ?? 0) >= 3) return false;
    selected.add(entry.spotifyId);
    artistCounts.set(entry.artist, (artistCounts.get(entry.artist) ?? 0) + 1);
    const { artist: _artist, score: _score, sharedArtist: _sharedArtist, ...track } = entry;
    result.push(track);
    return true;
  };
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
  for (const entry of all) add(entry);
  return result;
}
