import { readTokens, writeTokens } from './token-store.js'
import { requestToken } from './request-context.js'

const DEFAULT_BASE_URL = 'https://datosbizi.com'
const DEFAULT_TIMEOUT_MS = 15_000

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
  return process.env.BIZI_PUBLIC_API_KEY ?? null
}

async function getAccessToken(): Promise<string | null> {
  const accessToken = requestToken() ?? process.env.BIZI_ACCESS_TOKEN
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
 * Always forwards X-Public-Api-Key when configured; harmless on routes that don't require it.
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
    const hint =
      response.status === 401 || response.status === 403
        ? ' (this request may require BIZI_PUBLIC_API_KEY to be configured)'
        : ''
    throw new BiziApiError(`${route} returned ${response.status} ${response.statusText}${hint}${detail}`, response.status, route)
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
    const hint =
      response.status === 401 || response.status === 403
        ? ' (this request may require BIZI_PUBLIC_API_KEY to be configured)'
        : ''
    throw new BiziApiError(`${route} returned ${response.status} ${response.statusText}${hint}`, response.status, route)
  }

  return response.text()
}
