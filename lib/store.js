/* =============================================================================
   Session store — ZERO external credentials. Replaces Google Sheets for the
   admin dashboard so it "just works" anywhere, including Vercel.

   Storage: an in-memory array, mirrored to a JSON file so it survives restarts.
   - Local dev:  ./data/sessions.json  (fully persistent)
   - Vercel:     /tmp/sessions.json     (writable; persists within a warm
                 instance — see the caveat below)

   ⚠ Serverless caveat: on Vercel each cold start is a fresh instance with its
   own /tmp, so rows aren't guaranteed to be shared across instances or kept
   forever. It NEVER errors, though, and works great locally + within a warm
   instance. For durable, shared storage without Google, upgrade to Vercel KV
   (see note in server.js).
   ============================================================================= */
import fs from "node:fs";
import path from "node:path";

const DIR  = process.env.VERCEL ? "/tmp" : path.join(process.cwd(), "data");
const FILE = path.join(DIR, "sessions.json");
const MAX  = 5000;

let sessions = [];
try {
  if (fs.existsSync(FILE)) sessions = JSON.parse(fs.readFileSync(FILE, "utf8")) || [];
} catch (e) {
  console.warn("[store] could not load existing sessions:", e.message);
}

function persist() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(sessions, null, 2));
  } catch (e) {
    // Read-only FS or similar — keep the in-memory copy, never throw.
    console.warn("[store] persist skipped:", e.message);
  }
}

/** Append one session row (timestamp added here). Returns the stored row. */
export function addSession(entry) {
  const row = { ts: new Date().toISOString(), ...entry };
  sessions.push(row);
  if (sessions.length > MAX) sessions = sessions.slice(-MAX);
  persist();
  return row;
}

/** All sessions, newest first. */
export function getSessionsList() {
  return [...sessions].reverse();
}

/** Wipe everything (used by the admin "clear" action if wired up). */
export function clearSessions() {
  sessions = [];
  persist();
}
