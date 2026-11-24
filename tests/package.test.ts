import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

import { toWireTools } from "../src/server.js";
import { contract } from "./helpers.js";

/**
 * `tools.json` is built, not committed, so the test runs the real build on a
 * copy: a directory reads the file from the published tarball, and npm skips a
 * missing `files` entry without an error.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
let copy: string;

beforeAll(() => {
  copy = mkdtempSync(join(tmpdir(), "fettle-mcp-"));
  for (const name of [
    "src",
    "scripts",
    "contracts",
    "package.json",
    "tsconfig.json",
    "tsconfig.build.json",
  ]) {
    cpSync(join(root, name), join(copy, name), { recursive: true });
  }
  symlinkSync(join(root, "node_modules"), join(copy, "node_modules"));
  execFileSync("npm", ["run", "build"], { cwd: copy, stdio: "pipe" });
}, 60_000);

afterAll(() => {
  rmSync(copy, { recursive: true, force: true });
});

describe("the published package", () => {
  it("carries a tools.json that equals the tools/list answer", () => {
    const path = join(copy, "tools.json");
    expect(existsSync(path)).toBe(true);
    const listed = JSON.parse(readFileSync(path, "utf8")) as { tools: unknown[] };

    expect(Object.keys(listed)).toEqual(["tools"]);
    expect(listed.tools).toEqual(JSON.parse(JSON.stringify(toWireTools(contract))));
    expect(ListToolsResultSchema.safeParse(listed).success).toBe(true);
  });

  it("packs tools.json at its root", () => {
    const [packed] = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
        cwd: copy,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ) as [{ files: { path: string }[] }];

    expect(packed.files.map((file) => file.path)).toContain("tools.json");
  });
});
