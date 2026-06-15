/**
 * macOS Chrome path constants.
 *
 * Playwright's `chromium.launchPersistentContext(path)` expects a *profile
 * directory* (i.e. a directory that already contains Chrome profile data such
 * as cookies, history, and logins), not the Chrome data root.
 *
 * The default profile for a fresh macOS Chrome install lives at
 * `~/Library/Application Support/Google/Chrome/Default`.
 *
 * Override by passing a custom `userDataDir` to `createBrowserManager()`.
 */

const DEFAULT_CHROME_BINARY =
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** Default profile subdirectory inside the Chrome data root. */
const DEFAULT_USER_DATA_DIR =
    "/Users/sifatul/Library/Application Support/Google/Chrome/Default";

export { DEFAULT_CHROME_BINARY, DEFAULT_USER_DATA_DIR };
