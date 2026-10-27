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
import type { Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** The nine notification events the section can toggle. */
export interface BarkEventSettings {
    /** ✅ turn ended completed. */
    completed: boolean;
    /** ❌ turn ended with an error. */
    error: boolean;
    /** 🚫 turn ended blocked (waiting on something the agent cannot do alone). */
    blocked: boolean;
    /** ⏹ turn aborted by the user. */
    aborted: boolean;
    /** ⚠️ a step hit its output-token ceiling. */
    maxTokens: boolean;
    /** ⏸ a crash-orphaned turn was closed on reload. */
    interrupted: boolean;
    /** ❓ ask_user_question is waiting for an answer. */
    question: boolean;
    /** 🔐 an approval request is waiting for a decision. */
    approval: boolean;
    /** 📋 exit_plan_mode presented a plan for review. */
    planReview: boolean;
}
/** Complete Bark plugin settings. */
export interface BarkSettings {
    /** Master switch; when off nothing is sent. */
    enabled: boolean;
    /** Full Bark endpoint, e.g. https://api.day.app/<key> — treated as a secret. */
    barkUrl: string;
    /** Per-event notification switches. */
    events: BarkEventSettings;
    /** Include the AI's last reply as summarizer material. */
    includeAssistantText: boolean;
    /** Title budget in user-perceived characters. */
    titleMaxChars: number;
    /** Body budget in user-perceived characters. */
    contentMaxChars: number;
    /** Fallback Bark group when the workspace `.env` sets none. */
    group: string;
}
/** Default title budget ("字"). */
export declare const DEFAULT_TITLE_MAX_CHARS = 20;
/** Default body budget ("字"). */
export declare const DEFAULT_CONTENT_MAX_CHARS = 50;
/** Upper bound accepted for the title budget. */
export declare const TITLE_MAX_CHARS_LIMIT = 80;
/** Upper bound accepted for the body budget. */
export declare const CONTENT_MAX_CHARS_LIMIT = 500;
/**
 * The resolved plugin config the Loader hands `apply`: every used field is a
 * retained volatile reference, so reading it inside the event listener always
 * follows the latest settings write.
 */
export interface Config {
    /** Master switch; when off nothing is sent. */
    enabled: Volatile<boolean>;
    /** Full Bark endpoint — treated as a secret and never echoed to the browser. */
    barkUrl: Volatile<string>;
    /** Per-event notification switches (one volatile object). */
    events: Volatile<BarkEventSettings>;
    /** Include the AI's last reply as summarizer material. */
    includeAssistantText: Volatile<boolean>;
    /** Title budget in user-perceived characters. */
    titleMaxChars: Volatile<number>;
    /** Body budget in user-perceived characters. */
    contentMaxChars: Volatile<number>;
    /** Fallback Bark group when the workspace `.env` sets none. */
    group: Volatile<string>;
}
/** Composition defaults — what a fresh install ships with. */
export declare const DEFAULT_SETTINGS: BarkSettings;
/**
 * The plugin's Loader config schema. Every editable field is `volatile()` so
 * the settings transport can edit it live; `barkUrl` is `role('secret')` so
 * any redacted describe never carries it.
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    enabled: z<boolean, boolean, "volatile-defined">;
    barkUrl: z<string, string, "volatile-defined">;
    events: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        completed: z<boolean, boolean, "defined">;
        error: z<boolean, boolean, "defined">;
        blocked: z<boolean, boolean, "defined">;
        aborted: z<boolean, boolean, "defined">;
        maxTokens: z<boolean, boolean, "defined">;
        interrupted: z<boolean, boolean, "defined">;
        question: z<boolean, boolean, "defined">;
        approval: z<boolean, boolean, "defined">;
        planReview: z<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        completed: z<boolean, boolean, "defined">;
        error: z<boolean, boolean, "defined">;
        blocked: z<boolean, boolean, "defined">;
        aborted: z<boolean, boolean, "defined">;
        maxTokens: z<boolean, boolean, "defined">;
        interrupted: z<boolean, boolean, "defined">;
        question: z<boolean, boolean, "defined">;
        approval: z<boolean, boolean, "defined">;
        planReview: z<boolean, boolean, "defined">;
    }>>>, "volatile">;
    includeAssistantText: z<boolean, boolean, "volatile-defined">;
    titleMaxChars: z<number, number, "volatile-defined">;
    contentMaxChars: z<number, number, "volatile-defined">;
    group: z<string, string, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    enabled: z<boolean, boolean, "volatile-defined">;
    barkUrl: z<string, string, "volatile-defined">;
    events: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        completed: z<boolean, boolean, "defined">;
        error: z<boolean, boolean, "defined">;
        blocked: z<boolean, boolean, "defined">;
        aborted: z<boolean, boolean, "defined">;
        maxTokens: z<boolean, boolean, "defined">;
        interrupted: z<boolean, boolean, "defined">;
        question: z<boolean, boolean, "defined">;
        approval: z<boolean, boolean, "defined">;
        planReview: z<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        completed: z<boolean, boolean, "defined">;
        error: z<boolean, boolean, "defined">;
        blocked: z<boolean, boolean, "defined">;
        aborted: z<boolean, boolean, "defined">;
        maxTokens: z<boolean, boolean, "defined">;
        interrupted: z<boolean, boolean, "defined">;
        question: z<boolean, boolean, "defined">;
        approval: z<boolean, boolean, "defined">;
        planReview: z<boolean, boolean, "defined">;
    }>>>, "volatile">;
    includeAssistantText: z<boolean, boolean, "volatile-defined">;
    titleMaxChars: z<number, number, "volatile-defined">;
    contentMaxChars: z<number, number, "volatile-defined">;
    group: z<string, string, "volatile-defined">;
}>>, "plain">;
/**
 * Clamp a user-supplied character budget into its accepted range.
 * @param value - candidate from a settings write.
 * @param max - inclusive upper bound.
 * @returns a positive integer within `[1, max]`.
 */
export declare function clampCharLimit(value: number, max: number): number;
/**
 * Read a detached plain settings object from the live volatile config.
 * @param config - resolved config handed to `apply`.
 * @returns the current settings, defaults applied.
 */
export declare function readBarkSettings(config: Config): BarkSettings;
/**
 * Map a `turn/end` reason kind onto the settings event flag. Kinds outside
 * the official set (plugin extensions, fork seeds) yield undefined and stay
 * silent.
 */
export declare const TURN_END_EVENT_FLAG: Record<string, keyof BarkEventSettings>;
/**
 * Bark push levels: completed → active; waiting/error states → timeSensitive;
 * aborted → passive. critical is intentionally never used by default.
 */
export type BarkLevel = 'active' | 'timeSensitive' | 'passive' | 'critical';
/** Per-event presentation metadata. */
export interface BarkEventMeta {
    /** One-line headline, the fallback body's first line and summarizer input. */
    headline: string;
    /** Bark level for this event. */
    level: BarkLevel;
}
/** Event metadata keyed by the settings event flag. */
export declare const EVENT_META: Record<keyof BarkEventSettings, BarkEventMeta>;
/**
 * Normalize a Bark endpoint: trim and strip trailing slashes so the JSON POST
 * hits exactly the server root (Bark V2 accepts `POST <base>` with a JSON
 * body carrying title/body/group/level/icon).
 */
export declare function sanitizeBarkUrl(input: string): string;
/**
 * Mask a Bark URL for display: the URL carries the device key, so only a
 * configured/unconfigured fact plus the last four characters cross the wire.
 */
export declare function maskBarkUrl(url: string): {
    configured: boolean;
    masked: string;
};
//# sourceMappingURL=settings-store.d.ts.map