import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/app-error";

export function notFoundMiddleware(req: Request, _res: Response, next: NextFunction): void {
  next(
    new AppError(404, "NOT_FOUND", `Route not found: ${req.method} ${req.originalUrl}`)
  );
}
