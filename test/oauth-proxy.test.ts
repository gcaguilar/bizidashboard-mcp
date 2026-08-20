import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getOAuthEndpoints, getOAuthServerMetadata, removeMcpResourceFromBody, removeMcpResourceIndicator } from '../dist/oauth-proxy.js'

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

test('advertises the OAuth proxy as the authorization server when configured', () => {
  assert.deepEqual(getOAuthServerMetadata({
    AUTH0_DOMAIN: 'tenant.auth0.com',
    AUTH0_AUDIENCE: 'https://api.datosbizi.com',
    OAUTH_PROXY_ORIGIN: 'https://auth.datosbizi.com',
  }), {
    issuer: 'https://auth.datosbizi.com/',
    authorization_endpoint: 'https://auth.datosbizi.com/authorize?audience=https%3A%2F%2Fapi.datosbizi.com',
    token_endpoint: 'https://auth.datosbizi.com/oauth/token',
    revocation_endpoint: 'https://auth.datosbizi.com/oauth/revoke',
    registration_endpoint: 'https://auth.datosbizi.com/oidc/register',
    jwks_uri: 'https://tenant.auth0.com/.well-known/jwks.json',
    introspection_endpoint: 'https://tenant.auth0.com/oauth/introspect',
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    code_challenge_methods_supported: ['S256'],
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

test('removes the MCP resource indicator before forwarding to Auth0', () => {
  const upstream = removeMcpResourceIndicator(new URL(
    '/authorize?audience=https%3A%2F%2Fapi.datosbizi.com&resource=https%3A%2F%2Fmcp.datosbizi.com%2F&state=state',
    'https://tenant.auth0.com',
  ))

  assert.equal(upstream.toString(), 'https://tenant.auth0.com/authorize?audience=https%3A%2F%2Fapi.datosbizi.com&state=state')
  assert.deepEqual(removeMcpResourceFromBody({ grant_type: 'authorization_code', code: 'code', resource: 'https://mcp.datosbizi.com/' }), {
    grant_type: 'authorization_code',
    code: 'code',
  })
})
