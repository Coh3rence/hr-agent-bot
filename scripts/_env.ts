/**
 * Shared env loader for the dev scripts. Mirrors how Bun loads env for the bot:
 * base `.env`, then `.env.<NODE_ENV>` overlaid on top. This matters because the
 * bot runs via `dev:stage` (NODE_ENV=development), where `.env.development`
 * overrides GOOGLE_SHEETS_ID to the dev sheet. Without this layering the scripts
 * would default to the base `.env` sheet and read a different spreadsheet than
 * the running bot writes to.
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function parseInto(env: Record<string, string>, path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1);
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, i)] = v;
  }
}

export function loadEnv(): Record<string, string> {
  const dir = resolve(import.meta.dir, "..");
  const env: Record<string, string> = {};
  parseInto(env, resolve(dir, ".env"));
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv) parseInto(env, resolve(dir, `.env.${nodeEnv}`));
  return env;
}
