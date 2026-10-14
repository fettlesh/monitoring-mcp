/**
 * Execute a tool call as a real HTTP request against the public API.
 *
 * The central decision of S2, held identically in both channels: an MCP tool
 * call is a transport adapter, not a second implementation of the API. This
 * module maps a `ToolEntry` plus the model's arguments onto an ordinary
 * `/v1/...` request carrying the user's key as a Bearer token. Authentication,
 * the `x-fettle-public-api` scope marker, the per-organization rate bucket,
 * pydantic validation and pagination all execute in core, unchanged, because
 * it is a real request hitting the real route.
 *
 * Where core's executor dispatches in-process through `httpx.ASGITransport`,
 * this one goes over the network with `fetch` — but the argument-routing rules
 * and the success/failure boundary are deliberately the same, so a tool
 * behaves identically whichever channel a user picked.
 */

import type { ToolEntry } from "./contract.js";
import { describeFailure, describeTransportFailure } from "./errors.js";

/**
 * The MCP `tools/call` result shape.
 *
 * The index signature is what MCP's own result type requires — the protocol
 * lets a result carry `_meta` and forward-compatible extras alongside the
 * fields this package sets.
 */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
  [key: string]: unknown;
}

/**
 * An argument the model can fix: missing, wrongly typed, or aimed at a
 * parameter this tool does not declare. Surfaces as an error *tool result*, so
 * the model reads the explanation and retries.
 */
export class ToolArgumentError extends Error {}

/**
 * A failure the model cannot fix by retrying with different arguments — the
 * API answered 5xx, or the request never got there. Surfaces as a JSON-RPC
 * error, the same choice core makes for a 5xx.
 */
export class ToolProtocolError extends Error {}

/**
 * Status codes at or above this boundary are protocol-level failures (the API
 * itself is broken), not something the calling model can act on.
 */
const SERVER_ERROR_THRESHOLD = 500;

export interface ExecutorOptions {
  apiUrl: string;
  apiKey: string;
  timeoutMs: number;
  userAgent: string;
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

function substitutePathParams(tool: ToolEntry, args: Record<string, unknown>): string {
  let path = tool.operation.path;
  for (const name of tool.operation.path_params) {
    if (!(name in args)) {
      throw new ToolArgumentError(`Tool '${tool.name}' requires argument '${name}'.`);
    }
    const raw = args[name];
    delete args[name];
    // A boolean is not a sane identifier even though JavaScript would happily
    // stringify it — reject it explicitly rather than send "true" as an id.
    if (
      typeof raw === "boolean" ||
      (typeof raw !== "string" && typeof raw !== "number")
    ) {
      throw new ToolArgumentError(
        `Tool '${tool.name}' argument '${name}' must be a string or number; ` +
          `got ${raw === null ? "null" : typeof raw}.`,
      );
    }
    const value = String(raw);
    // An empty value changes which route answers exactly the way a stray '/'
    // does: DELETE /v1/monitors/ is not the route DELETE
    // /v1/monitors/{monitor_id}, and the redirect it earns would be reported
    // as something other than the delete the model asked for.
    if (value === "") {
      throw new ToolArgumentError(
        `Tool '${tool.name}' argument '${name}' must not be empty.`,
      );
    }
    // A raw '/' or '?' would add a path segment or open a query string of its
    // own. Percent-encoding is applied below anyway, but a value containing
    // either is refused outright rather than quietly retargeted at a
    // different route — the same rule core's executor enforces.
    if (value.includes("/") || value.includes("?")) {
      throw new ToolArgumentError(
        `Tool '${tool.name}' argument '${name}' may not contain '/' or '?'.`,
      );
    }
    path = path.replace(`{${name}}`, encodeURIComponent(value));
  }
  return path;
}

function buildQuery(tool: ToolEntry, args: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const name of tool.operation.query) {
    if (!(name in args)) {
      continue;
    }
    const value = args[name];
    delete args[name];
    if (value === undefined || value === null) {
      continue;
    }
    // Arrays become repeated parameters (`regions=eu&regions=us`), which is
    // how FastAPI reads a list query parameter — a single comma-joined value
    // would arrive as one malformed member.
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(name, typeof item === "boolean" ? String(item) : String(item));
      }
      continue;
    }
    params.append(name, String(value));
  }
  // Pinned parameters go last and with `set`, so they replace anything of the
  // same name: the contract pins them precisely so the model cannot choose a
  // different value (core gives agents the compact monitor list this way).
  for (const [name, value] of Object.entries(tool.operation.fixed_query)) {
    params.set(name, value);
  }
  return params;
}

async function readBody(response: Response): Promise<unknown | undefined> {
  const text = await response.text();
  if (text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Not JSON at all — a proxy's HTML error page, say. Returning the raw text
    // is more useful to the reader than pretending there was no body.
    return text;
  }
}

/** Dispatches `tools/call` invocations as requests against the public API. */
export class ToolExecutor {
  private readonly options: ExecutorOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ExecutorOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Execute one tool call and return an MCP `tools/call` result.
   *
   * Flow:
   * 1. Substitute the operation's declared path parameters into the URL
   *    template, percent-encoding each value so it cannot introduce extra path
   *    segments or a query string of its own.
   * 2. Route the declared query parameters into the query string, then the
   *    operation's pinned `fixed_query` pairs, which override any same name.
   * 3. Route whatever arguments remain into the JSON body when the operation
   *    declares one; otherwise an argument that matched no declared parameter
   *    is rejected rather than silently dropped.
   * 4. Dispatch the request with the user's key as a Bearer token, following
   *    no redirects: a 3xx is reported, never chased, so the credential cannot
   *    be replayed to a host the contract did not name.
   * 5. Map the response — 2xx is a result, any other non-5xx is an actionable
   *    tool error, 5xx and transport failures raise.
   *
   * Throws:
   *   ToolArgumentError: an argument is missing, wrongly typed, or matched no
   *   declared parameter on a tool with no request body.
   *   ToolProtocolError: the API answered 5xx, or the request never completed.
   */
  async execute(tool: ToolEntry, args: Record<string, unknown>): Promise<ToolResult> {
    const remaining = { ...args };
    const path = substitutePathParams(tool, remaining);
    const query = buildQuery(tool, remaining);

    let body: string | undefined;
    if (tool.operation.body) {
      body = JSON.stringify(remaining);
    } else if (Object.keys(remaining).length > 0) {
      const unexpected = Object.keys(remaining).sort().join(", ");
      throw new ToolArgumentError(
        `Tool '${tool.name}' does not accept argument(s): ${unexpected}.`,
      );
    }

    const url = `${this.options.apiUrl}${path}${query.size > 0 ? `?${query}` : ""}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      Accept: "application/json",
      "User-Agent": this.options.userAgent,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: tool.operation.method,
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: "manual",
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (cause) {
      if (cause instanceof Error && cause.name === "TimeoutError") {
        throw new ToolProtocolError(
          `Tool '${tool.name}' timed out after ${this.options.timeoutMs}ms ` +
            `waiting for ${this.options.apiUrl}. Retry, or raise ` +
            "FETTLE_TIMEOUT_MS if this endpoint is legitimately slow.",
        );
      }
      throw new ToolProtocolError(describeTransportFailure(this.options.apiUrl, cause));
    }

    if (response.status >= SERVER_ERROR_THRESHOLD) {
      throw new ToolProtocolError(
        `Tool '${tool.name}' failed: the API returned ${response.status}.`,
      );
    }

    const payload = await readBody(response);

    if (response.status < 200 || response.status >= 300) {
      const errorBody =
        typeof payload === "object" && payload !== null && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;
      return {
        content: [
          {
            type: "text",
            text: describeFailure(response.status, errorBody, response.headers),
          },
        ],
        isError: true,
      };
    }

    const text =
      payload === undefined
        ? `${tool.name} succeeded (${response.status}); the response had no body.`
        : JSON.stringify(payload);
    return { content: [{ type: "text", text }], isError: false };
  }
}
