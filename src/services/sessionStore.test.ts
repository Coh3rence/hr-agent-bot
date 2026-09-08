import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { SessionData } from "../models/types";
import { isExpired, sweepExpiredSessions, SESSION_TTL_MS } from "./sessionStore";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("isExpired", () => {
  const now = Date.UTC(2026, 8, 8);

  test("a session touched just inside the window survives", () => {
    expect(isExpired(now - (SESSION_TTL_MS - 1000), SESSION_TTL_MS, now)).toBe(false);
  });

  test("a session touched just outside the window expires", () => {
    expect(isExpired(now - (SESSION_TTL_MS + 1000), SESSION_TTL_MS, now)).toBe(true);
  });

  test("the 48h reviewer window is never swept — a slow reviewer keeps their session", () => {
    expect(isExpired(now - 2 * DAY_MS, SESSION_TTL_MS, now)).toBe(false);
  });
});

describe("sweepExpiredSessions", () => {
  function seed(name: string, ageMs: number): string {
    const dir = mkdtempSync(join(tmpdir(), "hrbot-sessions-"));
    const path = join(dir, name);
    writeFileSync(path, "{}");
    const seconds = (Date.now() - ageMs) / 1000;
    utimesSync(path, seconds, seconds);
    return dir;
  }

  test("removes a session abandoned past the window", () => {
    const dir = seed("535329585", 8 * DAY_MS);
    expect(sweepExpiredSessions(dir)).toBe(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("leaves a recently active session alone", () => {
    const dir = seed("535329585", 1 * DAY_MS);
    expect(sweepExpiredSessions(dir)).toBe(0);
    expect(readdirSync(dir)).toEqual(["535329585"]);
  });

  test("a missing directory is not an error — the bot must still boot", () => {
    expect(sweepExpiredSessions(join(tmpdir(), "hrbot-does-not-exist"))).toBe(0);
  });
});

describe("SessionData survives a JSON round-trip", () => {
  // FileAdapter serialises with JSON. This fails loudly if a Date, Map or class
  // instance is ever added to SessionData, which would silently corrupt on reload.
  test("a fully populated session reloads unchanged", () => {
    const session: SessionData = {
      phase: "reviewer_feedback",
      contributorId: "c_1788807562702",
      selectedOpportunityId: "opp_003",
      currentAgreementId: "a_1788808260898",
      messageHistory: [
        { role: "user", content: "I do community management" },
        { role: "assistant", content: "Great — what rate are you looking for?" },
      ],
      pendingReviewAgreementId: "a_1788808260898",
      pendingReviewDecision: "counter",
      negotiationContext: "asked 50, budget 20-40",
    };

    expect(JSON.parse(JSON.stringify(session))).toEqual(session);
  });
});
