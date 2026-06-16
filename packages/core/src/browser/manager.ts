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
import { DEFAULT_CHROME_BINARY, DEFAULT_USER_DATA_DIR } from "./profile";

// ---------------------------------------------------------------------------
// Stealth: patch navigator.webdriver
// ---------------------------------------------------------------------------
// Playwright unconditionally sets navigator.webdriver = true, which is one of
// the most reliable signals Google uses to detect automation.  This init script
// redefines the getter so it returns undefined — indistinguishable from a real
// Chrome instance from the page's perspective.
//
// The script runs before every navigation on every new page, so it is safe
// even when the user navigates cross-origin or reloads.

const STEALTH_INIT_SCRIPT = `
Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
});
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserManagerDeps {
    /** Path to the Chrome binary on macOS. */
    chromeBinary?: string;
    /** Chrome user-data-dir (profile directory). */
    userDataDir?: string;
    /** Set to `true` to run Chrome in headless mode (CI / no-display environments). */
    headless?: boolean;
}

export type BrowserManager = {
    /** Start Chrome and return the persistent context. Safe to call twice. */
    start: () => Promise<BrowserContext>;
    /** Get (or create) a page within the browser context. */
    newPage: () => Promise<Page>;
    /** Navigate to a URL and wait for DOM content to be ready. */
    goto: (url: string, timeoutMs?: number) => Promise<void>;
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

const DEFAULT_LAUNCH_ARGS = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-popup-blocking",
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBrowserManager(
    deps: BrowserManagerDeps = {},
): BrowserManager {
    const chromeBinary = deps.chromeBinary ?? DEFAULT_CHROME_BINARY;
    const userDataDir = deps.userDataDir ?? DEFAULT_USER_DATA_DIR;
    const headless = deps.headless ?? false;

    let context: BrowserContext | null = null;

    // `newPage` is captured in a closure so that `goto` and any other
    // method that needs a page never depends on `this` — callers may safely
    // destructure individual methods out of this object without breaking.
    async function getPage(): Promise<Page> {
        if (!context) throw new Error("BrowserManager: call start() first");
        const pages = context.pages() ?? [];
        return pages.length > 0 ? pages[0] : context.newPage();
    }

    return {
        async start(): Promise<BrowserContext> {
            if (context) return context;

            context = await chromium.launchPersistentContext(userDataDir, {
                channel: "chrome",
                headless,
                executablePath: chromeBinary,
                viewport: { width: 1280, height: 720 },
                args: DEFAULT_LAUNCH_ARGS,
            });

            // Patch navigator.webdriver on every new page before it navigates.
            context.on("page", (page: Page) => {
                void page.addInitScript(STEALTH_INIT_SCRIPT).catch(() => {});
            });

            // Also patch any pages that already exist (e.g. a blank startup tab).
            for (const existingPage of context.pages()) {
                void existingPage
                    .addInitScript(STEALTH_INIT_SCRIPT)
                    .catch(() => {});
            }

            return context;
        },

        async newPage(): Promise<Page> {
            return getPage();
        },

        async goto(url: string, timeoutMs = 15_000): Promise<void> {
            const page = await getPage();
            await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: timeoutMs,
            });
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
