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

describe("describeFailure trims the server's own full stop", () => {
  it("ends a 403 reason with a single full stop", () => {
    expect(
      describeFailure(403, {
        message: "Only an owner or admin can manage API keys.",
      }),
    ).toBe("Forbidden: Only an owner or admin can manage API keys.");
  });

  it("keeps the 403 default when the server says nothing but dots", () => {
    expect(describeFailure(403, { message: " . " })).toBe(
      "Forbidden: the API key is not permitted to perform this action.",
    );
  });

  it("ends a 404 reason with a single full stop", () => {
    expect(describeFailure(404, { detail: "Monitor not found.\n" })).toBe(
      "Not found: Monitor not found. Check the id and try again.",
    );
  });

  it("keeps the 404 default when the body is empty", () => {
    expect(describeFailure(404, null)).toBe(
      "Not found: the requested resource does not exist. Check the id and try again.",
    );
  });

  it("ends a plain-string 422 reason with a single full stop", () => {
    expect(describeFailure(422, { detail: "URL is unreachable..." })).toBe(
      "Invalid request: URL is unreachable. Check the argument values and retry.",
    );
  });

  it("keeps the 422 default when the detail is empty", () => {
    expect(describeFailure(422, { detail: "" })).toBe(
      "Invalid request: the arguments failed validation. Check the argument values and retry.",
    );
  });

  it("ends an unmapped status reason with a single full stop", () => {
    expect(describeFailure(418, { message: "I am a teapot. " })).toBe(
      "Request failed with status 418: I am a teapot.",
    );
  });

  it("keeps the unmapped-status default when the body is empty", () => {
    expect(describeFailure(418, null)).toBe(
      "Request failed with status 418: no further detail was provided.",
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
