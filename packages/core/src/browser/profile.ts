/**
 * Chrome profile + binary resolution (macOS and Linux only — Windows is not
 * supported).
 *
 * Playwright's `chromium.launchPersistentContext(path)` expects a *profile
 * directory* (i.e. a directory that already contains Chrome profile data such
 * as cookies, history, and logins), not the Chrome data root.
 *
 * Resolution is layered so the library works out of the box while still being
 * fully overridable:
 *
 *   explicit argument  >  environment variable  >  computed per-OS default
 *
 * The Chrome *binary* is normally discovered by Playwright's `channel: "chrome"`
 * mechanism, which knows the standard install locations on every supported OS.
 * We therefore only ever pass an `executablePath` when one is explicitly
 * provided (e.g. for Chromium / Brave / a custom build).
 */

import os from "node:os";
import path from "node:path";

/** Env var that overrides the Chrome profile (user-data) directory. */
export const ENV_PROFILE = "SWEB_SEARCH_PROFILE";
/** Env var that overrides the Chrome binary path. */
export const ENV_CHROME_BINARY = "SWEB_SEARCH_CHROME_BINARY";

/**
 * The default Chrome profile directory for the current OS.
 *
 * @throws Error on unsupported platforms (e.g. Windows). Pass an explicit
 *         `userDataDir` or set `SWEB_SEARCH_PROFILE` to use the tool anyway.
 */
export function defaultUserDataDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(
        home,
        "Library/Application Support/Google/Chrome/Default",
      );
    case "linux":
      return path.join(home, ".config/google-chrome/Default");
    default:
      throw new Error(
        `Unsupported platform "${process.platform}" — this tool supports macOS and Linux only. ` +
          `Set the ${ENV_PROFILE} env var or pass { userDataDir } to override.`,
      );
  }
}

/**
 * Resolve the profile directory: explicit argument, then env var, then the
 * per-OS default.
 */
export function resolveUserDataDir(explicit?: string): string {
  return explicit ?? process.env[ENV_PROFILE] ?? defaultUserDataDir();
}

/**
 * Resolve the Chrome binary path. Returns `undefined` when nothing is set, in
 * which case Playwright's `channel: "chrome"` discovery is used instead of an
 * explicit `executablePath`.
 */
export function resolveChromeBinary(explicit?: string): string | undefined {
  return explicit ?? process.env[ENV_CHROME_BINARY];
}
