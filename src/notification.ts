/**
 * Notification composition: titles, summarizer material, and the deterministic
 * fallback body.
 *
 * Two separate budgets shape every push:
 *   - the title is the workspace name, fitted to `titleMaxChars` (default 20);
 *   - the body is the model summary, fitted to `contentMaxChars` (default 50),
 *     with a composed fallback used whenever no model answer is available.
 *
 * Keeping the composition pure (no I/O, no clock) makes the budgets directly
 * testable and keeps the event listener focused on routing events.
 * @module dsh-notify-bark/notification
 */

import type { BarkEventSettings, BarkSettings } from './settings-store.ts'
import { clipChars, collapseWhitespace } from './text.ts'

/** Input-material bounds; the summarizer request never needs more than this. */
const MATERIAL_ASSISTANT_CHARS = 2000
const MATERIAL_ARGUMENTS_CHARS = 800
const MATERIAL_REASON_CHARS = 400
const MATERIAL_DETAIL_CHARS = 400

/** A decided notification: which event fired, its headline, and extra detail. */
export interface NotificationIntent {
  /** The settings event flag this notification maps to. */
  flag: keyof BarkEventSettings
  /** Headline, e.g. "✅ 任务完成". */
  headline: string
  /** Event-specific detail line (error message, question text, …). */
  detail: string
  /** Tool the event is about, when the event carries one. */
  toolName?: string
  /** Raw tool-call arguments (JSON string), when available. */
  toolArguments?: string
  /** Asker-supplied approval reason, when available. */
  reason?: string
  /** Exact tool call the approval belongs to, when available. */
  callId?: string
}

/** Everything the summarizer and fallback need for one push. */
export interface MaterialInput {
  /** The decided event. */
  intent: NotificationIntent
  /** Live settings (budgets and the assistant-text switch). */
  settings: BarkSettings
  /** Newest assistant reply for this session, when tracked. */
  assistantText: string
  /** Workspace display name (title source and model context). */
  workspaceName: string
}

/**
 * Compose the notification title: the workspace name, fitted to the budget.
 * A phone notification needs a stable, recognizable source line, so the title
 * deliberately stays deterministic instead of being model-generated.
 * @param workspaceName - last path segment of the session's cwd (or its id).
 * @param settings - live settings carrying the title budget.
 * @returns the title within `titleMaxChars`.
 */
export function notificationTitle(workspaceName: string, settings: BarkSettings): string {
  return clipChars(collapseWhitespace(workspaceName), settings.titleMaxChars)
}

/**
 * Build the JSON material handed to the summarizer.
 *
 * The payload is intentionally small and structured: the model only needs the
 * event, its headline/detail, and the concrete command or question that made
 * the event worth a push. Including the workspace name lets the summary name
 * the project when the body has room.
 * @param input - event, settings, tracked reply text, and workspace name.
 * @returns a JSON string (bounded).
 */
export function summaryMaterial(input: MaterialInput): string {
  const { intent, settings, assistantText, workspaceName } = input
  const material: Record<string, string> = {
    event: intent.flag,
    workspace: clipChars(workspaceName, 120),
    headline: intent.headline,
  }
  if (intent.detail.length > 0) material['detail'] = clipChars(intent.detail, MATERIAL_DETAIL_CHARS)
  if (settings.includeAssistantText && assistantText.length > 0) {
    material['assistantReply'] = clipChars(collapseWhitespace(assistantText), MATERIAL_ASSISTANT_CHARS)
  }
  if (intent.toolName !== undefined && intent.toolName.length > 0) material['tool'] = intent.toolName
  if (intent.toolArguments !== undefined && intent.toolArguments.length > 0) {
    material['toolArguments'] = clipChars(intent.toolArguments, MATERIAL_ARGUMENTS_CHARS)
  }
  if (intent.reason !== undefined && intent.reason.length > 0) {
    material['reason'] = clipChars(intent.reason, MATERIAL_REASON_CHARS)
  }
  return JSON.stringify(material)
}

/**
 * Deterministic body used when the model answer is unavailable.
 * Keeps the headline and the most specific detail available, then fits the
 * content budget.
 * @param intent - decided event.
 * @param settings - live settings carrying the content budget.
 * @param assistantText - newest assistant reply (appended only when enabled).
 * @returns the fallback body within `contentMaxChars`.
 */
export function fallbackContent(
  intent: NotificationIntent,
  settings: BarkSettings,
  assistantText: string,
): string {
  const parts = [intent.headline]
  if (intent.detail.length > 0) parts.push(intent.detail)
  else if (intent.toolName !== undefined && intent.toolName.length > 0) parts.push(`工具 ${intent.toolName}`)
  let body = parts.join('：')
  if (settings.includeAssistantText && assistantText.length > 0) {
    body = `${body} ${collapseWhitespace(assistantText)}`
  }
  return clipChars(collapseWhitespace(body), settings.contentMaxChars)
}

/**
 * Choose the final body: the model summary when one exists, else the fallback.
 * @param summary - normalized model answer, if any.
 * @param intent - decided event.
 * @param settings - live settings carrying the content budget.
 * @param assistantText - newest assistant reply.
 * @returns the body within `contentMaxChars`.
 */
export function contentFromSummary(
  summary: string | undefined,
  intent: NotificationIntent,
  settings: BarkSettings,
  assistantText: string,
): string {
  const normalized = summary === undefined ? '' : collapseWhitespace(summary)
  if (normalized.length > 0) return clipChars(normalized, settings.contentMaxChars)
  return fallbackContent(intent, settings, assistantText)
}
