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
  status: "draft" | "submitted" | "under_review" | "approved" | "rejected" | "signed";
  reviewerFeedback: ReviewerFeedback[];
  aggregatedCounterOffer: CounterOffer | null;
  negotiationRound: number;
  submittedAt: string;
  reviewedAt: string | null;
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
  suggestedRate: number;
  qualitativeSummary: string;
  reviewerCount: number;
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
  | "resolution";

export interface SessionData {
  phase: ConversationPhase;
  contributorId: string | null;
  selectedOpportunityId: string | null;
  currentAgreementId: string | null;
  messageHistory: { role: "user" | "assistant"; content: string }[];
}
