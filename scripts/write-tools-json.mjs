#!/usr/bin/env node
/**
 * Write `tools.json` — the `tools/list` answer — to the package root.
 *
 * A directory that reads the package without starting the server finds no tool
 * in its code, because the list is built from the contract at runtime. The
 * file is rendered by the same function the server answers with, so the two
 * cannot differ. Runs after `tsc`: it imports the compiled modules.
 */

import { writeFileSync } from "node:fs";

import { loadContract } from "../dist/contract.js";
import { toWireTools } from "../dist/server.js";

const tools = toWireTools(loadContract());
writeFileSync(
  new URL("../tools.json", import.meta.url),
  `${JSON.stringify({ tools })}\n`,
  "utf8",
);
