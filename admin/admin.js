/* =============================================================================
   PEAR Admin Dashboard — client logic with Supabase Auth login gate
   -----------------------------------------------------------------------------
   • Login gate: email + password are checked server-side against ADMIN_EMAILS /
     ADMIN_PASSWORDS (see server.js /api/admin/check-auth) BEFORE a one-time
     email magic link is requested. Only once both match does Supabase email a
     sign-in link; the admin clicks it, Supabase redirects back here with a
     session, and onAuthStateChange fires SIGNED_IN → dashboard access.
   • On page load: getSession() → if valid session, skip to dashboard.
   • All data fetches carry a Bearer token; server verifies via getUser().
   -----------------------------------------------------------------------------
   SUPABASE SETTINGS — one-time manual configuration required for magic-link login:

     1. Enable the email provider:
        Supabase Dashboard → Authentication → Providers → Email
        Make sure the Email provider is enabled (magic-link sign-in is on by
        default for the email provider).

     2. Allow this page as a redirect target:
        Supabase Dashboard → Authentication → URL Configuration
        Set Site URL and add the admin page URL under Redirect URLs so the
        emailed link returns the admin here with a valid session.

     3. (Optional) Customize the sign-in email:
        Supabase Dashboard → Authentication → Email Templates → Magic Link
        Edit the template to change the wording, branding, or subject line.

     4. Set the link expiry to 60 seconds (matches the on-screen note):
        Supabase Dashboard → Authentication → Configuration → OTP Expiry
        Set it to 60 seconds so the link expires in step with this UI.

     NOTE: signInWithOtp() below uses shouldCreateUser: false, so ONLY existing
     Supabase users can request a link. Add admin accounts under
     Authentication → Users, and list their emails in the server's ADMIN_EMAILS
     env var. Also set ADMIN_PASSWORDS with one password per email, in the SAME
     ORDER as ADMIN_EMAILS — index i in ADMIN_EMAILS pairs with index i in
     ADMIN_PASSWORDS (the server enforces both — see server.js).
   ============================================================================= */
(() => {
  "use strict";

  const SUPABASE_URL      = "https://nhkaiucbaauqetaidgoi.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oa2FpdWNiYWF1cWV0YWlkZ29pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MTQ2NzIsImV4cCI6MjA5ODM5MDY3Mn0.t6uZbCmQUoeNdz1XkH1ZxwrcIcy7bxmvzezGcSUOLDU"; // Supabase Dashboard → Settings → API → anon public

  const adminSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  /* ── Login view markup — single screen, magic-link ──────────────────────────
     One card: email field + כניסה עם קישור לאימייל button. After signInWithOtp succeeds a
     confirmation message appears below the button; onAuthStateChange (see init)
     loads the dashboard once the admin clicks the emailed link. */
  function loginMarkup() {
    return `
    <div id="loginView" class="login-view">
      <div class="login-card">
        <div class="login-brand">PEAR</div>
        <p class="login-subtitle">Admin Dashboard</p>

        <form id="emailForm" autocomplete="on" novalidate>
          <div class="login-field">
            <label for="loginEmail">אימייל</label>
            <input id="loginEmail" type="email" autocomplete="email" required placeholder="admin@example.com" dir="ltr">
          </div>
          <div class="login-field">
            <label for="loginPassword">סיסמה</label>
            <input id="loginPassword" type="password" autocomplete="current-password" required placeholder="••••••••" dir="ltr">
          </div>
          <p id="emailError" class="login-error" hidden></p>
          <button type="submit" id="sendCodeBtn" class="dash-btn login-submit">כניסה עם קישור לאימייל</button>
          <p id="loginSent" class="login-hint" hidden>נשלח לך קישור לאימייל שלך. לחץ על הקישור כדי להיכנס.</p>
        </form>
      </div>
    </div>`;
  }

  /* ── Dashboard shell markup ─────────────────────────────────────────────── */
  function shellMarkup() {
    return `
    <main id="dashboardView" class="dashboard-view">

      <header class="dash-top">
        <div class="dash-top__brand">
          <span class="dash-top__mark">PEAR</span>
          <span class="dash-top__sub">Session Analytics</span>
        </div>
        <div class="dash-top__actions">
          <button id="refreshBtn" class="dash-btn" type="button">Refresh</button>
          <button id="clearBtn"   class="dash-btn" type="button">Clear all</button>
          <button id="logoutBtn"  class="dash-btn" type="button">Logout</button>
        </div>
      </header>

      <section class="card">
        <h2 class="card__title">Overview</h2>
        <div class="stat-row">
          <div class="stat-card">
            <span class="stat-card__num" id="statTotal">0</span>
            <span class="stat-card__label">Total Sessions</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__num" id="statVisitors">0</span>
            <span class="stat-card__label">Unique Visitors</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__num" id="statGarments">0</span>
            <span class="stat-card__label">Garments Sized</span>
          </div>
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">Users</h2>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Measurements</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody id="usersRows"></tbody>
          </table>
        </div>
        <p id="usersEmpty" class="empty" hidden>No users registered yet.</p>
      </section>

      <section class="card">
        <h2 class="card__title">Most-Worn Garments</h2>
        <div id="garmentsList" class="rank-list"></div>
        <p id="garmentsEmpty" class="empty" hidden>No garment data yet.</p>
      </section>

      <section class="card">
        <h2 class="card__title">Most-Requested Sizes</h2>
        <div id="sizesList" class="rank-list"></div>
        <p id="sizesEmpty" class="empty" hidden>No size data yet.</p>
      </section>

      <section class="card">
        <h2 class="card__title">All Sessions</h2>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Visitor ID</th>
                <th>Recommended Size</th>
                <th>Height</th>
                <th>Weight</th>
                <th>Garment</th>
                <th>Date &amp; Time</th>
              </tr>
            </thead>
            <tbody id="sessionRows"></tbody>
          </table>
        </div>
        <p id="emptyState" class="empty" hidden>No sessions logged yet.</p>
        <p id="dashError"  class="error" role="alert" hidden></p>
      </section>

    </main>`;
  }

  /* ── Show login form — single screen, magic-link ────────────────────────────
     email → server-side ADMIN_EMAILS check → signInWithOtp → confirmation msg.
     The admin clicks the emailed link; onAuthStateChange (see init) fires
     SIGNED_IN and loads the dashboard. */
  function showLogin() {
    document.getElementById("app").innerHTML = loginMarkup();

    const emailForm    = document.getElementById("emailForm");
    const emailInput   = document.getElementById("loginEmail");
    const passwordInput = document.getElementById("loginPassword");
    const emailError   = document.getElementById("emailError");
    const sendCodeBtn  = document.getElementById("sendCodeBtn");
    const sentMsg      = document.getElementById("loginSent");

    function showError(msg) {
      sentMsg.hidden = true;
      emailError.textContent = msg;
      emailError.hidden = false;
      sendCodeBtn.disabled = false;
      sendCodeBtn.textContent = "כניסה עם קישור לאימייל";
    }

    emailForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      emailError.hidden = true;
      sentMsg.hidden = true;
      sendCodeBtn.disabled = true;
      sendCodeBtn.textContent = "...";

      const email    = emailInput.value.trim();
      const password = passwordInput.value;

      // Verify BOTH email and password against the server-side allowlist before
      // requesting a magic link, so only verified admins trigger a Supabase
      // email send. Sent as a POST body (not a GET query string) so the
      // password never lands in a URL — URLs get written to server/proxy
      // access logs and browser history in plaintext.
      try {
        const check = await fetch("/api/admin/check-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const { allowed } = await check.json();
        if (!allowed) {
          showError("אימייל או סיסמה שגויים");
          return;
        }
      } catch (err) {
        console.warn("[auth] check-auth failed:", err?.message || err);
        showError("אימייל או סיסמה שגויים");
        return;
      }

      const { error } = await adminSupabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          // DOMAIN FIX: was hardcoded to pear-web-demo.vercel.app, which is a
          // separate/broken Vercel deployment this project doesn't control (see
          // troubleshooting notes) — magic-link emails were bouncing admins to a
          // stale build. window.location.origin always matches whatever domain
          // this page was actually loaded from, so it self-corrects if the
          // domain situation changes again. NOTE: this exact origin must also be
          // present in Supabase → Authentication → URL Configuration → Redirect
          // URLs, or Supabase will reject/ignore the redirect.
          emailRedirectTo: window.location.origin + "/admin/",
        },
      });

      // Log status only — never the response body (may carry session material).
      if (error) {
        console.warn("[auth] magic-link request failed:", error?.status || "", error?.name || "error");
        showError("שגיאה בשליחת הקישור, נסה שוב");
        return;
      }

      sendCodeBtn.disabled = false;
      sendCodeBtn.textContent = "כניסה עם קישור לאימייל";
      sentMsg.hidden = false;
    });
  }

  /* ── Render dashboard and boot data-fetching logic ──────────────────────── */
  function showDashboard(accessToken) {
    document.getElementById("app").innerHTML = shellMarkup();
    startDashboard(accessToken);
  }

  /* ── All dashboard logic — unchanged except every fetch is authed ────────── */
  function startDashboard(accessToken) {
    const $ = (id) => document.getElementById(id);

    /* Always re-reads session so auto-refreshed tokens are picked up. */
    async function currentToken() {
      const { data: { session } } = await adminSupabase.auth.getSession();
      return session?.access_token || accessToken;
    }

    async function authedFetch(url, opts = {}) {
      const tk = await currentToken();
      return fetch(url, {
        ...opts,
        headers: { ...(opts.headers || {}), "Authorization": `Bearer ${tk}` },
      });
    }

    /* ── Logout ─────────────────────────────────────────────────────────── */
    const logoutBtn = $("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", async () => {
      await adminSupabase.auth.signOut();
      showLogin();
    });

    /* ── Refresh / clear ────────────────────────────────────────────────── */
    const refreshBtn = $("refreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", () => loadSessions());

    const clearBtn = $("clearBtn");
    if (clearBtn) clearBtn.addEventListener("click", async () => {
      if (!confirm("Delete ALL session data permanently? This cannot be undone.")) return;
      clearBtn.disabled = true;
      try {
        const res = await authedFetch("/api/sessions", { method: "DELETE" });
        if (!res.ok) throw new Error("Server error " + res.status);
        await loadSessions();
      } catch (err) {
        const errEl = $("dashError");
        if (errEl) { errEl.textContent = "Clear failed: " + (err.message || err); errEl.hidden = false; }
      } finally {
        clearBtn.disabled = false;
      }
    });

    /* ── Data load + render ─────────────────────────────────────────────── */
    async function loadSessions() {
      const errEl = $("dashError");
      if (errEl) errEl.hidden = true;

      try {
        const url = "/api/sessions?_=" + Date.now();
        const res = await authedFetch(url, { cache: "no-store" });

        if (res.status === 401) { await adminSupabase.auth.signOut(); showLogin(); return; }

        const rawText = await res.text();
        let data;
        try { data = JSON.parse(rawText); } catch { data = null; }
        console.log("[admin] GET /api/sessions →", res.status, res.ok ? "OK" : "ERROR");

        if (!res.ok || !data || data.ok === false) {
          throw new Error((data && (data.message || data.error)) || ("Server error " + res.status));
        }

        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        renderStats(sessions);
        renderUsageStats(sessions);
        renderRows(sessions);
        loadUsers();
      } catch (err) {
        console.error("[admin] loadSessions failed:", err);
        const errEl = $("dashError");
        if (errEl) {
          errEl.textContent = "Could not load data: " + (err.message || err);
          errEl.hidden = false;
        }
      }
    }

    function renderStats(sessions) {
      const visitors = new Set(sessions.map((s) => s.session_id).filter(Boolean));
      const garments = new Set(sessions.map((s) => s.garment_name || s.garment_id).filter(Boolean));
      const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      set("statTotal",    sessions.length);
      set("statVisitors", visitors.size);
      set("statGarments", garments.size);
    }

    function val(v, unit) {
      if (v === "" || v === null || v === undefined) return "—";
      return esc(v) + (unit || "");
    }

    function sizeBadge(s) {
      const size = (s.size || "").trim();
      return size
        ? `<span class="size-badge">${esc(size.toUpperCase())}</span>`
        : `<span class="size-badge size-badge--none">—</span>`;
    }

    function garmentCell(s) {
      const name = s.garment_name || "—";
      const id   = s.garment_id ? `<span class="garment-id">${esc(s.garment_id)}</span>` : "";
      return `<span class="garment-name">${esc(name)}</span>${id}`;
    }

    function timeCell(ts) {
      if (!ts) return "—";
      const d = new Date(ts);
      if (isNaN(d)) return esc(ts);
      return d.toLocaleString(undefined, {
        year: "numeric", month: "short", day: "2-digit",
        hour: "2-digit", minute: "2-digit",
      });
    }

    function shortId(id) {
      if (!id) return "—";
      return id.length > 14 ? id.slice(0, 8) + "…" + id.slice(-4) : id;
    }

    function renderRows(sessions) {
      const tbody   = $("sessionRows");
      const emptyEl = $("emptyState");
      if (!tbody) return;
      tbody.innerHTML = "";

      if (!sessions.length) { if (emptyEl) emptyEl.hidden = false; return; }
      if (emptyEl) emptyEl.hidden = true;

      const frag = document.createDocumentFragment();
      for (const s of sessions) {
        const tr = document.createElement("tr");
        tr.innerHTML =
          `<td data-label="Anonymized ID"><span class="cell-id" title="${esc(s.session_id)}">${esc(shortId(s.session_id))}</span></td>` +
          `<td data-label="Recommended Size">${sizeBadge(s)}</td>` +
          `<td data-label="Height">${val(s.height, "cm")}</td>` +
          `<td data-label="Weight">${val(s.weight, "kg")}</td>` +
          `<td data-label="Garment">${garmentCell(s)}</td>` +
          `<td data-label="Timestamp" class="cell-time">${esc(timeCell(s.created_at))}</td>`;
        frag.appendChild(tr);
      }
      tbody.appendChild(frag);
    }

    function esc(v) {
      return String(v ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function renderRankList(gridId, emptyId, items, unit) {
      const grid  = $(gridId);
      const empty = $(emptyId);
      if (!grid) return;
      grid.innerHTML = "";
      if (!items.length) { if (empty) empty.hidden = false; return; }
      if (empty) empty.hidden = true;

      const max = items[0].count || 1;
      const frag = document.createDocumentFragment();
      items.forEach((it, i) => {
        const pct = Math.max(6, Math.round((it.count / max) * 100));
        const row = document.createElement("div");
        row.className = "rank-item";
        row.innerHTML =
          `<span class="rank-item__bar" style="width:${pct}%"></span>` +
          `<span class="rank-item__main">` +
            `<span class="rank-item__rank">${i + 1}</span>` +
            `<span class="rank-item__label">${esc(it.label)}` +
              (it.sub ? ` <span class="rank-item__sub">· ${esc(it.sub)}</span>` : "") +
            `</span>` +
          `</span>` +
          `<span class="rank-item__count">${it.count} ${esc(unit)}</span>`;
        frag.appendChild(row);
      });
      grid.appendChild(frag);
    }

    function renderUsageStats(sessions) {
      const byGarment = new Map();
      for (const s of sessions) {
        const name = String(s.garment_name || "Unspecified garment").trim();
        const type = String(s.garment_type || "").trim();
        const key  = type ? `${name}|${type}` : name;
        if (!byGarment.has(key)) byGarment.set(key, { label: name, sub: type, count: 0 });
        byGarment.get(key).count += 1;
      }
      const topGarments = [...byGarment.values()].sort((a, b) => b.count - a.count).slice(0, 5);
      renderRankList("garmentsList", "garmentsEmpty", topGarments, "worn");

      const bySize = new Map();
      for (const s of sessions) {
        const size = String(s.size || "").trim().toUpperCase();
        if (!size) continue;
        bySize.set(size, (bySize.get(size) || 0) + 1);
      }
      const sizes = [...bySize.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => ({ label, sub: "", count }));
      renderRankList("sizesList", "sizesEmpty", sizes, "requests");
    }

    async function loadUsers() {
      const tbody = $("usersRows");
      if (!tbody) return;

      try {
        const url = "/api/admin/users?_=" + Date.now();
        const res = await authedFetch(url, { cache: "no-store" });
        if (res.status === 401) { await adminSupabase.auth.signOut(); showLogin(); return; }
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || data.ok === false) {
          throw new Error((data && (data.message || data.error)) || ("Server error " + res.status));
        }
        const users = Array.isArray(data.users) ? data.users : [];
        const emptyEl = $("usersEmpty");
        tbody.innerHTML = "";
        if (!users.length) { if (emptyEl) emptyEl.hidden = false; return; }
        if (emptyEl) emptyEl.hidden = true;

        const frag = document.createDocumentFragment();
        for (const u of users) {
          const tr = document.createElement("tr");
          tr.innerHTML =
            `<td>${esc(u.name || "—")}</td>` +
            `<td>${esc(u.email || "—")}</td>` +
            `<td><span class="size-badge">${esc(String(u.session_count ?? 0))}</span></td>` +
            `<td class="cell-time">${esc(timeCell(u.created_at))}</td>`;
          frag.appendChild(tr);
        }
        tbody.appendChild(frag);
      } catch (err) {
        console.error("[admin] loadUsers failed:", err);
      }
    }

    loadSessions();
  }

  /* ── Entry point: check existing session, show login or dashboard ────────── */
  async function init() {
    // Magic-link return: when the admin clicks the emailed link, Supabase
    // restores the session on page load and fires SIGNED_IN — load the dashboard.
    adminSupabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        showDashboard(session.access_token);
      }
    });

    const { data: { session } } = await adminSupabase.auth.getSession();
    if (session) {
      showDashboard(session.access_token);
    } else {
      showLogin();
    }
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else
    init();
})();
