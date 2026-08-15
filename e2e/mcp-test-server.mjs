/**
 * Minimal stdio MCP server used by the e2e verification.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'spike-server', version: '0.0.1' })
server.tool(
  'ping',
  { msg: z.string() },
  async ({ msg }) => ({ content: [{ type: 'text', text: `pong:${msg}` }] }),
)
await server.connect(new StdioServerTransport())
