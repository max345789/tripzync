export type RegisterRequest = {
  email: string;
  password: string;
  name?: string;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type AuthUserDTO = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: string;
  refreshExpiresIn: string;
  user: AuthUserDTO;
};

export type SocialProvider = "google" | "apple";

export type SocialLoginRequest = {
  provider: SocialProvider;
  idToken: string;
  email?: string;
  name?: string;
};

export type RefreshTokenRequest = {
  refreshToken: string;
};
