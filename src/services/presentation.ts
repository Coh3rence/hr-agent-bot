import { InlineKeyboard } from "grammy";
import type { SheetsService } from "./sheets";

/**
 * Candidate-facing presentation of an aggregated review result (D-008/D-009).
 *
 * One shared entry point, called from both aggregation triggers (the on-tap
 * quorum close in review.ts and the timeout sweep) so the contributor sees the
 * same DM regardless of which path fired. Self-contained and idempotent:
 *   - it reads the offer back from the sheet (columns M/N), so a restart between
 *     aggregating and notifying doesn't lose the DM — the sweep can re-attempt it;
 *   - it skips when column O (candidateNotifiedAt) is already set, so the
 *     contributor is DM'd exactly once even if both triggers fire.
 *
 * Takes the bot api as a parameter rather than importing the bot, to avoid a
 * circular import and stay unit-testable with a fake notifier.
 */

export interface Notifier {
  sendMessage(
    chatId: number | string,
    text: string,
    other?: { reply_markup?: InlineKeyboard }
  ): Promise<unknown>;
}

export async function presentToCandidate(
  agreementId: string,
  sheets: SheetsService,
  notifier: Notifier
): Promise<boolean> {
  if (await sheets.isCandidateNotified(agreementId)) return false;

  const offer = await sheets.getCandidateOffer(agreementId);
  if (!offer) return false; // nothing aggregated yet — nothing to present

  const agreement = await sheets.getAgreement(agreementId);
  if (!agreement) {
    console.error(`presentToCandidate: agreement ${agreementId} not found`);
    return false;
  }

  const contributor = await sheets.getContributorById(agreement.contributorId);
  if (!contributor) {
    console.error(`presentToCandidate: contributor ${agreement.contributorId} not found`);
    return false;
  }

  const rateLine =
    offer.suggestedRate != null
      ? `Proposed rate: $${offer.suggestedRate}/hr`
      : `The reviewers did not propose a rate.`;
  const commitmentLine =
    offer.suggestedCommitment != null
      ? `\nProposed commitment: ${offer.suggestedCommitment}%`
      : ``;
  const message =
    `Your proposal has been reviewed.\n\n` +
    `Role: ${agreement.roleName}\n` +
    `${rateLine}${commitmentLine}\n\n` +
    `${offer.qualitativeSummary}\n\n` +
    `How would you like to proceed?`;

  const keyboard = new InlineKeyboard()
    .text("Accept", `resolution:accept:${agreementId}`)
    .row()
    .text("Modify Terms", `resolution:modify:${agreementId}`)
    .row()
    .text("Walk away", `resolution:walkaway:${agreementId}`);

  // Send first, then mark: a mark failure can at worst re-DM (annoying), whereas
  // marking before a failed send would silently lose the notification.
  await notifier.sendMessage(Number(contributor.telegramId), message, { reply_markup: keyboard });
  await sheets.markCandidateNotified(agreementId);
  return true;
}
