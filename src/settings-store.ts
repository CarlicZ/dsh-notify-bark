/**
 * dsh-notify-bark settings model: schema, defaults, and event metadata.
 *
 * On DSH 0.2+ the plugin entry's own config IS the settings namespace: the
 * Host `Config` schema below is registered by the Loader, exposed to the
 * settings transport (redacted, with `role('secret')` fields stripped), and
 * hot-reloaded in place. Every editable field is `volatile()`, so the Loader
 * hands `apply` stable `{ get() }` references instead of a frozen snapshot —
 * reads always follow the current document without remounting the plugin.
 *
 * The browser never touches this schema directly: the settings section reads
 * and writes through the barkNotify Remote, and the Bark URL is only ever
 * sent browser → Host (never echoed back).
 * @module dsh-notify-bark/settings-store
 */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** The nine notification events the section can toggle. */
export interface BarkEventSettings {
  /** ✅ turn ended completed. */
  completed: boolean
  /** ❌ turn ended with an error. */
  error: boolean
  /** 🚫 turn ended blocked (waiting on something the agent cannot do alone). */
  blocked: boolean
  /** ⏹ turn aborted by the user. */
  aborted: boolean
  /** ⚠️ a step hit its output-token ceiling. */
  maxTokens: boolean
  /** ⏸ a crash-orphaned turn was closed on reload. */
  interrupted: boolean
  /** ❓ ask_user_question is waiting for an answer. */
  question: boolean
  /** 🔐 an approval request is waiting for a decision. */
  approval: boolean
  /** 📋 exit_plan_mode presented a plan for review. */
  planReview: boolean
}

/** Complete Bark plugin settings. */
export interface BarkSettings {
  /** Master switch; when off nothing is sent. */
  enabled: boolean
  /** Full Bark endpoint, e.g. https://api.day.app/<key> — treated as a secret. */
  barkUrl: string
  /** Per-event notification switches. */
  events: BarkEventSettings
  /** Include the AI's last reply as summarizer material. */
  includeAssistantText: boolean
  /** Title budget in user-perceived characters. */
  titleMaxChars: number
  /** Body budget in user-perceived characters. */
  contentMaxChars: number
  /** Fallback Bark group when the workspace `.env` sets none. */
  group: string
}

/** Default title budget ("字"). */
export const DEFAULT_TITLE_MAX_CHARS = 20

/** Default body budget ("字"). */
export const DEFAULT_CONTENT_MAX_CHARS = 50

/** Upper bound accepted for the title budget. */
export const TITLE_MAX_CHARS_LIMIT = 80

/** Upper bound accepted for the body budget. */
export const CONTENT_MAX_CHARS_LIMIT = 500

/**
 * The resolved plugin config the Loader hands `apply`: every used field is a
 * retained volatile reference, so reading it inside the event listener always
 * follows the latest settings write.
 */
export interface Config {
  /** Master switch; when off nothing is sent. */
  enabled: Volatile<boolean>
  /** Full Bark endpoint — treated as a secret and never echoed to the browser. */
  barkUrl: Volatile<string>
  /** Per-event notification switches (one volatile object). */
  events: Volatile<BarkEventSettings>
  /** Include the AI's last reply as summarizer material. */
  includeAssistantText: Volatile<boolean>
  /** Title budget in user-perceived characters. */
  titleMaxChars: Volatile<number>
  /** Body budget in user-perceived characters. */
  contentMaxChars: Volatile<number>
  /** Fallback Bark group when the workspace `.env` sets none. */
  group: Volatile<string>
}

/** Composition defaults — what a fresh install ships with. */
export const DEFAULT_SETTINGS: BarkSettings = {
  enabled: true,
  barkUrl: '',
  events: {
    completed: true,
    error: true,
    blocked: true,
    aborted: false,
    maxTokens: true,
    interrupted: true,
    question: true,
    approval: true,
    planReview: false,
  },
  includeAssistantText: true,
  titleMaxChars: DEFAULT_TITLE_MAX_CHARS,
  contentMaxChars: DEFAULT_CONTENT_MAX_CHARS,
  group: 'DeepSeek Harness',
}

/**
 * The plugin's Loader config schema. Every editable field is `volatile()` so
 * the settings transport can edit it live; `barkUrl` is `role('secret')` so
 * any redacted describe never carries it.
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  barkUrl: z.string().role('secret').default('').volatile(),
  events: z.object({
    completed: z.boolean().default(true),
    error: z.boolean().default(true),
    blocked: z.boolean().default(true),
    aborted: z.boolean().default(false),
    maxTokens: z.boolean().default(true),
    interrupted: z.boolean().default(true),
    question: z.boolean().default(true),
    approval: z.boolean().default(true),
    planReview: z.boolean().default(false),
  }).volatile(),
  includeAssistantText: z.boolean().default(true).volatile(),
  titleMaxChars: z.number().step(1).min(1).max(TITLE_MAX_CHARS_LIMIT).default(DEFAULT_TITLE_MAX_CHARS).volatile(),
  contentMaxChars: z.number().step(1).min(1).max(CONTENT_MAX_CHARS_LIMIT).default(DEFAULT_CONTENT_MAX_CHARS).volatile(),
  group: z.string().default('DeepSeek Harness').volatile(),
})

/**
 * Clamp a user-supplied character budget into its accepted range.
 * @param value - candidate from a settings write.
 * @param max - inclusive upper bound.
 * @returns a positive integer within `[1, max]`.
 */
export function clampCharLimit(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(max, Math.max(1, Math.round(value)))
}

/**
 * Read a detached plain settings object from the live volatile config.
 * @param config - resolved config handed to `apply`.
 * @returns the current settings, defaults applied.
 */
export function readBarkSettings(config: Config): BarkSettings {
  return {
    enabled: config.enabled.get(),
    barkUrl: config.barkUrl.get(),
    events: { ...DEFAULT_SETTINGS.events, ...config.events.get() },
    includeAssistantText: config.includeAssistantText.get(),
    titleMaxChars: clampCharLimit(config.titleMaxChars.get(), TITLE_MAX_CHARS_LIMIT),
    contentMaxChars: clampCharLimit(config.contentMaxChars.get(), CONTENT_MAX_CHARS_LIMIT),
    group: config.group.get(),
  }
}

/**
 * Map a `turn/end` reason kind onto the settings event flag. Kinds outside
 * the official set (plugin extensions, fork seeds) yield undefined and stay
 * silent.
 */
export const TURN_END_EVENT_FLAG: Record<string, keyof BarkEventSettings> = {
  completed: 'completed',
  error: 'error',
  blocked: 'blocked',
  aborted: 'aborted',
  'max-tokens': 'maxTokens',
  interrupted: 'interrupted',
}

/**
 * Bark push levels: completed → active; waiting/error states → timeSensitive;
 * aborted → passive. critical is intentionally never used by default.
 */
export type BarkLevel = 'active' | 'timeSensitive' | 'passive' | 'critical'

/** Per-event presentation metadata. */
export interface BarkEventMeta {
  /** One-line headline, the fallback body's first line and summarizer input. */
  headline: string
  /** Bark level for this event. */
  level: BarkLevel
}

/** Event metadata keyed by the settings event flag. */
export const EVENT_META: Record<keyof BarkEventSettings, BarkEventMeta> = {
  completed: { headline: '✅ 任务完成', level: 'active' },
  error: { headline: '❌ 执行失败', level: 'timeSensitive' },
  blocked: { headline: '🚫 执行被阻塞', level: 'timeSensitive' },
  aborted: { headline: '⏹ 已中止', level: 'passive' },
  maxTokens: { headline: '⚠️ Token 达到上限', level: 'timeSensitive' },
  interrupted: { headline: '⏸ 异常中断', level: 'timeSensitive' },
  question: { headline: '❓ 等待你的回答', level: 'timeSensitive' },
  approval: { headline: '🔐 等待你的授权', level: 'timeSensitive' },
  planReview: { headline: '📋 计划待确认', level: 'timeSensitive' },
}

/**
 * Normalize a Bark endpoint: trim and strip trailing slashes so the JSON POST
 * hits exactly the server root (Bark V2 accepts `POST <base>` with a JSON
 * body carrying title/body/group/level/icon).
 */
export function sanitizeBarkUrl(input: string): string {
  return input.trim().replace(/\/+$/, '')
}

/**
 * Mask a Bark URL for display: the URL carries the device key, so only a
 * configured/unconfigured fact plus the last four characters cross the wire.
 */
export function maskBarkUrl(url: string): { configured: boolean; masked: string } {
  const normalized = sanitizeBarkUrl(url)
  if (normalized.length === 0) return { configured: false, masked: '' }
  return { configured: true, masked: `••••••••${normalized.slice(-4)}` }
}
