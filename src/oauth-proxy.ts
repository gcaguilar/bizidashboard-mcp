import type { Express, Request, Response } from 'express'

type FetchLike = typeof fetch

export type OAuthEndpoints = {
  authorizationUrl: string
  tokenUrl: string
  revocationUrl: string
}

export type OAuthServerMetadata = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  revocation_endpoint: string
  registration_endpoint: string
  jwks_uri: string
  introspection_endpoint: string
  grant_types_supported: string[]
  token_endpoint_auth_methods_supported: string[]
  response_types_supported: string[]
  response_modes_supported: string[]
  code_challenge_methods_supported: string[]
}

/**
 * Auth0 models RFC 8707 resource indicators as registered API services. The
 * MCP resource URL is this server, whereas DatosBizi tokens are issued for
 * AUTH0_AUDIENCE, so forwarding the MCP `resource` value makes Auth0 reject
 * the request as an unknown service.
 */
export function removeMcpResourceIndicator(url: URL): URL {
  const sanitized = new URL(url)
  sanitized.searchParams.delete('resource')
  return sanitized
}

export function removeMcpResourceFromBody(body: Record<string, unknown>): Record<string, unknown> {
  const { resource: _resource, ...sanitized } = body
  return sanitized
}

function normalizedHttpsOrigin(value: string | undefined): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) return null
    return url
  } catch {
    return null
  }
}

export function getOAuthEndpoints(env = process.env): OAuthEndpoints {
  const auth0Domain = env.AUTH0_DOMAIN
  if (!auth0Domain) throw new Error('AUTH0_DOMAIN must be set')
  const audience = env.AUTH0_AUDIENCE
  if (!audience) throw new Error('AUTH0_AUDIENCE must be set')

  const proxyOrigin = normalizedHttpsOrigin(env.OAUTH_PROXY_ORIGIN)
  const origin = proxyOrigin?.origin ?? `https://${auth0Domain}`
  const authorizationUrl = new URL('/authorize', origin)
  authorizationUrl.searchParams.set('audience', audience)
  return {
    authorizationUrl: authorizationUrl.toString(),
    tokenUrl: `${origin}/oauth/token`,
    revocationUrl: `${origin}/oauth/revoke`,
  }
}

/**
 * When an OAuth proxy is configured it is the authorization-server origin we
 * advertise to MCP clients. Otherwise clients discover Auth0 directly and
 * send its unsupported MCP resource indicator straight to Auth0, bypassing
 * the normalization in attachOAuthProxy().
 */
export function getOAuthServerMetadata(env = process.env): OAuthServerMetadata {
  const auth0Domain = env.AUTH0_DOMAIN
  if (!auth0Domain) throw new Error('AUTH0_DOMAIN must be set')

  const proxyOrigin = normalizedHttpsOrigin(env.OAUTH_PROXY_ORIGIN)
  const origin = proxyOrigin?.origin ?? `https://${auth0Domain}`
  const endpoints = getOAuthEndpoints(env)
  return {
    issuer: `${origin}/`,
    authorization_endpoint: endpoints.authorizationUrl,
    token_endpoint: endpoints.tokenUrl,
    revocation_endpoint: endpoints.revocationUrl,
    registration_endpoint: `${origin}/oidc/register`,
    jwks_uri: `https://${auth0Domain}/.well-known/jwks.json`,
    introspection_endpoint: `https://${auth0Domain}/oauth/introspect`,
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    code_challenge_methods_supported: ['S256'],
  }
}

function copyResponseHeaders(source: Headers, res: Response) {
  for (const header of ['cache-control', 'content-type', 'www-authenticate']) {
    const value = source.get(header)
    if (value) res.setHeader(header, value)
  }
}

/**
 * Serves Auth0's OAuth endpoints through a same-root-domain host. ChatGPT
 * Actions require its API and OAuth URLs to share a registrable domain.
 */
export function attachOAuthProxy(app: Express, options: { fetchImpl?: FetchLike } = {}) {
  const proxyOrigin = normalizedHttpsOrigin(process.env.OAUTH_PROXY_ORIGIN)
  if (!proxyOrigin) return

  const auth0Domain = process.env.AUTH0_DOMAIN
  if (!auth0Domain) throw new Error('AUTH0_DOMAIN must be set when OAUTH_PROXY_ORIGIN is configured')
  const fetchImpl = options.fetchImpl ?? fetch

  app.use(async (req, res, next) => {
    if (req.hostname.toLowerCase() !== proxyOrigin.hostname.toLowerCase()) return next()
    if (req.path === '/.well-known/oauth-authorization-server') {
      if (req.method !== 'GET') return res.sendStatus(405)
      return res.json(getOAuthServerMetadata())
    }
    if (!['/authorize', '/oauth/token', '/oauth/revoke', '/oidc/register'].includes(req.path)) return res.sendStatus(404)

    const upstream = removeMcpResourceIndicator(new URL(req.originalUrl, `https://${auth0Domain}`))
    try {
      if (req.path === '/authorize') {
        if (req.method !== 'GET') return res.sendStatus(405)
        return res.redirect(302, upstream.toString())
      }

      if (req.method !== 'POST') return res.sendStatus(405)
      const headers = new Headers()
      const contentType = req.get('content-type')
      const authorization = req.get('authorization')
      if (contentType) headers.set('content-type', contentType)
      if (authorization) headers.set('authorization', authorization)
      headers.set('accept', req.get('accept') ?? 'application/json')
      const isForm = contentType?.split(';', 1)[0].trim() === 'application/x-www-form-urlencoded'
      const requestBody = removeMcpResourceFromBody((req.body ?? {}) as Record<string, unknown>)
      const body = isForm
        ? new URLSearchParams(requestBody as Record<string, string>).toString()
        : JSON.stringify(requestBody)

      const upstreamResponse = await fetchImpl(upstream, {
        method: 'POST',
        headers,
        body,
      })
      copyResponseHeaders(upstreamResponse.headers, res)
      return res.status(upstreamResponse.status).send(Buffer.from(await upstreamResponse.arrayBuffer()))
    } catch {
      return res.status(502).json({ error: 'OAuth provider unavailable' })
    }
  })
}
