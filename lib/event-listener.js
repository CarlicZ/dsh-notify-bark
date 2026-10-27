/**
 * dsh-notify-bark Host event listener: watches the `session/event` firehose
 * and maps turn endings, user questions, plan reviews, and approval requests
 * onto Bark pushes. Everything runs on the Host, so the browser being closed
 * does not matter — the same path dsh-im-bridge uses for WeChat.
 *
 * Delivery is asynchronous and best-effort: the listener only decides whether
 * an event is notifiable, then a detached pipeline reads the workspace `.env`,
 * asks the current default model for a short body, and posts to Bark. A slow
 * or failed model call never blocks the session and never suppresses the push
 * (the deterministic fallback body is used instead).
 * @module dsh-notify-bark/event-listener
 */
import { basename } from 'node:path';
import { sendBark } from "./bark-service.js";
import { EVENT_META, TURN_END_EVENT_FLAG, sanitizeBarkUrl, } from "./settings-store.js";
import { contentFromSummary, notificationTitle, summaryMaterial, } from "./notification.js";
import { summarizeContent, SUMMARY_TIMEOUT_MS } from "./summarize.js";
import { readWorkspaceBarkEnv, workspaceDirectoryOf } from "./workspace-env.js";
/** Workspace title for a session: last path segment of its cwd, else its id. */
export function workspaceNameOf(session) {
    const cwd = session.header.cwd;
    return cwd !== undefined && cwd.length > 0 ? basename(cwd) : String(session.id);
}
/** Calls kept per session for approval lookups. */
const MAX_CALLS_PER_SESSION = 16;
/** Sessions whose latest reply and calls are tracked. */
const MAX_TRACKED_SESSIONS = 200;
/** Whole notification pipeline deadline (summary + `.env` read + Bark POST). */
const DELIVERY_TIMEOUT_MS = SUMMARY_TIMEOUT_MS + 6000;
/**
 * Extract the assistant reply text from one `assistant/message` event.
 * @param event - a session event; non-assistant events yield an empty string.
 * @returns the event's text blocks joined by newlines, trimmed.
 */
export function assistantTextOf(event) {
    if (event.type !== 'assistant/message')
        return '';
    const blocks = event.data.message.content ?? [];
    return blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
}
/**
 * Scan an event list backwards for the newest assistant reply text. Kept as a
 * pure helper (and the unit-test seam); the live listener instead tracks the
 * latest reply incrementally, because a live session's log is append-only and
 * the listener sees every message event anyway.
 * @param events - session events in log order.
 * @returns the newest assistant text, or an empty string.
 */
export function lastAssistantText(events) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event === undefined)
            continue;
        const text = assistantTextOf(event);
        if (text.length > 0)
            return text;
    }
    return '';
}
/**
 * Decide whether a session event should notify, and with what content.
 *
 * `approval/asked` is declared by dsh-user-approval through a session
 * event-map augmentation (imported above), so it participates in the
 * discriminated union exactly like the core event types.
 * @returns the intent, or undefined when the event is not notifiable.
 */
export function intentOfEvent(event) {
    switch (event.type) {
        case 'turn/end': {
            const flag = TURN_END_EVENT_FLAG[event.data.reason.kind];
            if (flag === undefined)
                return undefined;
            const meta = EVENT_META[flag];
            let detail = '';
            if (event.data.reason.kind === 'error') {
                detail = event.data.reason.error?.message ?? '任务执行出错';
            }
            else if (event.data.reason.kind === 'blocked') {
                detail = '任务被阻塞，等待你处理';
            }
            else if (event.data.reason.kind === 'max-tokens') {
                detail = '某一步骤达到输出 Token 上限';
            }
            else if (event.data.reason.kind === 'interrupted') {
                detail = '会话曾被异常中断，等待恢复';
            }
            return { flag, headline: meta.headline, detail };
        }
        case 'tool/call': {
            if (event.data.name === 'ask_user_question') {
                let question = '';
                try {
                    const parsed = JSON.parse(event.data.arguments);
                    question = parsed.questions?.[0]?.question ?? '';
                }
                catch {
                    question = '';
                }
                return {
                    flag: 'question',
                    headline: EVENT_META.question.headline,
                    detail: question,
                    toolName: 'ask_user_question',
                    toolArguments: event.data.arguments,
                };
            }
            if (event.data.name === 'exit_plan_mode') {
                return {
                    flag: 'planReview',
                    headline: EVENT_META.planReview.headline,
                    detail: 'Agent 已提交计划，等待你的确认',
                    toolName: 'exit_plan_mode',
                    toolArguments: event.data.arguments,
                };
            }
            return undefined;
        }
        case 'approval/asked': {
            const tool = event.data.toolName.length > 0 ? `工具 ${event.data.toolName}` : '一个操作';
            const reason = event.data.reason !== undefined && event.data.reason.length > 0 ? `：${event.data.reason}` : '';
            return {
                flag: 'approval',
                headline: EVENT_META.approval.headline,
                detail: `${tool} 需要授权${reason}`,
                ...event.data.toolName.length > 0 ? { toolName: event.data.toolName } : {},
                ...event.data.reason !== undefined ? { reason: event.data.reason } : {},
                ...event.data.callId !== undefined ? { callId: String(event.data.callId) } : {},
            };
        }
        default:
            return undefined;
    }
}
/** Bounded dedup ledger: one entry per session:seq, evicting the oldest. */
export function createDedupLedger(maxEntries = 500) {
    const seen = new Map();
    const windowMs = 24 * 60 * 60 * 1000;
    return {
        test(key) {
            const now = Date.now();
            const previous = seen.get(key);
            if (previous !== undefined && now - previous < windowMs)
                return false;
            seen.set(key, now);
            if (seen.size > maxEntries) {
                const oldest = seen.keys().next().value;
                if (oldest !== undefined)
                    seen.delete(oldest);
            }
            return true;
        },
    };
}
/**
 * Subscribe the plugin to `session/event` and push Bark notifications.
 * @param ctx - plugin context.
 * @param getSettings - live settings thunk (follows the settings section).
 * @returns the disposer removing the listener and aborting in-flight pushes.
 */
export function createEventListener(ctx, getSettings) {
    const dedup = createDedupLedger();
    // Newest assistant reply per session, tracked from the same firehose the
    // notifications ride, so turn/end never needs a synchronous session-log read
    // (DSH 0.2 removed `session.events`). Insertion order is the LRU order.
    const lastReply = new Map();
    // Recent tool calls per session keyed by callId: an approval/asked event
    // follows its tool/call, so the arguments (command, path, patch) that made
    // the push worth reading are available without touching the session log.
    const recentCalls = new Map();
    // One controller per detached delivery, aborted when the plugin unloads.
    const inflight = new Set();
    const rememberCall = (sessionId, callId, call) => {
        let calls = recentCalls.get(sessionId);
        if (calls === undefined) {
            calls = new Map();
            recentCalls.set(sessionId, calls);
            if (recentCalls.size > MAX_TRACKED_SESSIONS) {
                const oldest = recentCalls.keys().next().value;
                if (oldest !== undefined)
                    recentCalls.delete(oldest);
            }
        }
        calls.delete(callId);
        calls.set(callId, call);
        if (calls.size > MAX_CALLS_PER_SESSION) {
            const oldest = calls.keys().next().value;
            if (oldest !== undefined)
                calls.delete(oldest);
        }
    };
    const forgetCall = (sessionId, callId) => {
        const calls = recentCalls.get(sessionId);
        if (calls === undefined)
            return;
        calls.delete(callId);
        if (calls.size === 0)
            recentCalls.delete(sessionId);
    };
    const toolArgumentsFor = (sessionId, intent) => {
        if (intent.toolArguments !== undefined)
            return intent.toolArguments;
        const calls = recentCalls.get(sessionId);
        if (calls === undefined)
            return undefined;
        if (intent.callId !== undefined)
            return calls.get(intent.callId)?.arguments;
        // No callId on the ask: the approval follows the newest call in practice.
        let latest;
        for (const call of calls.values())
            latest = call;
        return latest?.arguments;
    };
    /**
     * Run one detached notification: `.env` overrides → model summary → Bark.
     * Never throws into the event dispatch; failures are logged without the
     * endpoint or any `.env` value.
     */
    const deliver = async (session, intent, settings, assistantText, endpoint) => {
        const controller = new AbortController();
        inflight.add(controller);
        const timer = setTimeout(() => controller.abort(new Error('notification timeout')), DELIVERY_TIMEOUT_MS);
        try {
            const workspaceName = workspaceNameOf(session);
            const env = await readWorkspaceBarkEnv(workspaceDirectoryOf(ctx, session));
            if (controller.signal.aborted)
                return;
            const callArguments = toolArgumentsFor(String(session.id), intent);
            const materialIntent = callArguments === undefined
                ? intent
                : { ...intent, toolArguments: callArguments };
            const summary = await summarizeContent(ctx, {
                material: summaryMaterial({ intent: materialIntent, settings, assistantText, workspaceName }),
                limit: settings.contentMaxChars,
            }, controller.signal);
            if (controller.signal.aborted)
                return;
            const payload = {
                title: notificationTitle(workspaceName, settings),
                body: contentFromSummary(summary, intent, settings, assistantText),
                group: env.group ?? settings.group,
                level: EVENT_META[intent.flag].level,
                ...env.icon === undefined ? {} : { icon: env.icon },
            };
            await sendBark(endpoint, payload);
        }
        catch (error) {
            // Never log the endpoint (it carries the device key) or `.env` values.
            const message = error instanceof Error ? error.message : String(error);
            ctx.logger.warn(`[bark-notify] 推送失败: ${message}`);
        }
        finally {
            clearTimeout(timer);
            inflight.delete(controller);
        }
    };
    const listener = (session, event) => {
        const sessionId = String(session.id);
        if (event.type === 'assistant/message') {
            const text = assistantTextOf(event);
            if (text.length > 0) {
                lastReply.delete(sessionId);
                lastReply.set(sessionId, text);
                if (lastReply.size > MAX_TRACKED_SESSIONS) {
                    const oldest = lastReply.keys().next().value;
                    if (oldest !== undefined)
                        lastReply.delete(oldest);
                }
            }
            return;
        }
        if (event.type === 'tool/call') {
            // Question and plan-review calls are themselves notifiable; every other
            // call is only remembered so a later approval can describe it.
            if (event.data.name !== 'ask_user_question' && event.data.name !== 'exit_plan_mode') {
                rememberCall(sessionId, String(event.data.callId), {
                    name: event.data.name,
                    arguments: event.data.arguments,
                });
                return;
            }
        }
        if (event.type === 'tool/result') {
            forgetCall(sessionId, String(event.data.message.source.callId));
            return;
        }
        // One push per logical event, even across reconnects or reloads.
        if (!dedup.test(`${sessionId}:${event.seq}`))
            return;
        const settings = getSettings();
        if (!settings.enabled)
            return;
        const endpoint = sanitizeBarkUrl(settings.barkUrl);
        if (endpoint.length === 0)
            return;
        const intent = intentOfEvent(event);
        if (intent === undefined)
            return;
        if (!settings.events[intent.flag])
            return;
        const assistantText = event.type === 'turn/end' ? (lastReply.get(sessionId) ?? '') : '';
        void deliver(session, intent, settings, assistantText, endpoint);
    };
    const dispose = ctx.on('session/event', listener);
    return () => {
        dispose();
        for (const controller of inflight)
            controller.abort(new Error('plugin unloaded'));
        inflight.clear();
    };
}
//# sourceMappingURL=event-listener.js.map