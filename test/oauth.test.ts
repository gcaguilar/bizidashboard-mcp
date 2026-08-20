import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createOAuthProvider, getAllowedAudiences, getAllowedClientIds } from '../dist/oauth.js'

const issuer = 'https://auth.example.test/'
const audience = 'https://api.datosbizi.com'

async function createToken(overrides: { aud?: string; scope?: string } = {}) {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey)
  jwk.kid = 'test-key'
  const jwks = createLocalJWKSet({ keys: [jwk] })
  const token = await new SignJWT({ scope: overrides.scope ?? 'read:dashboard' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject('user@example.com')
    .setIssuer(issuer)
    .setAudience(overrides.aud ?? audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
  return { token, jwks, privateKey }
}

test('parses comma-separated audiences and legacy singular configuration', () => {
  assert.deepEqual(getAllowedAudiences({ AUTH0_AUDIENCES: ' one, two ,, ' }), ['one', 'two'])
  assert.deepEqual(getAllowedAudiences({ AUTH0_AUDIENCE: 'legacy' }), ['legacy'])
  assert.deepEqual(getAllowedAudiences({ MCP_AUTH0_AUDIENCE: 'mcp', AUTH0_AUDIENCE: 'api' }), ['mcp'])
})

test('verifies a token signed by Auth0 with the configured audience and read:dashboard scope', async () => {
  const original = { ...process.env }
  process.env.AUTH0_DOMAIN = 'auth.example.test'
  process.env.AUTH0_AUDIENCE = audience
  process.env.AUTH0_AUDIENCES = audience
  const { token, jwks } = await createToken()
  const provider = createOAuthProvider({ jwks })

  const auth = await provider.verifyAccessToken(token)
  assert.equal(auth.clientId, 'user@example.com')
  assert.deepEqual(auth.scopes, ['read:dashboard'])
  process.env = original
})

test('rejects a token with another audience', async () => {
  const original = { ...process.env }
  process.env.AUTH0_DOMAIN = 'auth.example.test'
  process.env.AUTH0_AUDIENCE = audience
  process.env.AUTH0_AUDIENCES = audience
  const { token, jwks } = await createToken({ aud: 'https://other.example.test' })
  const provider = createOAuthProvider({ jwks })

  await assert.rejects(provider.verifyAccessToken(token), /Token verification failed/)
  process.env = original
})

test('rejects a correctly signed token without read:dashboard scope', async () => {
  const original = { ...process.env }
  process.env.AUTH0_DOMAIN = 'auth.example.test'
  process.env.AUTH0_AUDIENCE = audience
  process.env.AUTH0_AUDIENCES = audience
  const { token, jwks } = await createToken({ scope: 'profile email read:exports' })
  const provider = createOAuthProvider({ jwks })

  await assert.rejects(provider.verifyAccessToken(token), /Token verification failed/)
  process.env = original
})

test('can restrict accepted tokens to configured Auth0 clients', async () => {
  const original = { ...process.env }
  process.env.AUTH0_DOMAIN = 'auth.example.test'
  process.env.AUTH0_AUDIENCE = audience
  process.env.AUTH0_AUDIENCES = audience
  process.env.AUTH0_CLIENT_IDS = 'datosbizi-web'
  const { privateKey, jwks } = await createToken()
  const token = await new SignJWT({ scope: 'read:dashboard', azp: 'datosbizi-web' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject('user@example.com')
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
  const provider = createOAuthProvider({ jwks })

  await provider.verifyAccessToken(token)
  process.env = original
})

test('prefers the explicit access-token client allowlist and retains the legacy alias', () => {
  assert.deepEqual(
    getAllowedClientIds({ AUTH0_ACCESS_TOKEN_ALLOWED_CLIENT_IDS: 'chatgpt-client, other-client', AUTH0_CLIENT_IDS: 'legacy-client' }),
    ['chatgpt-client', 'other-client'],
  )
  assert.deepEqual(getAllowedClientIds({ AUTH0_CLIENT_IDS: 'legacy-client' }), ['legacy-client'])
})
