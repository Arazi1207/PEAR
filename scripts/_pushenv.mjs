// One-off: copy Google Sheets credentials from local .env into Vercel env vars.
// Values are piped to `vercel env add` via stdin — never echoed to the console.
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

for (const k of keys) {
  const v = val(k);
  if (!v) { console.log(`skip ${k} (empty)`); continue; }
  for (const e of envs) {
    // Remove any stale copy first (ignore "not found"), then add fresh.
    spawnSync("vercel", ["env", "rm", k, e, "-y"], { stdio: "ignore", shell: true });
    const r = spawnSync("vercel", ["env", "add", k, e], { input: v, encoding: "utf8", shell: true });
    console.log(`${k} → ${e}: ${r.status === 0 ? "OK" : "FAIL " + String(r.stderr || "").slice(0, 140)}`);
  }
}
console.log("done");
