import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { describe, expect, it } from "vitest";

import {
  CONTRACT_URL,
  findTool,
  loadContract,
  parseContract,
  SUPPORTED_CONTRACT_VERSION,
} from "../src/contract.js";

const vendored = loadContract();

function validDocument(): Record<string, unknown> {
  return {
    version: SUPPORTED_CONTRACT_VERSION,
    tools: [
      {
        name: "list_monitors",
        title: "List monitors",
        description: "…",
        scope: "read",
        input_schema: { type: "object", properties: {}, required: [] },
        operation: {
          method: "GET",
          path: "/v1/monitors",
          path_params: [],
          query: ["page"],
          body: false,
        },
      },
    ],
  };
}

describe("the vendored contract", () => {
  it("loads from the package root, not the working directory", () => {
    expect(CONTRACT_URL.pathname).toMatch(/\/contracts\/mcp_tools\.json$/);
    expect(vendored.version).toBe(SUPPORTED_CONTRACT_VERSION);
  });

  it("carries the fifty tools production serves", () => {
    expect(vendored.tools).toHaveLength(50);
    expect(vendored.tools.map((tool) => tool.name).sort()).toEqual([
      "acknowledge_incident",
      "bulk_create_monitors",
      "bulk_pause_monitors",
      "bulk_resume_monitors",
      "bulk_update_heartbeat_tags",
      "bulk_update_monitor_tags",
      "bulk_update_monitors",
      "check_now",
      "check_target",
      "create_heartbeat",
      "create_maintenance_window",
      "create_monitor",
      "create_status_page_incident",
      "delete_heartbeat",
      "delete_maintenance_window",
      "delete_monitor",
      "delete_status_page_incident",
      "delete_tag",
      "get_exposed_ports_preset",
      "get_heartbeat",
      "get_incident",
      "get_maintenance_window",
      "get_monitor",
      "get_plan_usage",
      "get_response_time_by_region",
      "get_status_page",
      "get_uptime_daily",
      "get_uptime_summary",
      "list_active_maintenance",
      "list_channels",
      "list_check_results",
      "list_heartbeats",
      "list_incidents",
      "list_maintenance_windows",
      "list_monitors",
      "list_regions",
      "list_status_page_incidents",
      "list_status_pages",
      "list_tags",
      "pause_heartbeat",
      "pause_monitor",
      "post_status_page_update",
      "preview_maintenance_window",
      "rename_tag",
      "resume_heartbeat",
      "resume_monitor",
      "update_heartbeat",
      "update_maintenance_window",
      "update_monitor",
      "update_status_page_incident",
    ]);
  });

  it("routes every argument a bodyless tool accepts to its path or query", () => {
    // The executor refuses an argument that matches no path or query parameter
    // on a tool without a body. A schema property with no route would pass
    // validation and then fail every call, so the contract must never have one.
    for (const tool of vendored.tools.filter((entry) => !entry.operation.body)) {
      const properties = Object.keys(
        (tool.input_schema.properties ?? {}) as Record<string, unknown>,
      );
      const routed = [...tool.operation.path_params, ...tool.operation.query];
      for (const name of properties) {
        expect(routed, `${tool.name}.${name}`).toContain(name);
      }
    }
  });

  it("lists delete_tag's query parameter as required, so a call cannot omit it", () => {
    const deleteTag = findTool(vendored, "delete_tag")!;
    expect(deleteTag.operation).toMatchObject({
      method: "DELETE",
      query: ["tag"],
      body: false,
    });
    expect(deleteTag.input_schema.required).toEqual(["tag"]);
  });

  it("pins the compact view on list_monitors", () => {
    expect(findTool(vendored, "list_monitors")!.operation.fixed_query).toEqual({
      view: "compact",
    });
  });

  it("never exposes a pinned key to the model as a parameter it could set", () => {
    for (const tool of vendored.tools) {
      const properties = Object.keys(
        (tool.input_schema.properties ?? {}) as Record<string, unknown>,
      );
      for (const name of Object.keys(tool.operation.fixed_query)) {
        expect(tool.operation.query).not.toContain(name);
        expect(properties).not.toContain(name);
      }
    }
  });

  it("declares every path parameter its path template actually contains", () => {
    for (const tool of vendored.tools) {
      const templated = [...tool.operation.path.matchAll(/\{([^}]+)\}/g)].map(
        (match) => match[1],
      );
      expect(templated.sort()).toEqual([...tool.operation.path_params].sort());
    }
  });

  it("requires every path parameter in its input schema, so a call cannot omit one", () => {
    for (const tool of vendored.tools) {
      const required = (tool.input_schema.required ?? []) as string[];
      for (const name of tool.operation.path_params) {
        expect(required).toContain(name);
      }
    }
  });

  it("finds a tool by name and reports an unknown one as undefined", () => {
    expect(findTool(vendored, "get_monitor")?.operation.method).toBe("GET");
    expect(findTool(vendored, "delete_organization")).toBeUndefined();
  });
});

describe("contract validation", () => {
  it("accepts a well-formed document", () => {
    expect(parseContract(validDocument()).tools).toHaveLength(1);
  });

  it("refuses a format version it cannot read, naming the upgrade", () => {
    const document = { ...validDocument(), version: 99 };
    expect(() => parseContract(document)).toThrow(/fettle-mcp@latest/);
  });

  it("refuses a document with no tools rather than serving an empty tool list", () => {
    expect(() => parseContract({ ...validDocument(), tools: [] })).toThrow(/no tools/);
  });

  it("refuses a duplicate tool name, which would silently shadow one of the two", () => {
    const document = validDocument();
    const tools = document.tools as unknown[];
    document.tools = [tools[0], tools[0]];
    expect(() => parseContract(document)).toThrow(/declared twice/);
  });

  it("refuses an unsupported HTTP method", () => {
    const document = validDocument();
    const tool = (document.tools as Record<string, unknown>[])[0]!;
    (tool.operation as Record<string, unknown>).method = "PUT";
    expect(() => parseContract(document)).toThrow(/unsupported method/);
  });

  it("refuses a relative path, which would resolve against the wrong host", () => {
    const document = validDocument();
    const tool = (document.tools as Record<string, unknown>[])[0]!;
    (tool.operation as Record<string, unknown>).path = "v1/monitors";
    expect(() => parseContract(document)).toThrow(/non-absolute path/);
  });
});

describe("operation.fixed_query", () => {
  function withFixedQuery(value: unknown): Record<string, unknown> {
    const document = validDocument();
    const [entry] = document.tools as Array<Record<string, unknown>>;
    (entry!.operation as Record<string, unknown>).fixed_query = value;
    return document;
  }

  it("defaults to an empty map when the contract omits it", () => {
    const contract = parseContract(validDocument());
    expect(contract.tools[0]!.operation.fixed_query).toEqual({});
  });

  it("carries a string-to-string map through unchanged", () => {
    const contract = parseContract(withFixedQuery({ view: "compact" }));
    expect(contract.tools[0]!.operation.fixed_query).toEqual({ view: "compact" });
  });

  it.each([
    ["an array", ["view", "compact"]],
    ["null", null],
    ["a string", "view=compact"],
    ["a non-string value", { view: 1 }],
  ])("rejects %s at load time, naming the tool", (_label, value) => {
    expect(() => parseContract(withFixedQuery(value))).toThrow(
      /Invalid tool contract: tool 'list_monitors' has a malformed fixed_query/,
    );
  });
});

describe("instructions", () => {
  it("is undefined when the document omits it (0.2.0-era contracts)", () => {
    expect(parseContract(validDocument()).instructions).toBeUndefined();
  });

  it("is carried through verbatim when it is a non-empty string", () => {
    const document = { ...validDocument(), instructions: "Guide\n\n- step one" };
    expect(parseContract(document).instructions).toBe("Guide\n\n- step one");
  });

  it('treats an empty string as absent — core writes "" when it has no guide', () => {
    const document = { ...validDocument(), instructions: "" };
    expect(parseContract(document).instructions).toBeUndefined();
  });

  it.each([42, ["x"], { text: "x" }, null])("fails at startup on %j", (value) => {
    const document = { ...validDocument(), instructions: value };
    expect(() => parseContract(document)).toThrow(/Invalid tool contract/);
  });
});

describe("annotations", () => {
  const hints = {
    read_only_hint: false,
    destructive_hint: true,
    idempotent_hint: true,
    open_world_hint: false,
  };

  function withAnnotations(value: unknown): Record<string, unknown> {
    const document = validDocument();
    const [entry] = document.tools as Array<Record<string, unknown>>;
    entry!.annotations = value;
    return document;
  }

  it("is undefined when the contract omits it (pre-0.5.0 contracts)", () => {
    expect(parseContract(validDocument()).tools[0]!.annotations).toBeUndefined();
  });

  it("carries all four hints through unchanged", () => {
    expect(parseContract(withAnnotations(hints)).tools[0]!.annotations).toEqual(hints);
  });

  it.each([
    ["null", null],
    ["a string", "read_only"],
    ["a missing hint", { ...hints, destructive_hint: undefined }],
    ["a non-boolean hint", { ...hints, read_only_hint: "true" }],
  ])("rejects %s at load time, naming the tool", (_label, value) => {
    expect(() => parseContract(withAnnotations(value))).toThrow(
      /Invalid tool contract: tool 'list_monitors'/,
    );
  });

  it("is set on every vendored tool, deletes marked destructive and lists read-only", () => {
    for (const entry of vendored.tools) {
      expect(entry.annotations, entry.name).toBeDefined();
      expect(entry.annotations!.destructive_hint, entry.name).toBe(
        entry.name.startsWith("delete_"),
      );
    }
    expect(findTool(vendored, "list_monitors")!.annotations!.read_only_hint).toBe(true);
    expect(findTool(vendored, "create_monitor")!.annotations!.read_only_hint).toBe(
      false,
    );
  });
});

describe("output_schema", () => {
  function withOutputSchema(value: unknown): Record<string, unknown> {
    const document = validDocument();
    const [entry] = document.tools as Array<Record<string, unknown>>;
    entry!.output_schema = value;
    return document;
  }

  it("is undefined when the contract omits it (pre-0.6.0 contracts)", () => {
    expect(parseContract(validDocument()).tools[0]!.output_schema).toBeUndefined();
  });

  it("carries an object schema through unchanged", () => {
    const schema = { type: "object", properties: { id: { type: "string" } } };
    expect(parseContract(withOutputSchema(schema)).tools[0]!.output_schema).toEqual(
      schema,
    );
  });

  it.each([
    ["a string", "object"],
    ["an array", []],
    ["a non-object schema", { type: "array" }],
  ])("rejects %s at load time, naming the tool", (_label, value) => {
    expect(() => parseContract(withOutputSchema(value))).toThrow(
      /Invalid tool contract: tool 'list_monitors'/,
    );
  });

  it("compiles every vendored schema with the validator MCP clients use", () => {
    const validator = new AjvJsonSchemaValidator();
    const withSchema = vendored.tools.filter((entry) => entry.output_schema);
    expect(withSchema.length).toBeGreaterThan(40);
    for (const entry of withSchema) {
      expect(
        () => validator.getValidator(entry.output_schema!),
        entry.name,
      ).not.toThrow();
    }
  });
});

interface DailyOutput {
  properties: {
    days: {
      items: {
        properties: Record<string, Record<string, unknown>>;
        required: string[];
      };
    };
  };
}

describe("get_uptime_daily", () => {
  const daily = findTool(vendored, "get_uptime_daily")!;
  const day = (daily.output_schema as unknown as DailyOutput).properties.days.items;

  it("reports each day's confirmed degradation in degraded_seconds", () => {
    expect(day.properties.degraded_seconds).toMatchObject({ type: "integer" });
    expect(day.properties.degraded_seconds!.description).toEqual(expect.any(String));
    expect(day.properties.degraded_seconds).not.toHaveProperty("minimum");
    expect(daily.description).toContain("degraded_seconds");
  });

  it("does not require degraded_seconds, so an older API's day still validates", () => {
    expect(day.required).not.toContain("degraded_seconds");
  });

  it("keeps the first sentence the docs page falls back to", () => {
    expect(daily.description).toMatch(
      /^Report one monitor's uptime for each UTC day, oldest first and ending today, to find the day an outage or degradation began\. /,
    );
  });
});

interface ArgumentsSchema {
  properties: Record<string, { description?: string }>;
}

describe("create guidance", () => {
  it("create_monitor defaults regions to every code in the plan's allowed_regions", () => {
    const create = findTool(vendored, "create_monitor")!;
    const regions = (create.input_schema as unknown as ArgumentsSchema).properties
      .regions!;
    expect(regions.description).toContain(
      "Unless the user names regions, pass every code in limits.allowed_regions",
    );
  });

  it("create_monitor asks to tell the user the interval it chose", () => {
    const create = findTool(vendored, "create_monitor")!;
    const interval = (create.input_schema as unknown as ArgumentsSchema).properties
      .interval_seconds!;
    expect(interval.description).toContain("Tell the user the interval");
  });

  it("bulk_create_monitors gives each item the plan's allowed_regions", () => {
    const bulk = findTool(vendored, "bulk_create_monitors")!;
    const monitors = (bulk.input_schema as unknown as ArgumentsSchema).properties
      .monitors!;
    expect(monitors.description).toContain(
      "Unless the user names regions, give each item every code in limits.allowed_regions",
    );
  });

  it("tells the agent about allowed_regions and offering update_monitor in the server instructions", () => {
    expect(vendored.instructions).toContain("allowed_regions");
    expect(vendored.instructions).toContain(
      "After create, tell the user the interval and regions chosen; offer to change the interval (update_monitor).",
    );
  });

  it("keeps the instructions within the 4096 characters a client keeps", () => {
    expect(vendored.instructions!.length).toBeLessThanOrEqual(4096);
  });
});
