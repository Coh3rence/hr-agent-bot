import { google, sheets_v4 } from "googleapis";
import type { Env } from "../config";
import type { Opportunity, Contributor, Agreement } from "../models/types";

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
      range: "Contributors!A2:M",
    });

    const rows = res.data.values || [];
    const row = rows.find((r) => r[1] === telegramId);
    if (!row) return null;

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
    };
  }

  async addContributor(contributor: Contributor): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: "Contributors!A:M",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            contributor.id,
            contributor.telegramId,
            contributor.telegramHandle,
            contributor.name,
            contributor.skills.join(", "),
            contributor.commitmentPercent,
            contributor.desiredRate.min,
            contributor.desiredRate.max,
            contributor.timezone,
            contributor.location,
            contributor.status,
            contributor.cooldownUntil || "",
            contributor.previousAttempts,
            contributor.createdAt,
          ],
        ],
      },
    });
  }

  async updateContributor(id: string, updates: Partial<Contributor>): Promise<boolean> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Contributors!A2:M",
    });

    const rows = res.data.values || [];
    const index = rows.findIndex((r) => r[0] === id);
    if (index === -1) return false;

    const row = rows[index]!;
    const current = await this.getContributor(row[1]);
    if (!current) return false;

    const updated = { ...current, ...updates } as Contributor;
    const rowNum = index + 2;

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Contributors!A${rowNum}:M${rowNum}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            updated.id,
            updated.telegramId,
            updated.telegramHandle,
            updated.name,
            updated.skills.join(", "),
            updated.commitmentPercent,
            updated.desiredRate.min,
            updated.desiredRate.max,
            updated.timezone,
            updated.location,
            updated.status,
            updated.cooldownUntil || "",
            updated.previousAttempts,
            updated.createdAt,
          ],
        ],
      },
    });
    return true;
  }

  // --- Agreements ---

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
