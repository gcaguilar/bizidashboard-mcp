import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createHttpServer } from '../dist/http-server.js'
import { createOAuthProvider } from '../dist/oauth.js'

const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = await exportJWK(publicKey)
jwk.kid = 'k'; jwk.alg = 'RS256'; jwk.use = 'sig'
const jwks = createLocalJWKSet({ keys: [jwk] })

process.env.AUTH0_DOMAIN = 'local.test'
process.env.MCP_AUTH0_AUDIENCE = 'https://mcp.datosbizi.com/mcp'
process.env.API_AUTH0_AUDIENCE = 'https://api.datosbizi.com'
process.env.BASE_URL = 'http://localhost:8797'
process.env.NODE_ENV = 'test'

const app = createHttpServer({ oauthProvider: createOAuthProvider({ jwks }) })
const server = app.listen(8797)

const t = await new SignJWT({ scope: 'read:dashboard' })
  .setProtectedHeader({ alg: 'RS256', kid: 'k' })
  .setSubject('user@example.com').setIssuer('https://local.test/')
  .setAudience('https://mcp.datosbizi.com/mcp').setIssuedAt().setExpirationTime('5m').sign(privateKey)

const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${t}` }

async function post(label, payload, headers = H) {
  const res = await fetch('http://localhost:8797/mcp', { method: 'POST', headers, body: JSON.stringify(payload) })
  const text = await res.text()
  console.log(`${label} -> ${res.status} ${res.headers.get('content-type')} ${text.slice(0, 200)}`)
}

await post('notifications/initialized', { jsonrpc: '2.0', method: 'notifications/initialized' })
await post('ping', { jsonrpc: '2.0', id: 9, method: 'ping' })
await post('unknown method', { jsonrpc: '2.0', id: 10, method: 'nope' })
await post('tools/call missing args', { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'get_patterns', arguments: {} } })
await post('bad json', 'not json')

const r = await fetch('http://localhost:8797/mcp', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: '{bad' })
console.log('bad json ->', r.status, (await r.text()).slice(0, 200))

server.close(); process.exit(0)
