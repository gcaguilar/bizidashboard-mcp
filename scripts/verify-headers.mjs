import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createHttpServer } from '../dist/http-server.js'
import { createOAuthProvider } from '../dist/oauth.js'

const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = await exportJWK(publicKey)
jwk.kid = 'local-test'; jwk.alg = 'RS256'; jwk.use = 'sig'
const jwks = createLocalJWKSet({ keys: [jwk] })

process.env.AUTH0_DOMAIN = 'local.test'
process.env.MCP_AUTH0_AUDIENCE = 'https://mcp.datosbizi.com/mcp'
process.env.API_AUTH0_AUDIENCE = 'https://api.datosbizi.com'
process.env.BASE_URL = 'http://localhost:8798'
process.env.NODE_ENV = 'test'

const app = createHttpServer({ oauthProvider: createOAuthProvider({ jwks }) })
const server = app.listen(8798)

const t = await new SignJWT({ scope: 'read:dashboard' })
  .setProtectedHeader({ alg: 'RS256', kid: 'local-test' })
  .setSubject('user@example.com').setIssuer('https://local.test/')
  .setAudience('https://mcp.datosbizi.com/mcp').setIssuedAt().setExpirationTime('5m').sign(privateKey)

const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'p', version: '1' } } })

async function probe(label, headers) {
  const res = await fetch('http://localhost:8798/mcp', { method: 'POST', headers, body })
  console.log(label, '->', res.status, res.headers.get('content-type'))
  const text = await res.text()
  if (res.status !== 200) console.log('   ', text.slice(0, 300))
}

await probe('accept json only', { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${t}` })
await probe('accept sse only', { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${t}` })
await probe('accept both', { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${t}` })
await probe('no accept', { 'content-type': 'application/json', authorization: `Bearer ${t}` })
await probe('with session id', { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${t}`, 'mcp-session-id': 'abc' })

for (const [label, url] of [
  ['AS metadata (served at mcp host)', 'http://localhost:8798/.well-known/oauth-authorization-server'],
  ['PRM', 'http://localhost:8798/.well-known/oauth-protected-resource/mcp'],
]) {
  const res = await fetch(url)
  console.log('\n' + label, res.status, (await res.text()).slice(0, 500))
}

const del = await fetch('http://localhost:8798/mcp', { method: 'DELETE', headers: { authorization: `Bearer ${t}` } })
console.log('\nDELETE /mcp ->', del.status)

server.close(); process.exit(0)
