import type { CounterOffer } from "../models/types";
import type { SheetsService } from "./sheets";
import type { ClaudeService } from "./claude";

export async function aggregateForAgreement(
  agreementId: string,
  sheets: SheetsService,
  claude: ClaudeService
): Promise<CounterOffer | null> {
  const agreement = await sheets.getAgreement(agreementId);
  if (!agreement) {
    console.warn(`aggregateForAgreement: agreement ${agreementId} not found`);
    return null;
  }

  const feedbacks = await sheets.getReviewFeedbacks(agreementId);
  const result = await claude.aggregateFeedback(feedbacks, agreement.hourlyRate);
  if (!result) return null;

  try {
    await sheets.updateAgreementAggregation(
      agreementId,
      result.suggestedRate,
      result.qualitativeSummary
    );
  } catch (err) {
    console.error(
      `aggregateForAgreement: sheet write failed for ${agreementId}:`,
      err
    );
  }

  return result;
}
