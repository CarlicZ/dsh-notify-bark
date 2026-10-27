/**
 * Character-budget helpers for notification copy.
 *
 * "字数" here means user-perceived characters, so one CJK character, one
 * Latin letter, and one emoji each cost one unit. `Intl.Segmenter` supplies
 * grapheme clusters where the runtime has it (Node 22+ always does); the
 * code-point fallback only keeps the helpers usable under older embeddings.
 * @module dsh-notify-bark/text
 */

/** Grapheme segmenter, or undefined when the runtime lacks `Intl.Segmenter`. */
const segmenter: Intl.Segmenter | undefined =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : undefined

/**
 * Count the notification budget units in `text`.
 * @param text - arbitrary text.
 * @returns grapheme-cluster count (0 for an empty string).
 */
export function charLength(text: string): number {
  if (text.length === 0) return 0
  if (segmenter === undefined) return Array.from(text).length
  let count = 0
  for (const _part of segmenter.segment(text)) count += 1
  return count
}

/**
 * Slice `text` to at most `max` budget units without adding an ellipsis.
 * @param text - source text.
 * @param max - maximum units; non-positive yields an empty string.
 * @returns the prefix that fits the budget.
 */
export function truncateChars(text: string, max: number): string {
  if (max <= 0 || text.length === 0) return ''
  if (charLength(text) <= max) return text
  if (segmenter === undefined) return Array.from(text).slice(0, max).join('')
  const parts: string[] = []
  for (const part of segmenter.segment(text)) {
    if (parts.length >= max) break
    parts.push(part.segment)
  }
  return parts.join('')
}

/**
 * Fit `text` into `max` units, marking a cut with a trailing ellipsis.
 * The ellipsis itself is part of the budget.
 * @param text - source text.
 * @param max - maximum units; non-positive yields an empty string.
 * @returns text within the budget.
 */
export function clipChars(text: string, max: number): string {
  if (max <= 0 || text.length === 0) return ''
  if (charLength(text) <= max) return text
  if (max === 1) return '…'
  return `${truncateChars(text, max - 1)}…`
}

/**
 * Collapse every whitespace run (newlines included) into one space and trim.
 * A phone notification body renders as a single line, so composed copy uses
 * this before measuring it.
 * @param text - source text.
 * @returns single-line text.
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}
