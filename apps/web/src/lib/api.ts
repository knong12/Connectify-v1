const apiUrl = import.meta.env.VITE_API_URL || '';

export type ProfileResponse = {
  user: {
    id: string;
    email: string;
    displayName: string;
    spotifyUserId: string;
    spotifyProfileImage: string | null;
    spotifyConnected: boolean;
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
