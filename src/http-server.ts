import express, { type Request, type Response } from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { mcpAuthMetadataRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { BiziApiError } from './client.js'
import { operations } from './operations.js'
import { tools } from './tools.js'
import { buildOpenApiDocument } from './openapi.js'
import { createOAuthProvider } from './oauth.js'
import { withRequestToken } from './request-context.js'

function getCorsOrigins(): string[] {
  return (process.env.MCP_CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function newMcpServer(): McpServer {
  const server = new McpServer({ name: 'bizidashboard-mcp', version: '0.1.0' })
  for (const tool of tools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.schema }, tool.handler)
  }
  return server
}

export function createHttpServer(options: { oauthProvider?: ReturnType<typeof createOAuthProvider> } = {}) {
  const app = express()
  // Coolify/Cloudflare terminate TLS before forwarding to Express. Trust the
  // first proxy so req.protocol and generated public URLs remain HTTPS.
  app.set('trust proxy', 1)
  app.use(express.json({ limit: '1mb' }))

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

  const resourceServerUrl = new URL(process.env.BASE_URL || 'http://localhost:8787')
  if (process.env.NODE_ENV === 'production' && resourceServerUrl.protocol !== 'https:') throw new Error('BASE_URL must use HTTPS in production')
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceServerUrl)
  const publicBaseUrl = resourceServerUrl.origin

  const oauthProvider = options.oauthProvider ?? createOAuthProvider()
  const bearerAuthMiddleware = requireBearerAuth({
    verifier: oauthProvider,
    requiredScopes: ['read'],
    resourceMetadataUrl,
  })

  app.use(mcpAuthMetadataRouter({
    oauthMetadata: {
      issuer: `https://${auth0Domain}/`,
      authorization_endpoint: `https://${auth0Domain}/authorize`,
      token_endpoint: `https://${auth0Domain}/oauth/token`,
      revocation_endpoint: `https://${auth0Domain}/oauth/revoke`,
      jwks_uri: `https://${auth0Domain}/.well-known/jwks.json`,
      introspection_endpoint: `https://${auth0Domain}/oauth/introspect`,
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      code_challenge_methods_supported: ['S256'],
    },
    resourceServerUrl,
    resourceName: 'BiziDashboard MCP Server',
  }))

  app.get('/openapi.json', (req, res) => {
    res.json(buildOpenApiDocument(publicBaseUrl))
  })

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

  for (const operation of operations) {
    app.get(`/actions/${operation.restPath}`, bearerAuthMiddleware, async (req, res) => {
      try {
        const result = await withRequestToken(req.auth?.token, () => operation.run(req.query as Record<string, unknown>))
        if (result.kind === 'csv') {
          res.type('text/csv').send(result.text)
        } else {
          res.json(result.data)
        }
      } catch (error) {
        if (error instanceof BiziApiError) {
          res.status(error.status ?? 502).json({ error: error.message })
        } else {
          res.status(500).json({ error: `Unexpected error: ${String(error)}` })
        }
      }
    })
  }

  return app
}
