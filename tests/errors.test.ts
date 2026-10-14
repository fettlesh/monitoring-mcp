import { describe, expect, it } from "vitest";

import { describeFailure, describeTransportFailure } from "../src/errors.js";

describe("describeFailure", () => {
  it("points a 401 at FETTLE_API_KEY, not at an Authorization header", () => {
    const text = describeFailure(401, { message: "Invalid API key" });
    expect(text).toContain("FETTLE_API_KEY");
    expect(text).toContain("restart");
    expect(text).not.toContain("Authorization header");
  });

  it("tells a read-only key exactly what to create", () => {
    const text = describeFailure(403, { message: "API key scope is not sufficient" });
    expect(text).toContain("write scope");
    expect(text).toContain("Settings → API Keys");
  });

  it("opens a scope refusal with the remote channel's wording, which the agent guide quotes", () => {
    const text = describeFailure(403, { message: "API key scope is not sufficient" });
    expect(text.startsWith("This tool requires an API key with write scope")).toBe(
      true,
    );
    expect(text).toContain("Settings → API Keys");
  });

  it("does not diagnose an unrelated 403 as a scope problem", () => {
    const text = describeFailure(403, {
      message: "Your plan does not include status pages",
    });
    expect(text).not.toContain("write scope");
    expect(text).toContain("Your plan does not include status pages");
  });

  it("answers a 404 with the same text as the remote channel", () => {
    const text = describeFailure(404, { detail: "Monitor not found" });
    expect(text).toBe("Not found: Monitor not found. Check the id and try again.");
  });

  it("names the offending field of a pydantic 422 and drops the HTTP location prefix", () => {
    const text = describeFailure(422, {
      detail: [
        { loc: ["body", "interval_seconds"], msg: "Input should be greater than 29" },
      ],
    });
    expect(text).toContain("'interval_seconds': Input should be greater than 29");
    expect(text).not.toContain("body.");
  });

  it("falls back to a readable sentence when a 422 carries a plain string detail", () => {
    expect(describeFailure(422, { detail: "URL is unreachable" })).toContain(
      "URL is unreachable",
    );
  });

  it("reads retry_after out of the body", () => {
    expect(describeFailure(429, { retry_after: 43 })).toContain(
      "retry after 43 seconds",
    );
  });

  it("falls back to the Retry-After header, which is all a front proxy sends", () => {
    const headers = new Headers({ "Retry-After": "17" });
    expect(describeFailure(429, null, headers)).toContain("retry after 17 seconds");
  });

  it("does not blame the plan budget: some limiters are per address", () => {
    expect(describeFailure(429, { retry_after: 5 })).not.toContain("plan");
    expect(describeFailure(429, { retry_after: 5 })).toMatch(/^Rate limited:/);
  });

  it("still says something useful when a 429 carries neither", () => {
    expect(describeFailure(429, null)).toContain("Slow down");
  });

  it("reports an unmapped status with whatever detail there was", () => {
    expect(describeFailure(418, { message: "I am a teapot" })).toContain(
      "status 418: I am a teapot",
    );
  });
});

describe("describeTransportFailure", () => {
  it("names the URL that was attempted and the setting that chose it", () => {
    const text = describeTransportFailure(
      "https://api.fettle.sh",
      new Error("getaddrinfo ENOTFOUND"),
    );
    expect(text).toContain("https://api.fettle.sh");
    expect(text).toContain("ENOTFOUND");
    expect(text).toContain("FETTLE_API_URL");
  });
});
