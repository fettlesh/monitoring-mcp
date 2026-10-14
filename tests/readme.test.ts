import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { contract } from "./helpers.js";

describe("README agent guide", () => {
  it("reproduces the vendored contract's instructions verbatim", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const match = readme.match(
      /<!-- agent-guide:start -->\n```text\n([\s\S]*?)\n```\n<!-- agent-guide:end -->/,
    );
    expect(match, "agent-guide markers missing from README.md").not.toBeNull();
    expect(match![1]).toBe(contract.instructions);
  });
});
