#!/usr/bin/env node
import { writeTokens } from './token-store.js'

const domain = process.env.AUTH0_DOMAIN
const clientId = process.env.AUTH0_CLIENT_ID
const audience = process.env.AUTH0_AUDIENCE
const scope = process.env.AUTH0_SCOPE ?? 'openid profile email read offline_access'
if (!domain || !clientId || !audience) {
  console.error('Set AUTH0_DOMAIN, AUTH0_CLIENT_ID and AUTH0_AUDIENCE before running login.')
  process.exit(1)
}

const response = await fetch(`https://${domain}/oauth/device/code`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ client_id: clientId, audience, scope }),
})
if (!response.ok) throw new Error(`Auth0 device authorization failed: ${response.status} ${await response.text()}`)
const device = await response.json() as { device_code: string; user_code: string; verification_uri?: string; verification_uri_complete?: string; interval?: number; expires_in: number }
console.log(`Open ${device.verification_uri_complete ?? device.verification_uri}`)
console.log(`If needed, enter code: ${device.user_code}`)

const deadline = Date.now() + device.expires_in * 1000
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, (device.interval ?? 5) * 1000))
  const tokenResponse = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: device.device_code, client_id: clientId }),
  })
  const payload = await tokenResponse.json() as Record<string, unknown>
  if (tokenResponse.ok) {
    await writeTokens({ access_token: String(payload.access_token), refresh_token: payload.refresh_token ? String(payload.refresh_token) : undefined, expires_at: payload.expires_in ? Date.now() + Number(payload.expires_in) * 1000 : undefined })
    console.log(`Saved tokens to ${process.env.BIZI_TOKEN_FILE ?? '~/.config/bizidashboard-mcp/tokens.json'}`)
    process.exit(0)
  }
  if (payload.error !== 'authorization_pending' && payload.error !== 'slow_down') throw new Error(`Auth0 login failed: ${JSON.stringify(payload)}`)
}
throw new Error('Auth0 device authorization expired.')
