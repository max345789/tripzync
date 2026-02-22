import { env } from "../config/env";

const includeDebug = env.nodeEnv !== "production";

export const logger = {
  debug: (...args: unknown[]): void => {
    if (includeDebug) {
      console.debug("[DEBUG]", ...args);
    }
  },
  info: (...args: unknown[]): void => {
    console.info("[INFO]", ...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn("[WARN]", ...args);
  },
  error: (...args: unknown[]): void => {
    console.error("[ERROR]", ...args);
  },
};
