import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getMcpAuth0Audience, getOAuthEndpoints, getOAuthServerMetadata } from '../dist/oauth-proxy.js'

test('uses Auth0 directly and requests the MCP resource audience', () => {
  assert.deepEqual(getOAuthEndpoints({
    AUTH0_DOMAIN: 'tenant.auth0.com',
    AUTH0_AUDIENCE: 'https://api.datosbizi.com',
  }), {
    authorizationUrl: 'https://tenant.auth0.com/authorize?audience=https%3A%2F%2Fapi.datosbizi.com',
    tokenUrl: 'https://tenant.auth0.com/oauth/token',
    revocationUrl: 'https://tenant.auth0.com/oauth/revoke',
  })
})

test('prefers a dedicated MCP audience over the downstream API audience', () => {
  const env = {
    AUTH0_DOMAIN: 'tenant.auth0.com',
    AUTH0_AUDIENCE: 'https://api.datosbizi.com',
    MCP_AUTH0_AUDIENCE: 'https://mcp.datosbizi.com/mcp',
  }
  assert.equal(getMcpAuth0Audience(env), 'https://mcp.datosbizi.com/mcp')
  assert.equal(getOAuthEndpoints(env).authorizationUrl, 'https://tenant.auth0.com/authorize?audience=https%3A%2F%2Fmcp.datosbizi.com%2Fmcp')
})

test('advertises Auth0 as the authorization server', () => {
  assert.deepEqual(getOAuthServerMetadata({
    AUTH0_DOMAIN: 'tenant.auth0.com',
    MCP_AUTH0_AUDIENCE: 'https://mcp.datosbizi.com/mcp',
  }), {
    issuer: 'https://tenant.auth0.com/',
    authorization_endpoint: 'https://tenant.auth0.com/authorize?audience=https%3A%2F%2Fmcp.datosbizi.com%2Fmcp',
    token_endpoint: 'https://tenant.auth0.com/oauth/token',
    revocation_endpoint: 'https://tenant.auth0.com/oauth/revoke',
    registration_endpoint: 'https://tenant.auth0.com/oidc/register',
    jwks_uri: 'https://tenant.auth0.com/.well-known/jwks.json',
    introspection_endpoint: 'https://tenant.auth0.com/oauth/introspect',
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    code_challenge_methods_supported: ['S256'],
  })
})

test('requires an MCP audience when no legacy configuration exists', () => {
  assert.throws(
    () => getOAuthEndpoints({ AUTH0_DOMAIN: 'tenant.auth0.com' }),
    /MCP_AUTH0_AUDIENCE must be set/,
  )
})
