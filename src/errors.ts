/**
 * Turn a failed API response into a sentence that says what to fix.
 *
 * The counterpart of core's `src/mcp/executor.py::describe_failure`, and
 * deliberately a port by meaning rather than a shared implementation — the two
 * channels differ in exactly one respect that matters to the reader. On the
 * remote channel the credential arrives as an HTTP header the client set; here
 * it comes from the `FETTLE_API_KEY` environment variable in the user's MCP
 * client config, so that is the thing the model must tell its user to change.
 *
 * Every branch answers "what should the caller do differently", never just
 * "what went wrong": a model that reads "rate limited" retries immediately, a
 * model that reads "retry after 43 seconds" waits.
 */

/** The API's two error body shapes, as core's exception handlers emit them. */
interface ErrorBody {
  detail?: unknown;
  message?: unknown;
  retry_after?: unknown;
}

/**
 * The exact sentence core raises for an insufficient-scope 403
 * (`PermissionDeniedException("API key scope is not sufficient")`). Matched
 * verbatim rather than on the bare word "scope" so an unrelated 403 — a plan
 * gate, say — whose message merely mentions scope in passing is never
 * misdiagnosed as a key-scope problem.
 */
const SCOPE_INSUFFICIENT_MESSAGE = "API key scope is not sufficient";

function extractMessage(body: ErrorBody | null): string {
  if (body === null) {
    return "";
  }
  if (typeof body.detail === "string") {
    return body.detail;
  }
  if (typeof body.message === "string") {
    return body.message;
  }
  return "";
}

/**
 * Drop trailing dots and whitespace so a caller can append its own full stop.
 *
 * Mirrors core's `_trim_sentence_end` (`message.rstrip(". \t\r\n")`): server
 * messages often end in a full stop already, and appending ours would give
 * "..". The character set is kept identical to core's so both channels render
 * the same message the same way.
 */
function trimSentenceEnd(message: string): string {
  return message.replace(/[. \t\r\n]+$/, "");
}

/**
 * Turn a FastAPI/pydantic `detail` list into a sentence naming each field.
 *
 * The `body`/`query`/`path` prefix pydantic puts at the head of every `loc` is
 * dropped: it names the HTTP location, which is an implementation detail of a
 * transport the model never sees. What is left is the argument name the model
 * actually passed.
 */
function describeValidationErrors(detail: unknown[]): string {
  const parts: string[] = [];
  for (const error of detail) {
    if (typeof error !== "object" || error === null) {
      continue;
    }
    const candidate = error as { loc?: unknown; msg?: unknown };
    const loc = Array.isArray(candidate.loc) ? candidate.loc : [];
    const fieldParts = loc
      .filter((part) => part !== "body" && part !== "query" && part !== "path")
      .map((part) => String(part));
    const field = fieldParts.length > 0 ? fieldParts.join(".") : "request";
    const msg = typeof candidate.msg === "string" ? candidate.msg : "is invalid";
    parts.push(`'${field}': ${msg}`);
  }
  if (parts.length === 0) {
    return "The arguments failed validation. Check the argument values and retry.";
  }
  return `Invalid argument(s) — ${parts.join("; ")}. Fix the value(s) and retry.`;
}

/**
 * Read the retry delay a 429 carries.
 *
 * Core answers rate limits with `retry_after` in the JSON body; the
 * `Retry-After` header carries the same number and is read as a fallback,
 * because unlike the remote channel this package also faces whatever sits in
 * front of the API — a proxy that rate-limits before the application does
 * answers with the header and no body of ours at all.
 */
function retryAfterSeconds(
  body: ErrorBody | null,
  headers: Headers | null,
): number | null {
  const fromBody = body?.retry_after;
  if (typeof fromBody === "number" && Number.isFinite(fromBody)) {
    return fromBody;
  }
  const fromHeader = headers?.get("retry-after");
  if (fromHeader !== null && fromHeader !== undefined) {
    const parsed = Number.parseInt(fromHeader, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

/** Describe a non-2xx response in terms of what the caller should change. */
export function describeFailure(
  statusCode: number,
  body: ErrorBody | null,
  headers: Headers | null = null,
): string {
  const message = extractMessage(body);

  if (statusCode === 401) {
    return (
      "Authentication failed: Fettle rejected the API key. Check that " +
      "FETTLE_API_KEY in the MCP client configuration holds a current, " +
      "un-revoked key from Settings → API Keys at https://fettle.sh, then " +
      "restart the MCP client so it picks the new value up."
    );
  }

  if (statusCode === 403) {
    if (message.includes(SCOPE_INSUFFICIENT_MESSAGE)) {
      return (
        "This tool requires an API key with write scope; FETTLE_API_KEY holds a " +
        "read-only key. Create a write-scoped key in Settings → API Keys at " +
        "https://fettle.sh and restart the MCP client with it."
      );
    }
    return `Forbidden: ${trimSentenceEnd(message) || "the API key is not permitted to perform this action"}.`;
  }

  if (statusCode === 404) {
    return (
      // Same text as core's remote channel. Naming list tools here went stale as
      // soon as new id sources shipped; each tool's description says where its
      // ids come from.
      `Not found: ${trimSentenceEnd(message) || "the requested resource does not exist"}. ` +
      "Check the id and try again."
    );
  }

  if (statusCode === 422) {
    const detail = body?.detail;
    if (Array.isArray(detail)) {
      return describeValidationErrors(detail);
    }
    return (
      `Invalid request: ${trimSentenceEnd(message) || "the arguments failed validation"}. ` +
      "Check the argument values and retry."
    );
  }

  if (statusCode === 429) {
    const retryAfter = retryAfterSeconds(body, headers);
    if (retryAfter !== null) {
      return (
        `Rate limited: too many requests. Wait, then retry after ${retryAfter} ` +
        "seconds."
      );
    }
    return "Rate limited: too many requests. Slow down and retry shortly.";
  }

  return (
    `Request failed with status ${statusCode}: ` +
    `${trimSentenceEnd(message) || "no further detail was provided"}.`
  );
}

/**
 * Describe a request that never produced a response at all.
 *
 * A thrown `fetch` is not something the model can fix by changing arguments,
 * but it is very often something the *user* can fix — a typo in
 * `FETTLE_API_URL`, a machine with no network, a corporate proxy. Saying which
 * URL was attempted turns an opaque "fetch failed" into a diagnosis.
 */
export function describeTransportFailure(baseUrl: string, cause: unknown): string {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return (
    `Could not reach the Fettle API at ${baseUrl}: ${reason}. Check network ` +
    "connectivity and the FETTLE_API_URL setting (it defaults to " +
    "https://api.fettle.sh and should not normally be set)."
  );
}
