import { homedir } from 'node:os'
import { lstat, mkdir, readFile, open } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { dirname } from 'node:path'

export type StoredTokens = { access_token: string; refresh_token?: string; expires_at?: number }

export function tokenFile(): string {
  return process.env.BIZI_TOKEN_FILE ?? `${homedir()}/.config/bizidashboard-mcp/tokens.json`
}

export async function readTokens(): Promise<StoredTokens | null> {
  try {
    if ((await lstat(tokenFile())).isSymbolicLink()) return null
    const value = JSON.parse(await readFile(tokenFile(), 'utf8')) as Partial<StoredTokens>
    if (typeof value.access_token !== 'string' || !value.access_token) return null
    if (value.refresh_token !== undefined && typeof value.refresh_token !== 'string') return null
    if (value.expires_at !== undefined && typeof value.expires_at !== 'number') return null
    return value as StoredTokens
  } catch { return null }
}

export async function writeTokens(tokens: StoredTokens): Promise<void> {
  const file = tokenFile()
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | (fsConstants.O_NOFOLLOW ?? 0)
  const handle = await open(file, flags, 0o600)
  try {
    await handle.chmod(0o600)
    await handle.writeFile(`${JSON.stringify(tokens, null, 2)}\n`, 'utf8')
  } finally {
    await handle.close()
  }
}
