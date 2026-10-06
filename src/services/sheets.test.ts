import { describe, expect, test } from "bun:test";
import type { Opportunity } from "../models/types";
import {
  mergeOpportunity,
  nextRoundFromHistory,
  opportunityToRow,
  type AgreementRoundRow,
} from "./sheets";

const C = "c_1";
const O = "opp_1";

function row(over: Partial<AgreementRoundRow> = {}): AgreementRoundRow {
  return { contributorId: C, opportunityId: O, reviewed: true, ...over };
}

describe("nextRoundFromHistory", () => {
  test("a first-time contributor starts at round 1", () => {
    expect(nextRoundFromHistory([], C, O)).toBe(1);
  });

  test("a reviewed proposal advances the round", () => {
    expect(nextRoundFromHistory([row()], C, O)).toBe(2);
  });

  // Observed live 2026-09-09: both reviewers approved, then the contributor tapped
  // Modify anyway. The reviewers spent a cycle either way, so it counts.
  test("a unanimous approval the contributor renegotiated still burns a round", () => {
    expect(nextRoundFromHistory([row({ reviewed: true })], C, O)).toBe(2);
  });

  test("an abandoned draft does not burn a round", () => {
    expect(nextRoundFromHistory([row({ reviewed: false })], C, O)).toBe(1);
  });

  test("a proposal still awaiting review does not burn a round", () => {
    expect(nextRoundFromHistory([row({ reviewed: true }), row({ reviewed: false })], C, O)).toBe(2);
  });

  // Rounds are per-role: countering a contributor on one opportunity must not
  // eat into the two rounds they get on a different one.
  test("another opportunity's rounds are not counted", () => {
    expect(nextRoundFromHistory([row({ opportunityId: "opp_2" })], C, O)).toBe(1);
  });

  test("another contributor's rounds are not counted", () => {
    expect(nextRoundFromHistory([row({ contributorId: "c_2" })], C, O)).toBe(1);
  });

  // The bypass this replaced: session state reset to 1 on restart and on
  // re-selecting the opportunity, so the cap at MAX_NEGOTIATION_ROUNDS never bit.
  test("history keeps counting past the cap so the limit still bites", () => {
    expect(nextRoundFromHistory([row(), row()], C, O)).toBe(3);
  });
});

const baseOpp: Opportunity = {
  id: "opp_1791280007760",
  title: "Full-Stack Web3 Developer",
  description: "Full-stack developer with React, TypeScript, Node.js and Web3 skills",
  skillsRequired: ["React", "TypeScript", "Node.js", "Web3"],
  commitmentPercent: { min: 30, max: 70 },
  hourlyRate: { min: 50, max: 75 },
  responsibilities: "Building and maintaining the web app features end to end",
  status: "open",
  createdBy: "535329585",
};

// §27, defect 1: the Opportunities tab is 11 columns (A:K). A 12th value made
// Google reject every edit with "tried writing to column [L]".
describe("opportunityToRow", () => {
  test("serializes exactly 11 columns in sheet order", () => {
    const r = opportunityToRow(baseOpp);
    expect(r).toHaveLength(11);
    expect(r[0]).toBe("opp_1791280007760");
    expect(r[3]).toBe("React, TypeScript, Node.js, Web3");
    expect(r[6]).toBe(50);
    expect(r[7]).toBe(75);
    expect(r[10]).toBe("535329585");
  });
});

// §27, defect 2: "raise the maximum rate to 80" must not zero the minimum.
describe("mergeOpportunity", () => {
  test("a max-only rate edit keeps the existing min", () => {
    const merged = mergeOpportunity(baseOpp, { hourlyRate: { max: 80 } });
    expect(merged.hourlyRate).toEqual({ min: 50, max: 80 });
    expect(merged.commitmentPercent).toEqual({ min: 30, max: 70 });
  });

  test("a min-only commitment edit keeps the existing max", () => {
    const merged = mergeOpportunity(baseOpp, { commitmentPercent: { min: 40 } });
    expect(merged.commitmentPercent).toEqual({ min: 40, max: 70 });
    expect(merged.hourlyRate).toEqual({ min: 50, max: 75 });
  });

  test("a status-only edit (pause/reopen) touches nothing else", () => {
    const merged = mergeOpportunity(baseOpp, { status: "paused" });
    expect(merged).toEqual({ ...baseOpp, status: "paused" });
  });

  test("an explicit zero is applied, not treated as missing", () => {
    const merged = mergeOpportunity(baseOpp, { commitmentPercent: { min: 0 } });
    expect(merged.commitmentPercent).toEqual({ min: 0, max: 70 });
  });
});
