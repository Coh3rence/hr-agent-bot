import type { SheetsService } from "./sheets";

/**
 * Structured "negotiation memory" for a Modify cycle (D-012, Option C).
 *
 * The session is in-memory only, so the negotiation transcript is gone after a
 * restart. Rather than persist raw chat, we reconstruct a background brief from
 * data already on the sheet — the contributor's prior terms (Agreements row),
 * the aggregated counter (columns M/N), and the per-reviewer reasons
 * (ReviewFeedback tab). The caller carries the returned string as system-prompt
 * background for the re-entered negotiation, NOT as a conversation turn.
 *
 * Read-only. Degrades gracefully: missing counter or missing reviewer notes are
 * simply omitted; only a missing agreement yields null.
 */
export async function buildModifyContext(
  agreementId: string,
  sheets: SheetsService
): Promise<string | null> {
  const agreement = await sheets.getAgreement(agreementId);
  if (!agreement) return null;

  const lines: string[] = [
    `Background for this re-negotiation. Use it to guide the contributor; do not repeat it back verbatim.`,
    ``,
    `The contributor's previous proposal for "${agreement.roleName}": ` +
      `$${agreement.hourlyRate}/hr, ${agreement.commitmentPercent}% commitment, ` +
      `${agreement.durationMonths} months.`,
  ];

  const offer = await sheets.getCandidateOffer(agreementId);
  if (offer) {
    const terms: string[] = [];
    if (offer.suggestedRate != null) terms.push(`$${offer.suggestedRate}/hr`);
    if (offer.suggestedCommitment != null) terms.push(`${offer.suggestedCommitment}% commitment`);
    const clause =
      terms.length > 0
        ? `countered at ${terms.join(", ")}`
        : `responded without proposing new terms`;
    lines.push(`The core team reviewed it and ${clause}. ${offer.qualitativeSummary}`);
  }

  const feedbacks = await sheets.getReviewFeedbacks(agreementId);
  const notes = feedbacks
    .map((f) => {
      const reason = f.qualitativeFeedback?.trim();
      if (!reason) return null;
      const terms: string[] = [];
      if (f.suggestedRate != null) terms.push(`$${f.suggestedRate}/hr`);
      if (f.suggestedCommitment != null) terms.push(`${f.suggestedCommitment}% commitment`);
      const suffix = terms.length > 0 ? ` (suggested ${terms.join(", ")})` : "";
      return `- ${f.decision}${suffix}: ${reason}`;
    })
    .filter((n): n is string => n !== null);

  if (notes.length > 0) {
    lines.push(``, `Reviewer notes:`, ...notes);
  }

  lines.push(``, `The contributor now wants to revise their terms.`);
  return lines.join("\n");
}
