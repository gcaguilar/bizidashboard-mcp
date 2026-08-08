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
  return (process.env.BIZI_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
}

function getPublicApiKey(): string | null {
  return process.env.BIZI_PUBLIC_API_KEY ?? null
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
