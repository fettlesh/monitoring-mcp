/**
 * Argument validation against the contract's own JSON Schemas.
 *
 * The schemas are generated from core's pydantic models, so validating here
 * catches exactly what the API would have rejected — one round trip earlier,
 * without spending a unit of the organization's rate budget, and with the
 * offending field named in the same wording a 422 would have used. This is a
 * pre-filter, never an authority: the API still validates everything, and a
 * schema that lets something through is core's problem to answer.
 *
 * Ajv runs with `strict: false` on purpose. Strict mode rejects schemas over
 * details of *how* they are written — an unrecognised keyword, a format it
 * does not know — and this package does not author these schemas, it receives
 * them. A newly generated contract must never fail to load here because the
 * generator started emitting a keyword this version had not seen.
 */

import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import ajvFormats from "ajv-formats";

import type { ToolContract } from "./contract.js";

export type ToolValidators = Map<string, ValidateFunction>;

/**
 * `ajv-formats` is CommonJS whose `module.exports` *is* the plugin function.
 * Node's ESM interop hands that function straight to a default import, but
 * TypeScript under NodeNext types the same import as the module namespace, so
 * the shape is asserted once here rather than fought at the call site.
 */
const addFormats = ajvFormats as unknown as (ajv: Ajv) => Ajv;

/** Compile one validator per tool, once, at startup. */
export function compileValidators(contract: ToolContract): ToolValidators {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validators: ToolValidators = new Map();
  for (const tool of contract.tools) {
    validators.set(tool.name, ajv.compile(tool.input_schema));
  }
  return validators;
}

function describeError(error: ErrorObject): string {
  const path = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
  if (error.keyword === "required") {
    const missing = (error.params as { missingProperty?: string }).missingProperty;
    const field = path === "" ? missing : `${path}.${missing}`;
    return `'${field}': required argument is missing`;
  }
  if (error.keyword === "additionalProperties") {
    const extra = (error.params as { additionalProperty?: string }).additionalProperty;
    const field = path === "" ? extra : `${path}.${extra}`;
    return `'${field}': unexpected argument — this tool does not accept it`;
  }
  const field = path === "" ? "arguments" : path;
  return `'${field}': ${error.message ?? "is invalid"}`;
}

/** The text goes into the model's context, so a long array must not fill it. */
const MAX_REPORTED_ERRORS = 10;

/**
 * Turn Ajv's errors into the same field-naming sentence a 422 would produce.
 *
 * Deduplicated because `allErrors` reports one entry per failing keyword, and
 * a single bad value routinely trips two of them — the model does not need to
 * be told twice about one argument.
 */
export function describeSchemaErrors(
  toolName: string,
  errors: ErrorObject[] | null | undefined,
): string {
  // Size errors first: one oversized array also reports each bad item in it.
  const all = [...(errors ?? [])];
  const bySize = all.filter((error) => error.keyword === "maxItems");
  const rest = all.filter((error) => error.keyword !== "maxItems");
  const parts = [...new Set([...bySize, ...rest].map(describeError))];
  if (parts.length === 0) {
    return `Tool '${toolName}' rejected the arguments. Check them and retry.`;
  }
  const shown = parts.slice(0, MAX_REPORTED_ERRORS).join("; ");
  const hidden = parts.length - MAX_REPORTED_ERRORS;
  const more = hidden > 0 ? `; and ${hidden} more` : "";
  return `Invalid argument(s) for '${toolName}' — ${shown}${more}. Fix the value(s) and retry.`;
}
