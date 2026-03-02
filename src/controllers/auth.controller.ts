import { Request, Response } from "express";
import { authService } from "../services/auth.service";
import { asyncHandler } from "../utils/async-handler";
import { sendSuccess } from "../utils/api-response";
import { AppError } from "../utils/app-error";
import {
  validateLoginRequest,
  validateRefreshTokenRequest,
  validateRegisterRequest,
  validateSocialLoginRequest,
} from "../validators/auth.validator";

function authUserId(req: Request): string {
  if (!req.auth?.userId) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required.");
  }

  return req.auth.userId;
}

export const registerController = asyncHandler(async (req: Request, res: Response) => {
  const payload = validateRegisterRequest(req.body);
  const result = await authService.register(payload);

  return sendSuccess(res, result, 201);
});

export const loginController = asyncHandler(async (req: Request, res: Response) => {
  const payload = validateLoginRequest(req.body);
  const result = await authService.login(payload);

  return sendSuccess(res, result);
});

export const meController = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.me(authUserId(req));

  return sendSuccess(res, user);
});

export const socialLoginController = asyncHandler(async (req: Request, res: Response) => {
  const payload = validateSocialLoginRequest(req.body);
  const result = await authService.socialLogin(payload);

  return sendSuccess(res, result);
});

export const refreshController = asyncHandler(async (req: Request, res: Response) => {
  const payload = validateRefreshTokenRequest(req.body);
  const result = await authService.refresh(payload);

  return sendSuccess(res, result);
});

export const logoutController = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(authUserId(req));

  return sendSuccess(res, { loggedOut: true });
});
