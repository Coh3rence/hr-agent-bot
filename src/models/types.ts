export interface Opportunity {
  id: string;
  title: string;
  description: string;
  skillsRequired: string[];
  commitmentPercent: { min: number; max: number };
  hourlyRate: { min: number; max: number };
  responsibilities: string;
  status: "open" | "filled" | "paused";
  createdBy: string; // Telegram user ID of admin
  createdAt: string;
}

export interface Contributor {
  id: string;
  telegramId: string;
  telegramHandle: string;
  name: string;
  skills: string[];
  commitmentPercent: number;
  desiredRate: { min: number; max: number };
  timezone: string;
  location: string;
  status: "active" | "hired" | "rejected" | "cooldown";
  cooldownUntil: string | null;
  previousAttempts: number;
  createdAt: string;
  // Captured when the contributor self-registers on Collabberry via the bot's
  // invite link (wallet proven by their sign-up signature). These link the
  // Telegram contributor to their Collabberry user for agreement creation.
  walletAddress: string | null;
  collabberryUserId: string | null;
}

export interface Agreement {
  id: string;
  opportunityId: string;
  contributorId: string;
  roleName: string;
  responsibilities: string;
  hourlyRate: number;
  commitmentPercent: number;
  durationMonths: number;
  settlementLikelihood: number;
  status: "draft" | "submitted" | "under_review" | "escalated" | "approved" | "rejected" | "signed";
  reviewerFeedback: ReviewerFeedback[];
  aggregatedCounterOffer: CounterOffer | null;
  negotiationRound: number;
  submittedAt: string;
  reviewedAt: string | null;
  // Set once the agreement is created in the Collabberry Beta App. Local
  // idempotency guard so the bridge never double-POSTs the same agreement.
  betaAppAgreementId: string | null;
}

export interface ReviewerFeedback {
  reviewerId: string;
  reviewerName: string;
  decision: "approve" | "counter" | "reject";
  suggestedRate: number | null;
  qualitativeFeedback: string;
  submittedAt: string;
}

export interface CounterOffer {
  suggestedRate: number | null;
  qualitativeSummary: string;
  outcome: "all_approve" | "mixed" | "all_reject";
  reviewerCount: number;
  aggregationSig?: string;
}

export interface MatchResult {
  opportunity: Opportunity;
  score: number;
  breakdown: {
    skillOverlap: number;
    rateAlignment: number;
    commitmentFit: number;
  };
  explanation: string;
}

export type ConversationPhase =
  | "idle"
  | "gate"
  | "discovery"
  | "matching"
  | "negotiation"
  | "review"
  | "reviewer_feedback"
  | "resolution"
  | "awaiting_collabberry_signup";

export interface SessionData {
  phase: ConversationPhase;
  contributorId: string | null;
  selectedOpportunityId: string | null;
  currentAgreementId: string | null;
  messageHistory: { role: "user" | "assistant"; content: string }[];
  pendingReviewAgreementId: string | null;
  pendingReviewDecision: "counter" | "reject" | null;
  negotiationContext: string | null;
}
