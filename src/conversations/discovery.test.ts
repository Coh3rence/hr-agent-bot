import { describe, expect, test } from "bun:test";
import { trimHistory } from "./discovery";

function turns(n: number) {
  return Array.from({ length: n }, (_, i) => ({ role: "user" as const, content: `msg-${i}` }));
}

describe("trimHistory", () => {
  test("history under the limit is untouched", () => {
    const history = turns(5);
    expect(trimHistory(history, 20)).toBe(history);
  });

  test("history at the limit is untouched", () => {
    const history = turns(20);
    expect(trimHistory(history, 20)).toBe(history);
  });

  test("over the limit keeps the newest turns, oldest first", () => {
    const trimmed = trimHistory(turns(25), 20);
    expect(trimmed).toHaveLength(20);
    expect(trimmed[0]!.content).toBe("msg-5");
    expect(trimmed[19]!.content).toBe("msg-24");
  });

  test("a non-positive limit disables trimming rather than emptying the history", () => {
    const history = turns(5);
    expect(trimHistory(history, 0)).toBe(history);
  });
});
