import type { Opportunity, Contributor, MatchResult } from "../models/types";

const WEIGHTS = {
  skillOverlap: 0.4,
  rateAlignment: 0.25,
  commitmentFit: 0.35,
};

function skillOverlapScore(contributorSkills: string[], requiredSkills: string[]): number {
  if (requiredSkills.length === 0) return 1;

  const normalizedContributor = contributorSkills.map((s) => s.toLowerCase().trim());
  const normalizedRequired = requiredSkills.map((s) => s.toLowerCase().trim());

  const matches = normalizedRequired.filter((req) =>
    normalizedContributor.some(
      (cs) => cs.includes(req) || req.includes(cs)
    )
  );

  return matches.length / normalizedRequired.length;
}

function rateAlignmentScore(
  desiredRate: { min: number; max: number },
  budgetRange: { min: number; max: number }
): number {
  const midAsk = (desiredRate.min + desiredRate.max) / 2;
  const midBudget = (budgetRange.min + budgetRange.max) / 2;
  const budgetSpread = budgetRange.max - budgetRange.min || 1;

  // Perfect score if ask is within budget range
  if (midAsk >= budgetRange.min && midAsk <= budgetRange.max) return 1;

  // Penalize proportionally to how far outside the range
  const distance = midAsk > budgetRange.max
    ? midAsk - budgetRange.max
    : budgetRange.min - midAsk;

  return Math.max(0, 1 - distance / budgetSpread);
}

function commitmentFitScore(
  contributorCommitment: number,
  requiredCommitment: { min: number; max: number }
): number {
  if (
    contributorCommitment >= requiredCommitment.min &&
    contributorCommitment <= requiredCommitment.max
  ) {
    return 1;
  }

  const range = requiredCommitment.max - requiredCommitment.min || 1;
  const distance = contributorCommitment > requiredCommitment.max
    ? contributorCommitment - requiredCommitment.max
    : requiredCommitment.min - contributorCommitment;

  return Math.max(0, 1 - distance / range);
}

export function matchContributor(
  contributor: Contributor,
  opportunities: Opportunity[]
): MatchResult[] {
  return opportunities
    .map((opp) => {
      const skill = skillOverlapScore(contributor.skills, opp.skillsRequired);
      const rate = rateAlignmentScore(contributor.desiredRate, opp.hourlyRate);
      const commitment = commitmentFitScore(
        contributor.commitmentPercent,
        opp.commitmentPercent
      );

      const score = Math.round(
        (skill * WEIGHTS.skillOverlap +
          rate * WEIGHTS.rateAlignment +
          commitment * WEIGHTS.commitmentFit) *
          100
      );

      return {
        opportunity: opp,
        score,
        breakdown: {
          skillOverlap: Math.round(skill * 100),
          rateAlignment: Math.round(rate * 100),
          commitmentFit: Math.round(commitment * 100),
        },
        explanation: "",
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function calculateSettlementLikelihood(
  askRate: number,
  budgetMin: number,
  budgetMax: number,
  skillScore: number
): number {
  const budgetMid = (budgetMin + budgetMax) / 2;
  const budgetRange = budgetMax - budgetMin || 1;

  const rateFactor = Math.max(0, 1 - Math.abs(askRate - budgetMid) / budgetRange) * 30;
  const skillFactor = skillScore * 15;

  return Math.min(95, Math.round(50 + rateFactor + skillFactor));
}
