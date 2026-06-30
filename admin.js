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

  function start() {
    const $ = (id) => document.getElementById(id);

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
        renderInsights(sessions);
        renderUsageStats(sessions);   // most-worn garment + most-requested size
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

    /* Insights — group rows by garment, tally the calculated sizes within each.
       Renders cards like:  "Mono Slim"  →  5× L · 2× M · 1× S
       All computed dynamically from the fetched logs. */
    function renderInsights(sessions) {
      const grid  = $("insightsGrid");
      const empty = $("insightsEmpty");
      if (!grid) return;
      grid.innerHTML = "";

      // garment_name -> { total, sizes: { L: 5, M: 2, … } }
      const byGarment = new Map();
      for (const s of sessions) {
        const name = (s.garment_name || "").trim() || "Unspecified garment";
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

    /* Lazily create (once) a dash-insights section appended to the dashboard,
       reusing the EXACT existing CSS classes. Returns its inner grid element. */
    function ensureInsightSection(id, title) {
      let grid = $(id + "-grid");
      if (grid) return grid;
      const sec = document.createElement("section");
      sec.className = "dash-insights";
      sec.id = id;
      sec.innerHTML =
        `<h2 class="dash-section-title">${esc(title)}</h2>` +
        `<div class="insights-grid" id="${id}-grid"></div>` +
        `<p class="dash-empty" id="${id}-empty" hidden>No data yet.</p>`;
      dashView.appendChild(sec);
      return $(id + "-grid");
    }

    /* Most-worn garment (top 5, grouped by type + name) and most-requested size,
       both computed live from the fetched session rows. Rendered with the same
       insight-card / size-tally markup the existing Insights section uses. */
    function renderUsageStats(sessions) {
      /* ── Most-worn garment — group by garment_type + garment_name ── */
      const garmentGrid = ensureInsightSection("usageGarments", "Most-Worn Garments · Top 5");
      const gEmpty = $("usageGarments-empty");
      const byGarment = new Map();
      for (const s of sessions) {
        const name = String(s.garment_name || "Unspecified garment").trim();
        const type = String(s.garment_type || "").trim();
        const key  = type ? `${name}|${type}` : name;
        if (!byGarment.has(key)) byGarment.set(key, { name, type, count: 0 });
        byGarment.get(key).count += 1;
      }
      const topGarments = [...byGarment.values()].sort((a, b) => b.count - a.count).slice(0, 5);
      garmentGrid.innerHTML = "";
      if (!topGarments.length) { if (gEmpty) gEmpty.hidden = false; }
      else {
        if (gEmpty) gEmpty.hidden = true;
        const frag = document.createDocumentFragment();
        for (const g of topGarments) {
          const card = document.createElement("div");
          card.className = "insight-card";
          card.innerHTML =
            `<div class="insight-card__head">` +
              `<span class="insight-card__name">${esc(g.name)}${g.type ? ` · ${esc(g.type)}` : ""}</span>` +
              `<span class="insight-card__count">${g.count} worn</span>` +
            `</div>`;
          frag.appendChild(card);
        }
        garmentGrid.appendChild(frag);
      }

      /* ── Most-requested size — group by calculated size, count desc ── */
      const sizeGrid = ensureInsightSection("usageSizes", "Most-Requested Sizes");
      const sEmpty = $("usageSizes-empty");
      const bySize = new Map();
      for (const s of sessions) {
        const size = String(s.size || "").trim().toUpperCase();
        if (!size) continue;
        bySize.set(size, (bySize.get(size) || 0) + 1);
      }
      const sizes = [...bySize.entries()].sort((a, b) => b[1] - a[1]);
      sizeGrid.innerHTML = "";
      if (!sizes.length) { if (sEmpty) sEmpty.hidden = false; }
      else {
        if (sEmpty) sEmpty.hidden = true;
        const card = document.createElement("div");
        card.className = "insight-card";
        const tally = sizes.map(([sz, n]) =>
          `<span class="size-tally"><b>${n}×</b> ${esc(sz)}</span>`).join("");
        card.innerHTML =
          `<div class="insight-card__head">` +
            `<span class="insight-card__name">By calculated size</span>` +
            `<span class="insight-card__count">${sizes.length} size(s)</span>` +
          `</div>` +
          `<div class="insight-card__tally">${tally}</div>`;
        sizeGrid.appendChild(card);
      }
    }

    /* Users + total measurement count — fetched live from /api/admin/users,
       rendered into a dash-table appended once (reuses existing table styling). */
    async function loadUsers() {
      let tbody = $("usersRows");
      if (!tbody) {
        const sec = document.createElement("section");
        sec.className = "dash-table-wrap";
        sec.id = "usersTableWrap";
        sec.innerHTML =
          `<h2 class="dash-section-title">Users · Measurement Count</h2>` +
          `<table class="dash-table">` +
            `<thead><tr><th>Name</th><th>Phone</th><th>Measurements</th><th>Joined</th></tr></thead>` +
            `<tbody id="usersRows"></tbody>` +
          `</table>` +
          `<p id="usersEmpty" class="dash-empty" hidden>No users yet.</p>`;
        dashView.appendChild(sec);
        tbody = $("usersRows");
      }

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
            `<td data-label="Name">${esc(u.name || "—")}</td>` +
            `<td data-label="Phone">${esc(u.phone || "—")}</td>` +
            `<td data-label="Measurements"><span class="size-badge">${esc(String(u.session_count ?? 0))}</span></td>` +
            `<td data-label="Joined" class="cell-time">${esc(timeCell(u.created_at))}</td>`;
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
