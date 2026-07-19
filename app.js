/* app.js — rendu de l'interface, navigation et interactions */
(function (Budget) {
  "use strict";

  const S = Budget.store;
  const F = Budget.format;
  let currentView = "home";
  let viewAll = false; // true = vue globale toutes périodes
  let ghEditToken = false; // true = affiche le champ token même s'il est déjà configuré
  let settingsSubview = null; // null = liste racine, sinon "categories" | "backup" | "balance"

  /* ---------- petits utilitaires DOM ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));

  // Emoji indicatif par catégorie (purement visuel)
  const CAT_EMOJI = {
    Restaurant: "🍽️", Courses: "🛒", Transport: "🚌", Loisir: "🎬",
    "Achat perso": "🛍️", "Matériel photo": "📷", Autre: "💸",
    Loyer: "🏠", "Electricité": "💡", Électricité: "💡", Internet: "🌐",
    Assurance: "🛡️", Abonnements: "🔁", Salaire: "💼", "Santé": "💊", "Prêt": "🏦",
  };
  const emojiFor = (name, fallback) => {
    const custom = S.getCategoryEmojis();
    return custom[name] || CAT_EMOJI[name] || fallback || "•";
  };

  const MONTHS_FR_APP = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  function realMonthLabel() {
    const now = new Date();
    return `${MONTHS_FR_APP[now.getMonth()]} ${now.getFullYear()}`;
  }

  // Statut budgétaire d'un mois (couleur carte héro)
  function heroState(c) {
    if (c.available < 0) return "low";
    if (c.available < c.totalExpense * 0.15 || c.available < 50) return "tight";
    return "ok";
  }

  /* ================= RENDU ================= */

  function updateHeader() {
    const dateEl = document.getElementById("headerDate");
    if (dateEl) dateEl.textContent = F.headerDate();
  }

  function render() {
    if (!S.getState()) return; // état pas encore prêt (récupération IndexedDB en cours)
    updateHeader();
    if (currentView === "months") { renderMonths(); return; }
    if (currentView === "settings") { renderSettings(); return; }
    if (currentView === "recurring") { renderRecurring(); return; }
    if (viewAll) {
      if (currentView === "home") renderHomeAll();
      else if (currentView === "history") renderHistoryAll();
    } else {
      const m = S.currentMonth();
      if (currentView === "home") renderHome(m);
      else if (currentView === "history") renderHistory(m);
    }
  }

  /* ---------- Accueil ---------- */
  function renderHome(m) {
    const c = S.computed(m);
    const view = $("#view-home");
    view.innerHTML = "";

    // état de la carte héro
    const state = heroState(c);

    const hero = el("div", "hero " + state);
    hero.innerHTML = `
      <p class="hero-label">Argent disponible</p>
      <p class="hero-amount num">${F.money(c.available)}</p>
      <p class="hero-note"><span class="dot"></span>${
        c.available < 0
          ? "Tu es à découvert sur ce mois"
          : c.pendingExpense > 0
          ? `Après ${F.money(c.pendingExpense)} de dépenses encore à venir`
          : "Tout est à jour pour ce mois"
      }</p>`;
    view.appendChild(hero);

    const stats = el("div", "substats");
    stats.innerHTML = `
      <div class="stat">
        <p class="k">Solde du compte</p>
        <p class="v num ${c.bank < 0 ? "neg" : ""}">${F.money(c.bank)}</p>
      </div>
      <div class="stat">
        <p class="k">Dépenses restantes</p>
        <p class="v num">${F.money(c.pendingExpense)}</p>
      </div>`;
    view.appendChild(stats);

    // Bandeau quand on consulte un mois qui n'est pas le mois réel
    const realLabel = realMonthLabel();
    if (m.label !== realLabel) {
      const st2 = S.getState();
      const todayM = st2.months.find((x) => x.label === realLabel);
      const banner = el("div", "month-banner");
      banner.innerHTML = `<span>Tu consultes <strong>${esc(m.label)}</strong></span>`;
      if (todayM) {
        const btn = el("button", "banner-btn");
        btn.textContent = `Retour à ${realLabel}`;
        btn.addEventListener("click", () => {
          S.setCurrentMonth(todayM.id);
          switchView("home");
        });
        banner.appendChild(btn);
      }
      view.appendChild(banner);
    }

    const add = el("button", "btn-primary");
    add.innerHTML = `<span class="plus">+</span> Ajouter une opération`;
    add.addEventListener("click", () => openTxModal(m.id));
    view.appendChild(add);

    // Évolution jour par jour du mois consulté
    const dailySec = dailyChartSection(monthDailySeries(m));
    if (dailySec) view.appendChild(dailySec);

    // Résumé par catégorie
    renderCatSummary(m, view);
  }

  /* ---------- Récurrent ---------- */
  // Le mois consulté à cocher (comme sur Accueil avant) + la gestion des
  // modèles récurrents (comme dans Réglages avant), regroupés au même endroit.
  function renderRecurring() {
    const view = $("#view-recurring");
    view.innerHTML = "";
    const st = S.getState();
    const m = S.currentMonth();

    const head = el("div", "section-head");
    head.style.marginTop = "4px";
    head.innerHTML = `<h2 class="section-title">Ce mois-ci — ${esc(m.label)}</h2>`;
    view.appendChild(head);

    if (m.expenses.length) {
      const sec = el("div", "section");
      sec.appendChild(sectionHead("Dépenses du mois", null));
      const list = el("div", "list");
      m.expenses.forEach((e) => list.appendChild(recurringRow(m, "expense", e)));
      sec.appendChild(list);
      view.appendChild(sec);
    }
    if (m.incomes.length) {
      const sec = el("div", "section");
      sec.appendChild(sectionHead("Revenus du mois", null));
      const list = el("div", "list");
      m.incomes.forEach((i) => list.appendChild(recurringRow(m, "income", i)));
      sec.appendChild(list);
      view.appendChild(sec);
    }
    if (!m.expenses.length && !m.incomes.length) {
      view.appendChild(emptyState("🔁", "Aucun récurrent ce mois-ci. Ajoutes-en un ci-dessous."));
    }

    view.appendChild(recurringSection("Revenus récurrents", "income", st.recurringIncomes));
    view.appendChild(recurringSection("Dépenses récurrentes", "expense", st.recurringExpenses));
  }

  function recurringRow(m, kind, item) {
    const row = el("div", "row" + (item.done ? " done" : ""));
    const sign = kind === "income" ? "+" : "−";
    const isAuto = item.day != null;
    const statusText = item.done
      ? (kind === "income" ? "Reçu" : "Payé") + (isAuto ? ` · le ${item.day}` : "")
      : (kind === "income" ? "À recevoir" : "À payer") + (isAuto ? ` le ${item.day}` : "");
    if (isAuto) {
      row.innerHTML = `
        <div class="check ${item.done ? "done" : ""}" style="opacity:.45;cursor:default" aria-hidden="true">✓</div>
        <div class="body">
          <p class="t">${esc(item.name)}</p>
          <p class="s">${statusText}</p>
        </div>
        <div class="amt ${kind === "income" ? "income" : "expense"} num">${sign}${F.money(item.amount).replace("€", "").trim()} €</div>`;
    } else {
      row.innerHTML = `
        <button class="check ${item.done ? "done" : ""}" aria-label="${item.done ? "Marquer non fait" : (kind === "income" ? "Marquer reçu" : "Marquer payé")}">✓</button>
        <div class="body">
          <p class="t">${esc(item.name)}</p>
          <p class="s">${statusText}</p>
        </div>
        <div class="amt ${kind === "income" ? "income" : "expense"} num">${sign}${F.money(item.amount).replace("€", "").trim()} €</div>`;
      $(".check", row).addEventListener("click", () => {
        S.toggleRecurring(item._monthId || m.id, kind, item.id);
      });
    }
    return row;
  }

  // Utilisé uniquement dans le drill-down d'une catégorie (renderCatSummary) :
  // pas de puce d'icône, elle serait identique sur toutes les lignes de la liste.
  function txRow(m, t) {
    const row = el("div", "row");
    row.innerHTML = `
      <div class="body">
        <p class="t">${esc(t.description || t.category)}</p>
        <p class="s">${esc(t.category)} · ${F.fullDate(t.date)}</p>
      </div>
      <div class="amt ${t.type === "income" ? "income" : "expense"} num">${t.type === "income" ? "+" : "−"}${F.money(t.amount).replace("€", "").trim()} €</div>`;
    row.addEventListener("click", () => openTxModal(m.id, t));
    return row;
  }

  /* ---------- Résumé par catégorie ---------- */
  function renderCatSummary(m, view) {
    const totals = {};
    (m.expenses || []).forEach((e) => {
      totals[e.category] = (totals[e.category] || 0) + e.amount;
    });
    m.transactions.filter((t) => t.type === "expense").forEach((t) => {
      totals[t.category] = (totals[t.category] || 0) + t.amount;
    });
    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return;
    const totalExp = entries.reduce((s, [, v]) => s + v, 0);
    const sec = el("div", "section");
    sec.appendChild(sectionHead("Répartition des dépenses", null));
    const grid = el("div", "cat-grid");
    entries.forEach(([cat, amt]) => {
      const pct = Math.round((amt / totalExp) * 100);
      const card = el("div", "cat-card");
      card.style.cursor = "pointer";
      card.innerHTML = `
        <div class="cat-top">
          <span class="cat-emoji">${emojiFor(cat, "💸")}</span>
          <span class="cat-name">${esc(cat)}</span>
          <span class="cat-pct">${pct}%</span>
        </div>
        <div class="cat-amt num">${F.money(amt)}</div>
        <div class="cat-bar"><div class="cat-bar-fill" style="width:${pct}%"></div></div>`;
      card.addEventListener("click", () => {
        const recurring = (m.expenses || []).filter((e) => e.category === cat);
        const txs = m.transactions.filter((t) => t.type === "expense" && t.category === cat)
          .slice().sort((a, b) => b.date.localeCompare(a.date));
        const body = el("div");
        const list = el("div", "list");
        recurring.forEach((e) => list.appendChild(recurringRow(m, "expense", e)));
        txs.forEach((t) => list.appendChild(txRow(m, t)));
        body.appendChild(list);
        openModal(`${emojiFor(cat, "💸")} ${cat}`, body);
      });
      grid.appendChild(card);
    });
    sec.appendChild(grid);
    view.appendChild(sec);
  }

  /* ---------- Historique ---------- */
  function renderHistory(m) {
    const view = $("#view-history");
    view.innerHTML = "";
    const head = el("div", "section-head");
    head.style.marginTop = "4px";
    head.innerHTML = `<h2 class="section-title">Évolution — ${esc(m.label)}</h2>`;
    view.appendChild(head);

    const events = S.timeline(m.id);
    if (events.length <= 1 && m.transactions.length === 0) {
      view.appendChild(emptyState("📈", "L'historique se remplit dès que tu ajoutes des opérations."));
      return;
    }

    const tl = el("div", "timeline");
    events.forEach((ev) => {
      const row = el("div", "tl-row" + (ev.kind === "start" ? " start" : ""));
      const deltaHtml =
        ev.delta == null
          ? ""
          : `<div class="tl-delta ${ev.delta >= 0 ? "pos" : "neg"} num">${F.signed(ev.delta)}</div>`;
      row.innerHTML = `
        <div class="tl-date num">${ev.date ? F.dayMonth(ev.date) : ""}</div>
        <div class="tl-main">
          <p class="t">${esc(ev.label)}</p>
          ${ev.category ? `<p class="s">${esc(ev.category)}</p>` : ev.kind === "recurring" ? `<p class="s">Récurrent</p>` : ""}
        </div>
        <div class="tl-right">
          ${deltaHtml}
          <div class="tl-bal num">${F.money(ev.balance)}</div>
        </div>`;
      if (ev.kind === "transaction") {
        row.style.cursor = "pointer";
        row.addEventListener("click", () => openTxModal(m.id, m.transactions.find((t) => t.id === ev.id)));
      }
      tl.appendChild(row);
    });
    view.appendChild(tl);
  }

  /* ---------- Vue globale (toutes périodes) ---------- */
  function allTxSorted() {
    const st = S.getState();
    return st.months
      .flatMap((m) => m.transactions.map((t) => ({ ...t, _monthId: m.id })))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  function renderHomeAll() {
    const view = $("#view-home");
    view.innerHTML = "";
    const st = S.getState();
    const lastM = st.months[st.months.length - 1];
    const curBal = S.available(lastM);
    const allTx = st.months.flatMap((m) => m.transactions);
    const allExpenses = st.months.flatMap((m) => m.expenses.map((e) => ({ ...e, _monthId: m.id })));
    const allIncomes = st.months.flatMap((m) => m.incomes);
    const totalInc = allIncomes.reduce((s, i) => s + i.amount, 0)
      + allTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const totalExp = allExpenses.reduce((s, e) => s + e.amount, 0)
      + allTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);

    const hero = el("div", "hero " + (curBal < 0 ? "low" : "ok"));
    hero.innerHTML = `
      <p class="hero-label">Solde actuel</p>
      <p class="hero-amount num">${F.money(curBal)}</p>
      <p class="hero-note"><span class="dot"></span>Toutes périodes confondues</p>`;
    view.appendChild(hero);

    const stats = el("div", "substats");
    stats.innerHTML = `
      <div class="stat"><p class="k">Total revenus</p><p class="v num income">${F.money(totalInc)}</p></div>
      <div class="stat"><p class="k">Total dépenses</p><p class="v num">${F.money(totalExp)}</p></div>`;
    view.appendChild(stats);

    // Évolution jour par jour, toutes périodes enchaînées
    const dailySec = dailyChartSection(allDailySeries());
    if (dailySec) view.appendChild(dailySec);

    renderCatSummary({ transactions: allTx, expenses: allExpenses }, view);
  }

  function renderHistoryAll() {
    const view = $("#view-history");
    view.innerHTML = "";
    const st = S.getState();
    const period = st.months.length === 1
      ? st.months[0].label
      : `${st.months[0].label} → ${st.months[st.months.length - 1].label}`;

    const head = el("div", "section-head");
    head.style.marginTop = "4px";
    head.innerHTML = `<h2 class="section-title">Évolution — ${esc(period)}</h2>`;
    view.appendChild(head);

    const hasAny = st.months.some((m) => m.transactions.length > 0 || m.incomes.some((i) => i.done) || m.expenses.some((e) => e.done));
    if (!hasAny) {
      view.appendChild(emptyState("📈", "L'historique se remplit dès que tu ajoutes des opérations."));
      return;
    }

    const tl = el("div", "timeline");
    st.months.forEach((m, idx) => {
      if (idx > 0) {
        const sep = el("div", "tl-month-sep");
        sep.textContent = m.label;
        tl.appendChild(sep);
      }
      S.timeline(m.id).forEach((ev) => {
        const row = el("div", "tl-row" + (ev.kind === "start" ? " start" : ""));
        const deltaHtml = ev.delta == null
          ? ""
          : `<div class="tl-delta ${ev.delta >= 0 ? "pos" : "neg"} num">${F.signed(ev.delta)}</div>`;
        row.innerHTML = `
          <div class="tl-date num">${ev.date ? F.dayMonth(ev.date) : ""}</div>
          <div class="tl-main">
            <p class="t">${esc(ev.label)}</p>
            ${ev.category ? `<p class="s">${esc(ev.category)}</p>` : ev.kind === "recurring" ? `<p class="s">Récurrent</p>` : ""}
          </div>
          <div class="tl-right">
            ${deltaHtml}
            <div class="tl-bal num">${F.money(ev.balance)}</div>
          </div>`;
        if (ev.kind === "transaction") {
          row.style.cursor = "pointer";
          row.addEventListener("click", () => openTxModal(m.id, m.transactions.find((t) => t.id === ev.id)));
        }
        tl.appendChild(row);
      });
    });
    view.appendChild(tl);
  }

  /* ---------- Graphe d'évolution (solde jour par jour) ---------- */

  // Nombre de jours dans un mois "Juillet 2026" (null si libellé non standard)
  function daysInMonthFor(label) {
    const parts = (label || "").trim().split(" ");
    const idx = MONTHS_FR_APP.indexOf(parts[0]);
    const year = parseInt(parts[1], 10);
    if (idx === -1 || isNaN(year)) return null;
    return new Date(year, idx + 1, 0).getDate();
  }

  // Jusqu'à quel jour du mois on a de l'information : tout le mois s'il est
  // passé, jusqu'à aujourd'hui s'il est en cours, rien s'il est futur.
  function monthCutoffDay(m) {
    const total = daysInMonthFor(m.label);
    if (total == null) return null;
    const parts = m.label.trim().split(" ");
    const idx = MONTHS_FR_APP.indexOf(parts[0]);
    const year = parseInt(parts[1], 10);
    const now = new Date();
    const curY = now.getFullYear(), curM = now.getMonth(), curD = now.getDate();
    if (year < curY || (year === curY && idx < curM)) return total;
    if (year === curY && idx === curM) return curD;
    return 0;
  }

  // Série {x: jour du mois, value: solde} un point par jour connu.
  // Chaque mouvement "fait" compte dès aujourd'hui même si daté plus tard
  // (le store les compte déjà dans le solde, peu importe la date) — le
  // dernier point colle donc toujours au "Solde du compte" affiché.
  function monthDailySeries(m) {
    const cutoff = monthCutoffDay(m);
    if (cutoff == null || cutoff < 1) return [];
    const parts = m.label.trim().split(" ");
    const monthIdx = MONTHS_FR_APP.indexOf(parts[0]);
    const year = parseInt(parts[1], 10);
    const iso = (d) => `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

    // Jour 0 = veille du 1er (dernier jour du mois précédent), pour un
    // libellé d'axe cohérent avec les autres points de la série.
    const prevMonthIdx = monthIdx === 0 ? 11 : monthIdx - 1;
    const prevYear = monthIdx === 0 ? year - 1 : year;
    const prevLastDay = new Date(prevYear, prevMonthIdx + 1, 0).getDate();
    const day0Iso = `${prevYear}-${String(prevMonthIdx + 1).padStart(2, "0")}-${String(prevLastDay).padStart(2, "0")}`;

    const clamp = (d) => Math.min(Math.max(d, 1), cutoff);
    const events = [];
    m.incomes.filter((i) => i.done).forEach((i) => events.push({ day: clamp(i.day || 1), delta: i.amount }));
    m.expenses.filter((e) => e.done).forEach((e) => events.push({ day: clamp(e.day || 1), delta: -e.amount }));
    m.transactions.forEach((t) => {
      const d = parseInt((t.date || "").slice(8, 10), 10) || 1;
      events.push({ day: clamp(d), delta: t.type === "income" ? t.amount : -t.amount });
    });
    events.sort((a, b) => a.day - b.day);

    let running = m.initialBalance;
    let ei = 0;
    const series = [{ x: 0, value: running, date: day0Iso }];
    for (let d = 1; d <= cutoff; d++) {
      while (ei < events.length && events[ei].day <= d) { running += events[ei].delta; ei++; }
      series.push({ x: d, value: running, date: iso(d) });
    }
    return series;
  }

  // Série continue sur toutes les périodes (jour par jour, mois enchaînés)
  function allDailySeries() {
    const st = S.getState();
    const points = [];
    let xOffset = 0;
    for (const m of st.months) {
      const cutoff = monthCutoffDay(m);
      if (cutoff === 0) break; // mois futur : la courbe s'arrête ici
      if (cutoff != null) {
        monthDailySeries(m).forEach((p) => points.push({ x: xOffset + p.x, value: p.value, date: p.date }));
      }
      xOffset += daysInMonthFor(m.label) || 30;
    }
    return points;
  }

  // "Nombres ronds" pour des ticks d'axe lisibles (algorithme de Heckbert)
  function niceNum(range, round) {
    if (range <= 0) return 1;
    const exponent = Math.floor(Math.log10(range));
    const fraction = range / Math.pow(10, exponent);
    let niceFraction;
    if (round) {
      if (fraction < 1.5) niceFraction = 1;
      else if (fraction < 3) niceFraction = 2;
      else if (fraction < 7) niceFraction = 5;
      else niceFraction = 10;
    } else {
      if (fraction <= 1) niceFraction = 1;
      else if (fraction <= 2) niceFraction = 2;
      else if (fraction <= 5) niceFraction = 5;
      else niceFraction = 10;
    }
    return niceFraction * Math.pow(10, exponent);
  }

  // Ticks d'axe adaptés à l'amplitude réelle de [min, max]
  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const step = niceNum(niceNum(max - min, false) / Math.max(count - 1, 1), true);
    const niceMin = Math.floor(min / step) * step;
    const niceMax = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
    return ticks;
  }

  function nearestPoint(points, xv) {
    let best = points[0], bestDist = Math.abs(points[0].x - xv);
    for (let i = 1; i < points.length; i++) {
      const d = Math.abs(points[i].x - xv);
      if (d < bestDist) { best = points[i]; bestDist = d; }
    }
    return best;
  }

  function axisMoney(v) {
    return Math.round(v).toLocaleString("fr-FR") + " €";
  }

  // Courbe lissée (Catmull-Rom → Bézier) passant par les points pixel donnés
  function smoothPath(pix) {
    if (pix.length < 2) return "";
    let d = `M ${pix[0][0].toFixed(1)} ${pix[0][1].toFixed(1)}`;
    for (let i = 0; i < pix.length - 1; i++) {
      const p0 = pix[i - 1] || pix[i];
      const p1 = pix[i];
      const p2 = pix[i + 1];
      const p3 = pix[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  }

  // Construit la section "Évolution" : ligne lissée, verte au-dessus de 0,
  // rouge en dessous, avec deux axes adaptés à l'amplitude réelle des
  // données (montant en ordonnée, jours en abscisse) — sans points ni légende.
  function dailyChartSection(points) {
    if (points.length < 2) return null;
    const W = 300, H = 120;
    const xs = points.map((p) => p.x);
    const minX = xs[0], maxX = xs[xs.length - 1];
    const spanX = maxX - minX || 1;

    // Domaine des valeurs : basé sur les données réelles (+ le zéro, toujours visible)
    const rawValues = points.map((p) => p.value).concat([0]);
    const dataMinV = Math.min(...rawValues);
    const dataMaxV = Math.max(...rawValues);
    const rangeV = dataMaxV - dataMinV;
    const padV = (rangeV || 100) * 0.15;
    const minV = dataMinV - padV;
    const maxV = dataMaxV + padV;

    const xFor = (x) => ((x - minX) / spanX) * W;
    const yFor = (v) => H - ((v - minV) / (maxV - minV)) * H;
    const zeroY = Math.max(0, Math.min(H, yFor(0)));

    const path = smoothPath(points.map((p) => [xFor(p.x), yFor(p.value)]));

    // Ticks adaptatifs : amplitude réelle des montants pour l'ordonnée,
    // étendue de jours affichée pour l'abscisse.
    const yTicks = niceTicks(dataMinV, dataMaxV, 4).filter((v) => v >= minV && v <= maxV);
    const xTicks = niceTicks(minX, maxX, 5).filter((v) => v >= minX && v <= maxX);

    const gridLines = yTicks.map((v) => {
      const y = yFor(v).toFixed(1);
      return `<line x1="0" y1="${y}" x2="${W}" y2="${y}" class="daily-grid" />`;
    }).join("");

    const svg = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="daily-chart-svg">
        ${gridLines}
        <defs>
          <clipPath id="dcClipPos"><rect x="0" y="0" width="${W}" height="${zeroY.toFixed(1)}" /></clipPath>
          <clipPath id="dcClipNeg"><rect x="0" y="${zeroY.toFixed(1)}" width="${W}" height="${(H - zeroY).toFixed(1)}" /></clipPath>
        </defs>
        <path d="${path}" class="daily-line pos" clip-path="url(#dcClipPos)" />
        <path d="${path}" class="daily-line neg" clip-path="url(#dcClipNeg)" />
      </svg>`;

    // Les libellés d'axe sont des <span> HTML positionnés en % par-dessus le
    // SVG (et non du texte SVG) : le SVG est étiré en non-uniforme
    // (preserveAspectRatio="none") pour remplir la carte, ce qui déformerait
    // du texte dessiné dedans. Le positionnement en % reste correct car il
    // suit la même fraction 0..1 que le tracé, quelle que soit la déformation.
    const box = el("div", "daily-chart-box");
    box.innerHTML = svg;

    yTicks.forEach((v) => {
      const lbl = el("span", "daily-y-tick", esc(axisMoney(v)));
      lbl.style.top = ((yFor(v) / H) * 100) + "%";
      box.appendChild(lbl);
    });

    xTicks.forEach((xv) => {
      const p = nearestPoint(points, xv);
      const text = p && p.date ? F.dayMonth(p.date) : String(Math.round(xv));
      const lbl = el("span", "daily-x-tick", esc(text));
      lbl.style.left = ((xFor(xv) / W) * 100) + "%";
      box.appendChild(lbl);
    });

    const sec = el("div", "section");
    sec.appendChild(sectionHead("Évolution", null));
    const card = el("div", "daily-chart-card");
    card.appendChild(box);
    sec.appendChild(card);
    return sec;
  }

  /* ---------- Mois ---------- */
  function renderMonths() {
    const view = $("#view-months");
    view.innerHTML = "";
    const st = S.getState();

    const prev = el("button", "btn-ghost");
    prev.innerHTML = `<span class="plus">←</span> Créer un mois précédent`;
    prev.style.marginBottom = "10px";
    prev.addEventListener("click", () => {
      const first = st.months[0];
      const label = S.prevMonthLabel(first.label);
      if (confirm(`Créer « ${label} » avant ${first.label} ?\n\nLe solde de départ de ${label} sera réglé à ${F.money(first.initialBalance)} — tu pourras l'ajuster dans Réglages une fois dessus.`)) {
        S.goToPreviousMonth();
        switchView("home");
      }
    });
    view.appendChild(prev);

    const next = el("button", "btn-primary");
    next.innerHTML = `<span class="plus">→</span> Passer au mois suivant`;
    next.addEventListener("click", () => {
      const last = st.months[st.months.length - 1];
      const label = S.nextMonthLabel(last.label);
      if (confirm(`Créer « ${label} » ?\nSolde de départ : ${F.money(S.available(last))}\nLes revenus et dépenses récurrents seront appliqués automatiquement.`)) {
        S.goToNextMonth();
        switchView("home");
      }
    });
    view.appendChild(next);

    // Carte "Depuis le début"
    const lastM = st.months[st.months.length - 1];
    const allTx = st.months.flatMap((m) => m.transactions);
    const totalInc = allTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const totalExp = allTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const curBal = S.available(lastM);
    const period = st.months.length === 1
      ? st.months[0].label
      : `${st.months[0].label} → ${lastM.label}`;
    const totalCard = el("div", "month-card total-card" + (viewAll ? " current" : ""));
    totalCard.style.cursor = "pointer";
    totalCard.innerHTML = `
      <div style="width:100%">
        <p class="ml">Depuis le début <span class="ms" style="margin-left:6px">${esc(period)}</span></p>
        <div class="total-grid">
          <div><p class="ms">Solde actuel</p><p class="mv num ${curBal < 0 ? "neg" : ""}">${F.money(curBal)}</p></div>
          <div><p class="ms">Total revenus</p><p class="mv num income">${F.money(totalInc)}</p></div>
          <div><p class="ms">Total dépenses</p><p class="mv num expense">${F.money(totalExp)}</p></div>
        </div>
      </div>`;
    totalCard.addEventListener("click", () => {
      viewAll = true;
      render();
    });
    view.appendChild(totalCard);

    const sec = el("div", "section");
    const list = el("div", "list");
    const todayLabel = realMonthLabel();
    st.months.slice().reverse().forEach((m) => {
      const c = S.computed(m);
      const isCur = m.id === st.currentMonthId && !viewAll;
      const isToday = m.label === todayLabel;
      const card = el("div", "month-card" + (isCur ? " current" : ""));
      const badges = isToday ? '<span class="badge-today">Aujourd\'hui</span>' : "";
      card.innerHTML = `
        <div>
          <p class="ml">${esc(m.label)}${badges}</p>
          <p class="ms">${m.transactions.length} opération(s)</p>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <div>
            <p class="mv num ${c.available < 0 ? "neg" : ""}">${F.money(c.available)}</p>
            <p class="ms" style="text-align:right">disponible</p>
          </div>
          <button class="icon-btn" data-act="menu" aria-label="Options">⋯</button>
        </div>`;
      card.addEventListener("click", (e) => {
        if (e.target.closest('[data-act="menu"]')) {
          openMonthMenu(m);
        } else {
          viewAll = false;
          S.setCurrentMonth(m.id);
        }
      });
      list.appendChild(card);
    });
    sec.appendChild(list);
    view.appendChild(sec);
  }

  function openMonthMenu(m) {
    const st = S.getState();
    const body = el("div");
    const rename = el("button", "btn-ghost");
    rename.textContent = "Renommer ce mois";
    rename.style.marginBottom = "10px";
    rename.addEventListener("click", () => {
      const v = prompt("Nom du mois :", m.label);
      if (v) { S.renameMonth(m.id, v); closeModal(); }
    });
    body.appendChild(rename);

    if (st.months.length > 1) {
      const del = el("button", "btn-danger-ghost");
      del.textContent = "Supprimer ce mois";
      del.addEventListener("click", () => {
        if (confirm(`Supprimer « ${m.label} » ? Les mois suivants seront re-calculés.`)) {
          S.deleteMonth(m.id);
          closeModal();
        }
      });
      body.appendChild(del);
    }
    openModal(m.label, body);
  }

  function ghStatusText(s) {
    if (s.syncing) return "Sauvegarde en cours…";
    if (s.lastError) return "Échec : " + s.lastError;
    if (s.lastSync) {
      const d = new Date(s.lastSync);
      const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      return `Dernière sauvegarde réussie : ${F.fullDate(s.lastSync.slice(0, 10))} à ${time}`;
    }
    return "Aucune sauvegarde effectuée pour l'instant.";
  }

  /* ---------- Réglages ---------- */

  // Petite barre "‹ Réglages   Titre   [Action]" en haut d'un sous-écran
  function subSettingsHead(title, actionLabel, onAction) {
    const head = el("div", "settings-subhead");
    const back = el("button", "settings-back", "‹ Réglages");
    back.addEventListener("click", () => { settingsSubview = null; renderSettings(); });
    head.appendChild(back);
    head.appendChild(el("h2", "section-title", esc(title)));
    if (actionLabel) {
      const btn = el("button", "section-action", esc(actionLabel));
      btn.addEventListener("click", onAction);
      head.appendChild(btn);
    }
    return head;
  }

  // Ligne de navigation vers un sous-écran (façon "Réglages" iOS)
  function settingsNavRow(title, onClick) {
    const row = el("div", "row");
    row.style.cursor = "pointer";
    row.innerHTML = `<div class="body"><p class="t">${esc(title)}</p></div><span class="chevron">›</span>`;
    row.addEventListener("click", onClick);
    return row;
  }

  function renderSettings() {
    const view = $("#view-settings");
    view.innerHTML = "";
    if (settingsSubview === "categories") return renderSettingsCategories(view);
    if (settingsSubview === "backup") return renderSettingsBackup(view);
    if (settingsSubview === "balance") return renderSettingsBalance(view);
    renderSettingsRoot(view);
  }

  // Écran racine : uniquement des lignes de navigation, triées par fréquence
  // d'usage — "Solde de départ" (touché une fois, à la mise en place) en dernier.
  function renderSettingsRoot(view) {
    const nav = el("div", "section");
    nav.style.marginTop = "4px";
    const list = el("div", "list");
    list.appendChild(settingsNavRow("Catégories", () => { settingsSubview = "categories"; renderSettings(); }));
    list.appendChild(settingsNavRow("Sauvegarde & données", () => { settingsSubview = "backup"; renderSettings(); }));
    list.appendChild(settingsNavRow("Solde de départ", () => { settingsSubview = "balance"; renderSettings(); }));
    nav.appendChild(list);
    view.appendChild(nav);
  }

  function renderSettingsBalance(view) {
    const st = S.getState();
    view.appendChild(subSettingsHead("Solde de départ", "Modifier", () => {
      const v = prompt("Solde de départ du tout premier mois (€) :", st.months[0].initialBalance);
      if (v != null && v !== "") { S.setInitialBalance(parseFloat(v.replace(",", ".")) || 0); renderSettings(); }
    }));
    const help = el("p", "empty");
    help.style.cssText = "padding:0 2px 14px;text-align:left;font-size:12.5px";
    help.textContent = "Point de départ de tous les calculs — à ne régler qu'une seule fois, à la mise en place.";
    view.appendChild(help);
    const balRow = el("div", "row");
    balRow.innerHTML = `<div class="body"><p class="t">${esc(st.months[0].label)}</p><p class="s">Point de départ de tous les calculs</p></div><div class="amt num">${F.money(st.months[0].initialBalance)}</div>`;
    view.appendChild(balRow);
  }

  function renderSettingsCategories(view) {
    const st = S.getState();
    view.appendChild(subSettingsHead("Catégories", "Ajouter", () => {
      const body = el("div");
      body.innerHTML = `
        <div class="field-row">
          <div class="field" style="max-width:72px">
            <label>Emoji</label>
            <input id="cat-emoji" type="text" placeholder="🏷️" style="font-size:22px;text-align:center;padding:10px 6px">
          </div>
          <div class="field">
            <label>Nom</label>
            <input id="cat-name" type="text" placeholder="Ex : Santé, Voyage…">
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-primary" id="cat-save">Ajouter</button>
        </div>`;
      openModal("Nouvelle catégorie", body);
      setTimeout(() => $("#cat-emoji", body).focus(), 60);
      $("#cat-save", body).addEventListener("click", () => {
        const name = $("#cat-name", body).value.trim();
        const emoji = $("#cat-emoji", body).value.trim();
        if (!name) { $("#cat-name", body).focus(); return; }
        S.addCategory(name, emoji);
        closeModal();
      });
    }));
    const catList = el("div", "list");
    st.categories.forEach((cat) => {
      const row = el("div", "row");
      row.innerHTML = `<div class="chip">${emojiFor(cat, "🏷️")}</div><div class="body"><p class="t">${esc(cat)}</p></div><button class="icon-btn" aria-label="Supprimer">✕</button>`;
      $(".icon-btn", row).addEventListener("click", () => {
        if (confirm(`Supprimer la catégorie « ${cat} » ?`)) S.deleteCategory(cat);
      });
      catList.appendChild(row);
    });
    view.appendChild(catList);
  }

  function renderSettingsBackup(view) {
    view.appendChild(subSettingsHead("Sauvegarde & données", null));

    // Sauvegarde GitHub (optionnelle, 100% manuelle)
    const ghSec = el("div", "section");
    ghSec.style.marginTop = "0";
    ghSec.appendChild(sectionHead("Sauvegarde GitHub", null));
    const hasGhToken = !!S.getGhToken();

    if (!hasGhToken || ghEditToken) {
      const ghField = el("div", "field");
      ghField.innerHTML = `
        <label>Token GitHub</label>
        <input id="gh-token" type="password" placeholder="Colle ton token ici" value="${esc(S.getGhToken())}">`;
      ghSec.appendChild(ghField);
      const ghHelp = el("p", "empty");
      ghHelp.style.cssText = "padding:2px 2px 10px;text-align:left;font-size:12.5px";
      ghHelp.innerHTML = `Nécessaire une seule fois. Crée-le sur <a class="settings-link" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a> → limite-le au repo <strong>budget-etudiant-backup</strong>, permission "Contents: Read and write".`;
      ghSec.appendChild(ghHelp);
      const ghSaveBtn = el("button", "btn-ghost");
      ghSaveBtn.textContent = "Enregistrer le token";
      ghSaveBtn.style.marginBottom = "10px";
      ghSaveBtn.addEventListener("click", () => {
        S.setGhToken($("#gh-token", ghSec).value.trim());
        ghEditToken = false;
        renderSettings();
      });
      ghSec.appendChild(ghSaveBtn);
    } else {
      const ghTokenRow = el("div", "row");
      ghTokenRow.innerHTML = `<div class="body"><p class="t">Token GitHub configuré ✓</p></div>`;
      const changeBtn = el("button", "section-action", "Changer");
      changeBtn.addEventListener("click", () => { ghEditToken = true; renderSettings(); });
      ghTokenRow.appendChild(changeBtn);
      ghTokenRow.style.marginBottom = "10px";
      ghSec.appendChild(ghTokenRow);
    }

    const ghBackupBtn = el("button", "btn-ghost");
    ghBackupBtn.textContent = "☁️ Sauvegarder maintenant sur GitHub";
    ghBackupBtn.style.marginBottom = "10px";
    ghBackupBtn.addEventListener("click", async () => {
      if (!S.getGhToken()) { alert("Colle et enregistre d'abord ton token GitHub ci-dessus."); return; }
      ghBackupBtn.disabled = true;
      ghBackupBtn.textContent = "☁️ Sauvegarde en cours…";
      await S.ghSyncNow();
      renderSettings();
    });
    ghSec.appendChild(ghBackupBtn);

    const ghRestoreBtn = el("button", "btn-ghost");
    ghRestoreBtn.textContent = "📥 Restaurer depuis GitHub";
    ghRestoreBtn.style.marginBottom = "10px";
    ghRestoreBtn.addEventListener("click", async () => {
      if (!S.getGhToken()) { alert("Colle et enregistre d'abord ton token GitHub ci-dessus."); return; }
      if (!confirm("Restaurer la dernière sauvegarde GitHub ? Les données actuelles seront remplacées.")) return;
      ghRestoreBtn.disabled = true;
      const res = await S.ghRestoreLatest();
      ghRestoreBtn.disabled = false;
      if (res.ok) { alert("Restauration réussie !"); switchView("home"); }
      else alert("Erreur : " + (res.error || "impossible de restaurer"));
    });
    ghSec.appendChild(ghRestoreBtn);

    const ghStatusP = el("p", "empty", esc(ghStatusText(S.getGhStatus())));
    ghStatusP.style.cssText = "padding:0 2px 4px;text-align:left;font-size:12.5px";
    ghSec.appendChild(ghStatusP);
    view.appendChild(ghSec);

    // Sauvegarde locale (fichier)
    const dataSec = el("div", "section");
    dataSec.appendChild(sectionHead("Sauvegarde locale", null));
    const exportBtn = el("button", "btn-ghost");
    exportBtn.textContent = "📤 Exporter / sauvegarder mes données";
    exportBtn.style.marginBottom = "10px";
    exportBtn.addEventListener("click", () => {
      const json = S.exportData();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      a.href = url;
      a.download = `budget-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
    dataSec.appendChild(exportBtn);

    const restoreBtn = el("button", "btn-ghost");
    restoreBtn.textContent = "📥 Restaurer depuis une sauvegarde";
    restoreBtn.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (!confirm("Restaurer cette sauvegarde ? Les données actuelles seront remplacées.")) return;
          const ok = S.importData(ev.target.result);
          if (ok) {
            alert("Restauration réussie !");
            switchView("home");
          } else {
            alert("Erreur : fichier invalide ou corrompu.");
          }
        };
        reader.readAsText(file);
      });
      input.click();
    });
    dataSec.appendChild(restoreBtn);
    view.appendChild(dataSec);

    // Zone dangereuse
    const dangerSec = el("div", "section");
    dangerSec.appendChild(sectionHead("Zone dangereuse", null));
    const reset = el("button", "btn-danger-ghost");
    reset.textContent = "Tout réinitialiser";
    reset.addEventListener("click", () => {
      if (confirm("Effacer toutes les données ? Cette action est irréversible.")) {
        S.reset();
        switchView("home");
      }
    });
    dangerSec.appendChild(reset);
    const note = el("p", "empty");
    note.style.padding = "14px 4px 0";
    note.innerHTML = `<p style="margin:0">Tes données restent sur cet appareil (hors ligne). Aucune connexion bancaire.</p>`;
    dangerSec.appendChild(note);
    view.appendChild(dangerSec);
  }

  function recurringSection(title, kind, items) {
    const sec = el("div", "section");
    sec.appendChild(sectionHead(title, "Ajouter", () => openRecurringModal(kind)));
    if (items.length) {
      const list = el("div", "list");
      items.forEach((it) => {
        const row = el("div", "row");
        row.innerHTML = `
          <div class="chip">${emojiFor(it.name, kind === "income" ? "💰" : "📄")}</div>
          <div class="body"><p class="t">${esc(it.name)}</p><p class="s">Chaque mois${it.day ? ` · le ${it.day} (auto)` : " · Manuel"}</p></div>
          <div class="amt ${kind === "income" ? "income" : "expense"} num">${kind === "income" ? "+" : "−"}${F.money(it.amount).replace("€", "").trim()} €</div>`;
        row.addEventListener("click", () => openRecurringModal(kind, it));
        list.appendChild(row);
      });
      sec.appendChild(list);
    } else {
      sec.appendChild(emptyState(kind === "income" ? "💰" : "📄", `Aucun ${kind === "income" ? "revenu" : "e dépense"} récurrent${kind === "income" ? "" : "e"}. Ajoute ${kind === "income" ? "ton salaire, une aide…" : "loyer, internet…"}`));
    }
    return sec;
  }

  /* ---------- helpers de section ---------- */
  function sectionHead(title, actionLabel, onAction) {
    const head = el("div", "section-head");
    head.appendChild(el("h2", "section-title", esc(title)));
    if (actionLabel) {
      const b = el("button", "section-action", esc(actionLabel));
      b.addEventListener("click", onAction);
      head.appendChild(b);
    }
    return head;
  }
  function emptyState(emoji, text) {
    return el("div", "empty", `<div class="em-emoji">${emoji}</div><p>${esc(text)}</p>`);
  }

  /* ================= MODALES ================= */
  const backdrop = () => $("#modalBackdrop");
  const modalRoot = () => $("#modalRoot");

  function openModal(title, bodyNode) {
    modalRoot().innerHTML = "";
    const head = el("div", "modal-head");
    head.innerHTML = `<h3 class="modal-title">${esc(title)}</h3>`;
    const close = el("button", "modal-close", "✕");
    close.addEventListener("click", closeModal);
    head.appendChild(close);
    modalRoot().appendChild(head);
    modalRoot().appendChild(bodyNode);
    backdrop().classList.add("open");
  }
  function closeModal() {
    backdrop().classList.remove("open");
  }

  // Modale ajout / édition d'une transaction
  function openTxModal(monthId, existing) {
    const st = S.getState();
    let type = existing ? existing.type : "expense";

    const body = el("div");
    body.innerHTML = `
      <div class="segment">
        <button data-type="expense">Dépense</button>
        <button data-type="income">Revenu</button>
      </div>
      <div class="field amount">
        <label>Montant</label>
        <input id="f-amount" type="text" inputmode="decimal" placeholder="0,00" value="${existing ? existing.amount : ""}">
      </div>
      <div class="field">
        <label>Date</label>
        <input id="f-date" type="date" value="${existing ? existing.date : F.todayISO()}">
      </div>
      <div class="field">
        <label>Catégorie</label>
        <select id="f-cat">${st.categories.map((c) => `<option ${existing && existing.category === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label>Description (facultatif)</label>
        <input id="f-desc" type="text" placeholder="Ex : resto avec les potes" value="${existing ? esc(existing.description) : ""}">
      </div>
      <div class="modal-actions">
        ${existing ? '<button class="btn-delete" id="f-del">Supprimer</button>' : ""}
        <button class="btn-primary" id="f-save">${existing ? "Enregistrer" : "Ajouter"}</button>
      </div>`;

    openModal(existing ? "Modifier l'opération" : "Nouvelle opération", body);

    const segBtns = body.querySelectorAll(".segment button");
    const syncSeg = () => segBtns.forEach((b) => b.classList.toggle("active", b.dataset.type === type));
    segBtns.forEach((b) => b.addEventListener("click", () => { type = b.dataset.type; syncSeg(); }));
    syncSeg();

    setTimeout(() => $("#f-amount", body).focus(), 60);

    $("#f-save", body).addEventListener("click", () => {
      const amount = parseFloat(($("#f-amount", body).value || "").replace(",", "."));
      if (!amount || amount <= 0) { $("#f-amount", body).focus(); return; }
      const tx = {
        type,
        amount,
        date: $("#f-date", body).value || F.todayISO(),
        category: $("#f-cat", body).value,
        description: $("#f-desc", body).value.trim(),
      };
      if (existing) S.updateTransaction(monthId, existing.id, tx);
      else S.addTransaction(monthId, tx);
      closeModal();
    });

    if (existing) {
      $("#f-del", body).addEventListener("click", () => {
        S.deleteTransaction(monthId, existing.id);
        closeModal();
      });
    }
  }

  // Modale ajout / édition d'un récurrent
  function openRecurringModal(kind, existing) {
    const st = S.getState();
    const catOptions = st.categories.map((c) =>
      `<option ${existing && existing.category === c ? "selected" : ((!existing && c === "Autre") ? "selected" : "")}>${esc(c)}</option>`
    ).join("");
    const body = el("div");
    body.innerHTML = `
      <div class="field">
        <label>Nom</label>
        <input id="r-name" type="text" placeholder="${kind === "income" ? "Ex : Salaire, argent parents" : "Ex : Loyer, internet"}" value="${existing ? esc(existing.name) : ""}">
      </div>
      <div class="field amount">
        <label>Montant / mois</label>
        <input id="r-amount" type="text" inputmode="decimal" placeholder="0,00" value="${existing ? existing.amount : ""}">
      </div>
      <div class="field">
        <label>Catégorie</label>
        <select id="r-cat">${catOptions}</select>
      </div>
      <div class="field">
        <label>Jour du mois (optionnel)</label>
        <input id="r-day" type="number" inputmode="numeric" min="1" max="31" placeholder="— laisser vide pour cocher manuellement —" value="${existing && existing.day ? existing.day : ""}">
      </div>
      <p class="empty" style="padding:2px 2px 10px;text-align:left;font-size:12.5px">Si tu indiques un jour (ex : 5), le paiement sera validé automatiquement ce jour-là. Sinon, coche-le manuellement quand il tombe.</p>
      <p class="empty" style="padding:2px 2px 10px;text-align:left;font-size:12.5px">La modification s'applique à ce mois et aux suivants. Les mois passés ne changent pas.</p>
      <div class="modal-actions">
        ${existing ? '<button class="btn-delete" id="r-del">Supprimer</button>' : ""}
        <button class="btn-primary" id="r-save">${existing ? "Enregistrer" : "Ajouter"}</button>
      </div>`;
    openModal(
      (existing ? "Modifier " : "Nouveau ") + (kind === "income" ? "revenu récurrent" : "dépense récurrente"),
      body
    );
    setTimeout(() => $("#r-name", body).focus(), 60);

    $("#r-save", body).addEventListener("click", () => {
      const name = $("#r-name", body).value.trim();
      const amount = parseFloat(($("#r-amount", body).value || "").replace(",", "."));
      if (!name) { $("#r-name", body).focus(); return; }
      if (!amount || amount <= 0) { $("#r-amount", body).focus(); return; }
      const dayVal = parseInt($("#r-day", body).value, 10);
      const day = dayVal >= 1 && dayVal <= 31 ? dayVal : null;
      const category = $("#r-cat", body).value;
      if (existing) S.updateRecurring(kind, existing.id, { name, amount, day, category });
      else S.addRecurring(kind, name, amount, day, category);
      closeModal();
    });
    if (existing) {
      $("#r-del", body).addEventListener("click", () => {
        if (confirm(`Supprimer « ${existing.name} » des récurrents ?`)) {
          S.deleteRecurring(kind, existing.id);
          closeModal();
        }
      });
    }
  }

  // Sélecteur de mois depuis la pastille d'en-tête
  function openMonthPicker() {
    const st = S.getState();
    const body = el("div", "list");
    st.months.slice().reverse().forEach((m) => {
      const isCur = m.id === st.currentMonthId;
      const row = el("button", "month-card" + (isCur ? " current" : ""));
      row.style.width = "100%";
      row.style.textAlign = "left";
      row.innerHTML = `<div><p class="ml">${esc(m.label)}${isCur ? '<span class="badge-current">Actuel</span>' : ""}</p></div><p class="mv num ${S.available(m) < 0 ? "neg" : ""}">${F.money(S.available(m))}</p>`;
      row.addEventListener("click", () => { S.setCurrentMonth(m.id); closeModal(); });
      body.appendChild(row);
    });
    openModal("Choisir un mois", body);
  }

  /* ================= NAVIGATION ================= */
  function switchView(name) {
    if (name !== "settings") settingsSubview = null; // repart de la racine au prochain passage
    currentView = name;
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    $("#view-" + name).classList.add("active");
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    window.scrollTo({ top: 0, behavior: "auto" });
    render();
  }

  /* ================= INIT ================= */
  function init() {
    S.init();
    S.subscribe(render);

    document.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("click", () => switchView(t.dataset.view))
    );
    backdrop().addEventListener("click", (e) => {
      if (e.target === backdrop()) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });

    switchView("home");

    // PWA : enregistrement du service worker si servi via http(s)
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})(window.Budget = window.Budget || {});
