import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createOAuthProvider, getAllowedAudiences } from '../dist/oauth.js'

const issuer = 'https://auth.example.test/'
const audience = 'https://api.datosbizi.com'

async function createToken(overrides: { aud?: string; scope?: string } = {}) {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey)
  jwk.kid = 'test-key'
  const jwks = createLocalJWKSet({ keys: [jwk] })
  const token = await new SignJWT({ scope: overrides.scope ?? 'read' })
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
})

test('verifies a token signed by Auth0 with the configured audience and read scope', async () => {
  const original = { ...process.env }
  process.env.AUTH0_DOMAIN = 'auth.example.test'
  process.env.AUTH0_AUDIENCES = audience
  const { token, jwks } = await createToken()
  const provider = createOAuthProvider({ jwks })

  const auth = await provider.verifyAccessToken(token)
  assert.equal(auth.clientId, 'user@example.com')
  assert.deepEqual(auth.scopes, ['read'])
  process.env = original
})

test('rejects a token with another audience', async () => {
  const original = { ...process.env }
  process.env.AUTH0_DOMAIN = 'auth.example.test'
  process.env.AUTH0_AUDIENCES = audience
  const { token, jwks } = await createToken({ aud: 'https://other.example.test' })
  const provider = createOAuthProvider({ jwks })

  await assert.rejects(provider.verifyAccessToken(token), /Token verification failed/)
  process.env = original
})

test('rejects a correctly signed token without read scope', async () => {
  const original = { ...process.env }
  process.env.AUTH0_DOMAIN = 'auth.example.test'
  process.env.AUTH0_AUDIENCES = audience
  const { token, jwks } = await createToken({ scope: 'profile email' })
  const provider = createOAuthProvider({ jwks })

  await assert.rejects(provider.verifyAccessToken(token), /Token verification failed/)
  process.env = original
})
