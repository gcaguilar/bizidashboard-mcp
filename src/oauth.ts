import { jwtVerify, createRemoteJWKSet } from 'jose'
import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js'
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'

function requireEnv(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required environment variable: ${key}`)
  return val
}

export function getAllowedAudiences(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.AUTH0_AUDIENCES || env.AUTH0_AUDIENCE || ''
  const audiences = configured.split(',').map((audience) => audience.trim()).filter(Boolean)
  if (audiences.length === 0) {
    throw new Error('Missing required environment variable: AUTH0_AUDIENCES')
  }
  return audiences
}

export type JwksSource = Parameters<typeof jwtVerify>[1]

export function createOAuthProvider(options: { jwks?: JwksSource } = {}): ProxyOAuthServerProvider {
  const auth0Domain = requireEnv('AUTH0_DOMAIN')
  const auth0Audiences = getAllowedAudiences()
  const jwksUrl = `https://${auth0Domain}/.well-known/jwks.json`
  const issuer = `https://${auth0Domain}/`

  const jwks = options.jwks ?? createRemoteJWKSet(new URL(jwksUrl))

  async function verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const verified = await jwtVerify(token, jwks, {
        issuer,
        audience: auth0Audiences,
      })

      const clientId = verified.payload.sub || verified.payload.client_id
      if (!clientId || typeof clientId !== 'string') {
        throw new Error('Token missing sub or client_id claim')
      }

      const scopes = typeof verified.payload.scope === 'string'
        ? verified.payload.scope.split(/\s+/).filter(Boolean)
        : Array.isArray(verified.payload.scope)
          ? verified.payload.scope
          : []
      if (!scopes.includes('read')) throw new Error('Token missing required read scope')

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
      authorizationUrl: `https://${auth0Domain}/authorize`,
      tokenUrl: `https://${auth0Domain}/oauth/token`,
      revocationUrl: `https://${auth0Domain}/oauth/revoke`,
    },
    verifyAccessToken,
    getClient,
  })
}
