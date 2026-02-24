import { Router } from "express";
import {
  loginController,
  meController,
  registerController,
  socialLoginController,
} from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/auth.middleware";

const router = Router();

router.post("/register", registerController);
router.post("/login", loginController);
router.post("/social-login", socialLoginController);
router.get("/me", requireAuth, meController);

export default router;
