/**
 * The tool contract: the one description both Fettle MCP channels interpret.
 *
 * The file this module loads is *generated* in the core backend
 * (`scripts/generate_mcp_contract.py` from `src/mcp/registry.py`) and vendored
 * here verbatim. Nothing in this package describes a tool by hand: adding a
 * tool means re-vendoring the contract, not editing source. `pnpm
 * contract:check` compares the vendored copy against what production serves at
 * `GET /public-api/mcp-tools.json`, so drift is a failing check rather than a
 * silent difference between the two channels.
 */

import { readFileSync } from "node:fs";

/** How to execute a tool as an HTTP request against the public API. */
export interface ToolOperation {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  path_params: string[];
  query: string[];
  /**
   * Query parameters the contract pins for this tool. They are not in the
   * input schema, so the model never sees or sets them; the executor writes
   * them last so they always win. Core uses this to give agents the compact
   * monitor list (`view=compact`) without a second route.
   */
  fixed_query: Record<string, string>;
  body: boolean;
}

/**
 * The MCP behaviour hints of one tool, as core writes them (snake_case).
 * Core always sets all four: MCP reads a missing `destructiveHint` as true.
 */
export interface ToolAnnotations {
  read_only_hint: boolean;
  destructive_hint: boolean;
  idempotent_hint: boolean;
  open_world_hint: boolean;
}

/** One agent-facing tool. */
export interface ToolEntry {
  name: string;
  title: string;
  description: string;
  scope: "read" | "write";
  input_schema: Record<string, unknown>;
  operation: ToolOperation;
  /** Absent in contracts generated before 0.5.0; the tool then goes out without hints. */
  annotations?: ToolAnnotations;
  /**
   * The JSON Schema of a successful result, sent as `outputSchema`; a tool
   * that has one also answers with `structuredContent`. Absent for a tool
   * whose route answers with a list or declares no response model, and in
   * contracts generated before 0.6.0.
   */
  output_schema?: Record<string, unknown>;
}

/** The whole document. */
export interface ToolContract {
  version: number;
  tools: ToolEntry[];
  /**
   * The agent guide core authors (`SERVER_INSTRUCTIONS`). Sent verbatim as
   * the `initialize` result's `instructions`. Absent in contracts generated
   * before 0.3.0.
   */
  instructions?: string;
}

/**
 * The contract format version this code understands.
 *
 * Kept in lockstep with core's `SUPPORTED_CONTRACT_VERSION`. A guard, not a
 * migration path — a future format bump surfaces as one legible message
 * instead of an undefined field read at the first tool call.
 */
export const SUPPORTED_CONTRACT_VERSION = 1;

/**
 * Location of the vendored contract, resolved relative to this module rather
 * than to the process's working directory: the package runs as `npx
 * fettle-mcp` from wherever the MCP client happens to spawn it. `src/` and
 * `dist/` both sit one level under the package root, so the same relative
 * path is correct compiled and under test.
 */
export const CONTRACT_URL = new URL("../contracts/mcp_tools.json", import.meta.url);

const METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);

function fail(message: string): never {
  throw new Error(`Invalid tool contract: ${message}`);
}

function assertFixedQuery(value: unknown, toolName: string): Record<string, string> {
  // Absent is the common case: only tools that pin a parameter carry the field,
  // and contracts generated before it existed carry it nowhere.
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`tool '${toolName}' has a malformed fixed_query.`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([, item]) => typeof item !== "string")) {
    fail(`tool '${toolName}' has a malformed fixed_query.`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function assertOperation(operation: unknown, toolName: string): ToolOperation {
  if (typeof operation !== "object" || operation === null) {
    fail(`tool '${toolName}' has no operation object.`);
  }
  const candidate = operation as Record<string, unknown>;
  if (typeof candidate.method !== "string" || !METHODS.has(candidate.method)) {
    fail(`tool '${toolName}' has an unsupported method ${String(candidate.method)}.`);
  }
  if (typeof candidate.path !== "string" || !candidate.path.startsWith("/")) {
    fail(`tool '${toolName}' has a non-absolute path.`);
  }
  const pathParams = candidate.path_params;
  const query = candidate.query;
  if (!Array.isArray(pathParams) || !Array.isArray(query)) {
    fail(`tool '${toolName}' has malformed path_params/query.`);
  }
  return {
    method: candidate.method as ToolOperation["method"],
    path: candidate.path,
    path_params: pathParams.map(String),
    query: query.map(String),
    fixed_query: assertFixedQuery(candidate.fixed_query, toolName),
    body: candidate.body === true,
  };
}

const ANNOTATION_KEYS = [
  "read_only_hint",
  "destructive_hint",
  "idempotent_hint",
  "open_world_hint",
] as const;

/**
 * Check a tool's hints. A half-written hint object is refused rather than
 * patched up: a dropped `destructive_hint` would silently tell clients that a
 * delete is safe, or that every write is dangerous.
 */
function assertAnnotations(raw: unknown, name: string): ToolAnnotations {
  if (typeof raw !== "object" || raw === null) {
    fail(`tool '${name}' has annotations that are not an object.`);
  }
  const candidate = raw as Record<string, unknown>;
  for (const key of ANNOTATION_KEYS) {
    if (typeof candidate[key] !== "boolean") {
      fail(`tool '${name}' has no boolean annotations.${key}.`);
    }
  }
  return {
    read_only_hint: candidate.read_only_hint as boolean,
    destructive_hint: candidate.destructive_hint as boolean,
    idempotent_hint: candidate.idempotent_hint as boolean,
    open_world_hint: candidate.open_world_hint as boolean,
  };
}

/**
 * Validate a parsed contract document.
 *
 * Structural only — the per-tool `input_schema` is handed to Ajv unexamined,
 * which is the point: this package must not develop its own opinion about what
 * a tool's arguments look like.
 */
export function parseContract(raw: unknown): ToolContract {
  if (typeof raw !== "object" || raw === null) {
    fail("the document is not a JSON object.");
  }
  const document = raw as Record<string, unknown>;
  if (document.version !== SUPPORTED_CONTRACT_VERSION) {
    fail(
      `format version ${String(document.version)} is not the version ` +
        `${SUPPORTED_CONTRACT_VERSION} this package understands. Upgrade ` +
        `fettle-mcp (npm install -g fettle-mcp@latest) or pin an older one.`,
    );
  }
  if (!Array.isArray(document.tools) || document.tools.length === 0) {
    fail("the document carries no tools.");
  }

  const seen = new Set<string>();
  const tools = document.tools.map((entry): ToolEntry => {
    if (typeof entry !== "object" || entry === null) {
      fail("a tool entry is not an object.");
    }
    const candidate = entry as Record<string, unknown>;
    const name = candidate.name;
    if (typeof name !== "string" || name === "") {
      fail("a tool entry has no name.");
    }
    if (seen.has(name)) {
      fail(`tool '${name}' is declared twice.`);
    }
    seen.add(name);
    if (typeof candidate.input_schema !== "object" || candidate.input_schema === null) {
      fail(`tool '${name}' has no input_schema.`);
    }
    const tool: ToolEntry = {
      name,
      title: typeof candidate.title === "string" ? candidate.title : name,
      description:
        typeof candidate.description === "string" ? candidate.description : "",
      scope: candidate.scope === "write" ? "write" : "read",
      input_schema: candidate.input_schema as Record<string, unknown>,
      operation: assertOperation(candidate.operation, name),
    };
    if (candidate.annotations !== undefined) {
      tool.annotations = assertAnnotations(candidate.annotations, name);
    }
    if (candidate.output_schema !== undefined && candidate.output_schema !== null) {
      if (
        typeof candidate.output_schema !== "object" ||
        Array.isArray(candidate.output_schema) ||
        (candidate.output_schema as Record<string, unknown>).type !== "object"
      ) {
        fail(`tool '${name}' has an output_schema that is not an object schema.`);
      }
      tool.output_schema = candidate.output_schema as Record<string, unknown>;
    }
    return tool;
  });

  // Core's generator always writes the field and uses "" for "no guide", so
  // an empty string is the same as absent: refusing to start on it would
  // brick every 0.3.x install the day core ships an empty guide.
  if (document.instructions === undefined || document.instructions === "") {
    return { version: document.version, tools };
  }
  if (typeof document.instructions !== "string") {
    fail("instructions is not a string.");
  }
  return { version: document.version, tools, instructions: document.instructions };
}

/** Read and validate the vendored contract. */
export function loadContract(url: URL = CONTRACT_URL): ToolContract {
  return parseContract(JSON.parse(readFileSync(url, "utf8")));
}

/** Resolve a tool by name, or `undefined` when the contract has no such tool. */
export function findTool(contract: ToolContract, name: string): ToolEntry | undefined {
  return contract.tools.find((tool) => tool.name === name);
}
