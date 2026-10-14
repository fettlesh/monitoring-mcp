#!/usr/bin/env node
/**
 * Compare the vendored contract against the one production serves.
 *
 * The two MCP channels share one description of the tools, but only the remote
 * one reads it live — this package ships a copy, so a tool added or reworded
 * in core is invisible here until someone re-vendors the file. That gap is
 * unavoidable (a published npm version is frozen by definition); what is
 * avoidable is *not knowing about it*. This check turns the gap into a failing
 * CI step at release time.
 *
 * Exit codes: 0 identical · 1 drift · 2 the contract could not be fetched.
 * The fetch failure is kept distinct from drift on purpose: an unreachable API
 * says nothing about whether the contract is current, and must not be reported
 * as if it did.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit, stderr, stdout } from "node:process";

const DEFAULT_URL = "https://api.fettle.sh/public-api/mcp-tools.json";
const LOCAL_PATH = new URL("../contracts/mcp_tools.json", import.meta.url);

const write = argv.includes("--write");
const remoteUrl = process.env.FETTLE_CONTRACT_URL ?? DEFAULT_URL;

let remoteText;
try {
  const response = await fetch(remoteUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    stderr.write(`contract check: ${remoteUrl} answered ${response.status}\n`);
    exit(2);
  }
  remoteText = await response.text();
} catch (error) {
  stderr.write(`contract check: could not fetch ${remoteUrl}: ${error.message}\n`);
  exit(2);
}

const remote = JSON.parse(remoteText);
const local = JSON.parse(readFileSync(LOCAL_PATH, "utf8"));

// Compared as canonical JSON rather than byte-for-byte: core serves the
// contract through its own JSON encoder, so whitespace and key order are
// artefacts of the transport, not differences in the contract.
const canonical = (value) => JSON.stringify(value);

if (canonical(remote) === canonical(local)) {
  stdout.write(
    `contract check: vendored contract matches ${remoteUrl} (${local.tools.length} tools)\n`,
  );
  exit(0);
}

const remoteNames = new Set(remote.tools.map((tool) => tool.name));
const localNames = new Set(local.tools.map((tool) => tool.name));
const added = [...remoteNames].filter((name) => !localNames.has(name));
const removed = [...localNames].filter((name) => !remoteNames.has(name));
const changed = [...remoteNames]
  .filter((name) => localNames.has(name))
  .filter(
    (name) =>
      canonical(remote.tools.find((tool) => tool.name === name)) !==
      canonical(local.tools.find((tool) => tool.name === name)),
  );

stderr.write(`contract check: the vendored contract differs from ${remoteUrl}\n`);
if (remote.version !== local.version) {
  stderr.write(
    `  format version: vendored ${local.version}, production ${remote.version}\n`,
  );
}
if (added.length > 0) stderr.write(`  only in production: ${added.join(", ")}\n`);
if (removed.length > 0) stderr.write(`  only vendored: ${removed.join(", ")}\n`);
if (changed.length > 0) stderr.write(`  changed: ${changed.join(", ")}\n`);

if (write) {
  writeFileSync(LOCAL_PATH, `${JSON.stringify(remote, null, 2)}\n`, "utf8");
  stderr.write(
    "  rewrote contracts/mcp_tools.json from production — review the diff, then run the tests\n",
  );
}
stderr.write(
  "  fix: pnpm run contract:check -- --write, or copy the file from the core repo\n",
);
exit(1);
