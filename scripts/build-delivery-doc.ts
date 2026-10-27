/**
 * Renders docs/DELIVERY-STATUS.md into a styled, self-contained HTML file (and
 * PDF via headless Chrome). Mirrors scripts/build-qa-doc.ts so the two client
 * deliverables share the same typography and print layout.
 *
 *   bunx marked --gfm -i docs/DELIVERY-STATUS.md -o /tmp/delivery-body.html
 *   bun scripts/build-delivery-doc.ts
 *   google-chrome --headless --disable-gpu --no-sandbox \
 *     --print-to-pdf="$(pwd)/DELIVERY-STATUS.pdf" \
 *     "file://$(pwd)/DELIVERY-STATUS.html"
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dir, "..");
const body = readFileSync("/tmp/delivery-body.html", "utf-8");

const css = `
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1d21; line-height: 1.55; max-width: 1000px;
    margin: 0 auto; padding: 40px 32px; font-size: 14px;
  }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 {
    font-size: 18px; margin: 34px 0 12px; padding-bottom: 6px;
    border-bottom: 2px solid #e3e6ea; page-break-after: avoid;
  }
  h3 { font-size: 15px; margin: 24px 0 8px; color: #33383d; page-break-after: avoid; }
  p { margin: 10px 0; }
  table {
    border-collapse: collapse; width: 100%; margin: 14px 0;
    font-size: 12.5px; page-break-inside: avoid;
  }
  th {
    background: #f4f6f8; text-align: left; font-weight: 600;
    border: 1px solid #d7dbe0; padding: 7px 9px;
  }
  td { border: 1px solid #d7dbe0; padding: 7px 9px; vertical-align: top; }
  tbody tr:nth-child(even) { background: #fafbfc; }
  code {
    background: #f0f2f4; padding: 1px 5px; border-radius: 3px;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px;
  }
  blockquote {
    margin: 14px 0; padding: 10px 16px; background: #fbf7ec;
    border-left: 3px solid #d9a441; color: #4a4335;
  }
  blockquote p { margin: 0; }
  ol, ul { padding-left: 22px; }
  li { margin: 6px 0; }
  a { color: #1a5fb4; }
  hr { border: 0; border-top: 1px solid #e3e6ea; margin: 26px 0; }
  strong { font-weight: 600; }
  .doc-footer {
    margin-top: 40px; padding-top: 12px; border-top: 1px solid #e3e6ea;
    font-size: 11px; color: #7a8189;
  }
  @media print { body { padding: 0; max-width: none; } a { color: #1a1d21; } }
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Collabberry HR Agent — Delivery Status</title>
<style>${css}</style>
</head>
<body>
${body}
<div class="doc-footer">
  Collabberry HR Agent — Delivery Status. Generated ${new Date().toISOString().slice(0, 10)}.
</div>
</body>
</html>`;

const out = resolve(root, "DELIVERY-STATUS.html");
writeFileSync(out, html);
console.log(`wrote ${out} (${html.length} bytes)`);
