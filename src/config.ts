/**
 * Runtime configuration, read once at startup from the environment.
 *
 * An MCP server is spawned by its client with an env block from a JSON config
 * file the user hand-edits, so a missing or malformed value is the single most
 * likely failure of this package — and the worst place to discover it is
 * inside the first tool call, where the model reports it to the user as if the
 * *monitor* were the problem. Everything here therefore fails at startup, on
 * stderr, naming the variable and the file to fix.
 */

/** Where the public API lives when `FETTLE_API_URL` is not set. */
export const DEFAULT_API_URL = "https://api.fettle.sh";

/**
 * How long one tool call may take before it is abandoned.
 *
 * A hung request is worse here than a slow one: the MCP client has no timeout
 * of its own for a stdio server, so an unbounded `fetch` presents to the user
 * as a permanently frozen assistant. 30s is well past the API's own latency
 * and well short of a human's patience.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface Config {
  apiKey: string;
  apiUrl: string;
  timeoutMs: number;
}

export class ConfigError extends Error {}

function readApiUrl(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_API_URL;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ConfigError(
      `FETTLE_API_URL is not a valid URL: ${raw}. Leave it unset to use ` +
        `${DEFAULT_API_URL}.`,
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ConfigError(
      `FETTLE_API_URL must be an http(s) URL; got ${parsed.protocol}//. Leave ` +
        `it unset to use ${DEFAULT_API_URL}.`,
    );
  }
  // Trailing slashes are stripped because every path in the contract is
  // absolute and already leads with one — concatenating both would produce
  // `//v1/monitors`, which the API answers with a 404 rather than the route
  // the user plainly meant.
  return parsed.toString().replace(/\/+$/, "");
}

function readTimeout(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(
      `FETTLE_TIMEOUT_MS must be a positive whole number of milliseconds; ` +
        `got ${raw}. Leave it unset to use ${DEFAULT_TIMEOUT_MS}.`,
    );
  }
  return parsed;
}

/**
 * Build the configuration or explain what is missing.
 *
 * Throws:
 *   ConfigError: `FETTLE_API_KEY` is absent or blank, `FETTLE_API_URL` is not a
 *   usable http(s) URL, or `FETTLE_TIMEOUT_MS` is not a positive integer.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.FETTLE_API_KEY?.trim();
  if (apiKey === undefined || apiKey === "") {
    throw new ConfigError(
      "FETTLE_API_KEY is not set. Create an API key in Settings → API Keys at " +
        "https://fettle.sh and add it to the fettle-mcp entry of your MCP " +
        'client configuration, e.g. "env": { "FETTLE_API_KEY": "fettle_…" }.',
    );
  }
  return {
    apiKey,
    apiUrl: readApiUrl(env.FETTLE_API_URL),
    timeoutMs: readTimeout(env.FETTLE_TIMEOUT_MS),
  };
}
