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

test('remote requests forward only the incoming bearer and never a global API key', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.BIZI_PUBLIC_API_KEY
  let requestHeaders: Headers | undefined
  process.env.BIZI_PUBLIC_API_KEY = 'local-key-must-not-leak'

  globalThis.fetch = async (_input, init) => {
    requestHeaders = new Headers(init?.headers)
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    await withRequestAuthorization({
      token: 'incoming-user-token',
      scopes: ['read:dashboard'],
      remote: true,
    }, () => fetchJson('/api/stations'))

    assert.equal(requestHeaders?.get('authorization'), 'Bearer incoming-user-token')
    assert.equal(requestHeaders?.get('x-public-api-key'), null)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.BIZI_PUBLIC_API_KEY
    else process.env.BIZI_PUBLIC_API_KEY = originalKey
  }
})
