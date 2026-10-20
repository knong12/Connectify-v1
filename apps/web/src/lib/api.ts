const apiUrl = import.meta.env.VITE_API_URL || '';

export type SpotifyTimeRange = 'short_term' | 'medium_term' | 'long_term';

type FavoriteArtist = {
  id: string;
  spotifyId: string;
  name: string;
  imageUrl: string | null;
  rank: number;
};

type FavoriteTrack = {
  id: string;
  spotifyId: string;
  name: string;
  artistName: string;
  albumName: string | null;
  albumArt: string | null;
  previewUrl: string | null;
  rank: number;
};

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
    followerCount: number;
    followingCount: number;
    followers: {
      id: string;
      displayName: string;
      spotifyUserId: string;
      spotifyProfileImage: string | null;
    }[];
    followingUsers: {
      id: string;
      displayName: string;
      spotifyUserId: string;
      spotifyProfileImage: string | null;
    }[];
    createdAt: string;
    updatedAt: string;
    favoriteArtists: FavoriteArtist[];
    favoriteTracks: FavoriteTrack[];
    favoriteArtistsByRange: Record<SpotifyTimeRange, FavoriteArtist[]>;
    favoriteTracksByRange: Record<SpotifyTimeRange, FavoriteTrack[]>;
  };
};

export type MatchesResponse = {
  matches: {
    userId: string;
    displayName: string;
    spotifyUserId: string;
    spotifyProfileImage: string | null;
    bio: string | null;
    favoriteArtistNote: string | null;
    isFollowing: boolean;
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

export async function fetchUserProfile(token: string, userId: string) {
  const response = await fetch(`${apiUrl}/api/users/${userId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Failed to load user profile.');
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

export async function followUser(token: string, targetUserId: string) {
  const response = await fetch(`${apiUrl}/api/follows/${targetUserId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Failed to follow user.');
  }
}

export async function unfollowUser(token: string, targetUserId: string) {
  const response = await fetch(`${apiUrl}/api/follows/${targetUserId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Failed to unfollow user.');
  }
}
