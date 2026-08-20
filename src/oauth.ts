import { jwtVerify, createRemoteJWKSet } from 'jose'
import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js'
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { getOAuthEndpoints } from './oauth-proxy.js'

function requireEnv(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required environment variable: ${key}`)
  return val
}

export function getAllowedAudiences(env: NodeJS.ProcessEnv = process.env): string[] {
  // Keep the singular name fully compatible with existing Coolify deployments;
  // AUTH0_AUDIENCES is preferred when both are present.
  const configured = env.AUTH0_AUDIENCES || env.AUTH0_AUDIENCE || ''
  const audiences = configured.split(',').map((audience) => audience.trim()).filter(Boolean)
  if (audiences.length === 0) {
    throw new Error('Missing required environment variable: AUTH0_AUDIENCES')
  }
  return audiences
}

export function getAllowedClientIds(env: NodeJS.ProcessEnv = process.env): string[] {
  // The explicit name is the production setting. Keep the original shorter
  // name so existing deployments do not suddenly accept a broader set.
  return (env.AUTH0_ACCESS_TOKEN_ALLOWED_CLIENT_IDS ?? env.AUTH0_CLIENT_IDS ?? '')
    .split(',')
    .map((clientId) => clientId.trim())
    .filter(Boolean)
}

export type JwksSource = Parameters<typeof jwtVerify>[1]

export function createOAuthProvider(options: { jwks?: JwksSource } = {}): ProxyOAuthServerProvider {
  const auth0Domain = requireEnv('AUTH0_DOMAIN')
  const auth0Audiences = getAllowedAudiences()
  const allowedClientIds = getAllowedClientIds()
  const oauthEndpoints = getOAuthEndpoints()
  const jwksUrl = `https://${auth0Domain}/.well-known/jwks.json`
  const issuer = `https://${auth0Domain}/`

  const jwks = options.jwks ?? createRemoteJWKSet(new URL(jwksUrl))

  async function verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const verified = await jwtVerify(token, jwks, {
        issuer,
        audience: auth0Audiences,
        algorithms: ['RS256'],
      })

      const tokenClientId = typeof verified.payload.azp === 'string'
        ? verified.payload.azp
        : typeof verified.payload.client_id === 'string'
          ? verified.payload.client_id
          : null
      if (allowedClientIds.length > 0 && (!tokenClientId || !allowedClientIds.includes(tokenClientId))) {
        throw new Error('Token client is not allowed')
      }

      const clientId = verified.payload.sub || tokenClientId
      if (typeof clientId !== 'string' || !clientId) {
        throw new Error('Token missing sub or client_id claim')
      }

      const scopes = typeof verified.payload.scope === 'string'
        ? verified.payload.scope.split(/\s+/).filter(Boolean)
        : Array.isArray(verified.payload.scope)
          ? verified.payload.scope.filter((scope): scope is string => typeof scope === 'string')
          : []
      if (!scopes.includes('read:dashboard')) {
        throw new Error('Token missing required read:dashboard scope')
      }

      return {
        token,
        clientId,
        scopes,
        expiresAt: verified.payload.exp,
      }
    } catch (error) {
      throw new InvalidTokenError(
        `Token verification failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async function getClient(_clientId: string): Promise<OAuthClientInformationFull | undefined> {
    // For now, we don't store registered clients locally.
    // A client ID is valid if its token passes JWKS verification.
    // If dynamic client registration is needed, this would delegate to Auth0's DCR endpoint.
    return undefined
  }

  return new ProxyOAuthServerProvider({
    endpoints: {
      ...oauthEndpoints,
    },
    verifyAccessToken,
    getClient,
  })
}
