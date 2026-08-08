#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { tools } from './tools.js'

const server = new McpServer({
  name: 'bizidashboard-mcp',
  version: '0.1.0',
})

for (const tool of tools) {
  server.registerTool(tool.name, { description: tool.description, inputSchema: tool.schema }, tool.handler)
}

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error('Fatal error starting bizidashboard-mcp:', error)
  process.exit(1)
})
