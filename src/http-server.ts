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

function newMcpServer(): McpServer {
  const server = new McpServer({ name: 'bizidashboard-mcp', version: '0.1.0' })
  for (const tool of tools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.schema }, tool.handler)
  }
  return server
}

export function createHttpServer() {
  const app = express()
  app.use(express.json())

  // OAuth metadata: advertises this server as an OAuth protected resource using Auth0 as authorization server
  const auth0Domain = process.env.AUTH0_DOMAIN
  if (!auth0Domain) throw new Error('AUTH0_DOMAIN must be set')

  const resourceServerUrl = new URL(process.env.BASE_URL || 'http://localhost:8787')
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceServerUrl)

  const oauthProvider = createOAuthProvider()
  const bearerAuthMiddleware = requireBearerAuth({
    verifier: oauthProvider,
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
    const serverUrl = `${req.protocol}://${req.get('host')}`
    res.json(buildOpenApiDocument(serverUrl))
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
        const result = await operation.run(req.query as Record<string, unknown>)
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
