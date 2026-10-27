/**
 * Character-budget helpers for notification copy.
 *
 * "字数" here means user-perceived characters, so one CJK character, one
 * Latin letter, and one emoji each cost one unit. `Intl.Segmenter` supplies
 * grapheme clusters where the runtime has it (Node 22+ always does); the
 * code-point fallback only keeps the helpers usable under older embeddings.
 * @module dsh-notify-bark/text
 */
/**
 * Count the notification budget units in `text`.
 * @param text - arbitrary text.
 * @returns grapheme-cluster count (0 for an empty string).
 */
export declare function charLength(text: string): number;
/**
 * Slice `text` to at most `max` budget units without adding an ellipsis.
 * @param text - source text.
 * @param max - maximum units; non-positive yields an empty string.
 * @returns the prefix that fits the budget.
 */
export declare function truncateChars(text: string, max: number): string;
/**
 * Fit `text` into `max` units, marking a cut with a trailing ellipsis.
 * The ellipsis itself is part of the budget.
 * @param text - source text.
 * @param max - maximum units; non-positive yields an empty string.
 * @returns text within the budget.
 */
export declare function clipChars(text: string, max: number): string;
/**
 * Collapse every whitespace run (newlines included) into one space and trim.
 * A phone notification body renders as a single line, so composed copy uses
 * this before measuring it.
 * @param text - source text.
 * @returns single-line text.
 */
export declare function collapseWhitespace(text: string): string;
//# sourceMappingURL=text.d.ts.map