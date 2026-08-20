import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { mcpAuthMetadataRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { DASHBOARD_SCOPE } from './operations.js'
import { tools } from './tools.js'
import { createOAuthProvider } from './oauth.js'
import { getOAuthServerMetadata } from './oauth-proxy.js'

function getCorsOrigins(): string[] {
  return (process.env.MCP_CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function newMcpServer(): McpServer {
  const server = new McpServer({ name: 'bizidashboard-mcp', version: '0.1.0' })
  for (const tool of tools) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.schema,
      annotations: tool.annotations,
    }, tool.handler)
  }
  return server
}

export function createHttpServer(options: { oauthProvider?: ReturnType<typeof createOAuthProvider> } = {}) {
  const app = express()
  // Coolify/Cloudflare terminate TLS before forwarding to Express. Trust the
  // first proxy so req.protocol and generated public URLs remain HTTPS.
  app.set('trust proxy', 1)
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false, limit: '1mb' }))
  const corsOrigins = getCorsOrigins()
  app.use((req, res, next) => {
    const origin = req.get('origin')
    if (!origin) return next()
    if (!corsOrigins.includes(origin)) {
      return res.status(403).json({ error: 'Origin not allowed' })
    }

    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Vary', 'Origin')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })

  // OAuth metadata: advertises this server as an OAuth protected resource using Auth0 as authorization server
  const auth0Domain = process.env.AUTH0_DOMAIN
  if (!auth0Domain) throw new Error('AUTH0_DOMAIN must be set')
  const oauthMetadata = getOAuthServerMetadata()

  const publicServerUrl = new URL(process.env.BASE_URL || 'http://localhost:8787')
  if (process.env.NODE_ENV === 'production' && publicServerUrl.protocol !== 'https:') throw new Error('BASE_URL must use HTTPS in production')
  // RFC 9728 identifies the protected resource itself, not the host where it
  // happens to be served. Claude validates this against the connector URL.
  const resourceServerUrl = new URL('/mcp', publicServerUrl)
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceServerUrl)
  const oauthProvider = options.oauthProvider ?? createOAuthProvider()
  const bearerAuthMiddleware = requireBearerAuth({
    verifier: oauthProvider,
    requiredScopes: [DASHBOARD_SCOPE],
    resourceMetadataUrl,
  })

  app.use(mcpAuthMetadataRouter({
    oauthMetadata: {
      ...oauthMetadata,
    },
    resourceServerUrl,
    resourceName: 'BiziDashboard MCP Server',
  }))

  app.get('/healthz', (_req, res) => res.status(200).send('ok'))

  // Stateless Streamable HTTP: a fresh server+transport per request avoids
  // request-id collisions between concurrent callers and needs no session storage.
  app.post('/mcp', bearerAuthMiddleware, async (req, res) => {
    const server = newMcpServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      transport.close()
      server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  })

  app.get('/mcp', bearerAuthMiddleware, (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. This server runs in stateless mode; POST JSON-RPC requests to /mcp.' })
  })

  return app
}
