/**
 * Wire the contract, the validators and the executor into an MCP server.
 *
 * The server registers no tool by hand. `tools/list` is the contract rendered
 * into MCP's wire shape, and `tools/call` is "find the entry, validate against
 * its schema, execute it" — so a tool added in core and re-vendored here
 * appears in the package without a line of source changing. That is the whole
 * point of generating the contract in the first place.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { findTool, type ToolContract } from "./contract.js";
import { ToolArgumentError, ToolProtocolError, type ToolExecutor } from "./executor.js";
import { compileValidators, describeSchemaErrors } from "./validation.js";

export interface ServerIdentity {
  name: string;
  version: string;
}

/**
 * Render the contract as MCP tool descriptors.
 *
 * `inputSchema` is the wire-format camelCase key; the contract stores the same
 * data under the snake_case `input_schema` it was generated with, and its
 * snake_case `annotations` become the camelCase hint keys, and
 * `output_schema` becomes `outputSchema`. The schemas are passed through
 * untouched — this package must not develop a second opinion about what a
 * tool's arguments or results look like.
 */
function toWireTools(contract: ToolContract): Tool[] {
  return contract.tools.map((tool) => {
    const wire: Tool = {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.input_schema as Tool["inputSchema"],
    };
    if (tool.annotations !== undefined) {
      wire.annotations = {
        readOnlyHint: tool.annotations.read_only_hint,
        destructiveHint: tool.annotations.destructive_hint,
        idempotentHint: tool.annotations.idempotent_hint,
        openWorldHint: tool.annotations.open_world_hint,
      };
    }
    if (tool.output_schema !== undefined) {
      wire.outputSchema = tool.output_schema as Tool["outputSchema"];
    }
    return wire;
  });
}

/**
 * Build the MCP server.
 *
 * The failure surface is split deliberately, matching core's remote channel:
 * anything the model can fix by calling again with different arguments comes
 * back as an error *result* it can read and act on, while anything it cannot
 * — an unknown tool name, a 5xx, an unreachable API — is raised as a protocol
 * error. Dressing a broken backend up as "here is what to fix" would send the
 * model into a retry loop against a problem no argument can solve.
 */
export function createServer(
  contract: ToolContract,
  executor: ToolExecutor,
  identity: ServerIdentity,
): Server {
  const validators = compileValidators(contract);
  const wireTools = toWireTools(contract);

  const server = new Server(identity, {
    capabilities: { tools: {} },
    ...(contract.instructions === undefined
      ? {}
      : { instructions: contract.instructions }),
  });

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: wireTools }));

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<CallToolResult> => {
      const { name, arguments: rawArguments } = request.params;
      const tool = findTool(contract, name);
      if (tool === undefined) {
        throw new McpError(ErrorCode.InvalidParams, `Unknown tool '${name}'.`);
      }

      const args = (rawArguments ?? {}) as Record<string, unknown>;
      const validate = validators.get(name);
      if (validate !== undefined && !validate(args)) {
        return {
          content: [
            { type: "text", text: describeSchemaErrors(name, validate.errors) },
          ],
          isError: true,
        };
      }

      try {
        return await executor.execute(tool, args);
      } catch (error) {
        if (error instanceof ToolArgumentError) {
          return { content: [{ type: "text", text: error.message }], isError: true };
        }
        if (error instanceof ToolProtocolError) {
          throw new McpError(ErrorCode.InternalError, error.message);
        }
        throw error;
      }
    },
  );

  return server;
}
