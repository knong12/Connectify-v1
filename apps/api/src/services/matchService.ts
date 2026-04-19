export type MatchPreview = {
  userId: string;
  displayName: string;
  score: number;
  sharedArtists: number;
  sharedGenres: number;
};

export function rankMatches(): MatchPreview[] {
  // Placeholder until Spotify sync is wired up. Keeping the contract stable
  // lets us build the UI and API shape before the scoring gets smarter.
  return [];
}

