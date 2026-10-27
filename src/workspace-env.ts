/**
 * Per-workspace Bark presentation from the workspace `.env` file.
 *
 * Icon and group are workspace facts, not plugin settings: two projects often
 * want different notification icons and different Bark groups. On every
 * notification the listener reads `<workspace>/.env` (the session's effective
 * working directory) and lets two keys override the settings fallback:
 *
 *   DSH_BARK_ICON  — an http(s) URL the Bark server fetches as the icon
 *   DSH_BARK_GROUP — the Bark group shown on the phone
 *
 * Bare `BARK_ICON` / `BARK_GROUP` are accepted as aliases so an existing
 * `.env` keeps working; the `DSH_`-prefixed key wins. Only those four keys are
 * read and no value is ever logged.
 * @module dsh-notify-bark/workspace-env
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
// Type-only: pulls the `ctx.workingDirectory` service merge.
import type {} from '@deepseek-ai/dsh-working-directory'
import { clipChars } from './text.ts'

/** Workspace `.env` icon keys, highest precedence first. */
export const ENV_ICON_KEYS = ['DSH_BARK_ICON', 'BARK_ICON'] as const

/** Workspace `.env` group keys, highest precedence first. */
export const ENV_GROUP_KEYS = ['DSH_BARK_GROUP', 'BARK_GROUP'] as const

/** Group values longer than this are clipped before reaching Bark. */
const MAX_GROUP_CHARS = 64

/** Icon URLs longer than this are ignored. */
const MAX_ICON_URL_LENGTH = 2048

/** Presentation overrides read from one workspace `.env`. */
export interface WorkspaceBarkEnv {
  /** Icon URL the Bark server should fetch, when configured and valid. */
  icon?: string
  /** Bark group override, when configured. */
  group?: string
}

/**
 * Parse the subset of `.env` syntax needed for presentation keys.
 * Supports blank lines, `#` comments, an optional `export ` prefix, single or
 * double quotes, `\n`/`\t` escapes inside double quotes, and trailing
 * ` # comment` on unquoted values. Multi-line values are not supported; a
 * malformed line is skipped instead of aborting the whole file.
 * @param text - raw `.env` contents.
 * @returns the parsed key/value pairs.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const body = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const separator = body.indexOf('=')
    if (separator <= 0) continue
    const key = body.slice(0, separator).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue
    values[key] = parseValue(body.slice(separator + 1))
  }
  return values
}

/**
 * Parse one `.env` value.
 * @param raw - everything after the first `=`.
 * @returns the unquoted value.
 */
function parseValue(raw: string): string {
  const value = raw.trim()
  if (value.length === 0) return ''
  const quote = value[0]
  if ((quote === '"' || quote === "'") && value.length >= 2) {
    const end = value.indexOf(quote, 1)
    if (end > 0) {
      const inner = value.slice(1, end)
      return quote === '"' ? unescapeDoubleQuoted(inner) : inner
    }
  }
  const comment = value.search(/\s#/u)
  return (comment >= 0 ? value.slice(0, comment) : value).trim()
}

/**
 * Resolve the escapes a double-quoted `.env` value may carry.
 * @param text - quoted value without its delimiters.
 * @returns the unescaped value.
 */
function unescapeDoubleQuoted(text: string): string {
  return text.replace(/\\([nrt"\\])/gu, (_match, char: string) => {
    switch (char) {
      case 'n': return '\n'
      case 'r': return '\r'
      case 't': return '\t'
      case '"': return '"'
      default: return '\\'
    }
  })
}

/** Read the first present key from `keys`. */
function pick(values: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = values[key]
    if (value !== undefined && value.trim().length > 0) return value.trim()
  }
  return undefined
}

/**
 * Validate an icon override. Bark expects an absolute http(s) URL it can
 * fetch, so a local path (or any other scheme) is ignored rather than sent.
 * @param value - raw `.env` value.
 * @returns the normalized URL, or undefined.
 */
export function normalizeIcon(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_ICON_URL_LENGTH) return undefined
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/**
 * Normalize a group override: one line, control characters removed, clipped to
 * the Bark-safe length.
 * @param value - raw `.env` value.
 * @returns the group, or undefined when nothing usable remains.
 */
export function normalizeGroup(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim()
  if (cleaned.length === 0) return undefined
  return clipChars(cleaned, MAX_GROUP_CHARS)
}

/**
 * Select the presentation overrides from parsed `.env` values.
 * @param values - parsed key/value pairs.
 * @returns the valid overrides (absent fields stay absent).
 */
export function selectWorkspaceBarkEnv(values: Record<string, string>): WorkspaceBarkEnv {
  const icon = normalizeIcon(pick(values, ENV_ICON_KEYS))
  const group = normalizeGroup(pick(values, ENV_GROUP_KEYS))
  return {
    ...icon === undefined ? {} : { icon },
    ...group === undefined ? {} : { group },
  }
}

/**
 * Resolve the session's effective workspace directory.
 * @param ctx - Host context exposing `workingDirectory` when composed.
 * @param session - live session.
 * @returns the absolute directory, or undefined when the session has none.
 */
export function workspaceDirectoryOf(ctx: Context, session: Session): string | undefined {
  try {
    const current = ctx.get('workingDirectory')?.get(session)
    if (current !== undefined && current.length > 0) return current
  } catch {
    // A disposed working-directory service must not break notifications.
  }
  const cwd = session.header.cwd
  return cwd !== undefined && cwd.length > 0 ? cwd : undefined
}

/**
 * Read the presentation overrides from one workspace's `.env`.
 * A missing or unreadable file is a normal "no overrides" answer.
 * @param directory - workspace directory.
 * @returns the valid overrides.
 */
export async function readWorkspaceBarkEnv(directory: string | undefined): Promise<WorkspaceBarkEnv> {
  if (directory === undefined) return {}
  let text: string
  try {
    text = await readFile(join(directory, '.env'), 'utf8')
  } catch {
    return {}
  }
  return selectWorkspaceBarkEnv(parseDotEnv(text))
}
