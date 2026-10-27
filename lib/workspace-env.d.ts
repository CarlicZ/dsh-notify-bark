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
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
/** Workspace `.env` icon keys, highest precedence first. */
export declare const ENV_ICON_KEYS: readonly ["DSH_BARK_ICON", "BARK_ICON"];
/** Workspace `.env` group keys, highest precedence first. */
export declare const ENV_GROUP_KEYS: readonly ["DSH_BARK_GROUP", "BARK_GROUP"];
/** Presentation overrides read from one workspace `.env`. */
export interface WorkspaceBarkEnv {
    /** Icon URL the Bark server should fetch, when configured and valid. */
    icon?: string;
    /** Bark group override, when configured. */
    group?: string;
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
export declare function parseDotEnv(text: string): Record<string, string>;
/**
 * Validate an icon override. Bark expects an absolute http(s) URL it can
 * fetch, so a local path (or any other scheme) is ignored rather than sent.
 * @param value - raw `.env` value.
 * @returns the normalized URL, or undefined.
 */
export declare function normalizeIcon(value: string | undefined): string | undefined;
/**
 * Normalize a group override: one line, control characters removed, clipped to
 * the Bark-safe length.
 * @param value - raw `.env` value.
 * @returns the group, or undefined when nothing usable remains.
 */
export declare function normalizeGroup(value: string | undefined): string | undefined;
/**
 * Select the presentation overrides from parsed `.env` values.
 * @param values - parsed key/value pairs.
 * @returns the valid overrides (absent fields stay absent).
 */
export declare function selectWorkspaceBarkEnv(values: Record<string, string>): WorkspaceBarkEnv;
/**
 * Resolve the session's effective workspace directory.
 * @param ctx - Host context exposing `workingDirectory` when composed.
 * @param session - live session.
 * @returns the absolute directory, or undefined when the session has none.
 */
export declare function workspaceDirectoryOf(ctx: Context, session: Session): string | undefined;
/**
 * Read the presentation overrides from one workspace's `.env`.
 * A missing or unreadable file is a normal "no overrides" answer.
 * @param directory - workspace directory.
 * @returns the valid overrides.
 */
export declare function readWorkspaceBarkEnv(directory: string | undefined): Promise<WorkspaceBarkEnv>;
//# sourceMappingURL=workspace-env.d.ts.map