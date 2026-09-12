import { InlineKeyboard } from "grammy";
import type { SheetsService } from "./sheets";
import { unanimouslyApproved, unanimouslyRejected } from "./quorum";
import { closeAsDeclined, COOLDOWN_DAYS } from "./decline";

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

  // Every reviewer declined: there is no offer on the table, so there is nothing
  // to accept or renegotiate. Offering "Accept" here let a declined candidate hire
  // themselves at their own asking rate (§16) — the aggregation carries no
  // suggested rate, so the accept path fell back to what they originally asked for.
  //
  // The client's rule for an attempt that ends without agreement is the same one
  // walking away follows: thank them, cool down, invite them back. So the reply
  // carries no buttons at all and the attempt is closed here, rather than left
  // open waiting for the candidate to consent to their own rejection.
  const feedbacks = await sheets.getReviewFeedbacks(agreementId);
  if (unanimouslyRejected(feedbacks)) {
    const message =
      `Your proposal has been reviewed.\n\n` +
      `Role: ${agreement.roleName}\n\n` +
      `${offer.qualitativeSummary}\n\n` +
      `Thank you for your time — we won't be moving forward with this one. ` +
      `You're welcome to apply again after a ${COOLDOWN_DAYS}-day reflection period.`;

    await notifier.sendMessage(Number(contributor.telegramId), message);
    await sheets.markCandidateNotified(agreementId);
    // After marking, so a failed send retries the DM rather than re-incrementing
    // the contributor's attempt count.
    await closeAsDeclined(agreementId, agreement.contributorId, sheets);
    return true;
  }

  // Reviewers objected but named no figure, so there is no counter-offer to
  // accept — and the accept path reconciles with `offer.suggestedRate ??
  // agreement.hourlyRate`, meaning "Accept" could only ever have meant "approve
  // my own asking rate", the very rate that was just objected to (§19). A
  // reviewer writing "too expensive, please bring it down" leaves no number to
  // parse, so this is reachable without anyone behaving unusually. Renegotiating
  // is the honest next step, so those are the only two options offered.
  if (
    offer.suggestedRate == null &&
    offer.suggestedCommitment == null &&
    !unanimouslyApproved(feedbacks)
  ) {
    const message =
      `Your proposal has been reviewed.\n\n` +
      `Role: ${agreement.roleName}\n\n` +
      `${offer.qualitativeSummary}\n\n` +
      `The reviewers haven't put specific numbers on the table, so there's no revised ` +
      `offer for you to accept yet. Would you like to revise your terms?`;

    const keyboard = new InlineKeyboard()
      .text("Modify Terms", `resolution:modify:${agreementId}`)
      .row()
      .text("Walk away", `resolution:walkaway:${agreementId}`);

    await notifier.sendMessage(Number(contributor.telegramId), message, {
      reply_markup: keyboard,
    });
    await sheets.markCandidateNotified(agreementId);
    return true;
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
