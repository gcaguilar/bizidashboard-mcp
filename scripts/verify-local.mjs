import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createHttpServer } from '../dist/http-server.js'
import { createOAuthProvider } from '../dist/oauth.js'

const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = await exportJWK(publicKey)
jwk.kid = 'local-test'
jwk.alg = 'RS256'
jwk.use = 'sig'
const jwks = createLocalJWKSet({ keys: [jwk] })

process.env.AUTH0_DOMAIN = 'local.test'
process.env.MCP_AUTH0_AUDIENCE = 'https://mcp.datosbizi.com/mcp'
process.env.API_AUTH0_AUDIENCE = 'https://api.datosbizi.com'
process.env.BASE_URL = 'http://localhost:8799'
process.env.NODE_ENV = 'test'

const app = createHttpServer({ oauthProvider: createOAuthProvider({ jwks }) })
const server = app.listen(8799)

async function token(scope) {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: 'RS256', kid: 'local-test' })
    .setSubject('user@example.com')
    .setIssuer('https://local.test/')
    .setAudience('https://mcp.datosbizi.com/mcp')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

async function call(label, url, init) {
  const res = await fetch(url, init)
  const text = await res.text()
  console.log(`\n### ${label} -> ${res.status}`)
  console.log('headers:', Object.fromEntries([...res.headers].filter(([k]) => ['www-authenticate', 'content-type', 'mcp-session-id'].includes(k))))
  console.log(text.slice(0, 700))
}

const init = {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } },
  }),
}

await call('no auth', 'http://localhost:8799/mcp', init)

const t = await token('read:dashboard')
await call('with read:dashboard', 'http://localhost:8799/mcp', {
  ...init, headers: { ...init.headers, authorization: `Bearer ${t}` },
})

const tNoScope = await token('openid profile')
await call('with wrong scope', 'http://localhost:8799/mcp', {
  ...init, headers: { ...init.headers, authorization: `Bearer ${tNoScope}` },
})

await call('with Origin header (metadata)', 'http://localhost:8799/.well-known/oauth-protected-resource/mcp', {})

const toolsList = {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${t}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
}
await call('tools/list', 'http://localhost:8799/mcp', toolsList)

const toolsCall = {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${t}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_alerts', arguments: { limit: 2 } } }),
}
await call('tools/call get_alerts (public upstream)', 'http://localhost:8799/mcp', toolsCall)

const toolsCallElevated = {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${t}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_alerts_history', arguments: { format: 'csv' } } }),
}
await call('tools/call get_alerts_history csv (elevated -> OBO)', 'http://localhost:8799/mcp', toolsCallElevated)

server.close()
process.exit(0)
