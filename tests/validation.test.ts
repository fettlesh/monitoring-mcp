import { describe, expect, it } from "vitest";

import { compileValidators, describeSchemaErrors } from "../src/validation.js";
import { contract } from "./helpers.js";

const validators = compileValidators(contract);

function check(toolName: string, args: Record<string, unknown>): string | null {
  const validate = validators.get(toolName)!;
  return validate(args) ? null : describeSchemaErrors(toolName, validate.errors);
}

describe("compileValidators", () => {
  it("compiles every schema in the vendored contract", () => {
    expect(validators.size).toBe(contract.tools.length);
  });
});

describe("argument validation", () => {
  it("refuses view on list_monitors: the contract pins it, the model cannot set it", () => {
    expect(check("list_monitors", { view: "full" })).toContain("view");
  });

  it("accepts arguments the API would accept", () => {
    expect(
      check("get_monitor", { monitor_id: "0198f2b0-0000-7000-8000-000000000001" }),
    ).toBeNull();
    expect(check("list_monitors", { page: 1, size: 20, sort: "newest" })).toBeNull();
    expect(check("list_monitors", { sort: "response_time" })).toBeNull();
  });

  it("names the argument over a size limit of the contract", () => {
    const deployed_at = "2026-11-24T00:00:00Z";
    expect(check("record_deploy", { deployed_at, ref: "a".repeat(200) })).toBeNull();
    expect(check("record_deploy", { deployed_at, ref: "a".repeat(201) })).toContain(
      "'ref': must NOT have more than 200 characters",
    );
    expect(
      check("list_monitors", { status: Array.from({ length: 101 }, () => "UP") }),
    ).toContain("'status': must NOT have more than 100 items");
    expect(check("list_monitors", { page: 2147483648 })).toContain(
      "'page': must be <= 2147483647",
    );
  });

  it("accepts a value at the limit and refuses the one past it", () => {
    const id = "0198f2b0-0000-7000-8000-000000000001";
    const of = (count: number, value: unknown) =>
      Array.from({ length: count }, () => value);
    expect(
      check("list_monitors", { status: of(100, "UP"), page: 2147483647 }),
    ).toBeNull();

    const monitor = { name: "a", type: "HTTP", target: "https://example.com" };
    const config = (size: number) =>
      Object.fromEntries(of(size, 0).map((_, index) => [`key${index}`, index]));
    const create = (extra: object) =>
      check("create_monitor", { ...monitor, ...extra }) ?? "";
    expect(create({ config: config(32) })).not.toContain("'config'");
    expect(create({ config: config(33) })).toContain(
      "'config': must NOT have more than 32",
    );
    expect(create({ regions: ["r".repeat(64)] })).not.toContain("'regions");
    expect(create({ regions: ["r".repeat(65)] })).toContain(
      "'regions.0': must NOT have more than 64 characters",
    );
    expect(create({ channel_ids: of(10000, id) })).not.toContain("'channel_ids'");
    expect(create({ channel_ids: of(10001, id) })).toContain(
      "'channel_ids': must NOT have more than 10000 items",
    );
    expect(
      check("bulk_create_monitors", {
        monitors: [{ ...monitor, regions: of(101, "eu-central") }],
      }),
    ).toContain("'monitors.0.regions': must NOT have more than 100 items");
    expect(
      check("create_maintenance_window", { monitor_ids: of(10001, id) }),
    ).toContain("'monitor_ids': must NOT have more than 10000 items");
    expect(check("draft_status_page_post", { component_ids: of(10001, id) })).toContain(
      "'component_ids': must NOT have more than 10000 items",
    );
  });

  it("caps the text and names the size error first", () => {
    const message = check("create_monitor", {
      name: "a",
      type: "HTTP",
      target: "https://example.com",
      channel_ids: Array.from({ length: 10001 }, () => "bad"),
    })!;
    expect(message).toMatch(
      /^Invalid argument\(s\) for 'create_monitor' — 'channel_ids': must NOT have more than 10000 items; /,
    );
    expect(message).toMatch(/; and \d+ more\. Fix the value\(s\) and retry\.$/);
    expect(message.length).toBeLessThan(1500);
  });

  it("names a missing required argument", () => {
    expect(check("get_monitor", {})).toContain("'monitor_id': required argument");
  });

  it("catches a malformed uuid before it costs a request", () => {
    const message = check("get_monitor", { monitor_id: "not-a-uuid" });
    expect(message).toContain("monitor_id");
    expect(message).toContain("uuid");
  });

  it("catches a value outside the enum, listing the tool it belongs to", () => {
    const message = check("list_monitors", { sort: "loudest" });
    expect(message).toContain("'list_monitors'");
    expect(message).toContain("sort");
  });

  it("catches a page size the API caps", () => {
    expect(check("list_monitors", { size: 500 })).toContain("size");
  });

  it("rejects an argument the tool does not declare, saying so plainly", () => {
    expect(check("list_monitors", { organisation: "acme" })).toContain(
      "'organisation': unexpected argument",
    );
  });

  it("reports several bad arguments in one message rather than one per round trip", () => {
    const message = check("list_monitors", { size: 500, sort: "loudest" })!;
    expect(message).toContain("size");
    expect(message).toContain("sort");
  });
});

describe("describeSchemaErrors", () => {
  it("still says something actionable when Ajv reports nothing", () => {
    expect(describeSchemaErrors("get_monitor", null)).toContain(
      "rejected the arguments",
    );
  });

  it("does not repeat one argument that tripped two keywords", () => {
    const message = describeSchemaErrors("get_monitor", [
      {
        instancePath: "/monitor_id",
        schemaPath: "#/properties/monitor_id/type",
        keyword: "type",
        params: {},
        message: "must be string",
      },
      {
        instancePath: "/monitor_id",
        schemaPath: "#/properties/monitor_id/type",
        keyword: "type",
        params: {},
        message: "must be string",
      },
    ]);
    expect(message.match(/monitor_id/g)).toHaveLength(1);
  });
});

describe("required query parameters", () => {
  it("refuses delete_tag without its tag before a request is spent", () => {
    expect(check("delete_tag", {})).toContain("'tag': required argument");
  });

  it("accepts delete_tag with a tag", () => {
    expect(check("delete_tag", { tag: "prod" })).toBeNull();
  });
});

describe("list_incidents sort", () => {
  it("accepts the attention order", () => {
    expect(check("list_incidents", { sort: "attention" })).toBeNull();
  });

  it("refuses any other order before a request is spent", () => {
    expect(check("list_incidents", { sort: "oldest" })).toContain("sort");
  });
});

describe("domain_expiry_enabled", () => {
  it("is accepted on create_monitor, update_monitor and each bulk_create_monitors item", () => {
    expect(
      check("create_monitor", {
        name: "Shop",
        type: "HTTP",
        target: "https://shop.example.com",
        interval_seconds: 300,
        timeout_seconds: 10,
        regions: ["eu"],
        domain_expiry_enabled: true,
      }),
    ).toBeNull();
    expect(
      check("update_monitor", {
        monitor_id: "0198f2b0-0000-7000-8000-000000000001",
        domain_expiry_enabled: false,
      }),
    ).toBeNull();
    expect(
      check("bulk_create_monitors", {
        monitors: [
          {
            name: "Shop",
            type: "HTTP",
            target: "https://shop.example.com",
            interval_seconds: 300,
            timeout_seconds: 10,
            regions: ["eu"],
            domain_expiry_enabled: true,
          },
        ],
      }),
    ).toBeNull();
  });
});
