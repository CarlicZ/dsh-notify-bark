/**
 * Model-backed notification summarization.
 *
 * The deployed plugin deliberately has no model picker: every summary uses the
 * Host's current default model (`ctx.agentDefaultModel.currentSelection()`),
 * exactly the route a fresh session would use. The call is a hand-built
 * one-shot request through `ctx.llm`, so it needs no Agent, Session, or
 * transcript — the notification pipeline can run from the `session/event`
 * firehose without touching the session log.
 *
 * Failure is always soft: a missing `llm` service, an unconfigured route, a
 * timeout, or an empty/error finish resolves `undefined`, and the caller falls
 * back to the deterministic composed body. Notifications are never blocked or
 * lost because the model call failed.
 * @module dsh-notify-bark/summarize
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `ctx.llm` service merge from dsh-llm.
import type {} from '@deepseek-ai/dsh-llm'
// Type-only: pulls the `ctx.agentDefaultModel` service merge.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { clipChars, collapseWhitespace } from './text.ts'

/** End-to-end bound for one summary request, in milliseconds. */
export const SUMMARY_TIMEOUT_MS = 8000

/** Input material bound, so a long assistant reply cannot balloon the request. */
export const SUMMARY_MAX_INPUT_CHARS = 4000

/** Output-token cap; a 50-character summary needs far less than this. */
export const SUMMARY_MAX_TOKENS = 256

/** Sampling temperature for the one-line summary. */
export const SUMMARY_TEMPERATURE = 0.3

/** One material payload and the body budget it must satisfy. */
export interface SummaryRequest {
  /** JSON-serialized event material (already minimized by the caller). */
  material: string
  /** Maximum body characters the answer may use. */
  limit: number
}

/**
 * System instruction for the summarizer. Kept here (not in the customer-facing
 * locales) because it is a model contract, not UI copy.
 * @param limit - body character budget.
 * @returns the system prompt.
 */
export function summarySystemPrompt(limit: number): string {
  return [
    '你是 DeepSeek Harness 的手机推送文案助手。根据给定的事件素材，写一条简体中文推送正文。',
    '只输出一行纯文本：不要 Markdown、代码块、引号、前缀、解释，也不要换行。',
    `正文不超过 ${limit} 个字符（按用户感知的字符计：中文、英文字母、emoji 都算 1 个）。`,
    '先点明发生了什么（例如：任务完成、执行失败、等待授权、等待回答、计划待确认），再说明关键对象或原因。',
    '素材不足时按已有信息简短概括，不要编造素材里没有的命令、路径或结论。',
    '命令或路径太长时只保留最有辨识度的片段。',
  ].join('\n')
}

/**
 * Clean one model answer into a single-line notification body.
 * @param text - raw model text.
 * @param limit - body character budget.
 * @returns normalized text within the budget (possibly empty).
 */
export function normalizeSummary(text: string, limit: number): string {
  let value = text.trim()
  // Models sometimes wrap the answer in a fenced block despite instructions.
  value = value.replace(/^```[A-Za-z0-9_-]*\s*/u, '').replace(/\s*```$/u, '')
  // Drop a leading label such as "正文：" or "Body:".
  value = value.replace(/^(?:正文|内容|摘要|通知|body|content|summary)\s*[:：]\s*/iu, '')
  const firstLine = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? ''
  const unquoted = firstLine.replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/gu, '')
  return clipChars(collapseWhitespace(unquoted), limit)
}

/**
 * Ask the current default model for a short notification body.
 * @param ctx - Host context exposing `llm` and `agentDefaultModel`.
 * @param request - material payload and body budget.
 * @param signal - caller cancellation (plugin unload, pipeline deadline).
 * @returns the normalized body, or undefined when no usable answer exists.
 */
export async function summarizeContent(
  ctx: Context,
  request: SummaryRequest,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (signal?.aborted === true) return undefined

  const llm = ctx.get('llm')
  const defaults = ctx.get('agentDefaultModel')
  if (llm === undefined || defaults === undefined) return undefined

  let selection: { provider: string; model: string }
  try {
    selection = defaults.currentSelection()
  } catch {
    return undefined
  }
  if (selection.provider.length === 0 || selection.model.length === 0) return undefined

  const controller = new AbortController()
  const onAbort = (): void => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('summary timeout')), SUMMARY_TIMEOUT_MS)

  try {
    // Pick the route's least expensive reasoning effort: a one-line summary
    // does not benefit from high effort, and reasoning tokens would delay the
    // notification (the official session-title path does the same).
    //
    // Every dispatch control must already be part of this prepared config:
    // `prepared.stream()` rejects a request whose provider/model/
    // reasoningEffort/temperature/maxTokens differ from what was prepared.
    const prepared = await llm.prepareCall(
      {
        provider: selection.provider,
        model: selection.model,
        maxTokens: SUMMARY_MAX_TOKENS,
        temperature: SUMMARY_TEMPERATURE,
      },
      controller.signal,
      (controls, model) => {
        const effort = model.reasoning?.efforts[0]?.id
        return effort === undefined ? controls : { ...controls, reasoningEffort: effort }
      },
    )

    const options = {
      ...prepared.config,
      system: summarySystemPrompt(request.limit),
      messages: [{
        role: 'user' as const,
        content: [{ type: 'text' as const, text: clipChars(request.material, SUMMARY_MAX_INPUT_CHARS) }],
      }],
      signal: controller.signal,
    }

    let text = ''
    let failed = false
    for await (const chunk of prepared.stream(options)) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'finish') {
        if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') failed = true
      }
    }
    if (failed || controller.signal.aborted) return undefined

    const summary = normalizeSummary(text, request.limit)
    return summary.length > 0 ? summary : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
