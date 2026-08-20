import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchJson } from '../dist/client.js'
import { EXPORTS_SCOPE, getRequiredScopes, operations, runOperation } from '../dist/operations.js'
import { withRequestAuthorization } from '../dist/request-context.js'

function getOperation(name: string) {
  const operation = operations.find((candidate) => candidate.name === name)
  assert.ok(operation, `operation ${name} should be registered`)
  return operation
}

test('elevated variants declare read:exports while basic variants only need read:dashboard', () => {
  const alertsHistory = getOperation('get_alerts_history')
  const rebalancing = getOperation('get_rebalancing_report')

  assert.deepEqual(getRequiredScopes(alertsHistory, { limit: 500 }), ['read:dashboard'])
  assert.deepEqual(getRequiredScopes(alertsHistory, { limit: 501 }), ['read:dashboard', EXPORTS_SCOPE])
  assert.deepEqual(getRequiredScopes(alertsHistory, { format: 'csv' }), ['read:dashboard', EXPORTS_SCOPE])
  assert.deepEqual(getRequiredScopes(rebalancing, { days: 30 }), ['read:dashboard'])
  assert.deepEqual(getRequiredScopes(rebalancing, { days: 31 }), ['read:dashboard', EXPORTS_SCOPE])
})

test('remote elevated requests fail locally with an actionable read:exports error', async () => {
  const rebalancing = getOperation('get_rebalancing_report')

  await assert.rejects(
    withRequestAuthorization({
      token: 'incoming-user-token',
      scopes: ['read:dashboard'],
      remote: true,
    }, () => runOperation(rebalancing, { days: 60 })),
    /requires the read:exports scope.*Reconnect and grant read:exports/i,
  )
})

test('remote requests exchange the MCP bearer and never send a global API key', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.BIZI_PUBLIC_API_KEY
  const originalEnv = {
    AUTH0_DOMAIN: process.env.AUTH0_DOMAIN,
    MCP_AUTH0_CLIENT_ID: process.env.MCP_AUTH0_CLIENT_ID,
    MCP_AUTH0_CLIENT_SECRET: process.env.MCP_AUTH0_CLIENT_SECRET,
    API_AUTH0_AUDIENCE: process.env.API_AUTH0_AUDIENCE,
  }
  let requestHeaders: Headers | undefined
  process.env.BIZI_PUBLIC_API_KEY = 'local-key-must-not-leak'
  process.env.AUTH0_DOMAIN = 'tenant.auth0.com'
  process.env.MCP_AUTH0_CLIENT_ID = 'mcp-server'
  process.env.MCP_AUTH0_CLIENT_SECRET = 'secret'
  process.env.API_AUTH0_AUDIENCE = 'https://api.datosbizi.com'

  globalThis.fetch = async (input, init) => {
    if (String(input) === 'https://tenant.auth0.com/oauth/token') {
      const body = new URLSearchParams(String(init?.body))
      assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:token-exchange')
      assert.equal(body.get('subject_token'), 'incoming-mcp-token')
      assert.equal(body.get('audience'), 'https://api.datosbizi.com')
      assert.equal(body.get('scope'), 'read:dashboard')
      return new Response(JSON.stringify({ access_token: 'downstream-api-token', expires_in: 300 }), {
        headers: { 'content-type': 'application/json' },
      })
    }
    requestHeaders = new Headers(init?.headers)
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    await withRequestAuthorization({
      token: 'incoming-mcp-token',
      scopes: ['read:dashboard'],
      remote: true,
    }, () => fetchJson('/api/stations'))

    assert.equal(requestHeaders?.get('authorization'), 'Bearer downstream-api-token')
    assert.equal(requestHeaders?.get('x-public-api-key'), null)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.BIZI_PUBLIC_API_KEY
    else process.env.BIZI_PUBLIC_API_KEY = originalKey
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
