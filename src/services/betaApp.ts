import type { Env } from "../config";

/**
 * One entry from the Collabberry org roster (GET /api/orgs/:orgId → data.contributors[]).
 * `invitationToken` is the join key (D-018): it's the single-use token the
 * contributor redeemed at sign-up, exposed by the fork's getOrgById projection.
 */
export interface RosterContributor {
  id: string;
  walletAddress: string | null;
  username: string | null;
  telegramHandle?: string | null;
  invitationToken?: string | null;
  agreement?: { id: string } | null;
}

export interface InviteLink {
  token: string;
  url: string;
}

/**
 * Client for the Collabberry "Beta App" backend. Carries an admin-scoped bearer
 * JWT (BETA_APP_JWT) and targets the configured org. All routes live under
 * BETA_APP_API_URL, which must already include the `/api` prefix.
 */
export class BetaAppService {
  constructor(private config: Env) {}

  private get baseUrl(): string {
    return this.config.BETA_APP_API_URL.replace(/\/+$/, "");
  }

  /**
   * Prefer the unattended service-key (X-Service-Key) when set — it never expires
   * and the fork impersonates a designated org admin on a match (D-016). Falls
   * back to the admin-scoped bearer JWT (which expires every 7 days) otherwise.
   */
  private authHeaders(): Record<string, string> {
    if (this.config.BETA_APP_SERVICE_KEY) {
      return {
        "X-Service-Key": this.config.BETA_APP_SERVICE_KEY,
        "Content-Type": "application/json",
      };
    }
    if (this.config.BETA_APP_JWT) {
      return {
        Authorization: `Bearer ${this.config.BETA_APP_JWT}`,
        "Content-Type": "application/json",
      };
    }
    throw new Error("Neither BETA_APP_SERVICE_KEY nor BETA_APP_JWT is configured");
  }

  private requireOrgId(): string {
    if (!this.config.BETA_APP_ORG_ID) {
      throw new Error("BETA_APP_ORG_ID is not configured");
    }
    return this.config.BETA_APP_ORG_ID;
  }

  /** Hourly negotiated rate → USD/month marketRate, on the configured FTE basis (D-013). */
  hourlyToMonthly(hourlyRate: number): number {
    return Math.round(hourlyRate * this.config.FTE_HOURS_PER_MONTH * 100) / 100;
  }

  /** Mint a unique org-invite link the contributor uses to self-register (D-014). */
  async createInviteLink(): Promise<InviteLink> {
    const res = await fetch(`${this.baseUrl}/orgs/invitation`, {
      method: "GET",
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`createInviteLink failed: ${res.status} ${await res.text()}`);
    }
    // The backend sends the raw payload (handleResponse returns response.data
    // directly); tolerate a {data:{…}} envelope too in case an endpoint differs.
    const body = (await res.json()) as {
      invitationToken?: string;
      data?: { invitationToken?: string };
    };
    const token = body?.invitationToken ?? body?.data?.invitationToken;
    if (!token) throw new Error("createInviteLink: no invitationToken in response");

    const base = this.config.BETA_APP_INVITE_URL.replace(/\/+$/, "");
    const param = this.config.BETA_APP_INVITE_PARAM;
    return { token, url: `${base}?${param}=${encodeURIComponent(token)}` };
  }

  async getRoster(): Promise<RosterContributor[]> {
    const orgId = this.requireOrgId();
    const res = await fetch(`${this.baseUrl}/orgs/${encodeURIComponent(orgId)}`, {
      method: "GET",
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`getRoster failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      contributors?: RosterContributor[];
      data?: { contributors?: RosterContributor[] };
    };
    return body?.contributors ?? body?.data?.contributors ?? [];
  }

  /**
   * Find the freshly-registered contributor by the invite token they redeemed
   * (D-018). The token is minted single-use per contributor and stored bot-side
   * against their Telegram id, so this is a deterministic match — no reliance on a
   * self-reported Telegram handle. Requires the fork to expose invitationToken on
   * roster entries.
   */
  async resolveByToken(token: string | null): Promise<RosterContributor | null> {
    if (!token) return null;
    const roster = await this.getRoster();
    return roster.find((c) => c.invitationToken === token) ?? null;
  }

  /**
   * Create the agreement record in Collabberry (POST /api/orgs/agreement).
   * marketRate is derived from the hourly rate (D-013); fiatRequested defaults to
   * all-TeamPoints (D-015). On-chain signing/minting stays a manual admin action.
   */
  async createAgreement(input: {
    userId: string;
    roleName: string;
    responsibilities: string;
    hourlyRate: number;
    commitmentPercent: number;
  }): Promise<{ betaAgreementId: string | null }> {
    const payload = {
      userId: input.userId,
      roleName: input.roleName,
      responsibilities: input.responsibilities,
      marketRate: this.hourlyToMonthly(input.hourlyRate),
      fiatRequested: this.config.DEFAULT_FIAT_REQUESTED,
      commitment: input.commitmentPercent,
    };

    const res = await fetch(`${this.baseUrl}/orgs/agreement`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`createAgreement failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json().catch(() => null)) as
      | {
          id?: string;
          data?: { id?: string; agreementId?: string; agreement?: { id?: string } };
        }
      | null;
    const betaAgreementId =
      body?.id ??
      body?.data?.id ??
      body?.data?.agreementId ??
      body?.data?.agreement?.id ??
      null;
    return { betaAgreementId };
  }
}
