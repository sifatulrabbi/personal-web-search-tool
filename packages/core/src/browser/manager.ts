/**
 * Browser lifecycle management.
 *
 * Uses Playwright's `chromium.launchPersistentContext` to start the user's
 * installed Chrome with their real profile.  Only one Chrome instance is
 * ever created per manager instance (no duplicate-profile conflicts).
 *
 * No classes — factory function returning a plain record of methods.
 */

import { chromium, type BrowserContext, type Page } from "playwright-core";
import { resolveUserDataDir, resolveChromeBinary } from "./profile";

// ---------------------------------------------------------------------------
// Stealth: patch navigator.webdriver
// ---------------------------------------------------------------------------
// Playwright unconditionally sets navigator.webdriver = true, which is one of
// the most reliable signals Google uses to detect automation.  This init script
// redefines the getter so it returns undefined — indistinguishable from a real
// Chrome instance from the page's perspective.
//
// Registered on the *context* via addInitScript so it runs before every
// navigation on every page (current and future) — registering per-page after
// the "page" event raced with the first navigation.

const STEALTH_INIT_SCRIPT = `
Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
});
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserManagerDeps {
  /** Path to the Chrome binary. Defaults to Playwright's `channel: "chrome"` discovery. */
  chromeBinary?: string;
  /** Chrome user-data-dir (profile directory). */
  userDataDir?: string;
  /** Set to `true` to run Chrome in headless mode (CI / no-display environments). */
  headless?: boolean;
}

export type BrowserManager = {
  /** Start Chrome and return the persistent context. Safe to call twice. */
  start: () => Promise<BrowserContext>;
  /** Create a fresh page within the browser context. Caller is responsible for closing it. */
  newPage: () => Promise<Page>;
  /** Close the browser context. */
  close: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Default launch arguments for a smooth headful experience
// ---------------------------------------------------------------------------
// --disable-background-timer-throttling and the --disable-backgrounding-*
// flags were removed: they are automation signals that Google's bot-detection
// picks up. When using the user's own Chrome profile via launchPersistentContext
// there is no need to fight Chrome's normal background behaviour — the user's
// cookies, history, and login state are what actually avoid CAPTCHAs.
//
// --no-sandbox is NOT included by default: disabling the sandbox on the user's
// real, logged-in profile is a meaningful security reduction. It is only added
// for headless runs, where the tool is typically used in containers / CI that
// require it.

const DEFAULT_LAUNCH_ARGS = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-popup-blocking",
  "--disable-blink-features=AutomationControlled",
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBrowserManager(
  deps: BrowserManagerDeps = {},
): BrowserManager {
  const userDataDir = resolveUserDataDir(deps.userDataDir);
  const chromeBinary = resolveChromeBinary(deps.chromeBinary);
  const headless = deps.headless ?? false;

  let context: BrowserContext | null = null;

  return {
    async start(): Promise<BrowserContext> {
      if (context) return context;

      context = await chromium.launchPersistentContext(userDataDir, {
        channel: "chrome",
        headless,
        // Only override the binary when explicitly set; otherwise let
        // `channel: "chrome"` resolve the installed Chrome cross-platform.
        ...(chromeBinary ? { executablePath: chromeBinary } : {}),
        viewport: { width: 1280, height: 720 },
        args: headless
          ? [...DEFAULT_LAUNCH_ARGS, "--no-sandbox"]
          : DEFAULT_LAUNCH_ARGS,
      });

      // Patch navigator.webdriver on every page in this context before any
      // navigation. Context-level registration avoids the race that per-page
      // registration had (addInitScript is async; navigation could start first).
      await context.addInitScript(STEALTH_INIT_SCRIPT);

      return context;
    },

    async newPage(): Promise<Page> {
      if (!context) throw new Error("BrowserManager: call start() first");
      return context.newPage();
    },

    async close(): Promise<void> {
      if (context) {
        try {
          await context.close();
        } catch (e) {
          const msg = (e as Error)?.message ?? "";
          // "Target closed" is expected when Chrome has already exited.
          if (!msg.includes("Target closed")) {
            console.error(
              "[google-search-core] error closing browser context:",
              e,
            );
          }
        }
        context = null;
      }
    },
  };
}
