/* store.js — état de l'application, persistance et logique métier.
 *
 * Modèle mental
 * -------------
 * Chaque mois est une "enveloppe" indépendante qui contient un instantané
 * (snapshot) des revenus et dépenses récurrents au moment de sa création.
 * Modifier un récurrent n'affecte donc jamais les mois déjà passés.
 *
 * Deux montants sont exposés à l'écran :
 *   - solde du compte  : l'argent réellement présent (récurrents "faits" only)
 *   - argent disponible: ce qu'on peut dépenser sans compromettre le reste
 *
 * Propriété clé : "argent disponible" ne dépend PAS des cases cochées.
 *   disponible = soldeInitial + tousRevenus - toutesDépenses +/- transactions
 * Cocher un loyer comme payé déplace juste de l'argent entre "compte" et
 * "restant à payer", sans changer le disponible. Le chiffre reste fiable même
 * si l'utilisateur ne coche jamais rien.
 */
(function (Budget) {
  "use strict";

  const STORAGE_KEY = "budget-etudiant.v1";

  const DEFAULT_CATEGORIES = [
    "Restaurant",
    "Courses",
    "Transport",
    "Loisir",
    "Achat perso",
    "Matériel photo",
    "Prêt",
    "Autre",
  ];

  let state = null;
  const listeners = [];

  /* ---------- utilitaires ---------- */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function sum(list, pick) {
    return list.reduce((t, item) => t + (pick(item) || 0), 0);
  }

  const MONTHS_FR = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ];

  function currentMonthLabel() {
    const now = new Date();
    return `${MONTHS_FR[now.getMonth()]} ${now.getFullYear()}`;
  }

  // Devine le mois suivant à partir d'un libellé "Juillet 2026"
  function nextMonthLabel(label) {
    const parts = (label || "").trim().split(" ");
    const idx = MONTHS_FR.indexOf(parts[0]);
    let year = parseInt(parts[1], 10);
    if (idx === -1 || isNaN(year)) return "Nouveau mois";
    const nextIdx = (idx + 1) % 12;
    if (nextIdx === 0) year += 1;
    return `${MONTHS_FR[nextIdx]} ${year}`;
  }

  // Devine le mois précédent à partir d'un libellé "Mai 2026"
  function prevMonthLabel(label) {
    const parts = (label || "").trim().split(" ");
    const idx = MONTHS_FR.indexOf(parts[0]);
    let year = parseInt(parts[1], 10);
    if (idx === -1 || isNaN(year)) return "Mois précédent";
    const prevIdx = idx === 0 ? 11 : idx - 1;
    if (prevIdx === 11) year -= 1;
    return `${MONTHS_FR[prevIdx]} ${year}`;
  }

  /* ---------- persistance ---------- */

  // IndexedDB — miroir de secours (iOS vide rarement IDB contrairement à localStorage)
  const IDB_NAME = "budget-etudiant-idb";
  const IDB_STORE = "data";

  function idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  function idbSave(json) {
    idbOpen().then((db) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(json, "main");
    }).catch(() => {});
  }

  function idbLoad() {
    return idbOpen().then((db) => new Promise((res) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const r = tx.objectStore(IDB_STORE).get("main");
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => res(null);
    })).catch(() => null);
  }

  function save() {
    try {
      const json = JSON.stringify(state);
      localStorage.setItem(STORAGE_KEY, json);
      idbSave(json); // miroir async, silencieux
    } catch (e) {
      console.warn("Sauvegarde impossible :", e);
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state = JSON.parse(raw);
        return true;
      }
    } catch (e) {
      console.warn("Lecture localStorage impossible :", e);
    }
    return false;
  }

  // Instantané des récurrents pour un nouveau mois (tout à "non fait")
  function snapshot(templates) {
    return templates.map((t) => ({
      id: uid(),
      templateId: t.id,
      name: t.name,
      amount: t.amount,
      day: t.day || null,
      category: t.category || "Autre",
      done: false,
    }));
  }

  function seed() {
    const first = {
      id: uid(),
      label: currentMonthLabel(),
      initialBalance: 0,
      incomes: [],
      expenses: [],
      transactions: [],
    };
    state = {
      version: 1,
      categories: DEFAULT_CATEGORIES.slice(),
      categoryEmojis: {},
      recurringIncomes: [],
      recurringExpenses: [],
      months: [first],
      currentMonthId: first.id,
    };
    save();
  }

  /* ---------- abonnement / notifications ---------- */

  function subscribe(fn) {
    listeners.push(fn);
  }

  // Coche automatiquement les récurrents à jour fixe dont le jour est passé.
  function autoCheckState() {
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth(); // 0-indexed
    const todayDay = today.getDate();
    state.months.forEach((m) => {
      const parts = (m.label || "").trim().split(" ");
      const mIdx = MONTHS_FR.indexOf(parts[0]);
      const mYear = parseInt(parts[1], 10);
      if (mIdx === -1 || isNaN(mYear)) return;
      const isPast = mYear < todayYear || (mYear === todayYear && mIdx < todayMonth);
      const isCurrent = mYear === todayYear && mIdx === todayMonth;
      [...m.incomes, ...m.expenses].forEach((item) => {
        if (item.day == null || item.done) return;
        if (isPast || (isCurrent && todayDay >= item.day)) item.done = true;
      });
    });
  }

  function notify() {
    autoCheckState();
    save();
    listeners.forEach((fn) => fn(state));
  }

  /* ---------- sauvegarde GitHub (optionnelle, 100% manuelle) ----------
   * Miroir hors-appareil : pousse le JSON complet vers un fichier dans un
   * repo GitHub privé dédié, uniquement quand l'utilisateur clique sur
   * "Sauvegarder maintenant". Rien ne se déclenche tout seul, et rien de
   * tout ça ne s'active sans qu'un token soit renseigné.
   * L'historique git du repo sert de facto d'historique de sauvegardes.
   */

  const GH_OWNER = "akervennal";
  const GH_REPO = "budget-etudiant-backup";
  const GH_PATH = "backup.json";
  const GH_TOKEN_KEY = "budget-etudiant.gh-token";
  const GH_API = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`;

  let ghStatus = { syncing: false, lastSync: null, lastError: null };
  let ghStatusCb = null;
  let ghInFlight = false;

  function ghSetStatus(patch) {
    Object.assign(ghStatus, patch);
    if (ghStatusCb) ghStatusCb({ ...ghStatus });
  }

  function getGhToken() {
    return localStorage.getItem(GH_TOKEN_KEY) || "";
  }

  function setGhToken(token) {
    if (token) localStorage.setItem(GH_TOKEN_KEY, token);
    else localStorage.removeItem(GH_TOKEN_KEY);
  }

  function getGhStatus() {
    return { ...ghStatus };
  }

  function onGhStatus(fn) {
    ghStatusCb = fn;
  }

  // UTF-8 <-> base64 : btoa/atob natifs ne gèrent que le latin1
  function b64EncodeUtf8(str) {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p) => String.fromCharCode(parseInt(p, 16))));
  }
  function b64DecodeUtf8(str) {
    return decodeURIComponent(
      atob(str).split("").map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    );
  }

  async function ghFetchSha() {
    const res = await fetch(GH_API, { headers: { Authorization: `Bearer ${getGhToken()}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Lecture GitHub échouée (${res.status})`);
    const data = await res.json();
    return data.sha;
  }

  async function ghPut(sha) {
    const body = {
      message: "Sauvegarde — " + new Date().toISOString(),
      content: b64EncodeUtf8(JSON.stringify(state)),
    };
    if (sha) body.sha = sha;
    return fetch(GH_API, {
      method: "PUT",
      headers: { Authorization: `Bearer ${getGhToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // Déclenché uniquement par le bouton "Sauvegarder maintenant"
  async function ghSyncNow() {
    if (!getGhToken()) return;
    if (ghInFlight) return; // évite les doubles-clics qui se chevauchent
    ghInFlight = true;
    ghSetStatus({ syncing: true });
    try {
      let sha = await ghFetchSha();
      let res = await ghPut(sha);
      if (res.status === 409) {
        // Conflit (écrit ailleurs entre-temps) : on retente une fois avec le sha à jour
        sha = await ghFetchSha();
        res = await ghPut(sha);
      }
      if (!res.ok) throw new Error(`Écriture GitHub échouée (${res.status})`);
      ghSetStatus({ syncing: false, lastSync: new Date().toISOString(), lastError: null });
    } catch (e) {
      ghSetStatus({ syncing: false, lastError: e.message || String(e) });
    } finally {
      ghInFlight = false;
    }
  }

  async function ghRestoreLatest() {
    if (!getGhToken()) return { ok: false, error: "Aucun token configuré" };
    try {
      const res = await fetch(GH_API, { headers: { Authorization: `Bearer ${getGhToken()}` } });
      if (!res.ok) throw new Error(`Lecture GitHub échouée (${res.status})`);
      const data = await res.json();
      const json = b64DecodeUtf8((data.content || "").replace(/\n/g, ""));
      return { ok: importData(json) };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  /* ---------- calculs sur un mois ---------- */

  function doneIncome(m) {
    return sum(m.incomes.filter((i) => i.done), (i) => i.amount);
  }
  function doneExpense(m) {
    return sum(m.expenses.filter((e) => e.done), (e) => e.amount);
  }
  function pendingIncome(m) {
    return sum(m.incomes.filter((i) => !i.done), (i) => i.amount);
  }
  function pendingExpense(m) {
    return sum(m.expenses.filter((e) => !e.done), (e) => e.amount);
  }
  function txIncome(m) {
    return sum(m.transactions.filter((t) => t.type === "income"), (t) => t.amount);
  }
  function txExpense(m) {
    return sum(m.transactions.filter((t) => t.type === "expense"), (t) => t.amount);
  }

  // Argent réellement sur le compte
  function bankBalance(m) {
    return m.initialBalance + doneIncome(m) - doneExpense(m) + txIncome(m) - txExpense(m);
  }

  // Argent librement dépensable (invariant aux cases cochées)
  function available(m) {
    return bankBalance(m) + pendingIncome(m) - pendingExpense(m);
  }

  // Résumé complet pour l'affichage
  function computed(m) {
    return {
      initialBalance: m.initialBalance,
      bank: bankBalance(m),
      available: available(m),
      pendingExpense: pendingExpense(m),
      pendingIncome: pendingIncome(m),
      totalIncome: sum(m.incomes, (i) => i.amount) + txIncome(m),
      totalExpense: sum(m.expenses, (e) => e.amount) + txExpense(m),
    };
  }

  // Re-chaîne les soldes initiaux : chaque mois hérite du disponible du précédent.
  // Le tout premier mois garde son solde initial saisi par l'utilisateur.
  function rechain() {
    for (let i = 1; i < state.months.length; i++) {
      state.months[i].initialBalance = available(state.months[i - 1]);
    }
  }

  /* ---------- accès ---------- */

  function getState() {
    return state;
  }

  function currentMonth() {
    return state.months.find((m) => m.id === state.currentMonthId) || state.months[0];
  }

  function monthById(id) {
    return state.months.find((m) => m.id === id);
  }

  function setCurrentMonth(id) {
    if (monthById(id)) {
      state.currentMonthId = id;
      notify();
    }
  }

  /* ---------- transactions ---------- */

  function addTransaction(monthId, tx) {
    const m = monthById(monthId);
    if (!m) return;
    m.transactions.push({
      id: uid(),
      date: tx.date,
      type: tx.type, // "expense" | "income"
      category: tx.category,
      description: tx.description || "",
      amount: Math.abs(tx.amount) || 0,
    });
    m.transactions.sort((a, b) => a.date.localeCompare(b.date));
    rechain();
    notify();
  }

  function updateTransaction(monthId, txId, patch) {
    const m = monthById(monthId);
    if (!m) return;
    const t = m.transactions.find((x) => x.id === txId);
    if (!t) return;
    if (patch.amount != null) patch.amount = Math.abs(patch.amount);
    Object.assign(t, patch);
    m.transactions.sort((a, b) => a.date.localeCompare(b.date));
    rechain();
    notify();
  }

  function deleteTransaction(monthId, txId) {
    const m = monthById(monthId);
    if (!m) return;
    m.transactions = m.transactions.filter((x) => x.id !== txId);
    rechain();
    notify();
  }

  // Coche / décoche un récurrent du mois (payé / reçu)
  function toggleRecurring(monthId, kind, itemId) {
    const m = monthById(monthId);
    if (!m) return;
    const list = kind === "income" ? m.incomes : m.expenses;
    const item = list.find((x) => x.id === itemId);
    if (item) item.done = !item.done;
    notify();
  }

  /* ---------- récurrents (modèles) ---------- */

  function addRecurring(kind, name, amount, day, category) {
    const list = kind === "income" ? state.recurringIncomes : state.recurringExpenses;
    const tpl = { id: uid(), name: name.trim(), amount: Math.abs(amount) || 0, day: day || null, category: category || "Autre" };
    list.push(tpl);
    // Répercute sur le mois courant (mais pas les mois passés)
    const m = currentMonth();
    (kind === "income" ? m.incomes : m.expenses).push({
      id: uid(),
      templateId: tpl.id,
      name: tpl.name,
      amount: tpl.amount,
      day: tpl.day,
      category: tpl.category,
      done: false,
    });
    rechain();
    notify();
  }

  function updateRecurring(kind, tplId, patch) {
    const list = kind === "income" ? state.recurringIncomes : state.recurringExpenses;
    const tpl = list.find((x) => x.id === tplId);
    if (!tpl) return;
    if (patch.amount != null) patch.amount = Math.abs(patch.amount);
    Object.assign(tpl, patch);
    // Répercute sur le mois courant uniquement pour les lignes non "faites"
    const m = currentMonth();
    const snap = (kind === "income" ? m.incomes : m.expenses).find(
      (x) => x.templateId === tplId && !x.done
    );
    if (snap) Object.assign(snap, { name: tpl.name, amount: tpl.amount, day: tpl.day, category: tpl.category });
    rechain();
    notify();
  }

  function deleteRecurring(kind, tplId) {
    const list = kind === "income" ? state.recurringIncomes : state.recurringExpenses;
    const idx = list.findIndex((x) => x.id === tplId);
    if (idx === -1) return;
    list.splice(idx, 1);
    // Retire du mois courant (coché ou non)
    const m = currentMonth();
    const arr = kind === "income" ? m.incomes : m.expenses;
    const snapIdx = arr.findIndex((x) => x.templateId === tplId);
    if (snapIdx !== -1) arr.splice(snapIdx, 1);
    rechain();
    notify();
  }

  /* ---------- catégories ---------- */

  function addCategory(name, emoji) {
    const n = name.trim();
    if (!n) return;
    if (!state.categoryEmojis) state.categoryEmojis = {};
    if (!state.categories.includes(n)) state.categories.push(n);
    if (emoji && emoji.trim()) state.categoryEmojis[n] = emoji.trim();
    notify();
  }

  function deleteCategory(name) {
    state.categories = state.categories.filter((c) => c !== name);
    if (state.categoryEmojis) delete state.categoryEmojis[name];
    notify();
  }

  function getCategoryEmojis() {
    return state.categoryEmojis || {};
  }

  /* ---------- mois ---------- */

  function goToNextMonth() {
    const last = state.months[state.months.length - 1];
    const carry = available(last);
    const m = {
      id: uid(),
      label: nextMonthLabel(last.label),
      initialBalance: carry,
      incomes: snapshot(state.recurringIncomes),
      expenses: snapshot(state.recurringExpenses),
      transactions: [],
    };
    state.months.push(m);
    state.currentMonthId = m.id;
    notify();
    return m;
  }

  function goToPreviousMonth() {
    const first = state.months[0];
    const m = {
      id: uid(),
      label: prevMonthLabel(first.label),
      // Solde de départ = même que l'actuel premier mois pour l'instant.
      // Quand l'utilisateur ajoutera des transactions, rechain() recalculera.
      initialBalance: first.initialBalance,
      incomes: [],
      expenses: [],
      transactions: [],
    };
    state.months.unshift(m);
    state.currentMonthId = m.id;
    rechain();
    notify();
    return m;
  }

  function exportData() {
    return JSON.stringify(state);
  }

  function importData(json) {
    try {
      const parsed = JSON.parse(json);
      if (!parsed || !parsed.months) throw new Error("Format invalide");
      state = parsed;
      rechain();
      notify();
      return true;
    } catch (e) {
      return false;
    }
  }

  function renameMonth(monthId, label) {
    const m = monthById(monthId);
    if (m) {
      m.label = label.trim() || m.label;
      notify();
    }
  }

  function setInitialBalance(value) {
    // Modifie le solde de départ du tout premier mois
    state.months[0].initialBalance = value || 0;
    rechain();
    notify();
  }

  function deleteMonth(monthId) {
    if (state.months.length <= 1) return; // on garde toujours un mois
    const idx = state.months.findIndex((m) => m.id === monthId);
    if (idx === -1) return;
    state.months.splice(idx, 1);
    if (state.currentMonthId === monthId) {
      state.currentMonthId = state.months[Math.min(idx, state.months.length - 1)].id;
    }
    rechain();
    notify();
  }

  /* ---------- historique (chronologie avec solde courant) ---------- */

  function timeline(monthId) {
    const m = monthById(monthId);
    if (!m) return [];
    const events = [];

    // Solde initial comme point de départ
    let running = m.initialBalance;
    events.push({
      kind: "start",
      date: null,
      label: "Solde de départ",
      delta: null,
      balance: running,
    });

    // Un récurrent à jour fixe (mode auto) a une vraie date connue ce mois-ci ;
    // un récurrent manuel n'en a pas (on ne sait pas quel jour il a été coché).
    const parts = (m.label || "").trim().split(" ");
    const mIdx = MONTHS_FR.indexOf(parts[0]);
    const mYear = parseInt(parts[1], 10);
    const dateForDay = (day) => {
      if (day == null || mIdx === -1 || isNaN(mYear)) return null;
      return `${mYear}-${String(mIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    };

    // Récurrents "faits" + transactions, triés par date
    const items = [];
    m.incomes.filter((i) => i.done).forEach((i) =>
      items.push({ date: dateForDay(i.day), label: i.name, delta: i.amount, kind: "recurring" })
    );
    m.expenses.filter((e) => e.done).forEach((e) =>
      items.push({ date: dateForDay(e.day), label: e.name, delta: -e.amount, kind: "recurring" })
    );
    m.transactions.forEach((t) =>
      items.push({
        date: t.date,
        label: t.description || t.category,
        delta: t.type === "income" ? t.amount : -t.amount,
        kind: "transaction",
        category: t.category,
        id: t.id,
      })
    );
    // Les récurrents (date=null) n'ont pas de date réelle : on les place
    // avant toutes les transactions datées du mois.
    items.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    items.forEach((it) => {
      running += it.delta;
      events.push({ ...it, balance: running });
    });

    return events;
  }

  /* ---------- réinitialisation ---------- */

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    seed();
    notify();
  }

  function migrate() {
    ["Prêt", "Santé"].forEach((c) => {
      if (!state.categories.includes(c)) state.categories.push(c);
    });
  }

  function init() {
    if (load()) {
      migrate();
      autoCheckState();
      save();
    } else {
      // localStorage vide → tente la récupération depuis IndexedDB
      idbLoad().then((json) => {
        if (json) {
          try {
            state = JSON.parse(json);
            migrate();
            autoCheckState();
            save(); // restaure dans localStorage
            notify(); // re-render avec les données récupérées
            return;
          } catch (e) {}
        }
        seed();
        notify();
      });
    }
  }

  Budget.store = {
    init,
    subscribe,
    getState,
    // mois
    currentMonth,
    monthById,
    setCurrentMonth,
    goToNextMonth,
    goToPreviousMonth,
    renameMonth,
    setInitialBalance,
    deleteMonth,
    nextMonthLabel,
    prevMonthLabel,
    // sauvegarde
    exportData,
    importData,
    // sauvegarde GitHub (manuelle)
    getGhToken,
    setGhToken,
    getGhStatus,
    onGhStatus,
    ghSyncNow,
    ghRestoreLatest,
    // calculs
    computed,
    available,
    bankBalance,
    timeline,
    // transactions
    addTransaction,
    updateTransaction,
    deleteTransaction,
    toggleRecurring,
    // récurrents
    addRecurring,
    updateRecurring,
    deleteRecurring,
    // catégories
    addCategory,
    deleteCategory,
    getCategoryEmojis,
    // divers
    reset,
  };
})(window.Budget = window.Budget || {});
