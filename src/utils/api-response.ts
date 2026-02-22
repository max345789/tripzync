import { Response } from "express";
import { ApiSuccess } from "../types/api";

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: Record<string, unknown>
): Response<ApiSuccess<T>> {
  const payload: ApiSuccess<T> = meta
    ? { success: true, data, meta }
    : { success: true, data };

  return res.status(statusCode).json(payload);
}
