import { describe, expect, test } from "bun:test";
import { nextRoundFromHistory, type AgreementRoundRow } from "./sheets";

const C = "c_1";
const O = "opp_1";

function row(over: Partial<AgreementRoundRow> = {}): AgreementRoundRow {
  return { contributorId: C, opportunityId: O, countered: true, ...over };
}

describe("nextRoundFromHistory", () => {
  test("a first-time contributor starts at round 1", () => {
    expect(nextRoundFromHistory([], C, O)).toBe(1);
  });

  test("a countered proposal advances the round", () => {
    expect(nextRoundFromHistory([row()], C, O)).toBe(2);
  });

  test("an abandoned draft does not burn a round", () => {
    expect(nextRoundFromHistory([row({ countered: false })], C, O)).toBe(1);
  });

  test("a proposal still awaiting review does not burn a round", () => {
    expect(nextRoundFromHistory([row({ countered: true }), row({ countered: false })], C, O)).toBe(2);
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
