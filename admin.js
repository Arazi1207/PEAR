/* =============================================================================
   PEAR Admin Dashboard — client logic (open access, no login gate)
   -----------------------------------------------------------------------------
   • No password / login form. The dashboard loads directly on page open.
   • Data is read live from Supabase via the server:
       GET    /api/sessions      → every session row (newest first)
       GET    /api/admin/users   → users + per-user measurement count
       DELETE /api/sessions      → wipe all sessions ("Clear all")
   • All row fields are read using the snake_case keys Supabase returns
     (session_id, garment_name, garment_type, created_at, …).
   ============================================================================= */
(() => {
  "use strict";

  /* ── Static shell markup — the whole page structure, rendered once into
     #app by JS. Data-fetching/render functions below target these ids/classes
     exactly as before; only the HTML now originates here instead of admin.html. */
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
                <th>Phone</th>
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
                <th>Chest</th>
                <th>Waist</th>
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

  function start() {
    const $ = (id) => document.getElementById(id);

    // Render the page structure into #app before wiring anything up.
    const app = document.getElementById("app");
    if (app && !document.getElementById("dashboardView")) {
      app.innerHTML = shellMarkup();
    }

    const dashView = $("dashboardView");
    if (!dashView) {
      console.error("[admin] missing #dashboardView container");
      return;
    }

    /* ── refresh / clear ────────────────────────────────────────────────── */
    const refreshBtn = $("refreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", () => loadSessions());

    const clearBtn = $("clearBtn");
    if (clearBtn) clearBtn.addEventListener("click", async () => {
      if (!confirm("Delete ALL session data permanently? This cannot be undone.")) return;
      clearBtn.disabled = true;
      try {
        const res = await fetch("/api/sessions", { method: "DELETE" });
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
      const errEl = $("dashError");
      if (errEl) errEl.hidden = true;

      try {
        // Cache-buster (&_=) + no-store so the browser/CDN can never hand back a
        // stale or empty response.
        const url = "/api/sessions?_=" + Date.now();
        const res = await fetch(url, { cache: "no-store" });

        const rawText = await res.text();
        let data;
        try { data = JSON.parse(rawText); } catch { data = null; }
        console.log("[admin] GET /api/sessions →", res.status, res.ok ? "OK" : "ERROR");

        if (!res.ok || !data || data.ok === false) {
          throw new Error((data && (data.message || data.error)) || ("Server error " + res.status));
        }

        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        renderStats(sessions);
        renderUsageStats(sessions);   // most-worn garments + most-requested sizes
        renderRows(sessions);
        loadUsers();                  // users + per-user measurement counts
      } catch (err) {
        console.error("[admin] loadSessions failed:", err);
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
      set("statTotal",    sessions.length);     // Total Sessions
      set("statVisitors", visitors.size);       // Unique Visitors (unique IDs)
      set("statGarments", garments.size);       // Garments Sized
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
          `<td data-label="Chest">${val(s.chest, "cm")}</td>` +
          `<td data-label="Waist">${val(s.waist, "cm")}</td>` +
          `<td data-label="Garment">${garmentCell(s)}</td>` +
          `<td data-label="Timestamp" class="cell-time">${esc(timeCell(s.created_at))}</td>`;
        frag.appendChild(tr);
      }
      tbody.appendChild(frag);
    }

    // Minimal HTML-escape — all DB-sourced strings pass through this.
    function esc(v) {
      return String(v ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    /* Render a ranked list into a static container (#garmentsList / #sizesList).
       Each row carries a proportional bar behind it so relative magnitude reads
       at a glance. `items` = [{ label, sub, count }] already sorted desc. */
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

    /* Most-worn garments (top 5, grouped by garment_type + garment_name) and
       most-requested sizes — both computed live from the fetched session rows. */
    function renderUsageStats(sessions) {
      /* ── Most-worn garments — group by garment_type + garment_name ── */
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

      /* ── Most-requested sizes — group by calculated size, count desc ── */
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

    /* Users + total measurement count — fetched live from /api/admin/users and
       rendered into the static Users table. The endpoint returns snake_case keys
       (name, phone, created_at) plus the derived session_count. */
    async function loadUsers() {
      const tbody = $("usersRows");
      if (!tbody) return;

      try {
        const url = "/api/admin/users?_=" + Date.now();
        const res = await fetch(url, { cache: "no-store" });
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
            `<td>${esc(u.phone || "—")}</td>` +
            `<td><span class="size-badge">${esc(String(u.session_count ?? 0))}</span></td>` +
            `<td class="cell-time">${esc(timeCell(u.created_at))}</td>`;
          frag.appendChild(tr);
        }
        tbody.appendChild(frag);
      } catch (err) {
        console.error("[admin] loadUsers failed:", err);
      }
    }

    /* ── boot: load the dashboard data immediately (no auth) ─────────────── */
    loadSessions();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else
    start();
})();
