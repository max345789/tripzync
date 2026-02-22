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
  tokenType: "Bearer";
  expiresIn: string;
  user: AuthUserDTO;
};
