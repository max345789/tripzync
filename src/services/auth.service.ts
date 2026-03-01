import { User } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import {
  AuthResponse,
  AuthUserDTO,
  LoginRequest,
  RegisterRequest,
  SocialLoginRequest,
  SocialProvider,
} from "../types/auth";
import { AppError } from "../utils/app-error";
import admin from "firebase-admin";
import { logger } from "../utils/logger";

const SALT_ROUNDS = 12;

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

function buildAuthResponse(user: User): AuthResponse {
  return {
    accessToken: signAccessToken(user),
    tokenType: "Bearer",
    expiresIn: env.jwtExpiresIn,
    user: mapUser(user),
  };
}

function initFirebase(): void {
  if (admin.apps.length > 0) return;
  try {
    if (env.firebaseServiceAccountJson) {
      const serviceAccount = JSON.parse(env.firebaseServiceAccountJson);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: env.firebaseProjectId ?? serviceAccount.project_id,
      });
      return;
    }

    if (env.firebaseProjectId) {
      admin.initializeApp({ projectId: env.firebaseProjectId });
      return;
    }

    admin.initializeApp();
  } catch (error) {
    logger.error("FIREBASE_INIT_FAILED", error);
    throw new AppError(500, "INTERNAL_ERROR", "Firebase initialization failed.");
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

    if (!user) {
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

  private async verifyFirebaseToken(request: SocialLoginRequest) {
    initFirebase();
    try {
      const decoded = await admin.auth().verifyIdToken(request.idToken);
      return decoded;
    } catch (error) {
      logger.error("FIREBASE_TOKEN_VERIFY_FAILED", error);
      throw new AppError(401, "INVALID_TOKEN", "Unable to verify identity token.");
    }
  }

  private assertProviderConsistency(provider: SocialProvider, decoded: admin.auth.DecodedIdToken) {
    if (provider === "phone" && !decoded.phone_number) {
      throw new AppError(400, "VALIDATION_ERROR", "Phone provider requires phone_number.");
    }
    if (provider !== "phone" && !decoded.email) {
      throw new AppError(400, "VALIDATION_ERROR", "Email is required for this provider.");
    }
  }

  async socialLogin(input: SocialLoginRequest): Promise<AuthResponse> {
    const decoded = await this.verifyFirebaseToken(input);
    this.assertProviderConsistency(input.provider, decoded);

    const email = input.email ?? decoded.email?.toLowerCase();
    const phoneNumber = input.phoneNumber ?? decoded.phone_number;
    const name = input.name ?? decoded.name;

    const uniqueIdentity = email ?? phoneNumber;
    if (!uniqueIdentity) {
      throw new AppError(400, "VALIDATION_ERROR", "Email or phone number required.");
    }

    const derivedEmail = email ?? `phone-${phoneNumber}@autouser.tripzync`;

    const user = await prisma.user.upsert({
      where: { email: derivedEmail },
      update: {
        name: name ?? undefined,
        phone: phoneNumber ?? undefined,
      },
      create: {
        email: derivedEmail,
        name: name ?? null,
        passwordHash: "", // not used for social
        phone: phoneNumber ?? null,
      },
    });

    return buildAuthResponse(user);
  }
}

export const authService = new AuthService();
