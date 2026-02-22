import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../utils/app-error";

type AccessTokenPayload = JwtPayload & {
  email?: unknown;
};

function readBearerToken(header: string | undefined): string {
  if (!header) {
    throw new AppError(401, "UNAUTHORIZED", "Authorization header is required.");
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new AppError(401, "UNAUTHORIZED", "Authorization header must be Bearer token.");
  }

  return token.trim();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = readBearerToken(req.headers.authorization);
    const decoded = jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
    const userId = typeof decoded.sub === "string" ? decoded.sub : "";
    const email = typeof decoded.email === "string" ? decoded.email : "";

    if (!userId || !email) {
      throw new AppError(401, "UNAUTHORIZED", "Invalid access token payload.");
    }

    req.auth = { userId, email };
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }

    if (error instanceof jwt.TokenExpiredError || error instanceof jwt.JsonWebTokenError) {
      next(new AppError(401, "UNAUTHORIZED", "Invalid or expired access token."));
      return;
    }

    next(new AppError(401, "UNAUTHORIZED", "Unauthorized."));
  }
}
