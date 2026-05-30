const apiUrl = import.meta.env.VITE_API_URL || '';

export type ProfileResponse = {
  user: {
    id: string;
    email: string;
    displayName: string;
    spotifyUserId: string;
    spotifyProfileImage: string | null;
    spotifyConnected: boolean;
    bio: string | null;
    favoriteArtistNote: string | null;
    musicPrompt: string | null;
    createdAt: string;
    updatedAt: string;
    favoriteGenres: {
      id: string;
      slug: string;
      label: string;
      rank: number;
    }[];
    favoriteArtists: {
      id: string;
      spotifyId: string;
      name: string;
      imageUrl: string | null;
      genres: string[];
      rank: number;
    }[];
    favoriteTracks: {
      id: string;
      spotifyId: string;
      name: string;
      artistName: string;
      albumName: string | null;
      albumArt: string | null;
      previewUrl: string | null;
      rank: number;
    }[];
  };
};

export type MatchesResponse = {
  matches: {
    userId: string;
    displayName: string;
    spotifyUserId: string;
    spotifyProfileImage: string | null;
    score: number;
    sharedArtists: number;
    sharedTracks: number;
    sharedArtistNames: string[];
    sharedTrackNames: string[];
  }[];
};

export function getApiUrl() {
  return apiUrl;
}

export async function fetchProfile(token: string) {
  const response = await fetch(`${apiUrl}/api/me`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Failed to load profile.');
  }

  return response.json() as Promise<ProfileResponse>;
}

export async function fetchMatches(token: string) {
  const response = await fetch(`${apiUrl}/api/matches`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Failed to load matches.');
  }

  return response.json() as Promise<MatchesResponse>;
}

export async function updateProfile(
  token: string,
  payload: {
    bio: string;
    favoriteArtistNote: string;
    musicPrompt: string;
  }
) {
  const response = await fetch(`${apiUrl}/api/me`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Failed to save profile.');
  }

  return response.json() as Promise<ProfileResponse>;
}
