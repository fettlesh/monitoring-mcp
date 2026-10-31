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
