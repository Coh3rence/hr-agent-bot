import { readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";

/**
 * Sessions are persisted to disk, so an abandoned conversation would otherwise
 * pin a file forever. `FileAdapter` has no TTL, so we sweep instead.
 *
 * The window is comfortably longer than the 48h reviewer deadline, so a live
 * review is never swept out from under a reviewer who is simply slow. Anything
 * that matters is in the Sheet regardless — a swept session costs the user a
 * re-`/start`, not their data.
 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function isExpired(lastModifiedMs: number, ttlMs: number, now: number): boolean {
  return now - lastModifiedMs > ttlMs;
}

export function sweepExpiredSessions(
  dir: string,
  ttlMs: number = SESSION_TTL_MS,
  now: number = Date.now()
): number {
  let removed = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const path = join(dir, entry);
    try {
      if (isExpired(statSync(path).mtimeMs, ttlMs, now)) {
        unlinkSync(path);
        removed++;
      }
    } catch {
      // A session written or swept concurrently is not an error worth failing on.
    }
  }

  if (removed > 0) console.log(`Session sweep: removed ${removed} expired session(s)`);
  return removed;
}
