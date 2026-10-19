import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createHttpServer } from '../dist/http-server.js'

process.env.AUTH0_DOMAIN = 'tenant.auth0.com'
process.env.MCP_AUTH0_AUDIENCE = 'https://mcp.datosbizi.com/mcp'
process.env.BASE_URL = 'http://localhost:8787'
delete process.env.MCP_CORS_ORIGINS

const app = createHttpServer({
  oauthProvider: {
    async verifyAccessToken() {
      throw new Error('invalid token')
    },
  } as never,
})

let server: Server
let baseUrl: string

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
})

test('path-suffixed protected resource metadata advertises scopes', async () => {
  const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`)
  assert.equal(response.status, 200)
  const metadata = await response.json() as Record<string, unknown>
  assert.equal(metadata.resource, 'http://localhost:8787/mcp')
  assert.deepEqual(metadata.scopes_supported, ['read:dashboard', 'read:exports'])
})

test('bare protected resource metadata is served too', async () => {
  const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`)
  assert.equal(response.status, 200)
  const metadata = await response.json() as Record<string, unknown>
  assert.equal(metadata.resource, 'http://localhost:8787/mcp')
  assert.deepEqual(metadata.scopes_supported, ['read:dashboard', 'read:exports'])
})

test('browser preflight is not rejected when no allowlist is configured', async () => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://claude.ai',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type, mcp-protocol-version',
    },
  })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.match(response.headers.get('access-control-allow-headers') ?? '', /mcp-protocol-version/i)
})

test('metadata remains readable from a browser origin', async () => {
  const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`, {
    headers: { Origin: 'https://claude.ai' },
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
})

test('unauthenticated /mcp returns 401 pointing at the resource metadata', async () => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  assert.equal(response.status, 401)
  const header = response.headers.get('www-authenticate') ?? ''
  assert.match(header, /resource_metadata="http:\/\/localhost:8787\/\.well-known\/oauth-protected-resource\/mcp"/)
  assert.match(header, /scope="read:dashboard"/)
})

