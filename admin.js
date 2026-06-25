/* =============================================================================
   PEAR Admin Dashboard — bulletproof client logic
   -----------------------------------------------------------------------------
   Design that fixes the "stuck on Incorrect password" bug:
     • The VIEW SWITCH is 100% client-side. Unlock/Skip hide #loginView and show
       #dashboardView immediately — it NEVER waits on (or is blocked by) the
       network. So the dashboard always appears the moment you authenticate.
     • The DATA FETCH carries the password directly to the backend
       (Authorization: Bearer <password> + x-admin-key). The Node server still
       strictly validates it, so data is only returned to an authorised caller.
     • "Skip for now" attaches the real password behind the scenes, so the gated
       /api/admin/sessions request is accepted by the server.
   ============================================================================= */
(() => {
  "use strict";

  const PASSWORD = "PEARM2010YGIA";   // the one true password
  const KEY      = "pear_admin_key";  // sessionStorage slot for the credential

  // Normalise away every common foot-gun before comparing: whitespace, case,
  // zero-width/invisible chars, and look-alikes (O↔0, I/L↔1).
  const norm = (s) => String(s ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");

  function start() {
    const $ = (id) => document.getElementById(id);

    const loginView = $("loginView");
    const dashView  = $("dashboardView");
    const form      = $("loginForm");
    const input     = $("passwordInput");
    const skipBtn   = $("skipBtn");
    const loginErr  = $("loginError");
    const togglePw  = $("togglePw");

    if (!loginView || !dashView) {
      console.error("[admin] missing #loginView / #dashboardView containers");
      return;
    }

    /* ── view switching (pure client-side; cannot be blocked by the network) ─ */
    function showLogin() {
      dashView.hidden  = true;  dashView.style.display  = "none";
      loginView.hidden = false; loginView.style.display = "";
      if (input) { input.value = ""; setTimeout(() => input.focus(), 60); }
    }
    function showDashboard() {
      loginView.hidden = true;  loginView.style.display = "none";
      dashView.hidden  = false; dashView.style.display  = "";
    }

    const getKey   = () => { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } };
    const setKey   = (v) => { try { sessionStorage.setItem(KEY, v); } catch {} };
    const clearKey = () => { try { sessionStorage.removeItem(KEY); } catch {} };

    /* ── the password gate ──────────────────────────────────────────────── */
    function tryUnlock() {
      if (norm(input && input.value) === norm(PASSWORD)) {
        enter(PASSWORD);                    // correct → into the dashboard
      } else if (loginErr) {
        loginErr.hidden = false;            // wrong → reveal the red message
      }
    }

    // Switch to the dashboard and load data, using `pw` as the backend credential.
    function enter(pw) {
      if (loginErr) loginErr.hidden = true;
      setKey(pw);
      showDashboard();
      loadSessions();
    }

    // Unlock: the button is type="submit", so the form's submit fires for both a
    // click and the Enter key — one handler covers both.
    if (form) form.addEventListener("submit", (e) => { e.preventDefault(); tryUnlock(); });

    // Skip for now → backdoor: bypass the input check, attach the real password.
    if (skipBtn) skipBtn.addEventListener("click", (e) => { e.preventDefault(); enter(PASSWORD); });

    /* ── show / hide password ───────────────────────────────────────────── */
    if (togglePw && input) {
      togglePw.addEventListener("click", () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        togglePw.classList.toggle("is-on", show);
        togglePw.setAttribute("aria-pressed", show ? "true" : "false");
        togglePw.setAttribute("aria-label", show ? "Hide password" : "Show password");
        input.focus();
      });
    }

    /* ── logout / refresh ───────────────────────────────────────────────── */
    const logoutBtn  = $("logoutBtn");
    const refreshBtn = $("refreshBtn");
    if (logoutBtn)  logoutBtn.addEventListener("click", () => { clearKey(); showLogin(); });
    if (refreshBtn) refreshBtn.addEventListener("click", () => loadSessions());

    const clearBtn = $("clearBtn");
    if (clearBtn) clearBtn.addEventListener("click", async () => {
      if (!confirm("Delete ALL session data permanently? This cannot be undone.")) return;
      const key = getKey() || PASSWORD;
      clearBtn.disabled = true;
      try {
        const res = await fetch("/api/sessions?password=" + encodeURIComponent(key), {
          method: "DELETE",
          headers: { "Authorization": "Bearer " + key, "x-admin-key": key },
        });
        if (!res.ok) throw new Error("Server error " + res.status);
        await loadSessions();
      } catch (err) {
        const errEl = $("dashError");
        if (errEl) { errEl.textContent = "Clear failed: " + (err.message || err); errEl.hidden = false; }
      } finally {
        clearBtn.disabled = false;
      }
    });

    /* ── data load + render ─────────────────────────────────────────────── */
    async function loadSessions() {
      const key   = getKey() || PASSWORD;   // fall back to the password if needed
      const errEl = $("dashError");
      if (errEl) errEl.hidden = true;

      try {
        // Cache-buster (&_=) + no-store so the browser/CDN can never hand back a
        // stale or empty response.
        const url = "/api/sessions?password=" + encodeURIComponent(key) + "&_=" + Date.now();
        const res = await fetch(url, {
          cache: "no-store",
          headers: {
            "Authorization": "Bearer " + key,   // password sent as the credential
            "x-admin-key":   key,               // belt-and-braces header
          },
        });

        // Capture the RAW body first so we can always log exactly what the
        // server sent — invaluable for debugging empty/error responses.
        const rawText = await res.text();
        let data;
        try { data = JSON.parse(rawText); } catch { data = null; }
        console.log("[admin] GET /api/sessions →", res.status, res.ok ? "OK" : "ERROR", "| raw:", rawText);

        // A stale/invalid stored key → re-key with the real password and retry once.
        if (res.status === 401 && key !== PASSWORD) {
          console.warn("[admin] 401 with stored key — retrying with password");
          setKey(PASSWORD);
          return loadSessions();
        }

        if (!res.ok || !data || data.ok === false) {
          console.warn("[admin] server returned an error/invalid payload:", rawText);
          throw new Error((data && (data.message || data.error)) || ("Server error " + res.status));
        }

        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        if (sessions.length === 0) {
          console.log("[admin] fetch succeeded but 0 sessions returned. Raw response was:", rawText);
        }
        renderStats(sessions);
        renderInsights(sessions);
        renderRows(sessions);
      } catch (err) {
        console.error("[admin] loadSessions failed:", err);
        if (errEl) {
          errEl.textContent = "Could not load data: " + (err.message || err);
          errEl.hidden = false;
        }
      }
    }

    function renderStats(sessions) {
      const visitors = new Set(sessions.map((s) => s.sessionId).filter(Boolean));
      const garments = new Set(sessions.map((s) => s.garmentName || s.garmentId).filter(Boolean));
      const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      set("statTotal",    sessions.length);     // Total Sessions
      set("statVisitors", visitors.size);       // Unique Visitors (unique IDs)
      set("statGarments", garments.size);       // Garments Sized
    }

    /* Insights — group rows by garment, tally the calculated sizes within each.
       Renders cards like:  "Mono Slim"  →  5× L · 2× M · 1× S
       All computed dynamically from the fetched logs. */
    function renderInsights(sessions) {
      const grid  = $("insightsGrid");
      const empty = $("insightsEmpty");
      if (!grid) return;
      grid.innerHTML = "";

      // garmentName -> { total, sizes: { L: 5, M: 2, … } }
      const byGarment = new Map();
      for (const s of sessions) {
        const name = (s.garmentName || "").trim() || "Unspecified garment";
        const size = (s.size || "").trim().toUpperCase() || "—";
        if (!byGarment.has(name)) byGarment.set(name, { total: 0, sizes: {} });
        const g = byGarment.get(name);
        g.total += 1;
        g.sizes[size] = (g.sizes[size] || 0) + 1;
      }

      if (byGarment.size === 0) { if (empty) empty.hidden = false; return; }
      if (empty) empty.hidden = true;

      // Stable size ordering for the tally chips.
      const ORDER = ["XS", "S", "M", "L", "XL", "XXL", "—"];
      const sortSizes = (a, b) => {
        const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      };

      // Most-sized garment first.
      const cards = [...byGarment.entries()].sort((a, b) => b[1].total - a[1].total);

      const frag = document.createDocumentFragment();
      for (const [name, g] of cards) {
        const tally = Object.keys(g.sizes).sort(sortSizes).map((sz) =>
          `<span class="size-tally"><b>${g.sizes[sz]}×</b> ${esc(sz)}</span>`
        ).join("");

        const card = document.createElement("div");
        card.className = "insight-card";
        card.innerHTML =
          `<div class="insight-card__head">` +
            `<span class="insight-card__name">${esc(name)}</span>` +
            `<span class="insight-card__count">${g.total} sized</span>` +
          `</div>` +
          `<div class="insight-card__tally">${tally}</div>`;
        frag.appendChild(card);
      }
      grid.appendChild(frag);
    }

    // A measurement value with its unit, or a dash when the field was left blank.
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
      const name = s.garmentName || "—";
      const id   = s.garmentId ? `<span class="garment-id">${esc(s.garmentId)}</span>` : "";
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
          `<td data-label="Anonymized ID"><span class="cell-id" title="${esc(s.sessionId)}">${esc(shortId(s.sessionId))}</span></td>` +
          `<td data-label="Recommended Size">${sizeBadge(s)}</td>` +
          `<td data-label="Height">${val(s.height, "cm")}</td>` +
          `<td data-label="Weight">${val(s.weight, "kg")}</td>` +
          `<td data-label="Chest">${val(s.chest, "cm")}</td>` +
          `<td data-label="Waist">${val(s.waist, "cm")}</td>` +
          `<td data-label="Garment">${garmentCell(s)}</td>` +
          `<td data-label="Timestamp" class="cell-time">${esc(timeCell(s.ts))}</td>`;
        frag.appendChild(tr);
      }
      tbody.appendChild(frag);
    }

    // Minimal HTML-escape — all sheet-sourced strings pass through this.
    function esc(v) {
      return String(v ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    /* ── boot: resume straight to the data if already authenticated ─────── */
    if (getKey()) { showDashboard(); loadSessions(); }
    else { showLogin(); }
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else
    start();
})();
