import { describe, expect, it } from "vitest";

import {
  ConfigError,
  DEFAULT_API_URL,
  DEFAULT_TIMEOUT_MS,
  loadConfig,
} from "../src/config.js";

describe("loadConfig", () => {
  it("fails when the key is absent, naming the variable and where it goes", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/FETTLE_API_KEY is not set/);
    expect(() => loadConfig({})).toThrow(/MCP\s+client configuration/);
  });

  it("treats a blank key as absent — a quoted empty string in a config file is a typo, not a credential", () => {
    expect(() => loadConfig({ FETTLE_API_KEY: "   " })).toThrow(/not set/);
  });

  it("trims the key, because copy-paste out of a web UI brings whitespace", () => {
    expect(loadConfig({ FETTLE_API_KEY: " fettle_abc \n" }).apiKey).toBe("fettle_abc");
  });

  it("defaults the API URL and the timeout", () => {
    const config = loadConfig({ FETTLE_API_KEY: "fettle_abc" });
    expect(config.apiUrl).toBe(DEFAULT_API_URL);
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  it("strips a trailing slash so paths do not concatenate into a double slash", () => {
    const config = loadConfig({
      FETTLE_API_KEY: "fettle_abc",
      FETTLE_API_URL: "https://staging.fettle.sh/",
    });
    expect(config.apiUrl).toBe("https://staging.fettle.sh");
  });

  it("rejects a URL that does not parse", () => {
    expect(() =>
      loadConfig({ FETTLE_API_KEY: "fettle_abc", FETTLE_API_URL: "api.fettle.sh" }),
    ).toThrow(/not a valid URL/);
  });

  it("rejects a non-http scheme, which would not reach an API at all", () => {
    expect(() =>
      loadConfig({ FETTLE_API_KEY: "fettle_abc", FETTLE_API_URL: "ftp://fettle.sh" }),
    ).toThrow(/must be an http\(s\) URL/);
  });

  it("reads a custom timeout and rejects a nonsensical one", () => {
    expect(
      loadConfig({ FETTLE_API_KEY: "fettle_abc", FETTLE_TIMEOUT_MS: "5000" }).timeoutMs,
    ).toBe(5000);
    expect(() =>
      loadConfig({ FETTLE_API_KEY: "fettle_abc", FETTLE_TIMEOUT_MS: "0" }),
    ).toThrow(/positive whole number/);
    expect(() =>
      loadConfig({ FETTLE_API_KEY: "fettle_abc", FETTLE_TIMEOUT_MS: "soon" }),
    ).toThrow(/positive whole number/);
  });
});
