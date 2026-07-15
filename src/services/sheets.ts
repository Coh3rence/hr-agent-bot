import { google, sheets_v4 } from "googleapis";
import type { Env } from "../config";
import type { Opportunity, Contributor, Agreement, ReviewerFeedback } from "../models/types";

export class SheetsService {
  private sheets!: sheets_v4.Sheets;
  private spreadsheetId: string;

  constructor(private config: Env) {
    this.spreadsheetId = config.GOOGLE_SHEETS_ID;
  }

  async initialize() {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: this.config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: this.config.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    this.sheets = google.sheets({ version: "v4", auth });
  }

  // --- Opportunities ---

  async getOpportunities(): Promise<Opportunity[]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Opportunities!A2:K",
    });

    return (res.data.values || []).map((row) => ({
      id: row[0],
      title: row[1],
      description: row[2],
      skillsRequired: (row[3] || "").split(",").map((s: string) => s.trim()),
      commitmentPercent: { min: Number(row[4]), max: Number(row[5]) },
      hourlyRate: { min: Number(row[6]), max: Number(row[7]) },
      responsibilities: row[8] || "",
      status: row[9] as Opportunity["status"],
      createdBy: row[10] || "",
      createdAt: row[11] || "",
    }));
  }

  async getOpenOpportunities(): Promise<Opportunity[]> {
    const all = await this.getOpportunities();
    return all.filter((o) => o.status === "open");
  }

  async addOpportunity(opp: Opportunity): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: "Opportunities!A:K",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            opp.id,
            opp.title,
            opp.description,
            opp.skillsRequired.join(", "),
            opp.commitmentPercent.min,
            opp.commitmentPercent.max,
            opp.hourlyRate.min,
            opp.hourlyRate.max,
            opp.responsibilities,
            opp.status,
            opp.createdBy,
            opp.createdAt,
          ],
        ],
      },
    });
  }

  async updateOpportunity(id: string, updates: Partial<Opportunity>): Promise<boolean> {
    const opps = await this.getOpportunities();
    const index = opps.findIndex((o) => o.id === id);
    if (index === -1) return false;

    const base = opps[index];
    const updated = { ...base, ...updates } as Opportunity;
    const rowNum = index + 2; // +2 for header row and 0-index

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Opportunities!A${rowNum}:K${rowNum}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            updated.id,
            updated.title,
            updated.description,
            updated.skillsRequired.join(", "),
            updated.commitmentPercent.min,
            updated.commitmentPercent.max,
            updated.hourlyRate.min,
            updated.hourlyRate.max,
            updated.responsibilities,
            updated.status,
            updated.createdBy,
            updated.createdAt,
          ],
        ],
      },
    });
    return true;
  }

  // --- Contributors ---

  async getContributor(telegramId: string): Promise<Contributor | null> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Contributors!A2:Q",
    });

    const rows = res.data.values || [];
    const row = rows.find((r) => r[1] === telegramId);
    if (!row) return null;

    return rowToContributor(row);
  }

  async addContributor(contributor: Contributor): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: "Contributors!A:Q",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [contributorToRow(contributor)],
      },
    });
  }

  async updateContributor(id: string, updates: Partial<Contributor>): Promise<boolean> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Contributors!A2:Q",
    });

    const rows = res.data.values || [];
    const index = rows.findIndex((r) => r[0] === id);
    if (index === -1) return false;

    const current = rowToContributor(rows[index]!);
    const updated = { ...current, ...updates } as Contributor;
    const rowNum = index + 2;

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Contributors!A${rowNum}:Q${rowNum}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [contributorToRow(updated)],
      },
    });
    return true;
  }

  async getContributorById(id: string): Promise<Contributor | null> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Contributors!A2:Q",
    });

    const row = (res.data.values || []).find((r) => r[0] === id);
    if (!row) return null;

    return rowToContributor(row);
  }

  // --- Agreements ---

  async getAgreement(id: string): Promise<Agreement | null> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Agreements!A2:P",
    });

    const row = (res.data.values || []).find((r) => r[0] === id);
    if (!row) return null;

    return {
      id: row[0],
      opportunityId: row[1],
      contributorId: row[2],
      roleName: row[3],
      responsibilities: row[4],
      hourlyRate: Number(row[5]),
      commitmentPercent: Number(row[6]),
      durationMonths: Number(row[7]),
      settlementLikelihood: Number(row[8]),
      status: row[9] as Agreement["status"],
      reviewerFeedback: [],
      aggregatedCounterOffer: null,
      negotiationRound: Number(row[10]) || 1,
      submittedAt: row[11] || "",
      reviewedAt: null,
      betaAppAgreementId: row[15] || null,
    };
  }

  /**
   * Lightweight enumeration for the review timeout sweep. Returns one row per
   * agreement with just the fields the sweep needs: its id, status, submit time,
   * and whether an aggregation has already been written (column N non-empty).
   * `aggregated` is the cross-sweep idempotency signal — once M/N is populated
   * (by either the on-tap quorum trigger or a prior sweep), the review is done.
   */
  async listAgreementReviewState(): Promise<
    {
      id: string;
      status: Agreement["status"];
      submittedAt: string;
      aggregated: boolean;
      notified: boolean;
    }[]
  > {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Agreements!A2:O",
    });

    return (res.data.values || [])
      .filter((row) => row[0])
      .map((row) => ({
        id: row[0],
        status: row[9] as Agreement["status"],
        submittedAt: row[11] || "",
        aggregated: !!(row[13] && String(row[13]).trim()),
        notified: !!(row[14] && String(row[14]).trim()),
      }));
  }

  /**
   * The aggregated counter-offer to show the contributor, read from columns
   * M (rate) and N (summary). Returns null when nothing has been aggregated
   * (N empty), so `presentToCandidate` can read it back self-containedly after a
   * restart rather than depending on the in-memory aggregation result.
   */
  async getCandidateOffer(
    id: string
  ): Promise<{
    suggestedRate: number | null;
    suggestedCommitment: number | null;
    qualitativeSummary: string;
  } | null> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Agreements!A2:Q",
    });

    const row = (res.data.values || []).find((r) => r[0] === id);
    if (!row) return null;

    const qualitativeSummary = row[13] ? String(row[13]).trim() : "";
    if (!qualitativeSummary) return null;

    const rateRaw = row[12];
    const rate = rateRaw === "" || rateRaw == null ? null : Number(rateRaw);
    const suggestedRate = rate == null || Number.isNaN(rate) ? null : rate;

    const commitmentRaw = row[16];
    const commitment =
      commitmentRaw === "" || commitmentRaw == null ? null : Number(commitmentRaw);
    const suggestedCommitment =
      commitment == null || Number.isNaN(commitment) ? null : commitment;

    return { suggestedRate, suggestedCommitment, qualitativeSummary };
  }

  /**
   * True when an agreement has already been aggregated (column N non-empty).
   * Used by the on-tap path to ignore a late responder arriving after quorum
   * already closed and wrote the counter-offer (D-011 late-responder guard).
   */
  async isReviewAggregated(id: string): Promise<boolean> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Agreements!A2:N",
    });

    const row = (res.data.values || []).find((r) => r[0] === id);
    return !!(row && row[13] && String(row[13]).trim());
  }

  async addAgreement(agreement: Agreement): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: "Agreements!A:L",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            agreement.id,
            agreement.opportunityId,
            agreement.contributorId,
            agreement.roleName,
            agreement.responsibilities,
            agreement.hourlyRate,
            agreement.commitmentPercent,
            agreement.durationMonths,
            agreement.settlementLikelihood,
            agreement.status,
            agreement.negotiationRound,
            agreement.submittedAt,
          ],
        ],
      },
    });
  }

  async updateAgreementStatus(id: string, status: Agreement["status"]): Promise<boolean> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Agreements!A2:L",
    });

    const rows = res.data.values || [];
    const index = rows.findIndex((r) => r[0] === id);
    if (index === -1) return false;

    const rowNum = index + 2;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Agreements!J${rowNum}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[status]] },
    });
    return true;
  }

  async updateAgreementAggregation(
    id: string,
    aggregatedRate: number | null,
    aggregatedSummary: string,
    aggregatedCommitment: number | null = null
  ): Promise<boolean> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Agreements!A2:A",
    });

    const rows = res.data.values || [];
    const index = rows.findIndex((r) => r[0] === id);
    if (index === -1) return false;

    const rowNum = index + 2;
    // M/N are contiguous; aggregated commitment lives in Q (O/P are already
    // candidateNotifiedAt/betaAppAgreementId), so it's a separate write.
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: [
          {
            range: `Agreements!M${rowNum}:N${rowNum}`,
            values: [[aggregatedRate ?? "", aggregatedSummary]],
          },
          {
            range: `Agreements!Q${rowNum}`,
            values: [[aggregatedCommitment ?? ""]],
          },
        ],
      },
    });
    return true;
  }

  /**
   * True when the contributor has already been DM'd the counter-offer
   * (column O = candidateNotifiedAt non-empty). The exactly-once guard for
   * `presentToCandidate` (D-008): both the on-tap and sweep triggers check this
   * before sending, so the candidate is notified once even across restarts.
   */
  async isCandidateNotified(id: string): Promise<boolean> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Agreements!A2:O",
    });

    const row = (res.data.values || []).find((r) => r[0] === id);
    return !!(row && row[14] && String(row[14]).trim());
  }

  /** Stamp column O with the time the contributor was DM'd the counter-offer (D-008). */
  async markCandidateNotified(id: string, at: string = new Date().toISOString()): Promise<boolean> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Agreements!A2:A",
    });

    const rows = res.data.values || [];
    const index = rows.findIndex((r) => r[0] === id);
    if (index === -1) return false;

    const rowNum = index + 2;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Agreements!O${rowNum}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[at]] },
    });
    return true;
  }

  /** Stamp column P with the Collabberry agreement id once the bridge creates it. */
  async updateAgreementBetaId(id: string, betaAppAgreementId: string): Promise<boolean> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Agreements!A2:A",
    });

    const rows = res.data.values || [];
    const index = rows.findIndex((r) => r[0] === id);
    if (index === -1) return false;

    const rowNum = index + 2;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Agreements!P${rowNum}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[betaAppAgreementId]] },
    });
    return true;
  }

  // --- Review Feedback ---

  async addReviewFeedback(
    agreementId: string,
    feedback: ReviewerFeedback
  ): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: "ReviewFeedback!A:H",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            agreementId,
            feedback.reviewerId,
            feedback.reviewerName,
            feedback.decision,
            feedback.suggestedRate ?? "",
            feedback.qualitativeFeedback,
            feedback.submittedAt,
            feedback.suggestedCommitment ?? "",
          ],
        ],
      },
    });
  }

  async getReviewFeedbacks(agreementId: string): Promise<ReviewerFeedback[]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "ReviewFeedback!A2:H",
    });

    return (res.data.values || [])
      .filter((r) => r[0] === agreementId)
      .map((r) => ({
        reviewerId: r[1],
        reviewerName: r[2] || "",
        decision: r[3] as ReviewerFeedback["decision"],
        suggestedRate: r[4] ? Number(r[4]) : null,
        qualitativeFeedback: r[5] || "",
        submittedAt: r[6] || "",
        // Column H, appended after submittedAt so pre-widen rows read as null.
        suggestedCommitment: r[7] ? Number(r[7]) : null,
      }));
  }

  // --- Authorized Users ---

  async isAuthorized(telegramId: string): Promise<boolean> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "AuthorizedUsers!A2:B",
    });

    const rows = res.data.values || [];
    return rows.some((r) => r[0] === telegramId);
  }

  async isAdmin(telegramId: string): Promise<boolean> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "AuthorizedUsers!A2:B",
    });

    const rows = res.data.values || [];
    return rows.some((r) => r[0] === telegramId && r[1] === "admin");
  }

  async getAdminIds(): Promise<string[]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "AuthorizedUsers!A2:B",
    });

    const rows = res.data.values || [];
    return rows.filter((r) => r[1] === "admin").map((r) => r[0]);
  }

  async addAuthorizedUser(telegramId: string, role: "admin" | "contributor"): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: "AuthorizedUsers!A:B",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[telegramId, role]],
      },
    });
  }
}

// --- Contributors row mapping (cols A..P) ---
// A id, B telegramId, C telegramHandle, D name, E skills, F commitment%,
// G rateMin, H rateMax, I timezone, J location, K status, L cooldownUntil,
// M previousAttempts, N createdAt, O walletAddress, P collabberryUserId,
// Q collabberryInviteToken.

function rowToContributor(row: any[]): Contributor {
  return {
    id: row[0],
    telegramId: row[1],
    telegramHandle: row[2],
    name: row[3],
    skills: (row[4] || "").split(",").map((s: string) => s.trim()),
    commitmentPercent: Number(row[5]),
    desiredRate: { min: Number(row[6]), max: Number(row[7]) },
    timezone: row[8] || "",
    location: row[9] || "",
    status: row[10] as Contributor["status"],
    cooldownUntil: row[11] || null,
    previousAttempts: Number(row[12]) || 0,
    createdAt: row[13] || "",
    walletAddress: row[14] || null,
    collabberryUserId: row[15] || null,
    collabberryInviteToken: row[16] || null,
  };
}

function contributorToRow(c: Contributor): (string | number)[] {
  return [
    c.id,
    c.telegramId,
    c.telegramHandle,
    c.name,
    c.skills.join(", "),
    c.commitmentPercent,
    c.desiredRate.min,
    c.desiredRate.max,
    c.timezone,
    c.location,
    c.status,
    c.cooldownUntil || "",
    c.previousAttempts,
    c.createdAt,
    c.walletAddress || "",
    c.collabberryUserId || "",
    c.collabberryInviteToken || "",
  ];
}
