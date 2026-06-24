// One-shot: copy Google Sheets credentials from local .env into Vercel, then
// redeploy production so the admin dashboard can read/write the sheet.
// Run it yourself:   node scripts/_pushenv.mjs
// Values are piped to `vercel env add` via stdin — never printed to screen.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const raw = fs.readFileSync(".env", "utf8");
function val(key) {
  const m = raw.match(new RegExp("^" + key + "=(.*)$", "m"));
  if (!m) return "";
  let v = m[1].trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); // strip wrapping quotes
  return v;
}

const keys = ["GOOGLE_SHEET_ID", "GOOGLE_SHEET_TAB", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY"];
const envs = ["production", "preview", "development"];

console.log("→ Copying Google credentials from .env into Vercel…\n");
for (const k of keys) {
  const v = val(k);
  if (!v) { console.log(`skip ${k} (empty)`); continue; }
  for (const e of envs) {
    spawnSync("vercel", ["env", "rm", k, e, "-y"], { stdio: "ignore", shell: true }); // remove stale (ignore "not found")
    const r = spawnSync("vercel", ["env", "add", k, e], { input: v, encoding: "utf8", shell: true });
    console.log(`${k} → ${e}: ${r.status === 0 ? "OK" : "FAIL " + String(r.stderr || "").slice(0, 140)}`);
  }
}

console.log("\n→ Redeploying production so the new env vars take effect…\n");
const d = spawnSync("vercel", ["--prod", "--yes"], { stdio: "inherit", shell: true });
console.log(d.status === 0
  ? "\n✓ Done. Hard-refresh /admin (Ctrl+Shift+R) on your live site."
  : "\n⚠ Env vars set, but redeploy didn't run. Redeploy manually: Vercel → Deployments → ⋯ → Redeploy.");
