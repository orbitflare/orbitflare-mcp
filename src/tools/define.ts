import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { asError } from '../utils/formatters.js';

export const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };
export const READ_LOCAL: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
export const WRITE_LOCAL: ToolAnnotations = { ...WRITE, openWorldHint: false };
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};
export const DESTRUCTIVE_LOCAL: ToolAnnotations = { ...DESTRUCTIVE, openWorldHint: false };

export const confirmSchema = z
  .boolean()
  .optional()
  .describe(
    'Must be true to actually execute. Without it the tool only explains what it would do; ask the user first.',
  );

type Shape = z.ZodRawShape;

export function defineTool<S extends Shape>(
  server: McpServer,
  name: string,
  config: {
    title: string;
    description: string;
    input: S;
    output?: Shape;
    annotations: ToolAnnotations;
  },
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<CallToolResult>,
): void {
  server.registerTool(
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.input,
      ...(config.output ? { outputSchema: config.output } : {}),
      annotations: { title: config.title, ...config.annotations },
    },
    (async (args: z.infer<z.ZodObject<S>>) => {
      try {
        return await handler(args);
      } catch (err) {
        return asError(err);
      }
    }) as never,
  );
}
