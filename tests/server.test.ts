import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import type { ToolContract } from "../src/contract.js";
import { ToolExecutor } from "../src/executor.js";
import { createServer } from "../src/server.js";
import { contract, stubFetch, type StubResponse } from "./helpers.js";

async function connectedClient(responses: StubResponse | StubResponse[]) {
  const stub = stubFetch(responses);
  const executor = new ToolExecutor({
    apiUrl: "https://api.fettle.sh",
    apiKey: "fettle_secret",
    timeoutMs: 1000,
    userAgent: "fettle-mcp/0.1.0",
    fetchImpl: stub.impl,
  });
  const server = createServer(contract, executor, {
    name: "fettle-mcp",
    version: "0.1.0",
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, stub };
}

describe("tools/list", () => {
  it("offers exactly what the contract declares, under the wire's camelCase key", async () => {
    const { client } = await connectedClient({ status: 200, body: {} });
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(contract.tools.length);
    const listMonitors = tools.find((entry) => entry.name === "list_monitors")!;
    expect(listMonitors.title).toBe("List monitors");
    expect(listMonitors.inputSchema).toEqual(
      contract.tools.find((entry) => entry.name === "list_monitors")!.input_schema,
    );
  });

  it("sends each tool's hints under the wire's camelCase keys", async () => {
    const { client } = await connectedClient({ status: 200, body: {} });
    const { tools } = await client.listTools();

    const deleteMonitor = tools.find((entry) => entry.name === "delete_monitor")!;
    expect(deleteMonitor.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    const listMonitors = tools.find((entry) => entry.name === "list_monitors")!;
    expect(listMonitors.annotations?.readOnlyHint).toBe(true);
  });

  it("announces the tools capability, so a client knows to ask at all", async () => {
    const { client } = await connectedClient({ status: 200, body: {} });
    expect(client.getServerCapabilities()?.tools).toBeDefined();
  });
});

describe("tools/call", () => {
  it("executes a tool and returns the API payload", async () => {
    const { client, stub } = await connectedClient({
      status: 200,
      body: { items: [{ id: "m-1", name: "Docs" }] },
    });
    const result = (await client.callTool({
      name: "list_monitors",
      arguments: { page: 1 },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(stub.calls[0]!.url).toBe(
      "https://api.fettle.sh/v1/monitors?page=1&view=compact",
    );
    const [block] = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(block!.text)).toEqual({ items: [{ id: "m-1", name: "Docs" }] });
  });

  it("rejects bad arguments without spending a request", async () => {
    const { client, stub } = await connectedClient({ status: 200, body: {} });
    const result = (await client.callTool({
      name: "get_monitor",
      arguments: { monitor_id: "not-a-uuid" },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(stub.calls).toHaveLength(0);
  });

  it("returns a 4xx as an error result the model can act on, not a protocol error", async () => {
    const { client } = await connectedClient({
      status: 403,
      body: { message: "API key scope is not sufficient" },
    });
    const result = (await client.callTool({
      name: "delete_monitor",
      arguments: { monitor_id: "0198f2b0-0000-7000-8000-000000000001" },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    const [block] = result.content as Array<{ type: string; text: string }>;
    expect(block!.text).toContain("write scope");
  });

  it("raises a protocol error for a 5xx, which no argument can fix", async () => {
    const { client } = await connectedClient({ status: 503, text: "unavailable" });
    await expect(
      client.callTool({ name: "list_monitors", arguments: {} }),
    ).rejects.toThrow(/the API returned 503/);
  });

  it("raises for a tool the contract does not declare", async () => {
    const { client } = await connectedClient({ status: 200, body: {} });
    await expect(
      client.callTool({ name: "drop_database", arguments: {} }),
    ).rejects.toThrow(/Unknown tool/);
  });

  it("treats a call with no arguments at all as an empty argument object", async () => {
    const { client, stub } = await connectedClient({
      status: 200,
      body: { items: [], total: 0, page: 1, size: 25, pages: 0 },
    });
    const result = (await client.callTool({
      name: "list_status_pages",
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(stub.calls[0]!.url).toBe("https://api.fettle.sh/v1/status-pages");
  });
});

/** A heartbeat as the API sends it: naive timestamps, null fields, no tags. */
const HEARTBEAT = {
  id: "0199a2b1-0000-7000-8000-000000000001",
  name: "Nightly backup",
  state: "PENDING",
  period_seconds: 86400,
  grace_seconds: 3600,
  ping_url: "https://ping.fettle.sh/h/abc",
  last_ping_at: null,
  last_success_at: null,
  last_start_at: null,
  last_duration_ms: null,
  overdue_at: null,
  notification_cooldown_seconds: 0,
  is_active: true,
  channel_ids: [],
  tags: [],
  created_at: "2026-10-20T09:00:00.123456",
  updated_at: "2026-10-20T09:00:00.123456",
};

describe("output schemas", () => {
  it("sends a tool's outputSchema, and none for a tool without one", async () => {
    const { client } = await connectedClient({ status: 200, body: {} });
    const { tools } = await client.listTools();

    const getHeartbeat = tools.find((entry) => entry.name === "get_heartbeat")!;
    expect(getHeartbeat.outputSchema).toEqual(
      contract.tools.find((entry) => entry.name === "get_heartbeat")!.output_schema,
    );
    const listMonitors = tools.find((entry) => entry.name === "list_monitors")!;
    expect(listMonitors.outputSchema).toBeUndefined();
  });

  it("answers with structured content the SDK client accepts", async () => {
    const { client } = await connectedClient({ status: 200, body: HEARTBEAT });
    // A client checks results only against schemas it has listed.
    await client.listTools();
    const result = (await client.callTool({
      name: "get_heartbeat",
      arguments: { heartbeat_id: HEARTBEAT.id },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(HEARTBEAT);
    const [block] = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(block!.text)).toEqual(HEARTBEAT);
  });

  it("accepts an answer from a newer API: a new field, a new enum value", async () => {
    const newer = { ...HEARTBEAT, state: "SNOOZED", added_later: { nested: true } };
    const { client } = await connectedClient({ status: 200, body: newer });
    await client.listTools();
    const result = (await client.callTool({
      name: "get_heartbeat",
      arguments: { heartbeat_id: HEARTBEAT.id },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(newer);
  });

  it("is really checked by the client, so the test above means something", async () => {
    const { name: _dropped, ...withoutName } = HEARTBEAT;
    const { client } = await connectedClient({ status: 200, body: withoutName });
    await client.listTools();

    await expect(
      client.callTool({
        name: "get_heartbeat",
        arguments: { heartbeat_id: HEARTBEAT.id },
      }),
    ).rejects.toThrow(/structured content does not match/i);
  });

  it("accepts get_uptime_daily days with and without degraded_seconds", async () => {
    expect(
      contract.tools.find((entry) => entry.name === "get_uptime_daily")!.output_schema,
    ).toHaveProperty("properties.days.items.properties.degraded_seconds");
    const DAILY = {
      monitor_id: HEARTBEAT.id,
      days: [
        {
          date: "2026-10-21",
          uptime_percentage: 100,
          total_checks: 1440,
          up_checks: 1380,
          down_checks: 0,
          degraded_checks: 60,
          maintenance_checks: 0,
          downtime_seconds: 0,
          observed_seconds: 86400,
          degraded_seconds: 720,
        },
        {
          date: "2026-10-22",
          uptime_percentage: null,
          total_checks: 0,
          up_checks: 0,
          down_checks: 0,
          degraded_checks: 0,
          maintenance_checks: 0,
          downtime_seconds: 0,
          observed_seconds: 0,
        },
      ],
    };
    const { client } = await connectedClient({ status: 200, body: DAILY });
    await client.listTools();
    const result = (await client.callTool({
      name: "get_uptime_daily",
      arguments: { monitor_id: HEARTBEAT.id },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(DAILY);
  });

  it("sends no structured content on an error result", async () => {
    const { client } = await connectedClient({
      status: 404,
      body: { detail: "Heartbeat not found" },
    });
    await client.listTools();
    const result = (await client.callTool({
      name: "get_heartbeat",
      arguments: { heartbeat_id: HEARTBEAT.id },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });
});

async function instructionsSeenBy(served: ToolContract): Promise<string | undefined> {
  const executor = new ToolExecutor({
    apiUrl: "https://api.fettle.sh",
    apiKey: "fettle_secret",
    timeoutMs: 1000,
    userAgent: "fettle-mcp/0.1.0",
    fetchImpl: stubFetch({ status: 200, body: {} }).impl,
  });
  const server = createServer(served, executor, {
    name: "fettle-mcp",
    version: "0.1.0",
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client.getInstructions();
}

describe("initialize", () => {
  it("sends the contract's instructions to the client", async () => {
    expect(
      await instructionsSeenBy({ ...contract, instructions: "How to use Fettle" }),
    ).toBe("How to use Fettle");
  });

  it("sends no instructions when the contract has none", async () => {
    const bare: ToolContract = { version: contract.version, tools: contract.tools };
    expect(await instructionsSeenBy(bare)).toBeUndefined();
  });
});
