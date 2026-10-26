export const timeRanges = ['short_term', 'medium_term', 'long_term'] as const;
export type TimeRange = typeof timeRanges[number];
export type MusicKind = 'artists' | 'tracks';
const rangeWeights = { short_term: 0.5, medium_term: 0.3, long_term: 0.2 };
const kindWeights = { artists: 0.6, tracks: 0.4 };

export type MusicItem = {
  spotifyId: string;
  name: string;
  imageUrl: string | null;
  rank: number;
  timeRange: TimeRange;
};
export type MusicProfile = Record<MusicKind, MusicItem[]>;
export type SharedItem = {
  spotifyId: string;
  name: string;
  imageUrl: string | null;
  windows: { timeRange: TimeRange; yourRank: number; theirRank: number }[];
};

function indexItems(items: MusicItem[]) {
  const ranges = Object.fromEntries(timeRanges.map((range) => [range, new Map<string, MusicItem>()])) as
    Record<TimeRange, Map<string, MusicItem>>;
  for (const item of items) {
    const previous = ranges[item.timeRange].get(item.spotifyId);
    if (!previous || item.rank < previous.rank) ranges[item.timeRange].set(item.spotifyId, item);
  }
  return ranges;
}

export function compareMusicProfiles(yours: MusicProfile, theirs: MusicProfile) {
  const signals = [];
  const evidence: Record<MusicKind, SharedItem[]> = { artists: [], tracks: [] };
  const counts = { yourArtists: 0, theirArtists: 0, yourTracks: 0, theirTracks: 0 };
  for (const kind of ['artists', 'tracks'] as const) {
    const yourIndex = indexItems(yours[kind]);
    const theirIndex = indexItems(theirs[kind]);
    const yourIds = new Set(yours[kind].map((item) => item.spotifyId));
    const theirIds = new Set(theirs[kind].map((item) => item.spotifyId));
    if (kind === 'artists') {
      counts.yourArtists = yourIds.size;
      counts.theirArtists = theirIds.size;
    } else {
      counts.yourTracks = yourIds.size;
      counts.theirTracks = theirIds.size;
    }
    for (const range of timeRanges) {
      const yourItems = yourIndex[range];
      const theirItems = theirIndex[range];
      const sharedCount = [...yourItems.keys()].filter((id) => theirItems.has(id)).length;
      const unionCount = yourItems.size + theirItems.size - sharedCount;
      signals.push({
        kind, timeRange: range,
        yourCount: yourItems.size, theirCount: theirItems.size, sharedCount, unionCount,
        similarity: unionCount ? sharedCount / unionCount : 0,
        baseWeight: kindWeights[kind] * rangeWeights[range]
      });
    }
    const itemsById = new Map(yours[kind].map((item) => [item.spotifyId, item]));
    for (const id of yourIds) {
      if (!theirIds.has(id)) continue;
      const item = itemsById.get(id)!;
      const windows = timeRanges.flatMap((timeRange) => {
        const yourItem = yourIndex[timeRange].get(id);
        const theirItem = theirIndex[timeRange].get(id);
        return yourItem && theirItem ? [{ timeRange, yourRank: yourItem.rank, theirRank: theirItem.rank }] : [];
      });
      evidence[kind].push({ spotifyId: id, name: item.name, imageUrl: item.imageUrl, windows });
    }
    evidence[kind].sort((a, b) =>
      b.windows.reduce((sum, window) => sum + rangeWeights[window.timeRange], 0) -
        a.windows.reduce((sum, window) => sum + rangeWeights[window.timeRange], 0) ||
      a.name.localeCompare(b.name) || a.spotifyId.localeCompare(b.spotifyId));
  }
  // Only jointly empty signals are omitted. A one-sided list still counts as zero overlap.
  const totalWeight = signals.filter((signal) => signal.unionCount > 0)
    .reduce((sum, signal) => sum + signal.baseWeight, 0);
  const breakdown = signals.map((signal) => ({
    ...signal,
    maxPoints: totalWeight && signal.unionCount ? signal.baseWeight / totalWeight * 100 : 0,
    contribution: totalWeight && signal.unionCount ? signal.similarity * signal.baseWeight / totalWeight * 100 : 0
  }));
  const hasYourData = counts.yourArtists + counts.yourTracks > 0;
  const hasTheirData = counts.theirArtists + counts.theirTracks > 0;
  const rawScore = breakdown.reduce((sum, signal) => sum + signal.contribution, 0);
  const limitedData = Math.min(counts.yourArtists + counts.yourTracks, counts.theirArtists + counts.theirTracks) < 10 ||
    breakdown.some((signal) => signal.yourCount === 0 || signal.theirCount === 0);
  return {
    score: Math.round(Math.min(100, Math.max(0, rawScore)) * 10) / 10,
    rawScore,
    explanation: {
      version: 'jaccard-v2' as const,
      status: hasYourData && hasTheirData ? 'ready' as const : 'insufficient_data' as const,
      limitedData, counts, signals: breakdown,
      sharedArtists: evidence.artists, sharedTracks: evidence.tracks
    }
  };
}
