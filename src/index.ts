#!/usr/bin/env node
/**
 * `npx fettle-mcp` — the stdio MCP server for Fettle.
 *
 * Everything that can be wrong with the setup is checked here, before the
 * transport is connected: a missing key, an unusable API URL, a contract this
 * version cannot read. The reason is the medium — an MCP client spawns this
 * process with stdout reserved for JSON-RPC frames and nothing but stderr for
 * a human to read. A configuration mistake discovered later, inside a tool
 * call, reaches the user as "the assistant could not check your monitor",
 * which is the wrong diagnosis of the wrong problem.
 */

import { readFileSync } from "node:fs";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ConfigError, loadConfig } from "./config.js";
import { loadContract } from "./contract.js";
import { ToolExecutor } from "./executor.js";
import { createServer } from "./server.js";

const SERVER_NAME = "fettle-mcp";

/**
 * The published version, read from the package manifest at startup.
 *
 * Reported to the MCP client in `serverInfo` and sent as the `User-Agent` on
 * every API call, so a support question about odd behaviour can be answered
 * with "which version" from the server's own logs. `src/` and `dist/` both sit
 * one level under the package root, so this path is right compiled and under
 * test alike.
 */
function readVersion(): string {
  try {
    const manifestUrl = new URL("../package.json", import.meta.url);
    const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
      version?: string;
    };
    return manifest.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const contract = loadContract();
  const version = readVersion();

  const executor = new ToolExecutor({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    userAgent: `${SERVER_NAME}/${version} (+https://fettle.sh)`,
  });

  const server = createServer(contract, executor, {
    name: SERVER_NAME,
    version,
  });

  await server.connect(new StdioServerTransport());
  // Nothing is logged on success: stdout carries the protocol, and a startup
  // banner on stderr shows up in some clients as an error the user must chase.
}

main().catch((error: unknown) => {
  const message =
    error instanceof ConfigError || error instanceof Error
      ? error.message
      : String(error);
  process.stderr.write(`fettle-mcp: ${message}\n`);
  process.exit(1);
});
