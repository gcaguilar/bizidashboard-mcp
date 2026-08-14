import { z } from 'zod'
import { BiziApiError } from './client.js'
import { BiziAuthorizationError, operations, runOperation, type OperationResult } from './operations.js'
import { withRequestAuthorization } from './request-context.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js'

export type ToolTextResult = {
  content: [{ type: 'text'; text: string }]
  isError?: boolean
}

function toToolTextResult(result: OperationResult): ToolTextResult {
  const text = result.kind === 'csv' ? result.text : JSON.stringify(result.data, null, 2)
  return { content: [{ type: 'text', text }] }
}

function errorResult(error: unknown): ToolTextResult {
  const message = error instanceof BiziApiError || error instanceof BiziAuthorizationError
    ? error.message
    : `Unexpected error: ${String(error)}`
  return { content: [{ type: 'text', text: message }], isError: true }
}

export type ToolDefinition = {
  name: string
  description: string
  schema: z.ZodRawShape
  handler: (args: Record<string, unknown>, extra?: RequestHandlerExtra<ServerRequest, ServerNotification>) => Promise<ToolTextResult>
}

/**
 * Every tool handler is wrapped so it never throws: MCP clients and direct callers (tests)
 * see the same isError-flagged result shape regardless of how the tool is invoked.
 */
export const tools: ToolDefinition[] = operations.map((operation) => ({
  name: operation.name,
  description: operation.description,
  schema: operation.schema,
  handler: async (args: Record<string, unknown>, extra?: RequestHandlerExtra<ServerRequest, ServerNotification>) => withRequestAuthorization({
    token: extra?.authInfo?.token,
    scopes: extra?.authInfo?.scopes,
    remote: Boolean(extra?.authInfo?.token),
  }, async () => {
    try {
      return toToolTextResult(await runOperation(operation, args))
    } catch (error) {
      return errorResult(error)
    }
  }),
}))
