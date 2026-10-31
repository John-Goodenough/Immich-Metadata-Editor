"use strict";

// Dia-Assistent: geführte Oberfläche. Eine Frage pro Bildschirm.
// Aufbau und Aussehen nach dem Claude-Design-Entwurf: Foto links, Bedienbereich rechts,
// feste Fußleiste „← Zurück · Weiß ich nicht · Weiter →“, ein Listenmuster für Orte, Personen, Themen und Alben.

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
  "August", "September", "Oktober", "November", "Dezember"];
const STEP_OF = {
  decade: "when", year: "when", month: "when", day: "when", certainty: "when",
  place: "where", what: "what", face: "who", who: "who", tags: "tags", newtag: "tags", album: "album", summary: "done",
};
// Fragen-Blöcke: Reihenfolge und Sichtbarkeit kommen aus den Einstellungen
const ALL_STEPS = ["when", "where", "what", "who", "tags", "album"];
const STEP_LABEL = { when: "Wann?", where: "Wo?", what: "Was?", who: "Wer?", tags: "Themen", album: "Album", done: "Fertig" };
const STEP_TEXT = {
  when: "Wann wurde das Foto gemacht?", where: "Wo wurde das Foto gemacht?", what: "Was ist auf dem Foto zu sehen?",
  who: "Wer ist auf dem Foto?", tags: "Zu welchen Themen passt das Foto?", album: "In welches Album gehört das Foto?",
};
const STEP_SCREEN = { when: "decade", where: "place", what: "what", who: "face:0", tags: "tags", album: "album", done: "summary" };
const DRAFT_KEY = "dia-assistent-entwurf";

const ICONS = {
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  exit: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
};

const $ = (id) => document.getElementById(id);

const state = {
  settings: { yearFrom: 1940, yearTo: 2010, steps: ALL_STEPS },
  queue: [],
  index: 0,
  saved: 0,
  skipped: 0,
  people: null,
  albums: null,
  tags: null,
  asset: null,
  answers: null,
  screen: null,
  history: [],
  decade: null,
  keyboard: false,
  retry: null,
  saveError: null,
  ...freshScreenState(),
};

// Such- und Blätterzustand der einzelnen Bildschirme; wird bei jedem neuen Bild zurückgesetzt
function freshScreenState() {
  return {
    placeQuery: "", placeResults: null, placePage: 0, placeFocus: false,
    faceQuery: "", facePage: 0,
    peopleFilter: "", peoplePage: 0,
    tagPath: [], tagPage: 0, tagQuery: "",
    newTagName: null, ntPath: [], ntQuery: "", ntPage: 0,
    albumFilter: "", albumPage: 0,
  };
}

function freshAnswers() {
  return {
    year: null, month: null, day: null, approximate: false,
    latitude: null, longitude: null, placeName: null, placeKind: null, placeTag: null,
    description: "", person_ids: [], new_people: [], tag_values: [],
    album_ids: [], new_albums: [],
    faces: {}, // Gesichts-ID -> { person_id } oder { new_name }
  };
}

// ---------- Hilfsfunktionen ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "onclick") node.addEventListener("click", value);
    else if (key in node && typeof value !== "string") node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function icon(name) {
  const t = document.createElement("template");
  t.innerHTML = `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">${ICONS[name]}</svg>`;
  return t.content.firstChild;
}

// "face:1" -> "face": Bildschirme mit Nummer teilen sich eine Funktion
function screenName(screen = state.screen) {
  return screen ? screen.split(":")[0] : screen;
}

function images(n) {
  return n === 1 ? "1 Bild" : `${n} Bilder`;
}

function decadeName(d) {
  return d >= 2000 ? `${d}er` : `${String(d).slice(2)}er`;
}

function button(label, onclick, cls = "") {
  return el("button", { class: `btn ${cls}`.trim(), type: "button", onclick }, label);
}

// Antwortknopf mit Auswahlzustand (Jahrzehnt, Jahr, Monat …)
function choice(label, pressed, onclick, cls = "") {
  return el("button", { class: `choice ${cls}`.trim(), type: "button", "aria-pressed": String(Boolean(pressed)), onclick }, label);
}

const same = (x, y) => x.toLocaleLowerCase("de") === y.toLocaleLowerCase("de");
const contains = (text, q) => text.toLocaleLowerCase("de").includes(q.toLocaleLowerCase("de"));

function cleanName(text) {
  return text.split(/\s+/).filter(Boolean).join(" ");
}

function searchField(id, value, placeholder, label, maxlength = "100") {
  return el("input", { class: "field", type: "text", id, value, placeholder, "aria-label": label, autocomplete: "off", maxlength });
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error("Keine Verbindung zum Assistenten. Läuft das Programm noch?");
  }
  let data = null;
  try { data = await response.json(); } catch { /* leer */ }
  if (!response.ok) {
    // Ohne deutsche Meldung vom Server: allgemeiner Text plus Code, damit sich der Fehler eingrenzen lässt
    throw new Error((data && data.fehler) || `Da ist etwas schiefgegangen (Code ${response.status}). Bitte noch einmal versuchen.`);
  }
  return data;
}

function busy(on, text = "Einen Moment bitte …") {
  $("busy-text").textContent = text;
  $("busy").hidden = !on;
}

function showError(message, retry) {
  state.retry = retry || null;
  $("error-text").textContent = message;
  $("error-retry").hidden = !retry;
  $("error").hidden = false;
}

function clearError() {
  $("error").hidden = true;
  state.retry = null;
}

function saveDraft() {
  try {
    if (!state.asset) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      id: state.asset.id, answers: state.answers, screen: state.screen,
      history: state.history, decade: state.decade, newTagName: state.newTagName, ntPath: state.ntPath,
    }));
  } catch { /* Speicher nicht verfügbar: dann eben ohne Entwurf */ }
}

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { return null; }
}

function dropDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* egal */ }
}

function dateText(a) {
  if (a.year == null) return null;
  let text = String(a.year);
  if (a.month != null) text = `${MONTHS[a.month - 1]} ${text}`;
  if (a.day != null) text = `${a.day}. ${text}`;
  return a.approximate ? `${text} (ungefähr)` : text;
}

// Hat ein Schritt schon eine Antwort? Für das Häkchen in der Schrittleiste.
function stepDone(step) {
  const a = state.answers;
  if (!a) return false;
  switch (step) {
    case "when": return a.year != null;
    case "where": return Boolean(a.placeName);
    case "what": return Boolean(a.description.trim());
    case "who": return Object.values(a.faces).some((v) => !v.skip) || a.person_ids.length + a.new_people.length > 0;
    case "tags": return a.tag_values.length > 0;
    case "album": return a.album_ids.length + a.new_albums.length > 0;
    default: return false;
  }
}

// ---------- Rahmen ----------

// Baut Kopf, Frage und Fußleiste. Ohne Foto (photo:false) wird der Bedienbereich zur Karte in der Mitte.
function frame({
  question, hint = "", hintOptional = false, error = false, extra = null,
  back: canBack = true, backLabel = "← Zurück", onBack = null,
  skip = null, next = null, nextLabel = "Weiter →", nextCls = "btn-primary",
  photo = true, wide = false,
}) {
  clearError();
  showFaceMark(null);
  $("question").textContent = question;
  $("question").classList.toggle("error", error);
  $("hint").replaceChildren(...[].concat(hint));
  $("hint").classList.toggle("hide-compact", hintOptional);
  $("q-extra").replaceChildren(...(extra ? [extra] : []));
  $("main").classList.toggle("center", !photo);
  $("main").classList.toggle("wide", wide);
  $("top").hidden = !photo;
  $("photo-box").hidden = !photo;
  $("skip-image").hidden = !photo;
  $("steps").hidden = !photo;

  // Fußleiste: drei feste Plätze; ein leerer Platz bleibt unsichtbar stehen
  const back = $("back");
  back.textContent = backLabel;
  back.hidden = !photo && !onBack;
  back.disabled = !onBack && (!canBack || state.history.length === 0);
  back.onclick = onBack || goBack;
  $("skip").classList.toggle("slot", !skip);
  $("skip").onclick = skip;
  $("skip").tabIndex = skip ? 0 : -1;
  $("next").classList.toggle("slot", !next);
  $("next").tabIndex = next ? 0 : -1;
  $("next").textContent = nextLabel;
  $("next").onclick = next;
  $("next").className = `btn ${nextCls}${next ? "" : " slot"}`;
  $("nav").hidden = back.hidden && !next && !skip;

  if (photo && state.answers) buildSteps();

  if (state.queue.length) {
    const nr = Math.min(state.index + 1, state.queue.length);
    $("progress-text").textContent = `Bild ${nr} von ${state.queue.length}`;
    // Mindestens ein kleiner Punkt, damit der Balken bei Bild 1 nicht kaputt wirkt
    $("progress-fill").style.width = `${Math.max(2, (state.index / state.queue.length) * 100)}%`;
    $("progress-bar").setAttribute("aria-valuemin", "0");
    $("progress-bar").setAttribute("aria-valuemax", String(state.queue.length));
    $("progress-bar").setAttribute("aria-valuenow", String(state.index));
  }

  const content = $("content");
  content.replaceChildren();
  return content;
}

// Schrittleiste: aktuell = blau, beantwortet = grün mit Häkchen. Ein Klick springt direkt dorthin.
function buildSteps() {
  const current = STEP_OF[screenName()];
  $("steps").replaceChildren(...[...state.settings.steps, "done"].map((step) => {
    const b = el("button", {
      type: "button",
      class: `step${step !== current && stepDone(step) ? " done" : ""}`,
      title: `Zu „${STEP_LABEL[step]}“ springen`,
      onclick: () => { if (STEP_OF[screenName()] !== step) go(STEP_SCREEN[step]); },
    }, STEP_LABEL[step]);
    if (step === current) b.setAttribute("aria-current", "step");
    return b;
  }));
}

function go(screen) {
  if (screenName() === "summary") state.saveError = null;
  state.history.push(state.screen);
  state.screen = screen;
  render();
}

// Erster Bildschirm des nächsten eingeschalteten Blocks, nach dem letzten die Zusammenfassung
function goAfter(step) {
  const steps = state.settings.steps;
  const next = steps[steps.indexOf(step) + 1];
  go(next ? STEP_SCREEN[next] : "summary");
}

function goBack() {
  if (!state.history.length) return;
  state.screen = state.history.pop();
  render();
}

let renderNo = 0;
async function render() {
  const no = ++renderNo;
  saveDraft();
  await SCREENS[screenName()]();
  if (no !== renderNo) return;
  const content = $("content");
  // Nach einer Ortssuche mit Tastatur: gleich auf den ersten Treffer
  if (state.placeFocus) {
    state.placeFocus = false;
    const hit = content.querySelector(".list .item");
    if (hit && state.keyboard) { hit.focus({ preventScroll: true }); return; }
  }
  // Textfelder bekommen immer den Fokus, Knöpfe nur bei Tastaturbedienung:
  // ein sichtbarer Fokusrahmen ohne Tastatur würde wie eine Auswahl aussehen.
  const field = content.querySelector("input, textarea");
  const first = field || (state.keyboard && content.querySelector('[aria-pressed="true"]:not([aria-disabled]), .item:not(.locked), .choice, .btn'));
  if (first) first.focus({ preventScroll: true });
}

// ---------- Auswahlliste (Orte, Personen, Themen, Alben) ----------

// Liste mit Blättern. Pro Seite stehen so viele Einträge, wie in die freie Höhe passen – nie Seiten-Scrollen.
// lead: Einträge, die immer oben stehen (z. B. „+ … neu anlegen“).
function pagedList(parent, { cols = 2, itemH = "var(--btn-h)", getPage, setPage }) {
  const leadList = el("div", { class: "list one lead-list", hidden: true });
  leadList.style.setProperty("--item-h", "calc(var(--btn-h) + 8px)");
  const list = el("div", { class: `list${cols === 1 ? " one" : ""}` });
  list.style.setProperty("--item-h", itemH);
  const pos = el("span", { class: "pos" });
  const prev = button("← Vorherige", () => turn(-1));
  const next = button("Weitere →", () => turn(1));
  const pager = el("div", { class: "pager ghost", "aria-hidden": "true" }, prev, pos, next);
  parent.append(leadList, list, pager);
  let cells = [];
  let emptyText = "";

  function turn(delta) {
    setPage(getPage() + delta);
    show();
    const target = delta < 0 ? prev : next;
    (target.disabled ? (delta < 0 ? next : prev) : target).focus({ preventScroll: true });
  }

  function show() {
    list.replaceChildren();
    const ghost = (on) => { pager.classList.toggle("ghost", on); pager.setAttribute("aria-hidden", String(on)); };
    if (!cells.length) {
      if (emptyText) list.append(el("div", { class: "empty" }, emptyText));
      ghost(true);
      return;
    }
    let perPage = cells.length;
    // Ohne Maus (Touch) zeigt die Liste alles und scrollt, weil der volle Text immer dasteht
    if (!matchMedia("(hover: none)").matches) {
      list.append(cells[0]);
      const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
      const rows = Math.max(1, Math.floor((list.clientHeight + gap + 1) / (cells[0].offsetHeight + gap)));
      perPage = rows * cols;
    }
    const pages = Math.max(1, Math.ceil(cells.length / perPage));
    const page = Math.min(Math.max(0, getPage()), pages - 1);
    setPage(page);
    list.replaceChildren(...cells.slice(page * perPage, (page + 1) * perPage));
    pos.textContent = `Seite ${page + 1} von ${pages}`;
    prev.disabled = page === 0;
    next.disabled = page >= pages - 1;
    ghost(pages < 2);
  }

  // Neu befüllen; der Fokus bleibt auf dem Eintrag an derselben Stelle
  function fill(newCells, lead = [], empty = "") {
    const active = document.activeElement;
    const cell = active && list.contains(active) ? active.closest(".cell") : null;
    const at = cell ? [...list.children].indexOf(cell) : -1;
    cells = newCells;
    emptyText = empty;
    leadList.replaceChildren(...lead);
    leadList.hidden = !lead.length;
    show();
    if (at >= 0) (list.children[at] || list.lastElementChild)?.querySelector("button")?.focus({ preventScroll: true });
  }

  return { fill, list };
}

// Ein Listeneintrag. pressed=null: kein Auswahlzustand. locked: grau, nicht anklickbar („schon drin“).
function itemCell({ name, meta = null, pressed = null, locked = false, lead = null, cls = "", title = null, onClick }) {
  const btn = el("button", { type: "button", class: `item ${cls}${locked ? " locked" : ""}`.trim(), title },
    lead,
    el("span", { class: "body" }, el("span", { class: "name" }, name), meta ? el("span", { class: "meta" }, meta) : null),
    el("span", { class: "check", "aria-hidden": "true" }, "✔"));
  if (locked) btn.setAttribute("aria-disabled", "true");
  else {
    if (pressed !== null) btn.setAttribute("aria-pressed", String(pressed));
    btn.addEventListener("click", onClick);
  }
  return el("div", { class: "cell" }, btn);
}

// „+ „…“ neu anlegen“: grün gestrichelt, steht immer ganz oben
function newCell(text, meta, onClick) {
  return el("div", { class: "cell wide" }, el("button", { type: "button", class: "item new", onclick: onClick },
    el("span", { class: "plus", "aria-hidden": "true" }, "+"),
    el("span", { class: "body" }, el("span", { class: "name" }, `„${text}“ neu anlegen`), el("span", { class: "meta" }, meta))));
}

function tagLabel(text, cls = "") {
  return el("span", { class: `tag ${cls}`.trim() }, text);
}

// Entfernbare Auswahl als Chips
function chips(lead, entries) {
  return el("div", { class: "chips", hidden: !entries.length },
    el("span", { class: "lead" }, lead),
    entries.map(({ label, onClick }) => el("button", { type: "button", class: "chip-x", "aria-label": `${label} abwählen`, onclick: onClick },
      label, el("span", { class: "x", "aria-hidden": "true" }, "✕"))));
}

// Pfadleiste: Alle Themen › Urlaub › Italien
function crumbs(path, open) {
  const nav = el("nav", { class: "crumbs", "aria-label": "Themen-Ebene" });
  const parts = ["Alle Themen", ...path];
  parts.forEach((part, depth) => {
    if (depth === parts.length - 1) nav.append(el("span", { class: "cur", "aria-current": "page" }, part));
    else nav.append(el("button", { type: "button", onclick: () => open(path.slice(0, depth)) }, part), el("span", { "aria-hidden": "true" }, "›"));
  });
  return nav;
}

// ---------- Bildschirme ----------

const SCREENS = {
  decade() {
    const a = state.answers;
    const c = frame({
      question: "Wann wurde das Foto gemacht?", hint: "Welches Jahrzehnt? Ungefähr reicht.",
      skip: () => { Object.assign(a, { year: null, month: null, day: null, approximate: false }); goAfter("when"); },
      next: () => goAfter("when"),
    });
    const grid = el("div", { class: "grid g4" });
    const from = Math.floor(state.settings.yearFrom / 10) * 10;
    for (let d = from; d <= state.settings.yearTo; d += 10) {
      const chosen = a.year != null && Math.floor(a.year / 10) * 10 === d;
      grid.append(choice(decadeName(d), chosen, () => { state.decade = d; go("year"); }));
    }
    c.append(grid);
  },

  year() {
    const a = state.answers;
    const d = state.decade ?? (a.year != null ? Math.floor(a.year / 10) * 10 : 1960);
    const inDecade = a.year != null && a.year >= d && a.year < d + 10;
    const c = frame({
      question: "Welches Jahr?", hint: `In den ${decadeName(d)}n. Wenn Sie es nicht genau wissen: unten antippen.`,
      next: () => (inDecade && !a.approximate ? go("month") : goAfter("when")),
    });
    const grid = el("div", { class: "grid g5" });
    for (let y = d; y < d + 10; y++) {
      grid.append(choice(String(y), a.year === y && !a.approximate, () => {
        Object.assign(a, { year: y, approximate: false });
        go("month");
      }));
    }
    const vague = inDecade && a.approximate && a.month == null;
    c.append(grid, choice(`Irgendwann in den ${decadeName(d)}n`, vague, () => {
      Object.assign(a, { year: d + 5, month: null, day: null, approximate: true });
      goAfter("when");
    }, "choice-wide"));
  },

  month() {
    const a = state.answers;
    const c = frame({
      question: "Welcher Monat?", hint: `Im Jahr ${a.year}.`,
      skip: () => { Object.assign(a, { month: null, day: null }); go("certainty"); },
      next: () => go(a.month != null ? "day" : "certainty"),
    });
    const grid = el("div", { class: "grid g3" });
    MONTHS.forEach((name, i) => grid.append(choice(name, a.month === i + 1, () => {
      a.month = i + 1;
      go("day");
    })));
    c.append(grid);
  },

  day() {
    const a = state.answers;
    const c = frame({
      question: "Welcher Tag?", hint: `Im ${MONTHS[a.month - 1]} ${a.year}.`,
      skip: () => { a.day = null; go("certainty"); },
      next: () => go("certainty"),
    });
    const grid = el("div", { class: "grid g8" });
    const days = new Date(a.year, a.month, 0).getDate();
    for (let d = 1; d <= days; d++) {
      grid.append(choice(String(d), a.day === d, () => { a.day = d; go("certainty"); }));
    }
    c.append(grid);
  },

  certainty() {
    const a = state.answers;
    const c = frame({
      question: "Wie sicher sind Sie?",
      hint: ["Sie haben gewählt: ", el("b", {}, dateText({ ...a, approximate: false }))],
      next: () => goAfter("when"),
    });
    c.append(el("div", { class: "grid g2" },
      choice("Ganz sicher", !a.approximate, () => { a.approximate = false; goAfter("when"); }),
      choice("Nur ungefähr", a.approximate, () => { a.approximate = true; goAfter("when"); }),
    ));
  },

  place() {
    const a = state.answers;
    const results = state.placeResults;
    const clear = () => Object.assign(a, { latitude: null, longitude: null, placeName: null, placeKind: null, placeTag: null });
    const c = frame({
      question: "Wo wurde das Foto gemacht?",
      hint: a.placeName ? "Stimmt der Ort? Dann „Weiter“." : results?.length ? "Den richtigen Ort antippen." : "Ort eintippen, dann „Suchen“ drücken.",
      hintOptional: Boolean(results?.length) && !a.placeName,
      skip: () => { clear(); goAfter("where"); },
      next: () => goAfter("where"),
    });
    if ((a.placeName || !results) && state.asset.city) {
      c.append(el("div", { class: "note" }, "In Immich steht bisher: ", el("b", {}, state.asset.city)));
    }
    if (a.placeName) {
      c.append(el("div", { class: "chosen" },
        el("span", { class: "txt" }, el("b", {}, "Gewählt: "), a.placeName, " ", a.placeKind ? tagLabel(a.placeKind) : null),
        button("Entfernen", () => { clear(); render(); })));
      return;
    }
    const input = searchField("place-input", state.placeQuery, "z. B. Rüdesheim am Rhein", "Ort", "200");
    const search = async () => {
      const q = input.value.trim();
      state.placeQuery = input.value;
      if (q.length < 2) return;
      clearError();
      busy(true, "Ort wird gesucht …");
      try {
        state.placeResults = await api(`/api/places?q=${encodeURIComponent(q)}`);
      } catch (err) {
        busy(false);
        showError(err.message, search);
        return;
      }
      busy(false);
      state.placePage = 0;
      state.placeFocus = true;
      render();
    };
    input.addEventListener("input", () => { state.placeQuery = input.value; });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
    c.append(el("div", { class: "search-row" }, input, button("Suchen", search, "btn-primary")));
    if (!results) return;
    const lst = pagedList(c, {
      cols: 1, itemH: "calc(var(--btn-h) + 10px)",
      getPage: () => state.placePage, setPage: (p) => { state.placePage = p; },
    });
    lst.fill(results.map((r) => itemCell({
      name: r.name,
      meta: [r.kind ? tagLabel(r.kind) : null, " ", r.detail],
      pressed: a.latitude === r.lat && a.longitude === r.lon,
      cls: "single",
      onClick: () => {
        Object.assign(a, { latitude: r.lat, longitude: r.lon, placeName: r.name, placeKind: r.kind || null, placeTag: r.tag || null });
        render();
      },
    })), [], "Keinen Ort mit diesem Namen gefunden. Anders schreiben – oder „Weiß ich nicht“.");
  },

  what() {
    const a = state.answers;
    const c = frame({
      question: "Was ist auf dem Foto zu sehen?", hint: "Ein paar Worte genügen.",
      skip: () => goAfter("what"),
      next: () => goAfter("what"),
    });
    if (state.asset.description) {
      c.append(el("div", { class: "note" }, "Bisher steht dort: ", el("b", {}, state.asset.description)));
    }
    const text = el("textarea", { class: "field", id: "what-input", "aria-label": "Beschreibung", placeholder: "z. B. Sonntagsausflug mit dem neuen Auto", maxlength: "5000" });
    text.value = a.description;
    text.addEventListener("input", () => { a.description = text.value; saveDraft(); });
    c.append(text);
  },

  // Ein von Immich erkanntes Gesicht nach dem anderen. Hat Immich schon eine Person zugeordnet (oder wurde eben
  // eine gewählt), fragt der Assistent „Ist das …?“; sonst (oder nach „Nein, jemand anderes“) „Wer ist das?“ mit Liste.
  // Jede Antwort geht gleich zum nächsten Gesicht. Bildschirm: "face:<Nr>" bzw. "face:<Nr>:pick".
  async face() {
    const a = state.answers;
    const faces = askedFaces();
    const [, nr, mode] = state.screen.split(":");
    const i = Number(nr) || 0;
    const f = faces[i];
    if (!f) {
      // keine (weiteren) Gesichter: weiter mit der Personenliste
      state.screen = "who";
      return SCREENS.who();
    }
    const screen = state.screen;
    const answer = a.faces[f.id];
    const following = i + 1 < faces.length ? `face:${i + 1}` : "who";
    const answered = Boolean(answer);
    const pick = (value) => {
      a.faces[f.id] = value;
      // „Zurück“ führt danach zur Frage „Ist das …?“ mit der neuen Wahl, nicht wieder in die Liste
      if (mode === "pick" && !value.skip) state.screen = `face:${i}`;
      state.faceQuery = "";
      state.facePage = 0;
      go(following);
    };
    const hint = faces.length > 1 ? `Gesicht ${i + 1} von ${faces.length} · im Foto orange umrandet` : "Das Gesicht ist im Foto orange umrandet.";
    const next = answered ? () => { state.faceQuery = ""; state.facePage = 0; go(following); } : null;
    if (!(await loadPeople(frame({ question: "Wer ist das?", hint, extra: faceCrop(f) }), screen))) return;

    // Wer ist es gerade? Gewählte Antwort vor der Zuordnung aus Immich
    const current = answer?.person_id ? { id: answer.person_id, name: personName(answer.person_id) || "Unbekannte Person" }
      : answer?.new_name ? { id: null, name: answer.new_name, isNew: true }
        : f.personName ? { id: f.personId, name: f.personName } : null;
    const confirmed = answered && !answer.skip;

    if (current && mode !== "pick") {
      const label = current.isNew ? `${current.name} (neu)` : current.name;
      const c = frame({ question: `Ist das ${label}?`, hint, extra: faceCrop(f), next });
      showFaceMark(f, i + 1);
      const unknown = button("Weiß ich nicht", () => pick({ skip: true }), "btn-skip btn-answer2");
      unknown.setAttribute("aria-pressed", String(Boolean(answer?.skip)));
      c.append(el("div", { class: "answers", role: "group", "aria-label": "Antwort" },
        el("button", {
          type: "button", class: "btn btn-success btn-answer",
          onclick: () => pick(confirmed ? answer : { person_id: f.personId }),
        }, current.id ? avatar(current) : initialsAvatar(current.name), el("span", { class: "lbl" }, `${confirmed ? "✔ " : ""}Ja, das ist ${label}`)),
        button("Nein, jemand anderes", () => go(`face:${i}:pick`), "btn-answer2"),
        unknown));
      return;
    }

    const c = frame({ question: "Wer ist das?", hint, extra: faceCrop(f), next });
    showFaceMark(f, i + 1);
    const input = searchField("face-input", state.faceQuery, "Name eintippen …", "Name");
    const unknown = button("Weiß ich nicht", () => pick({ skip: true }), "btn-skip");
    unknown.setAttribute("aria-pressed", String(Boolean(answer?.skip)));
    c.append(el("div", { class: "search-row" }, input, unknown));

    // Wer schon an einem anderen Gesicht oder am Bild hängt, steht nicht in der Liste,
    // ebenso die Person, für die gerade „Nein, jemand anderes“ gewählt wurde
    const taken = markedPeople(f.id);
    if (current?.id) taken.add(current.id);
    const lst = pagedList(c, { getPage: () => state.facePage, setPage: (p) => { state.facePage = p; } });
    const draw = () => {
      const name = cleanName(state.faceQuery);
      const people = state.people.filter((p) => !taken.has(p.id) && contains(p.name, name));
      const lead = name && !state.people.some((p) => same(p.name, name))
        ? [newCell(name, people.length ? "Neue Person anlegen" : "Niemand mit diesem Namen – als neue Person anlegen", () => pick({ new_name: name }))]
        : [];
      lst.fill(people.map((p) => itemCell({
        name: p.name, lead: avatar(p), cls: "person",
        onClick: () => pick({ person_id: p.id }),
      })), lead, state.people.length ? "Niemand mit diesem Namen." : "In Immich sind noch keine Personen benannt.");
    };
    input.addEventListener("input", () => { state.faceQuery = input.value; state.facePage = 0; draw(); });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const name = cleanName(input.value);
      const match = state.people.find((p) => same(p.name, name) && !taken.has(p.id));
      if (match) pick({ person_id: match.id });
      else if (name && !state.people.some((p) => same(p.name, name))) pick({ new_name: name });
    });
    draw();
  },

  // Personen, deren Gesicht nicht erkannt wurde: Zuordnung zum ganzen Bild (Mehrfachauswahl)
  async who() {
    const a = state.answers;
    const asked = askedFaces().length > 0;
    const c = frame({
      question: asked ? "Wer ist noch auf dem Foto?" : "Wer ist auf dem Foto?",
      hint: "Alle antippen, die zu sehen sind.",
      next: () => goAfter("who"),
    });
    if (!(await loadPeople(c, "who"))) return;

    const marked = markedPeople();
    const known = [
      ...state.people.filter((p) => marked.has(p.id)).map((p) => p.name),
      ...Object.values(a.faces).filter((v) => v.new_name).map((v) => `${v.new_name} (neu)`),
    ];
    if (known.length) $("hint").replaceChildren("Schon erkannt: ", el("b", {}, known.join(", ")));

    const filter = searchField("people-filter", state.peopleFilter, "Name eintippen …", "Name");
    c.append(filter);
    const lst = pagedList(c, { getPage: () => state.peoplePage, setPage: (p) => { state.peoplePage = p; } });
    const addNew = (name) => {
      if (!name || a.new_people.some((n) => same(n, name))) return;
      a.new_people.push(name);
      state.peopleFilter = "";
      filter.value = "";
      state.peoplePage = 0;
      saveDraft();
      draw();
      filter.focus();
    };
    const updateNext = () => {
      const n = a.person_ids.length + a.new_people.length;
      $("next").textContent = n ? `Weiter (${n} gewählt) →` : "Niemand sonst →";
      buildSteps();
    };
    const draw = () => {
      const name = cleanName(state.peopleFilter);
      const people = state.people.filter((p) => !marked.has(p.id) && contains(p.name, name));
      const exists = [...state.people.map((p) => p.name), ...a.new_people].some((n) => same(n, name));
      const lead = name && !exists
        ? [newCell(name, people.length ? "Neue Person anlegen" : "Niemand mit diesem Namen – als neue Person anlegen", () => addNew(name))]
        : [];
      // Neu angelegte Personen stehen ausgewählt am Anfang; erneut antippen entfernt sie wieder
      const fresh = a.new_people.map((n, k) => itemCell({
        name: `${n} (neu)`, pressed: true, lead: initialsAvatar(n), cls: "person",
        onClick: () => { a.new_people.splice(k, 1); saveDraft(); draw(); },
      }));
      lst.fill([...fresh, ...people.map((p) => itemCell({
        name: p.name, pressed: a.person_ids.includes(p.id), lead: avatar(p), cls: "person",
        onClick: () => {
          const at = a.person_ids.indexOf(p.id);
          if (at >= 0) a.person_ids.splice(at, 1); else a.person_ids.push(p.id);
          saveDraft();
          draw();
        },
      }))], lead, state.people.length ? "Niemand mit diesem Namen." : "In Immich sind noch keine Personen benannt.");
      updateNext();
    };
    filter.addEventListener("input", () => { state.peopleFilter = filter.value; state.peoplePage = 0; draw(); });
    filter.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const name = cleanName(filter.value);
      if (!name) return;
      const match = state.people.find((p) => same(p.name, name) && !marked.has(p.id));
      if (match) {
        if (!a.person_ids.includes(match.id)) a.person_ids.push(match.id);
        state.peopleFilter = "";
        filter.value = "";
        saveDraft();
        draw();
      } else if (!state.people.some((p) => same(p.name, name))) addNew(name);
    });
    draw();
  },

  async tags() {
    const a = state.answers;
    const c = frame({
      question: "Zu welchen Themen passt das Foto?",
      hint: "Antippen zum Auswählen, mehrere sind möglich.", hintOptional: true,
      skip: () => goAfter("tags"),
      next: () => goAfter("tags"),
    });
    if (!(await loadTags(c, "tags"))) return;

    const chipBox = el("div");
    const search = searchField("tag-search", state.tagQuery, "Thema suchen oder neu eintippen …", "Thema suchen oder neu eintippen");
    const crumbBox = el("div");
    c.append(chipBox, search, crumbBox);
    const lst = pagedList(c, { getPage: () => state.tagPage, setPage: (p) => { state.tagPage = p; } });

    const openFolder = (parts) => {
      state.tagPath = parts;
      state.tagPage = 0;
      state.tagQuery = "";
      search.value = "";
      draw();
    };
    const toggle = (value) => {
      const at = a.tag_values.indexOf(value);
      if (at >= 0) a.tag_values.splice(at, 1); else a.tag_values.push(value);
      saveDraft();
      draw();
    };

    const draw = () => {
      const path = state.tagPath;
      const query = state.tagQuery.trim();
      chipBox.replaceChildren(chips("Ausgewählt:", a.tag_values.map((v) => ({
        label: `${lastPart(v)}${isNewTag(v) ? " (neu)" : ""}`,
        onClick: () => toggle(v),
      }))));
      crumbBox.replaceChildren(...(!query && path.length ? [crumbs(path, openFolder)] : []));

      // Ohne Suche: Themen der aktuellen Ebene. Mit Suche: Treffer aus allen Ebenen, Überthema darunter.
      const prefix = path.length ? `${path.join("/")}/` : "";
      const items = query
        ? [...allTagValues()].filter((v) => contains(lastPart(v), query)).sort((x, y) => x.localeCompare(y, "de"))
        : tagChildren(prefix).map((child) => prefix + child.name);
      const cells = items.map((value) => tagCell(value, {
        pressed: a.tag_values.includes(value),
        showParent: Boolean(query),
        onClick: () => toggle(value),
        onOpen: () => openFolder(value.split("/")),
      }));
      // Gesuchtes Thema gibt es noch nicht: als erster Eintrag „neu anlegen“, danach kommt die Frage nach dem Überthema
      const typed = cleanName(query.replace(/\//g, "-"));
      const exists = [...allTagValues()].some((v) => same(lastPart(v), typed));
      const lead = typed && !exists
        ? [newCell(typed, items.length ? "Neues Thema – danach Überthema wählen" : "Kein Thema mit diesem Namen – neu anlegen?", () => {
          Object.assign(state, { newTagName: typed, ntPath: [...state.tagPath], ntQuery: "", ntPage: 0 });
          go("newtag");
        })]
        : [];
      lst.list.style.setProperty("--item-h", cells.some((cell) => cell.querySelector(".meta")) ? "calc(var(--btn-h) + 8px)" : "var(--btn-h)");
      lst.fill(cells, lead, typed ? "" : path.length ? "Hier gibt es noch keine Unterthemen." : "Es gibt noch keine Themen.");
      buildSteps();
    };

    search.addEventListener("input", () => { state.tagQuery = search.value; state.tagPage = 0; draw(); });
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      lst.list.parentNode.querySelector(".item.new")?.click();
    });
    draw();
  },

  // Neues Thema: Folgefrage „Wohin gehört es?“
  async newtag() {
    const a = state.answers;
    const name = state.newTagName;
    if (!name) {
      state.screen = "tags";
      return SCREENS.tags();
    }
    const c = frame({
      question: `Wohin gehört „${name}“?`,
      hint: "Neues Thema. Überthema antippen – „›“ zeigt Unterthemen.", hintOptional: true,
    });
    if (!(await loadTags(c, "newtag"))) return;

    const create = (parent) => {
      const value = [...parent, name].join("/");
      if (!a.tag_values.includes(value) && !state.asset.tagValues.includes(value)) a.tag_values.push(value);
      Object.assign(state, { tagPath: parent, tagQuery: "", tagPage: 0, newTagName: null });
      goBack();
    };
    const row = el("div", { class: "answers answers-row", role: "group", "aria-label": "Antwort" });
    const search = searchField("newtag-search", state.ntQuery, "Oder Überthema suchen …", "Überthema suchen");
    const crumbBox = el("div");
    c.append(row, search, crumbBox);
    const lst = pagedList(c, { getPage: () => state.ntPage, setPage: (p) => { state.ntPage = p; } });
    const open = (parts) => {
      Object.assign(state, { ntPath: parts, ntQuery: "", ntPage: 0 });
      search.value = "";
      draw();
    };
    const draw = () => {
      const path = state.ntPath;
      const query = state.ntQuery.trim();
      row.replaceChildren(
        path.length && !query ? button(`Unter „${path[path.length - 1]}“ anlegen`, () => create(path), "btn-success") : null,
        button("Ohne Überthema anlegen", () => create([])),
      );
      crumbBox.replaceChildren(...(!query && path.length ? [crumbs(path, open)] : []));
      const prefix = path.length ? `${path.join("/")}/` : "";
      const items = query
        ? [...allTagValues()].filter((v) => !isNewTag(v) && contains(lastPart(v), query)).sort((x, y) => x.localeCompare(y, "de"))
        : tagChildren(prefix).map((child) => prefix + child.name);
      const cells = items.map((value) => tagCell(value, {
        single: true, showParent: Boolean(query),
        onClick: () => create(value.split("/")),
        onOpen: () => open(value.split("/")),
      }));
      lst.list.style.setProperty("--item-h", query ? "calc(var(--btn-h) + 8px)" : "var(--btn-h)");
      lst.fill(cells, [], query ? "Kein Thema mit diesem Namen." : "Hier gibt es keine Unterthemen.");
    };
    search.addEventListener("input", () => { state.ntQuery = search.value; state.ntPage = 0; draw(); });
    search.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
    draw();
  },

  async album() {
    const a = state.answers;
    const c = frame({
      question: "In welches Album gehört das Foto?",
      hint: "Antippen zum Auswählen, mehrere sind möglich.", hintOptional: true,
      skip: () => goAfter("album"),
      next: () => goAfter("album"),
    });
    if (state.albums === null) {
      c.append(el("p", {}, "Alben werden geladen …"));
      try {
        state.albums = await api("/api/albums");
      } catch (err) {
        c.replaceChildren();
        showError(err.message, () => render());
        return;
      }
      if (state.screen !== "album") return;
      c.replaceChildren();
    }

    const already = new Set(state.asset.albumIds);
    const chipBox = el("div");
    const filter = searchField("album-filter", state.albumFilter, "Album suchen oder neu eintippen …", "Album suchen oder neu eintippen", "200");
    c.append(chipBox, filter);
    const lst = pagedList(c, { itemH: "calc(var(--btn-h) + 14px)", getPage: () => state.albumPage, setPage: (p) => { state.albumPage = p; } });
    const addNew = (name) => {
      if (!name || a.new_albums.some((n) => same(n, name))) return;
      a.new_albums.push(name);
      state.albumFilter = "";
      filter.value = "";
      saveDraft();
      draw();
      filter.focus();
    };
    const draw = () => {
      chipBox.replaceChildren(chips("Neu:", a.new_albums.map((n, k) => ({
        label: `${n} (neu)`,
        onClick: () => { a.new_albums.splice(k, 1); saveDraft(); draw(); },
      }))));
      const name = cleanName(state.albumFilter);
      const list = state.albums.filter((al) => contains(al.name, name));
      const exists = [...state.albums.map((al) => al.name), ...a.new_albums].some((n) => same(n, name));
      const lead = name && !exists ? [newCell(name, list.length ? "Neues Album" : "Kein Album mit diesem Namen. Neu anlegen?", () => addNew(name))] : [];
      lst.fill(list.map((al) => {
        const locked = already.has(al.id);
        return itemCell({
          name: al.name,
          meta: locked ? tagLabel("schon drin", "locked") : al.count === 1 ? "1 Foto" : `${al.count} Fotos`,
          locked,
          pressed: a.album_ids.includes(al.id),
          title: locked ? "Das Foto ist schon in diesem Album" : null,
          onClick: () => {
            const at = a.album_ids.indexOf(al.id);
            if (at >= 0) a.album_ids.splice(at, 1); else a.album_ids.push(al.id);
            saveDraft();
            draw();
          },
        });
      }), lead, state.albums.length ? (name ? "" : "Keine Alben.") : "In Immich gibt es noch keine Alben.");
      buildSteps();
    };
    filter.addEventListener("input", () => { state.albumFilter = filter.value; state.albumPage = 0; draw(); });
    filter.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const name = cleanName(filter.value);
      const match = state.albums.find((al) => same(al.name, name));
      if (match && !already.has(match.id) && !a.album_ids.includes(match.id)) {
        a.album_ids.push(match.id);
        state.albumFilter = "";
        filter.value = "";
        saveDraft();
        draw();
      } else if (!match) addNew(name);
    });
    draw();
  },

  summary() {
    const a = state.answers;
    const failed = state.saveError;
    const c = frame({
      question: failed ? "⚠ Das Speichern hat nicht geklappt." : "Stimmt das so?",
      error: Boolean(failed),
      hint: failed ? `${failed} Ihre Angaben sind noch da. Bitte noch einmal versuchen.` : "Mit „Ändern“ lässt sich noch etwas korrigieren.",
      hintOptional: !failed,
      next: saveCurrent,
      nextLabel: failed ? "Noch einmal versuchen" : "Speichern ✔",
      nextCls: "btn-success",
    });
    const names = [...new Set([
      ...askedFaces().map((f) => {
        const v = a.faces[f.id];
        if (v?.new_name) return `${v.new_name} (neu)`;
        return v?.person_id ? personName(v.person_id) : f.personName;
      }),
      ...a.person_ids.map(personName),
      ...a.new_people.map((n) => `${n} (neu)`),
    ].filter(Boolean))];
    const values = {
      when: dateText(a),
      where: a.placeName ? `${a.placeName}${a.placeKind ? ` (${a.placeKind})` : ""}` : null,
      what: a.description.trim() || null,
      who: names.join(", ") || null,
      tags: a.tag_values.map((v) => `${v.split("/").join(" › ")}${isNewTag(v) ? " (neu)" : ""}`).join(", ") || null,
      album: albumNames(a).join(", ") || null,
    };
    const grid = el("div", { class: "summary" });
    for (const step of state.settings.steps) {
      const label = STEP_LABEL[step].replace("?", "");
      grid.append(
        el("div", { class: "k" }, `${label}:`),
        el("div", { class: `v${values[step] ? "" : " none"}` }, el("span", { title: values[step] || null }, values[step] || "nicht angegeben")),
        el("div", {}, el("button", { type: "button", class: "btn btn-quiet", "aria-label": `${label} ändern`, onclick: () => go(STEP_SCREEN[step]) }, "Ändern")),
      );
    }
    const wrap = el("div", { class: "sum-wrap" }, grid);
    const more = el("div", { class: "scroll-hint", hidden: true }, "▼ weiter unten noch mehr");
    const update = () => { more.hidden = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 2; };
    wrap.addEventListener("scroll", update);
    c.append(wrap, more);
    update();
  },
};

// ---------- Themen ----------

async function loadTags(c, screen) {
  if (state.tags !== null) return true;
  c.append(el("p", {}, "Themen werden geladen …"));
  try {
    state.tags = await api("/api/tags");
  } catch (err) {
    c.replaceChildren();
    showError(err.message, () => render());
    return false;
  }
  if (state.screen !== screen) return false;
  c.replaceChildren();
  return true;
}

// Alle bekannten Themen: aus Immich, schon am Bild, und neu angelegte (noch nicht gespeichert)
function allTagValues() {
  return new Set([...(state.tags || []), ...state.asset.tagValues, ...state.answers.tag_values]);
}

function isNewTag(value) {
  return !(state.tags || []).includes(value) && !state.asset.tagValues.includes(value);
}

function lastPart(value) {
  return value.split("/").pop();
}

// Direkte Unterthemen unter einem Pfad-Präfix, mit Anzahl ihrer eigenen Unterthemen
function tagChildren(prefix) {
  const names = new Map();
  for (const value of allTagValues()) {
    if (!value.startsWith(prefix)) continue;
    const rest = value.slice(prefix.length).split("/");
    if (!rest[0]) continue;
    if (!names.has(rest[0])) names.set(rest[0], new Set());
    if (rest.length > 1) names.get(rest[0]).add(rest[1]);
  }
  return [...names.entries()]
    .map(([name, kids]) => ({ name, count: kids.size }))
    .sort((x, y) => x.name.localeCompare(y.name, "de"));
}

// Thema als Listeneintrag; hat es Unterthemen, hängt rechts ein Knopf „4 ›“ an derselben Karte
function tagCell(value, { pressed = false, single = false, showParent = false, onClick, onOpen }) {
  const parts = value.split("/");
  const locked = !single && state.asset.tagValues.includes(value);
  const meta = [
    showParent && parts.length > 1 ? parts.slice(0, -1).join(" › ") : null,
    locked ? tagLabel("schon drin", "locked") : null,
    isNewTag(value) ? tagLabel("neu", "new") : null,
  ].filter(Boolean);
  const cell = itemCell({
    name: parts[parts.length - 1],
    meta: meta.length ? meta.flatMap((m, i) => (i ? [" ", m] : [m])) : null,
    pressed: single ? null : pressed,
    locked,
    cls: single ? "single" : "",
    title: value.split("/").join(" › "),
    onClick,
  });
  const count = tagChildren(`${value}/`).length;
  if (count) {
    cell.classList.add("split");
    cell.append(el("button", {
      type: "button", class: "sub", onclick: onOpen,
      "aria-label": `${count} Unterthemen von ${parts[parts.length - 1]} zeigen`,
      title: `Unterthemen von ${parts[parts.length - 1]}`,
    }, el("span", {}, String(count)), el("span", { class: "arr", "aria-hidden": "true" }, "›")));
  }
  return cell;
}

// ---------- Personen und Gesichter ----------

function personName(id) {
  return (state.people || []).find((p) => p.id === id)?.name;
}

function albumNames(a) {
  return [
    ...a.album_ids.map((id) => (state.albums || []).find((al) => al.id === id)?.name).filter(Boolean),
    ...a.new_albums.map((n) => `${n} (neu)`),
  ];
}

function avatar(p) {
  return el("span", { class: "avatar", "aria-hidden": "true" }, el("img", { src: `/api/people/${p.id}/thumbnail`, alt: "", loading: "lazy" }));
}

function initialsAvatar(name) {
  const letters = name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return el("span", { class: "avatar initials", "aria-hidden": "true" }, letters);
}

// Alle von Immich erkannten Gesichter, auch die schon benannten: jedes wird einzeln abgefragt
function askedFaces() {
  return state.asset?.faces || [];
}

// Wer hängt nach den bisherigen Antworten an einem Gesicht oder am ganzen Bild? Optional ohne ein bestimmtes Gesicht.
function facePerson(f) {
  const v = state.answers.faces[f.id];
  if (v?.person_id) return v.person_id;
  if (v?.new_name) return null;
  return f.personId;
}

function markedPeople(exceptFaceId = null) {
  const ids = new Set(state.asset.personIds);
  for (const f of askedFaces()) {
    // Gesicht wurde jemand anderem zugeordnet: die alte Person hängt dann (über dieses Gesicht) nicht mehr am Bild
    if (f.personId && facePerson(f) !== f.personId && !askedFaces().some((g) => g !== f && facePerson(g) === f.personId)) ids.delete(f.personId);
    if (f.id === exceptFaceId) {
      if (f.personId && !askedFaces().some((g) => g !== f && facePerson(g) === f.personId)) ids.delete(f.personId);
      continue;
    }
    const p = facePerson(f);
    if (p) ids.add(p);
  }
  return ids;
}

async function loadPeople(c, screen) {
  if (state.people !== null) return true;
  c.append(el("p", {}, "Personen werden geladen …"));
  try {
    state.people = await api("/api/people");
  } catch (err) {
    c.replaceChildren();
    showError(err.message, () => render());
    return false;
  }
  if (state.screen !== screen) return false;
  c.replaceChildren();
  return true;
}

// Ausschnitt aus dem Vorschaubild mit etwas Rand um das Gesicht
function faceCrop(f) {
  const pad = 0.35;
  const x = Math.max(0, f.x - f.w * pad), y = Math.max(0, f.y - f.h * pad);
  const w = Math.min(1 - x, f.w * (1 + 2 * pad)), h = Math.min(1 - y, f.h * (1 + 2 * pad));
  const crop = el("div", { class: "face-crop", role: "img", "aria-label": "Das umrandete Gesicht, vergrößert" });
  crop.style.backgroundImage = `url("${$("photo").src}")`;
  crop.style.backgroundSize = `${100 / w}% ${100 / h}%`;
  crop.style.backgroundPosition = `${w < 1 ? (x / (1 - w)) * 100 : 0}% ${h < 1 ? (y / (1 - h)) * 100 : 0}%`;
  crop.style.aspectRatio = String((w * f.aspect) / h);
  return crop;
}

// Oranger Rahmen mit „Gesicht n“ um ein Gesicht im Foto; null blendet ihn aus
let markedFace = null;
function showFaceMark(f, nr = null) {
  markedFace = f;
  $("face-mark-label").textContent = nr ? `Gesicht ${nr}` : "";
  placeFaceMark();
}

function placeFaceMark() {
  const mark = $("face-mark"), img = $("photo");
  mark.hidden = !markedFace || !img.naturalWidth || img.hidden;
  if (mark.hidden) return;
  const f = markedFace;
  Object.assign(mark.style, {
    left: `${img.offsetLeft + f.x * img.offsetWidth}px`,
    top: `${img.offsetTop + f.y * img.offsetHeight}px`,
    width: `${f.w * img.offsetWidth}px`,
    height: `${f.h * img.offsetHeight}px`,
  });
}

// ---------- Ablauf ----------

async function saveCurrent() {
  // Ausgeblendete Fragen schreiben nichts, auch wenn ein alter Entwurf dort Werte hat
  const on = new Set(state.settings.steps);
  const a = {
    ...state.answers,
    ...(on.has("when") ? {} : { year: null, month: null, day: null, approximate: false }),
    ...(on.has("where") ? {} : { latitude: null, longitude: null, placeTag: null }),
    ...(on.has("what") ? {} : { description: "" }),
    ...(on.has("who") ? {} : { person_ids: [], new_people: [], faces: {} }),
    ...(on.has("tags") ? {} : { tag_values: [] }),
    ...(on.has("album") ? {} : { album_ids: [], new_albums: [] }),
  };
  busy(true, "Wird gespeichert …");
  try {
    await api(`/api/assets/${state.asset.id}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year: a.year, month: a.month, day: a.day, approximate: a.approximate,
        latitude: a.latitude, longitude: a.longitude, place_tag: a.placeTag ?? null,
        description: a.description, person_ids: a.person_ids, new_people: a.new_people, tag_values: a.tag_values,
        album_ids: a.album_ids, new_albums: a.new_albums,
        // „Ja“ bei schon zugeordneten Personen und „Weiß ich nicht“ ändern nichts und werden nicht geschickt
        faces: askedFaces()
          .map((f) => [f, a.faces[f.id]])
          .filter(([f, v]) => v && (v.new_name || (v.person_id && v.person_id !== f.personId)))
          .map(([f, v]) => (v.new_name ? { face_id: f.id, new_name: v.new_name } : { face_id: f.id, person_id: v.person_id })),
      }),
    });
  } catch (err) {
    busy(false);
    // Eingaben bleiben erhalten, es kann einfach erneut gespeichert werden.
    state.saveError = err.message;
    render();
    return;
  }
  busy(false);
  dropDraft();
  // Neu angelegte Personen, Alben und Themen sollen beim nächsten Bild in der Auswahl stehen
  if (a.new_people.length || Object.values(a.faces).some((v) => v.new_name)) state.people = null;
  if (a.new_albums.length) state.albums = null;
  if (a.tag_values.some((v) => !(state.tags || []).includes(v))) state.tags = null;
  state.saved++;
  state.index++;
  openImage();
}

function skipImage() {
  dropDraft();
  state.skipped++;
  state.index++;
  openImage();
}

function showPhoto(src) {
  $("photo-error").hidden = true;
  $("photo").hidden = false;
  $("photo-full").hidden = false;
  $("photo").src = src;
}

async function openImage(draft = null) {
  if (state.index >= state.queue.length) return finished();
  const id = state.queue[state.index];
  busy(true, "Bild wird geladen …");
  try {
    state.asset = await api(`/api/assets/${id}`);
  } catch (err) {
    busy(false);
    state.asset = null;
    const c = frame({ question: "Das Bild konnte nicht geladen werden.", photo: false });
    c.append(el("div", { class: "acts" }, button("Dieses Bild überspringen", skipImage)));
    showError(err.message, () => openImage(draft));
    return;
  }
  showPhoto(`/api/assets/${id}/preview`);
  const nextId = state.queue[state.index + 1];
  if (nextId) new Image().src = `/api/assets/${nextId}/preview`;
  busy(false);

  Object.assign(state, freshScreenState(), { saveError: null });
  const steps = [...state.settings.steps, "done"];
  if (draft && draft.id === id && steps.includes(STEP_OF[screenName(draft.screen)])) {
    Object.assign(state, {
      answers: { ...freshAnswers(), ...draft.answers }, screen: draft.screen, history: draft.history, decade: draft.decade,
      newTagName: draft.newTagName || null, ntPath: draft.ntPath || [],
    });
  } else {
    Object.assign(state, { answers: freshAnswers(), screen: STEP_SCREEN[state.settings.steps[0]], history: [], decade: null });
  }
  render();
}

function finished() {
  state.asset = null;
  state.answers = null;
  state.screen = null;
  dropDraft();
  const c = frame({ question: "Geschafft!", photo: false });
  if (state.saved) {
    c.append(el("p", { class: "lead" }, el("span", { class: "big-num" }, images(state.saved)), state.saved === 1 ? " ist gespeichert." : " sind gespeichert."));
  } else if (!state.skipped) {
    c.append(el("p", { class: "lead" }, "Im Moment gibt es keine Bilder zum Bearbeiten."));
  }
  if (state.skipped) {
    c.append(el("p", { class: "soft" }, `${images(state.skipped)} haben Sie für später aufgehoben. ${state.skipped === 1 ? "Es kommt" : "Die kommen"} beim nächsten Mal wieder.`));
  } else {
    c.append(el("p", { class: "soft" }, "Sie können das Fenster jetzt schließen."));
  }
  c.append(el("div", { class: "acts" },
    state.skipped ? button("Aufgehobene Bilder jetzt ansehen", restart, "btn-primary btn-hero") : null,
    settingsButton(), fullscreenButton()));
}

function settingsButton() {
  return el("button", { type: "button", class: "btn btn-quiet", onclick: showSettings }, icon("gear"), el("span", {}, "Fragen einstellen"));
}

// Einstellungen: welche Fragen in welcher Reihenfolge. Gilt für alle Bilder, gespeichert auf dem Laptop.
function showSettings() {
  const on = state.settings.steps;
  const work = [...on, ...ALL_STEPS.filter((s) => !on.includes(s))].map((step) => ({ step, on: on.includes(step) }));

  const save = async () => {
    const steps = work.filter((w) => w.on).map((w) => w.step);
    if (!steps.length) {
      showError("Mindestens eine Frage muss eingeschaltet bleiben.");
      return;
    }
    busy(true, "Wird gespeichert …");
    try {
      await api("/api/settings/steps", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-dia-assistent": "1" },
        body: JSON.stringify({ steps }),
      });
    } catch (err) {
      busy(false);
      showError(err.message, save);
      return;
    }
    busy(false);
    restart();
  };

  state.screen = "settings";
  const c = frame({
    question: "Fragen einstellen",
    hint: "Antippen schaltet eine Frage ein oder aus. Mit ↑ ↓ ändern Sie die Reihenfolge.",
    photo: false, wide: true,
    next: save, nextLabel: "Speichern ✔", nextCls: "btn-success",
    backLabel: "Abbrechen", onBack: restart,
  });
  const list = el("div", { class: "settings-list" });
  const draw = (focus = null) => {
    list.replaceChildren();
    work.forEach((w, i) => {
      const toggle = el("button", {
        type: "button", class: `item${w.on ? "" : " off"}`, "aria-pressed": String(w.on),
      },
      el("span", { class: "check", "aria-hidden": "true" }, w.on ? "✔" : "✕"),
      el("span", { class: "body" }, el("span", { class: "name" }, STEP_TEXT[w.step])),
      el("span", { class: "state" }, w.on ? "wird gefragt" : "ausgeblendet"));
      toggle.addEventListener("click", () => { w.on = !w.on; clearError(); draw([i, 0]); });
      const move = (to, label, sign) => {
        const b = el("button", { type: "button", class: "btn mv", "aria-label": `${STEP_LABEL[w.step]} ${label}`, title: label }, sign);
        b.disabled = to < 0 || to >= work.length;
        b.addEventListener("click", () => {
          [work[i], work[to]] = [work[to], work[i]];
          // Fokus bleibt am verschobenen Eintrag, am Rand auf dem anderen Pfeil
          const up = sign === "↑";
          const atEdge = up ? to === 0 : to === work.length - 1;
          draw([to, up !== atEdge ? 1 : 2]);
        });
        return b;
      };
      list.append(el("div", { class: "set-row" }, toggle, move(i - 1, "nach oben", "↑"), move(i + 1, "nach unten", "↓")));
    });
    if (focus) list.children[focus[0]]?.children[focus[1]]?.focus({ preventScroll: true });
    updateMore();
  };
  // Reicht der Platz nicht, scrollt die Liste; der Hinweis zeigt, dass unten noch etwas kommt
  const more = el("p", { class: "scroll-hint" }, "▼ Weitere Fragen: nach unten scrollen");
  const updateMore = () => { more.hidden = list.scrollTop + list.clientHeight >= list.scrollHeight - 2; };
  list.addEventListener("scroll", updateMore);
  new ResizeObserver(updateMore).observe(list);
  c.append(list, more);
  draw();
}

function restart() {
  Object.assign(state, { queue: [], index: 0, saved: 0, skipped: 0, tags: null, people: null, albums: null });
  start();
}

async function start() {
  state.asset = null;
  state.answers = null;
  frame({ question: "Bilder werden gesucht …", photo: false });
  try {
    state.settings = await api("/api/settings");
    state.queue = (await api("/api/queue")).ids;
  } catch (err) {
    frame({ question: "Es kann gerade nicht losgehen.", photo: false });
    showError(err.message, start);
    return;
  }
  if (!state.queue.length) return finished();

  const draft = loadDraft();
  const at = draft ? state.queue.indexOf(draft.id) : -1;
  if (at > 0) {
    // angefangenes Bild nach vorne holen
    state.queue.splice(at, 1);
    state.queue.unshift(draft.id);
  }

  const n = state.queue.length;
  const c = frame({ question: "Guten Tag!", photo: false });
  const begin = button("Los geht's →", () => openImage(at >= 0 ? draft : null), "btn-primary btn-hero");
  c.append(
    el("p", { class: "lead" }, el("span", { class: "big-num" }, images(n)), n === 1 ? " wartet darauf, beschriftet zu werden." : " warten darauf, beschriftet zu werden."),
    el("p", { class: "soft" }, "Zu jedem Bild gibt es ein paar kurze Fragen. Wenn Sie etwas nicht wissen, ist das nicht schlimm – dann tippen Sie einfach auf „Weiß ich nicht“."),
    el("div", { class: "acts" }, begin, settingsButton(), fullscreenButton()),
  );
  // Immer auf „Los geht's“: der vorher fokussierte Knopf ist jetzt ausgeblendet.
  // Der Fokusrahmen erscheint trotzdem nur bei Tastaturbedienung (:focus-visible).
  begin.focus({ preventScroll: true });
}

// Bild bildschirmfüllend anzeigen. Schließen per Knopf, Klick ins Bild oder Esc.
function openViewer() {
  if (!$("photo").naturalWidth) return;
  $("viewer-photo").src = $("photo").src;
  $("viewer").hidden = false;
  $("top").inert = $("main").inert = true;
  $("viewer-close").focus({ preventScroll: true });
}

function closeViewer() {
  $("viewer").hidden = true;
  $("top").inert = $("main").inert = false;
  if (state.keyboard) $("photo-full").focus({ preventScroll: true });
}

// Vollbild ein/aus. Die Knöpfe folgen dem tatsächlichen Zustand, auch wenn per Esc verlassen wird.
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    showError("Vollbild ist in diesem Browser gerade nicht möglich. Alternativ die Taste F11 drücken.");
  }
}

function updateFullscreenButtons() {
  const on = Boolean(document.fullscreenElement);
  for (const b of document.querySelectorAll(".fs-toggle")) {
    b.replaceChildren(icon(on ? "exit" : "full"), el("span", {}, on ? "Vollbild beenden" : "Vollbild"));
    b.setAttribute("aria-pressed", String(on));
  }
}

// Vollbild-Knopf für Seiten ohne Kopfleiste (Start, Geschafft)
function fullscreenButton() {
  if (!document.fullscreenEnabled) return null;
  const b = el("button", { type: "button", class: "btn btn-quiet fs-toggle", "aria-pressed": "false", onclick: toggleFullscreen });
  queueMicrotask(updateFullscreenButtons);
  return b;
}

if (document.fullscreenEnabled) {
  $("fullscreen").hidden = false;
  $("fullscreen").addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", updateFullscreenButtons);
  updateFullscreenButtons();
}

// Fenstergröße geändert (z. B. Vollbild): Listen neu aufteilen, Gesichtsrahmen neu setzen
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.asset && state.screen && state.screen !== "settings") render(); }, 150);
  placeFaceMark();
});

document.addEventListener("keydown", () => { state.keyboard = true; }, true);
document.addEventListener("pointerdown", () => { state.keyboard = false; }, true);
$("skip-image").addEventListener("click", skipImage);
$("error-retry").addEventListener("click", () => { const r = state.retry; clearError(); if (r) r(); });
$("photo").addEventListener("error", () => {
  if (!$("photo").getAttribute("src")) return;
  $("photo").hidden = true;
  $("photo-full").hidden = true;
  $("photo-error").hidden = false;
  placeFaceMark();
});
$("photo-retry").addEventListener("click", () => {
  if (state.asset) showPhoto(`/api/assets/${state.asset.id}/preview?neu=${Date.now()}`);
});
document.addEventListener("keydown", (e) => {
  if (!$("viewer").hidden) {
    if (e.key === "Escape") closeViewer();
    return;
  }
  if (e.key !== "Escape" || !state.asset || !$("busy").hidden) return;
  // Esc im Suchfeld mit Text: erst das Feld leeren, dann erst zurück
  const t = e.target;
  if (t instanceof HTMLInputElement && t.value) {
    e.preventDefault();
    t.value = "";
    t.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  goBack();
});

$("photo").addEventListener("click", openViewer);
$("photo").addEventListener("load", placeFaceMark);
$("photo-full").addEventListener("click", openViewer);
$("viewer").addEventListener("click", closeViewer);
start();
