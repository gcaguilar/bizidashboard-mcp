import { readTokens, writeTokens } from './token-store.js'
import { requestAuthorization } from './request-context.js'

const DEFAULT_BASE_URL = 'https://datosbizi.com'
const DEFAULT_TIMEOUT_MS = 15_000
const DOWNSTREAM_SCOPES = new Set(['read:dashboard', 'read:exports'])

type CachedDownstreamToken = {
  accessToken: string
  expiresAt: number
}

const downstreamTokenCache = new Map<string, CachedDownstreamToken>()

export class BiziApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly route: string
  ) {
    super(message)
    this.name = 'BiziApiError'
  }
}

function getBaseUrl(): string {
  const base = new URL(process.env.BIZI_API_BASE_URL ?? DEFAULT_BASE_URL)
  const allowed = (process.env.BIZI_ALLOWED_API_HOSTS ?? 'datosbizi.com').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)
  if (base.protocol !== 'https:' || !allowed.includes(base.hostname.toLowerCase())) throw new Error('BIZI_API_BASE_URL must be an HTTPS URL with an allowed host')
  return base.toString().replace(/\/+$/, '')
}

function getPublicApiKey(): string | null {
  // Remote MCP/Actions calls are authorized solely as the bearer-token user.
  // Never let a deployment-wide key silently elevate that user.
  if (requestAuthorization()?.remote) return null
  return process.env.BIZI_PUBLIC_API_KEY ?? null
}

async function getAccessToken(): Promise<string | null> {
  const authorization = requestAuthorization()
  if (authorization?.remote) {
    if (!authorization.token) return null
    return exchangeMcpTokenForApiToken(authorization.token, authorization.scopes ?? [])
  }

  const accessToken = authorization?.token ?? process.env.BIZI_ACCESS_TOKEN
  if (accessToken) return accessToken
  const tokens = await readTokens()
  if (!tokens) return null
  if (!tokens.expires_at || tokens.expires_at > Date.now() + 30_000) return tokens.access_token

  const domain = process.env.AUTH0_DOMAIN
  const clientId = process.env.AUTH0_CLIENT_ID
  const audience = process.env.AUTH0_AUDIENCE
  if (!tokens.refresh_token || !domain || !clientId || !audience) return tokens.access_token
  const response = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId, audience }),
  })
  if (!response.ok) return tokens.access_token
  const payload = await response.json() as Record<string, unknown>
  const refreshed = {
    access_token: String(payload.access_token),
    refresh_token: payload.refresh_token ? String(payload.refresh_token) : tokens.refresh_token,
    expires_at: payload.expires_in ? Date.now() + Number(payload.expires_in) * 1000 : undefined,
  }
  await writeTokens(refreshed)
  return refreshed.access_token
}

function getDownstreamAudience(): string {
  const audience = process.env.API_AUTH0_AUDIENCE || process.env.AUTH0_AUDIENCE
  if (!audience) throw new BiziApiError('MCP server is missing API_AUTH0_AUDIENCE for the DatosBizi API', 502, '/oauth/token')
  return audience
}

function getExchangeScope(scopes: string[]): string {
  const downstreamScopes = scopes.filter((scope) => DOWNSTREAM_SCOPES.has(scope))
  return downstreamScopes.length > 0 ? downstreamScopes.join(' ') : 'read:dashboard'
}

/**
 * A token issued for the MCP resource cannot be forwarded to DatosBizi's API:
 * its audience is deliberately different. Auth0 exchanges it on behalf of the
 * signed-in user and returns a token valid only for the downstream API.
 */
export async function exchangeMcpTokenForApiToken(incomingToken: string, scopes: string[]): Promise<string> {
  const now = Date.now()
  const scope = getExchangeScope(scopes)
  const cacheKey = `${incomingToken}:${scope}`
  const cached = downstreamTokenCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.accessToken

  const domain = process.env.AUTH0_DOMAIN
  const clientId = process.env.MCP_AUTH0_CLIENT_ID
  const clientSecret = process.env.MCP_AUTH0_CLIENT_SECRET
  if (!domain || !clientId || !clientSecret) {
    throw new BiziApiError('MCP server OBO exchange is not configured', 502, '/oauth/token')
  }

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: incomingToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    audience: getDownstreamAudience(),
    scope,
  })
  let response: Response
  try {
    response = await fetch(`https://${domain}/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body,
    })
  } catch {
    throw new BiziApiError('Auth0 was unavailable while exchanging the MCP token', 502, '/oauth/token')
  }

  if (!response.ok) {
    throw new BiziApiError('Auth0 rejected the MCP token exchange for the DatosBizi API', 502, '/oauth/token')
  }
  const payload = await response.json() as Record<string, unknown>
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new BiziApiError('Auth0 returned no API access token for the MCP request', 502, '/oauth/token')
  }

  const expiresIn = Number(payload.expires_in)
  if (Number.isFinite(expiresIn) && expiresIn > 30) {
    downstreamTokenCache.set(cacheKey, {
      accessToken: payload.access_token,
      expiresAt: now + (expiresIn - 30) * 1_000,
    })
  }
  return payload.access_token
}

async function addAuthHeaders(headers: Record<string, string>): Promise<void> {
  const accessToken = await getAccessToken()
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const installationId = process.env.BIZI_INSTALLATION_ID
  if (installationId) headers['X-Installation-Id'] = installationId
}

export type QueryParams = Record<string, string | number | boolean | undefined>

function buildQueryString(params: QueryParams): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

/**
 * GET a JSON endpoint on the BiziDashboard public API.
 * Local stdio mode can optionally send X-Public-Api-Key for backwards compatibility.
 * Remote MCP/Actions mode exchanges the original user bearer for a token whose
 * audience is DatosBizi's API; it never forwards either local credentials or
 * the MCP-resource token to the API.
 */
export async function fetchJson<T>(route: string, params: QueryParams = {}): Promise<T> {
  const url = `${getBaseUrl()}${route}${buildQueryString(params)}`
  const headers: Record<string, string> = { Accept: 'application/json' }
  const apiKey = getPublicApiKey()
  if (apiKey) headers['X-Public-Api-Key'] = apiKey
  await addAuthHeaders(headers)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, { headers, signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new BiziApiError(`Request to ${route} timed out after ${DEFAULT_TIMEOUT_MS}ms`, null, route)
    }
    throw new BiziApiError(
      `Network error calling ${route}: ${error instanceof Error ? error.message : String(error)}`,
      null,
      route
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.text()
      detail = body ? `: ${body.slice(0, 500)}` : ''
    } catch {
      // ignore body read failures on error paths
    }
    throw new BiziApiError(`${route} returned ${response.status} ${response.statusText}${detail}`, response.status, route)
  }

  return (await response.json()) as T
}

/**
 * GET a CSV endpoint on the BiziDashboard public API, returned as raw text.
 */
export async function fetchCsv(route: string, params: QueryParams = {}): Promise<string> {
  const url = `${getBaseUrl()}${route}${buildQueryString(params)}`
  const headers: Record<string, string> = { Accept: 'text/csv' }
  const apiKey = getPublicApiKey()
  if (apiKey) headers['X-Public-Api-Key'] = apiKey
  await addAuthHeaders(headers)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, { headers, signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new BiziApiError(`Request to ${route} timed out after ${DEFAULT_TIMEOUT_MS}ms`, null, route)
    }
    throw new BiziApiError(
      `Network error calling ${route}: ${error instanceof Error ? error.message : String(error)}`,
      null,
      route
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new BiziApiError(`${route} returned ${response.status} ${response.statusText}`, response.status, route)
  }

  return response.text()
}
