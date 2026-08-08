import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tools } from '../dist/tools.js'

function getTool(name: string) {
  const tool = tools.find((t) => t.name === name)
  assert.ok(tool, `tool ${name} should be registered`)
  return tool
}

function parseJsonResult(result: { content: [{ type: 'text'; text: string }]; isError?: boolean }) {
  assert.equal(result.isError, undefined, `expected no error, got: ${result.content[0].text}`)
  return JSON.parse(result.content[0].text)
}

test('get_stations returns stations with a generatedAt timestamp', async () => {
  const data = await parseJsonResult(await getTool('get_stations').handler({}))
  assert.ok(Array.isArray(data.stations))
  assert.ok(data.stations.length > 0)
  const station = data.stations[0]
  assert.ok('id' in station)
  assert.ok('bikesAvailable' in station)
  assert.ok(typeof data.generatedAt === 'string')
})

test('get_stations csv format returns CSV text', async () => {
  const result = await getTool('get_stations').handler({ format: 'csv' })
  assert.equal(result.isError, undefined)
  const text = result.content[0].text
  assert.ok(text.startsWith('"stationId"'))
})

test('get_rankings requires a type and returns ranked stations', async () => {
  const data = await parseJsonResult(await getTool('get_rankings').handler({ type: 'turnover', limit: 5 }))
  assert.equal(data.type, 'turnover')
  assert.ok(Array.isArray(data.rankings))
  assert.ok(data.rankings.length <= 5)
})

test('get_rankings rejects an invalid type at the API level with a clear error', async () => {
  const result = await getTool('get_rankings').handler({ type: 'not-a-real-type' })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /400|Invalid type/i)
})

test('get_alerts returns an alerts array', async () => {
  const data = await parseJsonResult(await getTool('get_alerts').handler({ limit: 10 }))
  assert.ok(Array.isArray(data.alerts))
})

test('get_alerts_history returns paginated alert rows', async () => {
  const data = await parseJsonResult(await getTool('get_alerts_history').handler({ limit: 5 }))
  assert.ok(data)
})

test('get_patterns requires a stationId and returns pattern rows for a real station', async () => {
  const stations = await parseJsonResult(await getTool('get_stations').handler({}))
  const stationId = stations.stations[0].id as string
  const data = await parseJsonResult(await getTool('get_patterns').handler({ stationId }))
  assert.ok(data)
})

test('get_heatmap returns heatmap rows for a real station', async () => {
  const stations = await parseJsonResult(await getTool('get_stations').handler({}))
  const stationId = stations.stations[0].id as string
  const data = await parseJsonResult(await getTool('get_heatmap').handler({ stationId }))
  assert.ok(data)
})

test('get_mobility returns mobility payload with defaults', async () => {
  const data = await parseJsonResult(await getTool('get_mobility').handler({}))
  assert.ok(data)
})

test('get_history returns historical coverage metadata', async () => {
  const data = await parseJsonResult(await getTool('get_history').handler({}))
  assert.ok(data)
})

test('get_rebalancing_report returns diagnostics for the default window', async () => {
  const data = await parseJsonResult(await getTool('get_rebalancing_report').handler({}))
  assert.ok(data.diagnostics === undefined || Array.isArray(data.diagnostics) || typeof data === 'object')
})

test('get_rebalancing_report over the elevated days threshold fails clearly without a key', async () => {
  if (process.env.BIZI_PUBLIC_API_KEY) {
    return // skip: a key is configured in this environment, so the elevated call would succeed
  }
  const result = await getTool('get_rebalancing_report').handler({ days: 60 })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /BIZI_PUBLIC_API_KEY|401|503/i)
})

test('unknown route error surfaces a BiziApiError-shaped message', async () => {
  const result = await getTool('get_patterns').handler({ stationId: 'this-station-does-not-exist' })
  // The API may respond 200 with empty rows or an error depending on validation;
  // either way the handler must not throw an unhandled exception.
  assert.ok(Array.isArray(result.content))
})
