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

function requireAuth0Domain(env: NodeJS.ProcessEnv): string {
  const domain = env.AUTH0_DOMAIN
  if (!domain) throw new Error('AUTH0_DOMAIN must be set')
  return domain
}

/**
 * The audience of the protected MCP resource. Keep AUTH0_AUDIENCE as a
 * fallback for existing single-audience installations, but production MCP
 * deployments should set MCP_AUTH0_AUDIENCE explicitly.
 */
export function getMcpAuth0Audience(env: NodeJS.ProcessEnv = process.env): string {
  const audience = env.MCP_AUTH0_AUDIENCE || env.AUTH0_AUDIENCE
  if (!audience) throw new Error('MCP_AUTH0_AUDIENCE must be set')
  return audience
}

/**
 * Auth0 is the authorization server. The resource indicator sent by an MCP
 * client must reach Auth0 unchanged, so it can issue a token for the MCP API.
 */
export function getOAuthEndpoints(env: NodeJS.ProcessEnv = process.env): OAuthEndpoints {
  const domain = requireAuth0Domain(env)
  const authorizationUrl = new URL('/authorize', `https://${domain}`)
  authorizationUrl.searchParams.set('audience', getMcpAuth0Audience(env))
  return {
    authorizationUrl: authorizationUrl.toString(),
    tokenUrl: `https://${domain}/oauth/token`,
    revocationUrl: `https://${domain}/oauth/revoke`,
  }
}

export function getOAuthServerMetadata(env: NodeJS.ProcessEnv = process.env): OAuthServerMetadata {
  const domain = requireAuth0Domain(env)
  const origin = `https://${domain}`
  const endpoints = getOAuthEndpoints(env)
  return {
    issuer: `${origin}/`,
    authorization_endpoint: endpoints.authorizationUrl,
    token_endpoint: endpoints.tokenUrl,
    revocation_endpoint: endpoints.revocationUrl,
    registration_endpoint: `${origin}/oidc/register`,
    jwks_uri: `${origin}/.well-known/jwks.json`,
    introspection_endpoint: `${origin}/oauth/introspect`,
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    code_challenge_methods_supported: ['S256'],
  }
}
