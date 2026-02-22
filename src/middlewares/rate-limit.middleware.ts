import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/app-error";

type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  code?: string;
  message?: string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export function createRateLimitMiddleware(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  const { windowMs, maxRequests } = options;
  const code = options.code ?? "RATE_LIMITED";
  const message = options.message ?? "Too many requests. Please retry later.";

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const existing = buckets.get(key);

    const bucket: Bucket =
      !existing || now >= existing.resetAt
        ? { count: 0, resetAt: now + windowMs }
        : existing;

    if (bucket.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", retryAfterSeconds.toString());
      res.setHeader("X-RateLimit-Limit", maxRequests.toString());
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("X-RateLimit-Reset", bucket.resetAt.toString());

      next(
        new AppError(429, code, message, {
          limit: maxRequests,
          windowMs,
          retryAfterSeconds,
        })
      );
      return;
    }

    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, maxRequests - bucket.count);
    res.setHeader("X-RateLimit-Limit", maxRequests.toString());
    res.setHeader("X-RateLimit-Remaining", remaining.toString());
    res.setHeader("X-RateLimit-Reset", bucket.resetAt.toString());

    if (buckets.size > 5000) {
      for (const [bucketKey, value] of buckets.entries()) {
        if (now >= value.resetAt) {
          buckets.delete(bucketKey);
        }
      }
    }

    next();
  };
}
