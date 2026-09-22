import type { ReviewerFeedback } from "../models/types";

/**
 * A floor under the one piece of candidate-facing copy a model writes freehand (§20).
 *
 * `aggregateFeedback` synthesises the mixed-verdict summary with Claude and it reached
 * the candidate verbatim. Two live runs showed why that is not safe: one produced a
 * literal "[relevant area]", and one asserted "our current band is $60" when no $60
 * existed in any reviewer's feedback and the offer on the table was the candidate's own
 * $75. An invented figure is the dangerous one — the candidate reads a number, taps
 * Accept, and is bound to a different one.
 *
 * Only the model-written summary is checked. The all-approve, all-reject and
 * single-reviewer paths are already deterministic, and a lone reviewer's own words are
 * authoritative rather than something to second-guess.
 */

const PLACEHOLDER = /\[[^\]\n]{1,80}\]|\{[^}\n]{1,80}\}/;
const DOLLARS = /\$\s?(\d[\d,]*(?:\.\d+)?)/g;
const PER_HOUR = /(\d[\d,]*(?:\.\d+)?)\s*(?:\/\s*(?:hr|hour)\b|per hour)/gi;

function parseAmount(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function amountsIn(summary: string): number[] {
  const found: number[] = [];
  for (const m of summary.matchAll(DOLLARS)) found.push(parseAmount(m[1]!));
  for (const m of summary.matchAll(PER_HOUR)) found.push(parseAmount(m[1]!));
  return found;
}

/**
 * Returns a human-readable reason the summary must not be sent, or null if it is clean.
 * `supportedAmounts` is every figure the copy is allowed to name: the aggregated offer,
 * the candidate's own ask, and each reviewer's counter.
 */
export function findSummaryViolation(
  summary: string,
  supportedAmounts: readonly number[]
): string | null {
  if (!summary.trim()) return "empty summary";

  const placeholder = summary.match(PLACEHOLDER);
  if (placeholder) return `unfilled placeholder ${placeholder[0]}`;

  const allowed = new Set(supportedAmounts);
  for (const amount of amountsIn(summary)) {
    if (!allowed.has(amount)) {
      return `unsupported figure $${amount} (no reviewer proposed it)`;
    }
  }

  return null;
}

/**
 * The replacement when the model's summary is rejected: the reviewers' own words, which
 * cannot invent a figure because nobody generated them. Mirrors the all-reject path,
 * which has always built its reason list this way.
 */
export function deterministicSummary(feedbacks: readonly ReviewerFeedback[]): string {
  const notes = feedbacks
    .map((f) => f.qualitativeFeedback?.trim())
    .filter((note): note is string => !!note);

  if (!notes.length) {
    return `The reviewers did not reach a single view and left no written comments.`;
  }

  const joined = notes.join("; ");
  const terminated = /[.!?]$/.test(joined) ? joined : `${joined}.`;
  return `The reviewers did not reach a single view. Their comments: ${terminated}`;
}
