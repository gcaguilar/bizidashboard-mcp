import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getOAuthEndpoints } from '../dist/oauth-proxy.js'

test('uses Auth0 directly when no same-domain proxy is configured', () => {
  assert.deepEqual(getOAuthEndpoints({ AUTH0_DOMAIN: 'tenant.auth0.com', AUTH0_AUDIENCE: 'https://api.datosbizi.com' }), {
    authorizationUrl: 'https://tenant.auth0.com/authorize?audience=https%3A%2F%2Fapi.datosbizi.com',
    tokenUrl: 'https://tenant.auth0.com/oauth/token',
    revocationUrl: 'https://tenant.auth0.com/oauth/revoke',
  })
})

test('uses a valid same-domain proxy origin for OAuth endpoints', () => {
  assert.deepEqual(getOAuthEndpoints({
    AUTH0_DOMAIN: 'tenant.auth0.com',
    AUTH0_AUDIENCE: 'https://api.datosbizi.com',
    OAUTH_PROXY_ORIGIN: 'https://auth.datosbizi.com',
  }), {
    authorizationUrl: 'https://auth.datosbizi.com/authorize?audience=https%3A%2F%2Fapi.datosbizi.com',
    tokenUrl: 'https://auth.datosbizi.com/oauth/token',
    revocationUrl: 'https://auth.datosbizi.com/oauth/revoke',
  })
})

test('does not accept an OAuth proxy origin with a path or insecure scheme', () => {
  assert.equal(
    getOAuthEndpoints({ AUTH0_DOMAIN: 'tenant.auth0.com', AUTH0_AUDIENCE: 'https://api.datosbizi.com', OAUTH_PROXY_ORIGIN: 'http://auth.datosbizi.com' }).tokenUrl,
    'https://tenant.auth0.com/oauth/token',
  )
  assert.equal(
    getOAuthEndpoints({ AUTH0_DOMAIN: 'tenant.auth0.com', AUTH0_AUDIENCE: 'https://api.datosbizi.com', OAUTH_PROXY_ORIGIN: 'https://auth.datosbizi.com/callback' }).tokenUrl,
    'https://tenant.auth0.com/oauth/token',
  )
})

test('requires the exact audience to request an Auth0 API access token', () => {
  assert.throws(
    () => getOAuthEndpoints({ AUTH0_DOMAIN: 'tenant.auth0.com' }),
    /AUTH0_AUDIENCE must be set/,
  )
})
