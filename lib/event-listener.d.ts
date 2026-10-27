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
import type { Context } from '@deepseek-ai/cordis';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import { type BarkSettings } from './settings-store.ts';
import { type NotificationIntent } from './notification.ts';
/** Workspace title for a session: last path segment of its cwd, else its id. */
export declare function workspaceNameOf(session: Session): string;
/**
 * Extract the assistant reply text from one `assistant/message` event.
 * @param event - a session event; non-assistant events yield an empty string.
 * @returns the event's text blocks joined by newlines, trimmed.
 */
export declare function assistantTextOf(event: SessionEvent): string;
/**
 * Scan an event list backwards for the newest assistant reply text. Kept as a
 * pure helper (and the unit-test seam); the live listener instead tracks the
 * latest reply incrementally, because a live session's log is append-only and
 * the listener sees every message event anyway.
 * @param events - session events in log order.
 * @returns the newest assistant text, or an empty string.
 */
export declare function lastAssistantText(events: readonly SessionEvent[]): string;
/**
 * Decide whether a session event should notify, and with what content.
 *
 * `approval/asked` is declared by dsh-user-approval through a session
 * event-map augmentation (imported above), so it participates in the
 * discriminated union exactly like the core event types.
 * @returns the intent, or undefined when the event is not notifiable.
 */
export declare function intentOfEvent(event: SessionEvent): NotificationIntent | undefined;
/** Bounded dedup ledger: one entry per session:seq, evicting the oldest. */
export declare function createDedupLedger(maxEntries?: number): {
    test(key: string): boolean;
};
/**
 * Subscribe the plugin to `session/event` and push Bark notifications.
 * @param ctx - plugin context.
 * @param getSettings - live settings thunk (follows the settings section).
 * @returns the disposer removing the listener and aborting in-flight pushes.
 */
export declare function createEventListener(ctx: Context, getSettings: () => BarkSettings): () => void;
//# sourceMappingURL=event-listener.d.ts.map