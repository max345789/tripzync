import { User } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { createRemoteJWKSet, JWTPayload, jwtVerify } from "jose";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import {
  AuthResponse,
  AuthUserDTO,
  LoginRequest,
  RefreshTokenRequest,
  RegisterRequest,
  SocialLoginRequest,
} from "../types/auth";
import { AppError } from "../utils/app-error";

const SALT_ROUNDS = 12;
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

type VerifiedSocialIdentity = {
  subject: string;
  email?: string;
  name?: string;
};

function mapUser(user: User): AuthUserDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function signAccessToken(user: Pick<User, "id" | "email">): string {
  return jwt.sign({ email: user.email }, env.jwtSecret, {
    subject: user.id,
    expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  } as jwt.SignOptions);
}

function signRefreshToken(user: Pick<User, "id" | "email">): string {
  return jwt.sign({ email: user.email, type: "refresh" }, env.jwtRefreshSecret, {
    subject: user.id,
    expiresIn: env.jwtRefreshExpiresIn as jwt.SignOptions["expiresIn"],
  } as jwt.SignOptions);
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function extractExpiry(token: string, secret: string): Date {
  const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
  if (!decoded.exp) {
    throw new AppError(500, "INTERNAL_ERROR", "Token expiry is missing.");
  }
  return new Date(decoded.exp * 1000);
}

async function buildAuthResponse(user: User): Promise<AuthResponse> {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const refreshTokenExpiresAt = extractExpiry(refreshToken, env.jwtRefreshSecret);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      refreshTokenHash,
      refreshTokenExpiresAt,
    },
  });

  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: env.jwtExpiresIn,
    refreshExpiresIn: env.jwtRefreshExpiresIn,
    user: mapUser(user),
  };
}

function claimString(payload: JWTPayload, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeSubject(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_")
    .slice(0, 80);
}

async function verifyGoogleToken(idToken: string): Promise<VerifiedSocialIdentity> {
  try {
    const options: Parameters<typeof jwtVerify>[2] = {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
    };

    if (env.googleClientId) {
      options.audience = env.googleClientId;
    }

    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, options);
    const subject = claimString(payload, "sub");

    if (!subject) {
      throw new AppError(401, "INVALID_TOKEN", "Google token subject is missing.");
    }

    const email = claimString(payload, "email")?.toLowerCase();
    const emailVerified = payload.email_verified;
    if (email && emailVerified === false) {
      throw new AppError(401, "INVALID_TOKEN", "Google email is not verified.");
    }

    return {
      subject,
      email,
      name: claimString(payload, "name"),
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(401, "INVALID_TOKEN", "Unable to verify Google identity token.");
  }
}

async function verifyAppleToken(idToken: string): Promise<VerifiedSocialIdentity> {
  try {
    const options: Parameters<typeof jwtVerify>[2] = {
      issuer: "https://appleid.apple.com",
    };

    if (env.appleClientId) {
      options.audience = env.appleClientId;
    }

    const { payload } = await jwtVerify(idToken, APPLE_JWKS, options);
    const subject = claimString(payload, "sub");

    if (!subject) {
      throw new AppError(401, "INVALID_TOKEN", "Apple token subject is missing.");
    }

    return {
      subject,
      email: claimString(payload, "email")?.toLowerCase(),
      name: claimString(payload, "name"),
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(401, "INVALID_TOKEN", "Unable to verify Apple identity token.");
  }
}

class AuthService {
  async register(input: RegisterRequest): Promise<AuthResponse> {
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    if (existing) {
      throw new AppError(409, "CONFLICT", "An account with this email already exists.");
    }

    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        name: input.name,
      },
    });

    return buildAuthResponse(user);
  }

  async login(input: LoginRequest): Promise<AuthResponse> {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (!user || !user.passwordHash) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const passwordValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordValid) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    }

    return buildAuthResponse(user);
  }

  async me(userId: string): Promise<AuthUserDTO> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Account not found.");
    }

    return mapUser(user);
  }

  async socialLogin(input: SocialLoginRequest): Promise<AuthResponse> {
    if (!env.socialAuthEnabled) {
      throw new AppError(503, "SOCIAL_AUTH_DISABLED", "Social sign-in is disabled.");
    }

    const identity =
      input.provider === "google"
        ? await verifyGoogleToken(input.idToken)
        : await verifyAppleToken(input.idToken);

    const socialProvider = input.provider;
    const socialSubject = identity.subject;
    const aliasEmail = `${socialProvider}-${sanitizeSubject(socialSubject)}@social.tripzync.local`;
    const requestedEmail = input.email?.toLowerCase() ?? identity.email;
    const name = input.name ?? identity.name;

    let user = await prisma.user.findUnique({
      where: {
        socialProvider_socialSubject: {
          socialProvider,
          socialSubject,
        },
      },
    });

    if (!user && requestedEmail) {
      user = await prisma.user.findUnique({
        where: { email: requestedEmail },
      });
    }

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: requestedEmail ?? aliasEmail,
          name: name ?? null,
          passwordHash: "",
          socialProvider,
          socialSubject,
        },
      });

      return buildAuthResponse(user);
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        socialProvider,
        socialSubject,
        name: name ?? user.name,
      },
    });

    return buildAuthResponse(updatedUser);
  }

  async refresh(input: RefreshTokenRequest): Promise<AuthResponse> {
    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(input.refreshToken, env.jwtRefreshSecret) as jwt.JwtPayload;
    } catch {
      throw new AppError(401, "UNAUTHORIZED", "Invalid or expired refresh token.");
    }

    const userId = typeof decoded.sub === "string" ? decoded.sub : "";
    if (!userId) {
      throw new AppError(401, "UNAUTHORIZED", "Invalid refresh token.");
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Account not found.");
    }

    if (!user.refreshTokenHash || !user.refreshTokenExpiresAt) {
      throw new AppError(401, "UNAUTHORIZED", "Refresh session not found.");
    }

    if (user.refreshTokenExpiresAt.getTime() <= Date.now()) {
      throw new AppError(401, "UNAUTHORIZED", "Refresh token expired.");
    }

    const providedHash = hashRefreshToken(input.refreshToken);
    if (providedHash !== user.refreshTokenHash) {
      throw new AppError(401, "UNAUTHORIZED", "Refresh token is invalid.");
    }

    return buildAuthResponse(user);
  }

  async logout(userId: string): Promise<void> {
    await prisma.user.updateMany({
      where: { id: userId },
      data: {
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
    });
  }
}

export const authService = new AuthService();
