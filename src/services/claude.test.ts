import { describe, expect, test } from "bun:test";
import { MIN_MATCH_SCORE, presentableMatches } from "./claude";

// §31: a veterinary-surgery profile was offered all three open roles as tappable
// matches at 11–15% — the model scores every opportunity, so without a floor the
// match list is never empty and the "no strong matches" decline could never fire.
describe("presentableMatches", () => {
  test("the C4 profile gets an empty list, so the decline branch is reachable", () => {
    const matches = [{ score: 15 }, { score: 12 }, { score: 11 }];
    expect(presentableMatches(matches)).toEqual([]);
  });

  test("the floor is the red-badge boundary: 50 stays, 49 goes", () => {
    const kept = presentableMatches([{ score: 50 }, { score: 49 }]);
    expect(kept).toEqual([{ score: MIN_MATCH_SCORE }]);
  });

  test("strong matches pass through in their original order", () => {
    const matches = [{ score: 95 }, { score: 72 }, { score: 42 }];
    expect(presentableMatches(matches)).toEqual([{ score: 95 }, { score: 72 }]);
  });

  test("an empty list stays empty", () => {
    expect(presentableMatches([])).toEqual([]);
  });
});
