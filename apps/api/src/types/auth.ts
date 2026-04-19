export type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

export type SpotifyImage = {
  url: string;
};

export type SpotifyProfile = {
  id: string;
  email: string;
  display_name: string;
  images: SpotifyImage[];
};

export type AuthenticatedUser = {
  userId: string;
  email: string;
};

