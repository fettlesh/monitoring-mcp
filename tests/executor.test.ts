import { describe, expect, it } from "vitest";

import type { ToolEntry } from "../src/contract.js";
import { ToolArgumentError, ToolExecutor, ToolProtocolError } from "../src/executor.js";
import { stubFetch, throwingFetch, tool, type FetchStub } from "./helpers.js";

function executorWith(stub: FetchStub): ToolExecutor {
  return new ToolExecutor({
    apiUrl: "https://api.fettle.sh",
    apiKey: "fettle_secret",
    timeoutMs: 1000,
    userAgent: "fettle-mcp/0.1.0",
    fetchImpl: stub.impl,
  });
}

describe("request building", () => {
  it("substitutes a path parameter and sends the key as a Bearer token", async () => {
    const stub = stubFetch({ status: 200, body: { id: "m-1" } });
    await executorWith(stub).execute(tool("get_monitor"), {
      monitor_id: "0198f2b0-0000-7000-8000-000000000001",
    });

    const call = stub.calls[0]!;
    expect(call.url).toBe(
      "https://api.fettle.sh/v1/monitors/0198f2b0-0000-7000-8000-000000000001",
    );
    expect(call.method).toBe("GET");
    expect(call.headers.Authorization).toBe("Bearer fettle_secret");
    expect(call.headers["User-Agent"]).toBe("fettle-mcp/0.1.0");
  });

  it("never follows a redirect, so the credential cannot be replayed elsewhere", async () => {
    const stub = stubFetch({ status: 200, body: {} });
    await executorWith(stub).execute(tool("list_monitors"), {});
    expect(stub.calls[0]!.redirect).toBe("manual");
  });

  it("routes declared query parameters into the query string", async () => {
    const stub = stubFetch({ status: 200, body: { items: [] } });
    await executorWith(stub).execute(tool("list_monitors"), {
      page: 2,
      size: 50,
      sort: "newest",
    });
    expect(stub.calls[0]!.url).toBe(
      "https://api.fettle.sh/v1/monitors?page=2&size=50&sort=newest&view=compact",
    );
  });

  it("sends only the pinned parameters when no query argument was given", async () => {
    const stub = stubFetch({ status: 200, body: { items: [] } });
    await executorWith(stub).execute(tool("list_monitors"), {});
    expect(stub.calls[0]!.url).toBe("https://api.fettle.sh/v1/monitors?view=compact");
  });

  it("sends no query string at all when a tool without pins gets no query argument", async () => {
    const stub = stubFetch({ status: 200, body: [] });
    await executorWith(stub).execute(tool("list_status_pages"), {});
    expect(stub.calls[0]!.url).toBe("https://api.fettle.sh/v1/status-pages");
  });

  it("repeats a list argument as separate query parameters", async () => {
    const stub = stubFetch({ status: 200, body: { items: [] } });
    await executorWith(stub).execute(tool("list_monitors"), {
      status: ["DOWN", "DEGRADED"],
    });
    expect(stub.calls[0]!.url).toBe(
      "https://api.fettle.sh/v1/monitors?status=DOWN&status=DEGRADED&view=compact",
    );
  });

  it("routes the remaining arguments into the JSON body of a body operation", async () => {
    const stub = stubFetch({ status: 201, body: { id: "m-2" } });
    await executorWith(stub).execute(tool("create_monitor"), {
      name: "Docs",
      type: "HTTP",
      target: "https://fettle.sh",
      interval_seconds: 120,
      regions: ["eu-central"],
    });
    const call = stub.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(call.body!)).toEqual({
      name: "Docs",
      type: "HTTP",
      target: "https://fettle.sh",
      interval_seconds: 120,
      regions: ["eu-central"],
    });
  });

  it("keeps the path parameter out of the body it also templated into the URL", async () => {
    const stub = stubFetch({ status: 200, body: {} });
    await executorWith(stub).execute(tool("update_monitor"), {
      monitor_id: "0198f2b0-0000-7000-8000-000000000001",
      name: "Renamed",
    });
    const call = stub.calls[0]!;
    expect(call.url).toContain("/v1/monitors/0198f2b0-0000-7000-8000-000000000001");
    expect(JSON.parse(call.body!)).toEqual({ name: "Renamed" });
  });

  it("sends no body on a bodyless write, rather than an empty object", async () => {
    const stub = stubFetch({ status: 200, body: {} });
    await executorWith(stub).execute(tool("pause_monitor"), {
      monitor_id: "0198f2b0-0000-7000-8000-000000000001",
    });
    expect(stub.calls[0]!.body).toBeUndefined();
  });
});

describe("argument rejection", () => {
  const stub = stubFetch({ status: 200, body: {} });

  it("refuses a missing path argument before spending a request", async () => {
    await expect(executorWith(stub).execute(tool("get_monitor"), {})).rejects.toThrow(
      ToolArgumentError,
    );
  });

  it("refuses a path argument containing '/', which would retarget the route", async () => {
    await expect(
      executorWith(stub).execute(tool("delete_monitor"), {
        monitor_id: "abc/../users",
      }),
    ).rejects.toThrow(/may not contain/);
  });

  it("refuses an empty path argument, which answers as a different route", async () => {
    await expect(
      executorWith(stub).execute(tool("delete_monitor"), { monitor_id: "" }),
    ).rejects.toThrow(/must not be empty/);
  });

  it('refuses a boolean id rather than sending the string "true"', async () => {
    await expect(
      executorWith(stub).execute(tool("get_monitor"), { monitor_id: true }),
    ).rejects.toThrow(/must be a string or number/);
  });

  it("refuses an argument no parameter accepts instead of dropping it silently", async () => {
    await expect(
      executorWith(stub).execute(tool("pause_monitor"), {
        monitor_id: "0198f2b0-0000-7000-8000-000000000001",
        force: true,
      }),
    ).rejects.toThrow(/does not accept argument\(s\): force/);
  });
});

describe("response mapping", () => {
  it("returns the JSON payload as the result text", async () => {
    const stub = stubFetch({ status: 200, body: { items: [{ id: "m-1" }] } });
    const result = await executorWith(stub).execute(tool("list_monitors"), {});
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]!.text)).toEqual({ items: [{ id: "m-1" }] });
  });

  it('says what succeeded when the response has no body, never the string "null"', async () => {
    const stub = stubFetch({ status: 204 });
    const result = await executorWith(stub).execute(tool("delete_monitor"), {
      monitor_id: "0198f2b0-0000-7000-8000-000000000001",
    });
    expect(result.isError).toBe(false);
    expect(result.content[0]!.text).toContain("delete_monitor succeeded (204)");
  });

  it("reports a 4xx as an actionable tool error, not as a result", async () => {
    const stub = stubFetch({ status: 404, body: { detail: "Monitor not found" } });
    const result = await executorWith(stub).execute(tool("get_monitor"), {
      monitor_id: "0198f2b0-0000-7000-8000-000000000001",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Monitor not found");
  });

  it("reads Retry-After off a 429 the API answered without a body", async () => {
    const stub = stubFetch({ status: 429, headers: { "Retry-After": "12" } });
    const result = await executorWith(stub).execute(tool("check_now"), {
      monitor_id: "0198f2b0-0000-7000-8000-000000000001",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("retry after 12 seconds");
  });

  it("treats a redirect as a failure, because the operation did not happen", async () => {
    const stub = stubFetch({ status: 307, headers: { Location: "/v1/monitors" } });
    const result = await executorWith(stub).execute(tool("delete_monitor"), {
      monitor_id: "0198f2b0-0000-7000-8000-000000000001",
    });
    expect(result.isError).toBe(true);
  });

  it('raises on a 5xx rather than handing the model something to "fix"', async () => {
    const stub = stubFetch({ status: 502, text: "<html>bad gateway</html>" });
    await expect(executorWith(stub).execute(tool("list_monitors"), {})).rejects.toThrow(
      ToolProtocolError,
    );
  });

  it("survives a non-JSON error body from a proxy in front of the API", async () => {
    const stub = stubFetch({ status: 403, text: "<html>blocked</html>" });
    const result = await executorWith(stub).execute(tool("list_monitors"), {});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Forbidden");
  });
});

describe("transport failures", () => {
  it("names the URL and the setting when the request never lands", async () => {
    const executor = new ToolExecutor({
      apiUrl: "https://api.fettle.invalid",
      apiKey: "fettle_secret",
      timeoutMs: 1000,
      userAgent: "fettle-mcp/0.1.0",
      fetchImpl: throwingFetch(new Error("getaddrinfo ENOTFOUND")),
    });
    await expect(executor.execute(tool("list_monitors"), {})).rejects.toThrow(
      /api\.fettle\.invalid.*ENOTFOUND/s,
    );
  });

  it("says it timed out, and which setting raises the limit", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const executor = new ToolExecutor({
      apiUrl: "https://api.fettle.sh",
      apiKey: "fettle_secret",
      timeoutMs: 25,
      userAgent: "fettle-mcp/0.1.0",
      fetchImpl: throwingFetch(timeout),
    });
    await expect(executor.execute(tool("list_monitors"), {})).rejects.toThrow(
      /timed out after 25ms.*FETTLE_TIMEOUT_MS/s,
    );
  });
});

describe("fixed query parameters", () => {
  function pinned(name: string, fixed: Record<string, string>): ToolEntry {
    const base = tool(name);
    return { ...base, operation: { ...base.operation, fixed_query: fixed } };
  }

  it("appends a pinned parameter after the model's own", async () => {
    const stub = stubFetch({ status: 200, body: { items: [] } });
    await executorWith(stub).execute(pinned("list_monitors", { view: "compact" }), {
      page: 2,
      sort: "newest",
    });
    expect(stub.calls[0]!.url).toBe(
      "https://api.fettle.sh/v1/monitors?page=2&sort=newest&view=compact",
    );
  });

  it("sends the pinned parameter even when the model passed no arguments", async () => {
    const stub = stubFetch({ status: 200, body: { items: [] } });
    await executorWith(stub).execute(pinned("list_monitors", { view: "compact" }), {});
    expect(stub.calls[0]!.url).toBe("https://api.fettle.sh/v1/monitors?view=compact");
  });

  it("lets the pinned value win over a declared argument of the same name", async () => {
    const base = tool("list_monitors");
    const entry: ToolEntry = {
      ...base,
      operation: {
        ...base.operation,
        query: [...base.operation.query, "view"],
        fixed_query: { view: "compact" },
      },
    };
    const stub = stubFetch({ status: 200, body: { items: [] } });
    await executorWith(stub).execute(entry, { view: "full" });
    const url = new URL(stub.calls[0]!.url);
    expect(url.searchParams.getAll("view")).toEqual(["compact"]);
  });

  it("still refuses an undeclared argument that shares a pinned key's name", async () => {
    const stub = stubFetch({ status: 200, body: { items: [] } });
    await expect(
      executorWith(stub).execute(pinned("list_monitors", { view: "compact" }), {
        view: "full",
      }),
    ).rejects.toThrow(ToolArgumentError);
    expect(stub.calls).toHaveLength(0);
  });
});

describe("operation shapes added with the 49-tool contract", () => {
  const MONITOR = "0198f2b0-0000-7000-8000-000000000001";
  const PAGE = "0198f2b0-0000-7000-8000-0000000000aa";
  const INCIDENT = "0198f2b0-0000-7000-8000-0000000000bb";

  it("sends delete_tag's tag in the query string of a bodyless DELETE", async () => {
    const stub = stubFetch({ status: 204 });
    const result = await executorWith(stub).execute(tool("delete_tag"), {
      tag: "prod db",
    });
    const call = stub.calls[0]!;
    expect(call.method).toBe("DELETE");
    expect(call.url).toBe("https://api.fettle.sh/v1/tags?tag=prod+db");
    expect(call.body).toBeUndefined();
    expect(call.headers["Content-Type"]).toBeUndefined();
    expect(result.content[0]!.text).toContain("delete_tag succeeded (204)");
  });

  it("sends rename_tag's from and to as a PATCH body, not as query parameters", async () => {
    const stub = stubFetch({ status: 200, body: { renamed: 3 } });
    await executorWith(stub).execute(tool("rename_tag"), { from: "prod", to: "live" });
    const call = stub.calls[0]!;
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe("https://api.fettle.sh/v1/tags");
    expect(JSON.parse(call.body!)).toEqual({ from: "prod", to: "live" });
  });

  it("sends a bulk PATCH with the whole changes object in the body", async () => {
    const stub = stubFetch({ status: 200, body: { updated: 2 } });
    await executorWith(stub).execute(tool("bulk_update_monitors"), {
      monitor_ids: [MONITOR],
      changes: { interval_seconds: 300 },
    });
    const call = stub.calls[0]!;
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe("https://api.fettle.sh/v1/monitors/bulk");
    expect(JSON.parse(call.body!)).toEqual({
      monitor_ids: [MONITOR],
      changes: { interval_seconds: 300 },
    });
  });

  it("substitutes two path parameters into a DELETE", async () => {
    const stub = stubFetch({ status: 204 });
    await executorWith(stub).execute(tool("delete_status_page_incident"), {
      page_id: PAGE,
      incident_id: INCIDENT,
    });
    const call = stub.calls[0]!;
    expect(call.method).toBe("DELETE");
    expect(call.url).toBe(
      `https://api.fettle.sh/v1/status-pages/${PAGE}/incidents/${INCIDENT}`,
    );
    expect(call.body).toBeUndefined();
  });

  it("keeps both path parameters out of a nested route's body", async () => {
    const stub = stubFetch({ status: 201, body: {} });
    await executorWith(stub).execute(tool("post_status_page_update"), {
      page_id: PAGE,
      incident_id: INCIDENT,
      status: "MONITORING",
      body: "Fix deployed.",
    });
    const call = stub.calls[0]!;
    expect(call.url).toBe(
      `https://api.fettle.sh/v1/status-pages/${PAGE}/incidents/${INCIDENT}/updates`,
    );
    expect(JSON.parse(call.body!)).toEqual({
      status: "MONITORING",
      body: "Fix deployed.",
    });
  });

  it("refuses a second path parameter carrying '/', not only the first", async () => {
    const stub = stubFetch({ status: 204 });
    await expect(
      executorWith(stub).execute(tool("delete_status_page_incident"), {
        page_id: PAGE,
        incident_id: "x/../../monitors",
      }),
    ).rejects.toThrow(/'incident_id' may not contain/);
    expect(stub.calls).toHaveLength(0);
  });

  it("combines a path parameter with query parameters", async () => {
    const stub = stubFetch({ status: 200, body: { items: [] } });
    await executorWith(stub).execute(tool("list_check_results"), {
      monitor_id: MONITOR,
      region: "eu-central",
      page: 2,
    });
    expect(stub.calls[0]!.url).toBe(
      `https://api.fettle.sh/v1/monitors/${MONITOR}/check-results?page=2&region=eu-central`,
    );
  });

  it("sends a monitor's stats window as a query parameter", async () => {
    const stub = stubFetch({ status: 200, body: [] });
    await executorWith(stub).execute(tool("get_response_time_by_region"), {
      monitor_id: MONITOR,
      window: "7d",
    });
    expect(stub.calls[0]!.url).toBe(
      `https://api.fettle.sh/v1/monitors/${MONITOR}/response-time-by-region?window=7d`,
    );
  });
});
