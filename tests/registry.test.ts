import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_API_URL, DEFAULT_TIMEOUT_MS } from "../src/config.js";

/**
 * `server.json` — the entry the official MCP registry serves.
 *
 * None of this is read at runtime; it is metadata a *third party* publishes on
 * our behalf, which is exactly why it needs tests. A registry entry that names
 * the wrong npm version, or a version the registry accepted before the tarball
 * existed, is a listing that installs nothing — and it cannot be edited in
 * place, only superseded by another publish. The invariants below are the ones
 * `mcp-publisher` cannot check for us: it validates shape and ownership, not
 * whether this repository agrees with itself.
 */

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

const serverJson = JSON.parse(
  readFileSync(new URL("../server.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

interface RegistryInput {
  name: string;
  description: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
}

interface RegistryPackage {
  registryType: string;
  identifier: string;
  version: string;
  runtimeHint?: string;
  transport: { type: string };
  environmentVariables?: RegistryInput[];
}

interface RegistryRemote {
  type: string;
  url: string;
  headers?: RegistryInput[];
}

/** The entry declaring nothing to install is itself a failure worth naming. */
function only<T>(entries: T[] | undefined, what: string): T {
  const [entry] = entries ?? [];

  if (entry === undefined) {
    throw new Error(`server.json declares no ${what}`);
  }

  return entry;
}

const npmPackage = only(
  serverJson.packages as RegistryPackage[] | undefined,
  "npm package",
);
const remote = only(
  serverJson.remotes as RegistryRemote[] | undefined,
  "remote channel",
);

describe("the registry entry", () => {
  it("claims the namespace the published package proves we own", () => {
    // The registry validates npm ownership by reading `mcpName` out of the
    // package it finds on the npm registry. The two names disagreeing is the
    // one failure that only shows up at publish time, against the *previous*
    // release's metadata.
    expect(serverJson.name).toBe(packageJson.mcpName);
    expect(serverJson.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  });

  it("describes the server within the registry's 100-character limit", () => {
    const description = serverJson.description as string;
    const title = serverJson.title as string;

    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(100);
    expect(title.length).toBeLessThanOrEqual(100);
  });

  it("declares the schema version the entry was written against", () => {
    // Registry validation reports a deprecated schema as a warning, not an
    // error, so an entry can go out shaped for a format nobody reads any
    // more. Pinning it here makes the upgrade a deliberate edit.
    expect(serverJson.$schema).toBe(
      "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    );
  });

  it("points at this npm package, at this exact version", () => {
    expect(npmPackage.registryType).toBe("npm");
    expect(npmPackage.identifier).toBe(packageJson.name);
    expect(npmPackage.version).toBe(packageJson.version);
    expect(serverJson.version).toBe(packageJson.version);
  });

  it("declares the stdio transport the binary actually speaks", () => {
    expect(npmPackage.transport.type).toBe("stdio");
    expect(npmPackage.runtimeHint).toBe("npx");
  });

  it("declares every variable the server reads, with the key marked secret", () => {
    const declared = new Map(
      (npmPackage.environmentVariables ?? []).map((variable) => [
        variable.name,
        variable,
      ]),
    );

    expect([...declared.keys()].sort()).toEqual([
      "FETTLE_API_KEY",
      "FETTLE_API_URL",
      "FETTLE_TIMEOUT_MS",
    ]);
    expect(declared.get("FETTLE_API_KEY")?.isRequired).toBe(true);
    expect(declared.get("FETTLE_API_KEY")?.isSecret).toBe(true);
    expect(declared.get("FETTLE_API_URL")?.default).toBe(DEFAULT_API_URL);
    expect(declared.get("FETTLE_TIMEOUT_MS")?.default).toBe(String(DEFAULT_TIMEOUT_MS));
  });

  it("lists the remote channel as well, so one entry covers both", () => {
    // A client that speaks remote MCP should never be told to install a
    // package: the listing is the only place many of them look.
    expect(remote.type).toBe("streamable-http");
    expect(remote.url).toBe(`${DEFAULT_API_URL}/mcp`);
    expect(remote.headers?.[0]?.name).toBe("Authorization");
    expect(remote.headers?.[0]?.isSecret).toBe(true);
  });

  it("leaves the remote key optional, since OAuth sign-in needs none", () => {
    expect(remote.headers?.[0]?.isRequired).toBe(false);
  });

  it("links the public source repository", () => {
    // MCP directories read the tool list by following this link to the
    // repository and its server.json, so it must name the real, public one.
    expect(serverJson.repository).toEqual({
      url: "https://github.com/fettlesh/monitoring-mcp",
      source: "github",
    });
    expect(serverJson.websiteUrl).toBe("https://fettle.sh/docs/mcp");
  });

  it("sends an npm reader to the website and the public repository", () => {
    expect(packageJson.homepage).toBe("https://fettle.sh");
    expect(packageJson.description as string).toContain("https://fettle.sh");
    expect((packageJson.repository as { url?: string } | undefined)?.url).toBe(
      "git+https://github.com/fettlesh/monitoring-mcp.git",
    );
    expect((packageJson.bugs as { url?: string } | undefined)?.url).toBe(
      "https://github.com/fettlesh/monitoring-mcp/issues",
    );
  });

  it("carries no key-shaped string an agent could mistake for a working secret", () => {
    expect(JSON.stringify(serverJson)).not.toMatch(/fettle_[A-Za-z0-9]{20,}/);
  });
});
