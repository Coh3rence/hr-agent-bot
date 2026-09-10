import type { SheetsService } from "./sheets";

/** Client asked for "two or three days of cool down"; we use the upper end. */
export const COOLDOWN_DAYS = 3;

/**
 * Close an attempt that ended without an agreement: retire the proposal and put
 * the contributor on a cooldown they can come back from.
 *
 * Shared by the two ways an attempt ends that way — the candidate walking away,
 * and every reviewer declining (§16). The client gave one rule for both: *"if no
 * agreement was met, okay, thank you for your attention... two or three days of
 * cool down"*, the pause being time for each side to reflect before the next
 * cycle. Sharing the implementation keeps a decline from being a softer or
 * harsher ending than a walk-away.
 *
 * Non-fatal throughout: a contributor left un-cooled is a smaller harm than an
 * exception thrown on the path that tells someone they were turned down.
 */
export async function closeAsDeclined(
  agreementId: string,
  contributorId: string,
  sheets: SheetsService
): Promise<void> {
  await sheets
    .updateAgreementStatus(agreementId, "rejected")
    .catch((err) => console.error(`closeAsDeclined: could not reject ${agreementId}:`, err));

  try {
    const contributor = await sheets.getContributorById(contributorId);
    if (!contributor) {
      console.error(`closeAsDeclined: contributor ${contributorId} not found`);
      return;
    }

    const cooldownUntil = new Date();
    cooldownUntil.setDate(cooldownUntil.getDate() + COOLDOWN_DAYS);

    await sheets.updateContributor(contributor.id, {
      status: "cooldown",
      cooldownUntil: cooldownUntil.toISOString(),
      previousAttempts: contributor.previousAttempts + 1,
    });
  } catch (err) {
    console.error(`closeAsDeclined: could not cool down ${contributorId}:`, err);
  }
}
