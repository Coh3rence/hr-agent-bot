/**
 * Populates an existing Google Sheet with the required tabs and headers for hr-agent-bot.
 * Also seeds sample test data.
 *
 * Usage: bun scripts/setup-sheets.ts [--your-telegram-id <id>]
 *
 * Requires GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_SHEETS_ID in .env
 * The sheet must be shared with the service account email as Editor.
 */

import { google } from "googleapis";
import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(import.meta.dir, "../.env");

// Parse .env manually since this is a standalone script
function loadEnv() {
  const content = readFileSync(envPath, "utf-8");
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    let value = trimmed.slice(eqIdx + 1);
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

const env = loadEnv();
const spreadsheetId = env.GOOGLE_SHEETS_ID;
const telegramId = process.argv.includes("--your-telegram-id")
  ? process.argv[process.argv.indexOf("--your-telegram-id") + 1]
  : "REPLACE_WITH_YOUR_TELEGRAM_ID";

if (!spreadsheetId || spreadsheetId === "PENDING_SETUP") {
  console.error("Set GOOGLE_SHEETS_ID in .env first (the ID from your Google Sheet URL)");
  process.exit(1);
}

async function main() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  console.log(`Using sheet: ${spreadsheetId}`);

  // Get existing sheet info
  const info = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTabs = info.data.sheets?.map((s) => s.properties?.title) || [];
  console.log(`Existing tabs: ${existingTabs.join(", ") || "(none)"}`);

  // Add missing tabs
  const requiredTabs = ["Opportunities", "Contributors", "Agreements", "AuthorizedUsers"];
  const tabsToAdd = requiredTabs.filter((t) => !existingTabs.includes(t));

  if (tabsToAdd.length > 0) {
    console.log(`Adding tabs: ${tabsToAdd.join(", ")}`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: tabsToAdd.map((title) => ({
          addSheet: { properties: { title } },
        })),
      },
    });
  }

  // Rename default "Sheet1" if it exists and isn't needed
  const sheet1 = info.data.sheets?.find((s) => s.properties?.title === "Sheet1");
  if (sheet1 && !requiredTabs.includes("Sheet1")) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { deleteSheet: { sheetId: sheet1.properties?.sheetId! } },
        ],
      },
    });
    console.log("Removed default Sheet1");
  }

  // Add headers
  console.log("Adding headers...");
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: "Opportunities!A1:L1",
          values: [[
            "id", "title", "description", "skillsRequired",
            "commitmentMin", "commitmentMax", "hourlyRateMin", "hourlyRateMax",
            "responsibilities", "status", "createdBy", "createdAt",
          ]],
        },
        {
          range: "Contributors!A1:N1",
          values: [[
            "id", "telegramId", "telegramHandle", "name",
            "skills", "commitmentPercent", "desiredRateMin", "desiredRateMax",
            "timezone", "location", "status", "cooldownUntil",
            "previousAttempts", "createdAt",
          ]],
        },
        {
          range: "Agreements!A1:L1",
          values: [[
            "id", "opportunityId", "contributorId", "roleName",
            "responsibilities", "hourlyRate", "commitmentPercent", "durationMonths",
            "settlementLikelihood", "status", "negotiationRound", "submittedAt",
          ]],
        },
        {
          range: "AuthorizedUsers!A1:B1",
          values: [["telegramId", "role"]],
        },
      ],
    },
  });

  // Seed sample data
  console.log("Seeding sample opportunities...");
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: "Opportunities!A2:L4",
          values: [
            [
              "opp_001", "Smart Contract Developer",
              "Build and audit governance smart contracts for Collabberry",
              "Solidity, Hardhat, OpenZeppelin, Governance",
              30, 60, 55, 85,
              "Design, implement, and audit smart contracts for on-chain governance. Includes upgradeability patterns and security reviews.",
              "open", telegramId, new Date().toISOString(),
            ],
            [
              "opp_002", "Frontend Developer",
              "Build React components for the Collabberry dApp",
              "React, TypeScript, TailwindCSS, wagmi, Web3",
              40, 80, 45, 70,
              "Develop new UI features, integrate wallet connections, build data visualization dashboards for team compensation.",
              "open", telegramId, new Date().toISOString(),
            ],
            [
              "opp_003", "Community Manager",
              "Grow and engage the Collabberry community",
              "Community Management, Discord, Twitter, Content Writing, DAO Governance",
              20, 40, 30, 50,
              "Manage Discord and Twitter, write governance proposals, organize community calls, onboard new contributors.",
              "open", telegramId, new Date().toISOString(),
            ],
          ],
        },
        {
          range: "AuthorizedUsers!A2:B3",
          values: [
            [telegramId, "admin"],
            ["test_contributor_123", "contributor"],
          ],
        },
      ],
    },
  });

  console.log("\n=== SETUP COMPLETE ===");
  console.log(`Sheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  console.log(`\nSeeded data:`);
  console.log(`  - 3 sample opportunities (Smart Contract Dev, Frontend Dev, Community Manager)`);
  console.log(`  - Admin user: ${telegramId}`);
  console.log(`  - Test contributor: test_contributor_123`);
  if (telegramId === "REPLACE_WITH_YOUR_TELEGRAM_ID") {
    console.log(`\nNote: Run again with --your-telegram-id <id> to set yourself as admin`);
    console.log(`Get your Telegram ID from @userinfobot`);
  }
}

main().catch((err) => {
  console.error("Setup failed:", err.message || err);
  console.error("Error code:", err.code);
  console.error("Error details:", JSON.stringify(err.errors || err.response?.data?.error, null, 2));
  process.exit(1);
});
