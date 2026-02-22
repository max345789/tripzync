import { User } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { AuthResponse, AuthUserDTO, LoginRequest, RegisterRequest } from "../types/auth";
import { AppError } from "../utils/app-error";

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
}

export const authService = new AuthService();
