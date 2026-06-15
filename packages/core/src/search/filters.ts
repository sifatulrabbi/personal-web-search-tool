/**
 * Google search query parser.
 *
 * Parses raw query strings that may contain Google search operators into a
 * structured `ParsedQuery` object, then reassembles them into a clean query
 * string for use in the search URL.
 *
 * Supported operators:
 *   site:       — restrict to a domain
 *   filetype:   — restrict to a file extension
 *   inurl:      — keyword must appear in the URL
 *   intitle:    — keyword must appear in the page title
 *   "phrase"    — exact phrase match (handled by the caller's input)
 *   -term       — exclude a term
 *   after:YYYY-MM-DD — date range lower bound
 *   before:YYYY-MM-DD — date range upper bound
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedQuery {
    /** The core search terms (everything that is not a recognized operator). */
    query: string;
    /** `site:` value — e.g. "github.com" */
    site?: string;
    /** `filetype:` value — e.g. "pdf" */
    filetype?: string;
    /** `inurl:` value — e.g. "download" */
    inurl?: string;
    /** `intitle:` value — e.g. "rust tutorial" */
    intitle?: string;
    /** `"exact phrase"` value */
    exactPhrase?: string;
    /** `-excluded` terms */
    excludeTerms: string[];
    /** `after:YYYY-MM-DD` */
    afterDate?: string;
    /** `before:YYYY-MM-DD` */
    beforeDate?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPERATORS = [
    "site:",
    "filetype:",
    "inurl:",
    "intitle:",
    "after:",
    "before:",
] as const;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns `true` when `value` matches `YYYY-MM-DD` and is an actual calendar
 * date (rejects `2024-02-30`, `2024-13-01`, etc.).
 */
function isValidDate(value: string): boolean {
    if (!DATE_REGEX.test(value)) return false;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return false;
    // Date.parse normalises overflow dates (e.g. 2024-02-30 → 2024-03-01).
    // Confirm the parsed components round-trip to the original string.
    const d = new Date(parsed);
    return (
        d.getUTCFullYear() === Number(value.slice(0, 4)) &&
        d.getUTCMonth() === Number(value.slice(5, 7)) - 1 &&
        d.getUTCDate() === Number(value.slice(8, 10))
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split a query string into tokens, keeping quoted phrases intact.
 *
 * @example
 *   splitTokens(`bun runtime "javascript tools" -outdated`)
 *   // => ["bun", "runtime", "\"javascript tools\"", "-outdated"]
 */
function splitTokens(input: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];

        // Escape character — skip the next character verbatim (handles \" inside
        // quoted phrases so quotes inside quotes do not terminate the phrase).
        if (ch === "\\" && i + 1 < input.length) {
            current += input[i + 1];
            i++; // consume the escaped character
            continue;
        }

        if (ch === '"') {
            inQuotes = !inQuotes;
            current += ch;
        } else if (ch === " " && !inQuotes) {
            if (current.trim().length > 0) {
                tokens.push(current.trim());
                current = "";
            }
        } else {
            current += ch;
        }
    }

    if (current.trim().length > 0) {
        tokens.push(current.trim());
    }

    return tokens;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a raw Google search string into a structured `ParsedQuery`.
 *
 * Operands that are not recognized operators are collected into the `query`
 * field, joined back with spaces.
 */
export function parseFilters(input: string): ParsedQuery {
    const result: ParsedQuery = {
        query: "",
        excludeTerms: [],
    };

    const tokens = splitTokens(input);

    for (const token of tokens) {
        const lower = token.toLowerCase();

        // Quoted phrase — extract as exactPhrase, do not add to query.
        // `lower` is used only for the shape check (starts/ends with `"`);
        // the original `token` is stored so that user-chosen capitalisation
        // in exact phrases is preserved.
        if (lower.startsWith('"') && lower.endsWith('"') && lower.length > 2) {
            result.exactPhrase = token.slice(1, -1);
            continue;
        }

        // Exclusion term — preserves original casing for consistency with
        // the core `query` field.
        if (lower.startsWith("-") && lower.length > 1) {
            result.excludeTerms.push(token.slice(1));
            continue;
        }

        // Known prefix operators — skip if value is empty (e.g. bare `site:`)
        const matched = OPERATORS.find((op) => lower.startsWith(op));
        if (matched) {
            const value = token.slice(matched.length).trim();

            // Ignore operator tokens that have no value attached
            if (value.length === 0) continue;

            switch (matched) {
                case "site:":
                    result.site = value;
                    break;
                case "filetype:":
                    result.filetype = value;
                    break;
                case "inurl:":
                    result.inurl = value;
                    break;
                case "intitle:":
                    result.intitle = value;
                    break;
                case "after:":
                    if (isValidDate(value)) result.afterDate = value;
                    break;
                case "before:":
                    if (isValidDate(value)) result.beforeDate = value;
                    break;
            }
            continue;
        }

        // Regular search term
        if (result.query.length > 0) result.query += " ";
        result.query += token;
    }

    result.query = result.query.trim();
    return result;
}

/**
 * Rebuild the `q=` parameter value from a `ParsedQuery`.
 *
 * Preserves operator ordering so Google can parse it correctly.
 */
export function buildQueryString(parsed: ParsedQuery): string {
    const parts: string[] = [];

    if (parsed.query) parts.push(parsed.query);
    if (parsed.exactPhrase) parts.push(`"${parsed.exactPhrase}"`);
    if (parsed.excludeTerms.length > 0) {
        for (const t of parsed.excludeTerms) parts.push(`-${t}`);
    }
    if (parsed.site) parts.push(`site:${parsed.site}`);
    if (parsed.filetype) parts.push(`filetype:${parsed.filetype}`);
    if (parsed.inurl) parts.push(`inurl:${parsed.inurl}`);
    if (parsed.intitle) parts.push(`intitle:${parsed.intitle}`);
    if (parsed.afterDate) parts.push(`after:${parsed.afterDate}`);
    if (parsed.beforeDate) parts.push(`before:${parsed.beforeDate}`);

    return parts.join(" ");
}
