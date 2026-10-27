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
import type { Context } from '@deepseek-ai/cordis';
/** End-to-end bound for one summary request, in milliseconds. */
export declare const SUMMARY_TIMEOUT_MS = 8000;
/** Input material bound, so a long assistant reply cannot balloon the request. */
export declare const SUMMARY_MAX_INPUT_CHARS = 4000;
/** Output-token cap; a 50-character summary needs far less than this. */
export declare const SUMMARY_MAX_TOKENS = 256;
/** Sampling temperature for the one-line summary. */
export declare const SUMMARY_TEMPERATURE = 0.3;
/** One material payload and the body budget it must satisfy. */
export interface SummaryRequest {
    /** JSON-serialized event material (already minimized by the caller). */
    material: string;
    /** Maximum body characters the answer may use. */
    limit: number;
}
/**
 * System instruction for the summarizer. Kept here (not in the customer-facing
 * locales) because it is a model contract, not UI copy.
 * @param limit - body character budget.
 * @returns the system prompt.
 */
export declare function summarySystemPrompt(limit: number): string;
/**
 * Clean one model answer into a single-line notification body.
 * @param text - raw model text.
 * @param limit - body character budget.
 * @returns normalized text within the budget (possibly empty).
 */
export declare function normalizeSummary(text: string, limit: number): string;
/**
 * Ask the current default model for a short notification body.
 * @param ctx - Host context exposing `llm` and `agentDefaultModel`.
 * @param request - material payload and body budget.
 * @param signal - caller cancellation (plugin unload, pipeline deadline).
 * @returns the normalized body, or undefined when no usable answer exists.
 */
export declare function summarizeContent(ctx: Context, request: SummaryRequest, signal?: AbortSignal): Promise<string | undefined>;
//# sourceMappingURL=summarize.d.ts.map