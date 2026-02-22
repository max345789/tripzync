import { Prisma } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { ApiError } from "../types/api";
import { logger } from "../utils/logger";
import { AppError } from "../utils/app-error";

function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): AppError {
  switch (error.code) {
    case "P2002":
      return new AppError(409, "CONFLICT", "Unique constraint violation.", error.meta);
    case "P2003":
      return new AppError(400, "FOREIGN_KEY_CONSTRAINT", "Invalid relationship reference.", error.meta);
    case "P2025":
      return new AppError(404, "NOT_FOUND", "Requested record was not found.", error.meta);
    case "P6000":
      return new AppError(503, "DATABASE_UNAVAILABLE", "Database is currently unavailable.", error.meta);
    case "P1010":
      return new AppError(500, "INTERNAL_ERROR", "Database access denied.", error.meta);
    default:
      return new AppError(500, "INTERNAL_ERROR", "Database operation failed.", {
        prismaCode: error.code,
        meta: error.meta,
      });
  }
}

export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    appError = mapPrismaError(err);
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    appError = new AppError(400, "VALIDATION_ERROR", "Invalid database query.");
  } else if (err instanceof Prisma.PrismaClientInitializationError) {
    appError = new AppError(503, "DATABASE_UNAVAILABLE", "Failed to initialize database connection.");
  } else if (err instanceof Error) {
    appError = new AppError(
      500,
      "INTERNAL_ERROR",
      env.nodeEnv === "development" ? err.message : "Internal server error."
    );
  } else {
    appError = new AppError(500, "INTERNAL_ERROR", "Unknown error occurred.");
  }

  logger.error(`${req.method} ${req.originalUrl}`, appError.code, appError.message);

  const payload: ApiError = {
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details,
    },
  };

  if (env.nodeEnv === "development" && err instanceof Error) {
    payload.error.stack = err.stack;
  }

  res.status(appError.statusCode).json(payload);
}
