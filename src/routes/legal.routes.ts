import { Router } from "express";
import {
  accountDeletionHtml,
  indexPageHtml,
  privacyPolicyHtml,
  termsOfUseHtml,
} from "../content/legal-content";

const router = Router();

router.get("/", (_req, res) => {
  res.type("html").status(200).send(indexPageHtml);
});

router.get("/privacy-policy", (_req, res) => {
  res.type("html").status(200).send(privacyPolicyHtml);
});

router.get("/terms-of-use", (_req, res) => {
  res.type("html").status(200).send(termsOfUseHtml);
});

router.get("/account-deletion", (_req, res) => {
  res.type("html").status(200).send(accountDeletionHtml);
});

export default router;
