"use strict";

// Dia-Assistent: geführte Oberfläche. Eine Frage pro Bildschirm.

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
  "August", "September", "Oktober", "November", "Dezember"];
const STEP_OF = {
  decade: "when", year: "when", month: "when", day: "when", certainty: "when",
  place: "where", what: "what", who: "who", tags: "tags", newtag: "tags", summary: "done",
};
// Fragen-Blöcke: Reihenfolge und Sichtbarkeit kommen aus den Einstellungen
const ALL_STEPS = ["when", "where", "what", "who", "tags"];
const STEP_LABEL = { when: "Wann?", where: "Wo?", what: "Was?", who: "Wer?", tags: "Themen" };
const STEP_TEXT = {
  when: "Wann? – Datum", where: "Wo? – Ort", what: "Was? – Beschreibung",
  who: "Wer? – Personen", tags: "Themen",
};
const STEP_SCREEN = { when: "decade", where: "place", what: "what", who: "who", tags: "tags" };
const PEOPLE_PER_PAGE = 6;
const TAG_ROW = 64 + 10; // Zeilenhöhe + Abstand, passend zu .tag-list in app.css
const DRAFT_KEY = "dia-assistent-entwurf";

const $ = (id) => document.getElementById(id);

const state = {
  settings: { yearFrom: 1940, yearTo: 2010, steps: ALL_STEPS },
  queue: [],
  index: 0,
  saved: 0,
  skipped: 0,
  people: null,
  asset: null,
  answers: null,
  screen: null,
  history: [],
  decade: null,
  placeResults: [],
  peoplePage: 0,
  peopleFilter: "",
  tags: null,
  tagPath: [],
  tagPage: 0,
  tagQuery: "",
  keyboard: false,
  retry: null,
};

function freshAnswers() {
  return {
    year: null, month: null, day: null, approximate: false,
    latitude: null, longitude: null, placeName: null,
    description: "", person_ids: [], tag_values: [],
  };
}

// ---------- Hilfsfunktionen ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "onclick") node.addEventListener("click", value);
    else if (key in node && typeof value !== "string") node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
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
      history: state.history, decade: state.decade,
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
  if (a.year == null) return "nicht angegeben";
  let text = String(a.year);
  if (a.month != null) text = `${MONTHS[a.month - 1]} ${text}`;
  if (a.day != null) text = `${a.day}. ${text}`;
  return a.approximate ? `${text} (ungefähr)` : text;
}

// ---------- Rahmen ----------

function frame({ question, hint = "", back = true, next = null, nextLabel = "Weiter →", photo = true }) {
  clearError();
  $("question").textContent = question;
  $("hint").textContent = hint;
  $("photo-box").hidden = !photo;
  $("skip-image").hidden = !photo;
  $("steps").hidden = !photo;
  $("back").hidden = !photo;
  $("back").disabled = !back || state.history.length === 0;
  $("next").hidden = !next;
  $("next").textContent = nextLabel;
  $("next").onclick = next;
  $("next").className = nextLabel.startsWith("Speichern") ? "btn btn-good" : "btn btn-primary";

  const step = STEP_OF[state.screen];
  const order = [...state.settings.steps, "done"];
  for (const li of $("steps").children) {
    const pos = order.indexOf(li.dataset.step);
    li.className = li.dataset.step === step ? "current" : pos < order.indexOf(step) ? "done" : "";
  }

  if (state.queue.length) {
    const nr = Math.min(state.index + 1, state.queue.length);
    $("progress-text").textContent = `Bild ${nr} von ${state.queue.length}`;
    $("progress-fill").style.width = `${(state.index / state.queue.length) * 100}%`;
  }

  const content = $("content");
  content.replaceChildren();
  return content;
}

function go(screen) {
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

// Fortschrittsleiste oben passend zum eingestellten Ablauf aufbauen
function buildStepList() {
  $("steps").replaceChildren(...[...state.settings.steps, "done"].map((step) =>
    el("li", { "data-step": step }, step === "done" ? "Fertig" : STEP_LABEL[step])));
}

function back() {
  if (!state.history.length) return;
  state.screen = state.history.pop();
  render();
}

function render() {
  saveDraft();
  SCREENS[state.screen]();
  // Textfelder bekommen immer den Fokus, Knöpfe nur bei Tastaturbedienung:
  // ein sichtbarer Fokusrahmen ohne Tastatur würde wie eine Auswahl aussehen.
  const field = $("content").querySelector("input, textarea");
  const first = field || (state.keyboard && $("content").querySelector(".btn.selected, .btn"));
  if (first) first.focus({ preventScroll: true });
}

// ---------- Bildschirme ----------

const SCREENS = {
  decade() {
    const c = frame({ question: "Wann wurde das Foto gemacht?", hint: "Welches Jahrzehnt?" });
    const grid = el("div", { class: "grid cols-4" });
    const from = Math.floor(state.settings.yearFrom / 10) * 10;
    for (let d = from; d <= state.settings.yearTo; d += 10) {
      const cls = state.answers.year != null && Math.floor(state.answers.year / 10) * 10 === d ? "selected" : "";
      grid.append(button(decadeName(d), () => { state.decade = d; go("year"); }, cls));
    }
    c.append(grid, button("Weiß ich nicht", () => {
      Object.assign(state.answers, { year: null, month: null, day: null, approximate: false });
      goAfter("when");
    }, "btn-wide"));
  },

  year() {
    const d = state.decade;
    const c = frame({ question: "Welches Jahr?", hint: `Die ${decadeName(d)} Jahre` });
    const grid = el("div", { class: "grid cols-5", style: "grid-template-columns: repeat(5, 1fr)" });
    for (let y = d; y < d + 10; y++) {
      grid.append(button(String(y), () => {
        Object.assign(state.answers, { year: y, approximate: false });
        go("month");
      }, state.answers.year === y && !state.answers.approximate ? "selected" : ""));
    }
    c.append(grid, button(`Irgendwann in den ${decadeName(d)}n`, () => {
      Object.assign(state.answers, { year: d + 5, month: null, day: null, approximate: true });
      goAfter("when");
    }, "btn-wide"));
  },

  month() {
    const c = frame({ question: "Welcher Monat?", hint: `Im Jahr ${state.answers.year}` });
    const grid = el("div", { class: "grid cols-3" });
    MONTHS.forEach((name, i) => grid.append(button(name, () => {
      state.answers.month = i + 1;
      go("day");
    }, state.answers.month === i + 1 ? "selected" : "")));
    c.append(grid, button("Weiß ich nicht", () => {
      Object.assign(state.answers, { month: null, day: null });
      go("certainty");
    }, "btn-wide"));
  },

  day() {
    const a = state.answers;
    const c = frame({ question: "Welcher Tag?", hint: `${MONTHS[a.month - 1]} ${a.year}` });
    const grid = el("div", { class: "grid cols-7" });
    const days = new Date(a.year, a.month, 0).getDate();
    for (let d = 1; d <= days; d++) {
      grid.append(button(String(d), () => { a.day = d; go("certainty"); }, a.day === d ? "selected" : ""));
    }
    // "Weiß ich nicht" füllt die letzte Reihe auf, damit nichts gescrollt werden muss
    const unknown = button("Weiß ich nicht", () => { a.day = null; go("certainty"); });
    unknown.style.gridColumn = `span ${7 - (days % 7)}`;
    grid.append(unknown);
    c.append(grid);
  },

  certainty() {
    const a = state.answers;
    const c = frame({ question: "Wie sicher ist das Datum?", hint: dateText({ ...a, approximate: false }) });
    c.append(el("div", { class: "grid cols-2" },
      button("Ganz sicher", () => { a.approximate = false; goAfter("when"); }, a.approximate ? "" : "selected"),
      button("Nur ungefähr", () => { a.approximate = true; goAfter("when"); }, a.approximate ? "selected" : ""),
    ));
  },

  place() {
    const a = state.answers;
    const c = frame({
      question: "Wo wurde das Foto gemacht?",
      hint: "Ort eintippen, dann auf „Suchen“ drücken.",
      next: () => goAfter("where"),
    });
    const input = el("input", { type: "text", id: "place-input", placeholder: "z. B. Rüdesheim am Rhein", autocomplete: "off" });
    const results = el("div", { class: "grid", id: "place-results" });
    const search = async () => {
      const q = input.value.trim();
      if (q.length < 2) return;
      clearError();
      results.replaceChildren(el("p", {}, "Suche läuft …"));
      try {
        state.placeResults = await api(`/api/places?q=${encodeURIComponent(q)}`);
        showPlaceResults(results);
        const firstResult = results.querySelector(".btn");
        if (firstResult) firstResult.focus();
      } catch (err) {
        results.replaceChildren();
        showError(err.message, search);
      }
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
    c.append(el("div", { class: "row" }, input, button("Suchen", search, "btn-primary")));
    if (a.placeName) {
      c.append(el("div", { class: "chosen" }, `Gewählt: ${a.placeName} `,
        button("Entfernen", () => {
          Object.assign(a, { latitude: null, longitude: null, placeName: null });
          render();
        }, "btn-quiet")));
    } else if (state.asset.city) {
      c.append(el("div", { class: "existing" }, `In Immich steht bisher: ${state.asset.city}`));
    }
    c.append(results);
    showPlaceResults(results);
  },

  what() {
    const a = state.answers;
    const c = frame({
      question: "Was ist auf dem Foto zu sehen?",
      hint: "Ein paar Worte genügen.",
      next: () => goAfter("what"),
    });
    if (state.asset.description) {
      c.append(el("div", { class: "existing" }, `Bisher steht da: ${state.asset.description}`));
    }
    const text = el("textarea", { id: "what-input", placeholder: "z. B. Sonntagsausflug mit dem neuen Auto", maxlength: "5000" });
    text.value = a.description;
    text.addEventListener("input", () => { a.description = text.value; saveDraft(); });
    c.append(text);
  },

  async who() {
    const a = state.answers;
    const c = frame({
      question: "Wer ist auf dem Foto?",
      hint: "Alle antippen, die zu sehen sind.",
      next: () => goAfter("who"),
    });
    if (state.people === null) {
      c.append(el("p", {}, "Personen werden geladen …"));
      try {
        state.people = await api("/api/people");
      } catch (err) {
        c.replaceChildren();
        showError(err.message, () => render());
        return;
      }
      if (state.screen !== "who") return;
      c.replaceChildren();
    }

    const filter = el("input", { type: "text", placeholder: "Name suchen …", autocomplete: "off", value: state.peopleFilter });
    const grid = el("div", { class: "people" });
    const pager = el("div", { class: "row" });
    const draw = () => {
      const q = state.peopleFilter.toLowerCase();
      const list = state.people.filter((p) => p.name.toLowerCase().includes(q));
      const pages = Math.max(1, Math.ceil(list.length / PEOPLE_PER_PAGE));
      state.peoplePage = Math.min(state.peoplePage, pages - 1);
      grid.replaceChildren();
      if (!list.length) grid.append(el("p", {}, state.people.length ? "Niemand mit diesem Namen." : "In Immich sind noch keine Personen benannt."));
      for (const p of list.slice(state.peoplePage * PEOPLE_PER_PAGE, (state.peoplePage + 1) * PEOPLE_PER_PAGE)) {
        const already = state.asset.personIds.includes(p.id);
        const chosen = already || a.person_ids.includes(p.id);
        const card = el("button", {
          type: "button",
          class: `btn person${chosen ? " selected" : ""}`,
          "aria-pressed": String(chosen),
          disabled: already,
          title: already ? "Ist schon zugeordnet" : p.name,
        }, el("img", { src: `/api/people/${p.id}/thumbnail`, alt: "", loading: "lazy" }), el("span", {}, p.name));
        card.addEventListener("click", () => {
          const pos = [...grid.children].indexOf(card);
          const i = a.person_ids.indexOf(p.id);
          if (i >= 0) a.person_ids.splice(i, 1); else a.person_ids.push(p.id);
          saveDraft();
          draw();
          grid.children[pos]?.focus();
        });
        grid.append(card);
      }
      pager.replaceChildren();
      if (pages > 1) {
        pager.append(
          button("← Vorherige", () => { state.peoplePage--; draw(); }, "btn-quiet"),
          el("span", { style: "align-self:center" }, `Seite ${state.peoplePage + 1} von ${pages}`),
          button("Weitere →", () => { state.peoplePage++; draw(); }, "btn-quiet"),
        );
        pager.children[0].disabled = state.peoplePage === 0;
        pager.children[2].disabled = state.peoplePage >= pages - 1;
      }
    };
    filter.addEventListener("input", () => { state.peopleFilter = filter.value; state.peoplePage = 0; draw(); });
    if (state.people.length > PEOPLE_PER_PAGE) c.append(filter);
    c.append(grid, pager);
    draw();
  },

  summary() {
    const a = state.answers;
    const c = frame({
      question: "Stimmt das so?",
      hint: "Mit „Zurück“ lässt sich noch etwas ändern.",
      next: saveCurrent,
      nextLabel: "Speichern ✔",
    });
    const names = a.person_ids
      .map((id) => (state.people || []).find((p) => p.id === id))
      .filter(Boolean).map((p) => p.name);
    const rows = {
      when: ["Wann:", dateText(a)],
      where: ["Wo:", a.placeName || "nicht angegeben"],
      what: ["Was:", a.description.trim() || "nicht angegeben"],
      who: ["Wer:", names.length ? names.join(", ") : "nicht angegeben"],
      tags: ["Themen:", a.tag_values.length ? a.tag_values.map(tagLabel).join(", ") : "nicht angegeben"],
    };
    c.append(el("dl", { class: "summary" },
      state.settings.steps.flatMap((step) => [el("dt", {}, rows[step][0]), el("dd", {}, rows[step][1])])));
  },

  async tags() {
    const a = state.answers;
    const c = frame({
      question: "Zu welchen Themen passt das Foto?",
      hint: "Antippen zum Auswählen. „›“ zeigt Unterthemen.",
      next: () => goAfter("tags"),
    });
    if (state.tags === null) {
      c.append(el("p", {}, "Themen werden geladen …"));
      try {
        state.tags = await api("/api/tags");
      } catch (err) {
        c.replaceChildren();
        showError(err.message, () => render());
        return;
      }
      if (state.screen !== "tags") return;
      c.replaceChildren();
    }

    const search = el("input", {
      type: "text", id: "tag-search", placeholder: "Thema suchen …", autocomplete: "off", value: state.tagQuery,
    });
    const clear = button("✕ Leeren", () => { state.tagQuery = ""; search.value = ""; state.tagPage = 0; draw(); search.focus(); }, "btn-quiet");
    const crumbs = el("div", { class: "crumbs" });
    const list = el("div", { class: "tag-list" });
    const bottom = el("div", { class: "row tag-bottom" });

    const openFolder = (parts) => {
      state.tagPath = parts;
      state.tagPage = 0;
      state.tagQuery = "";
      search.value = "";
      draw();
    };

    const draw = () => {
      const path = state.tagPath;
      const prefix = path.length ? `${path.join("/")}/` : "";
      const query = state.tagQuery.trim().toLocaleLowerCase("de");
      clear.hidden = !query;

      // Ohne Suche: Unterthemen der aktuellen Ebene. Mit Suche: Treffer aus allen Ebenen.
      let items;
      if (query) {
        items = [...allTagValues()]
          .filter((value) => value.split("/").some((part) => part.toLocaleLowerCase("de").includes(query)))
          .sort((x, y) => x.localeCompare(y, "de"))
          .map((value) => ({ value, name: value.split("/").pop(), parent: value.split("/").slice(0, -1) }));
      } else {
        items = tagChildren(prefix).map((child) => ({ value: prefix + child.name, name: child.name, parent: null }));
      }
      // Pfadleiste: Alle Themen › Urlaub › Italien (bei der Suche ausgeblendet)
      crumbs.replaceChildren();
      crumbs.hidden = Boolean(query);
      const crumb = (label, depth) => depth === path.length
        ? el("span", { class: "crumb-here" }, label)
        : button(label, () => openFolder(path.slice(0, depth)), "btn-quiet");
      crumbs.append(crumb("Alle Themen", 0));
      path.forEach((part, i) => crumbs.append(el("span", { class: "crumb-sep" }, "›"), crumb(part, i + 1)));

      // So viele Zeilen wie in die verfügbare Höhe passen (mindestens 2), je 2 Themen pro Zeile.
      // Erst Pfadleiste/Seitenknöpfe setzen, dann messen: die Liste bekommt den Rest.
      bottom.replaceChildren(button("←", null, "btn-quiet"));
      list.replaceChildren();
      const perPage = 2 * Math.max(2, Math.floor((list.clientHeight + 10) / TAG_ROW));
      const pages = Math.max(1, Math.ceil(items.length / perPage));
      state.tagPage = Math.min(state.tagPage, pages - 1);

      if (!items.length) {
        list.append(el("p", {}, query ? "Kein Thema gefunden." : path.length ? "Hier gibt es noch keine Unterthemen." : "Es gibt noch keine Themen."));
      }
      for (const item of items.slice(state.tagPage * perPage, (state.tagPage + 1) * perPage)) {
        const already = state.asset.tagValues.includes(item.value);
        const chosen = already || a.tag_values.includes(item.value);
        const count = tagChildren(`${item.value}/`).length;
        const toggle = el("button", {
          type: "button",
          class: `btn tag-toggle${chosen ? " selected" : ""}`,
          "aria-pressed": String(chosen),
          disabled: already,
          title: already ? "Ist schon zugeordnet" : tagLabel(item.value),
        }, el("span", {}, item.name), item.parent && item.parent.length ? el("small", {}, item.parent.join(" › ")) : null);
        toggle.addEventListener("click", () => {
          const i = a.tag_values.indexOf(item.value);
          if (i >= 0) a.tag_values.splice(i, 1); else a.tag_values.push(item.value);
          saveDraft();
          const pos = [...list.children].indexOf(toggle.parentNode);
          draw();
          list.children[pos]?.firstChild?.focus({ preventScroll: true });
        });
        const open = el("button", {
          type: "button",
          class: `btn tag-open${count ? "" : " empty"}`,
          "aria-label": `Unterthemen von ${item.name}`,
          title: `Unterthemen von ${item.name}`,
        }, count ? `${count} ›` : "›");
        open.addEventListener("click", () => openFolder(item.value.split("/")));
        list.append(el("div", { class: "tag-item" }, toggle, open));
      }

      bottom.replaceChildren();
      if (pages > 1) {
        const prev = button("←", () => { state.tagPage--; draw(); }, "btn-quiet");
        const nextPage = button("→", () => { state.tagPage++; draw(); }, "btn-quiet");
        prev.disabled = state.tagPage === 0;
        nextPage.disabled = state.tagPage >= pages - 1;
        prev.setAttribute("aria-label", "Vorherige Seite");
        nextPage.setAttribute("aria-label", "Nächste Seite");
        bottom.append(prev, el("span", { class: "page-info" }, `${state.tagPage + 1}/${pages}`), nextPage);
      }
      const typed = state.tagQuery.replace(/\//g, "-").trim();
      if (typed) {
        // Gesuchtes Thema gibt es auf dieser Ebene nicht: direkt anlegen anbieten
        const value = prefix + typed;
        const exists = [...allTagValues()].some((v) => v.toLocaleLowerCase("de") === value.toLocaleLowerCase("de"));
        if (!exists) {
          const where = path.length ? ` unter „${path[path.length - 1]}“` : "";
          bottom.append(button(`+ „${typed}“${where} anlegen`, () => {
            a.tag_values.push(value);
            state.tagQuery = "";
            search.value = "";
            saveDraft();
            draw();
          }, "btn-quiet btn-new"));
        }
      } else {
        bottom.append(button(path.length ? "+ Neues Unterthema" : "+ Neues Thema", () => go("newtag"), "btn-quiet btn-new"));
      }
    };

    search.addEventListener("input", () => { state.tagQuery = search.value; state.tagPage = 0; draw(); });
    search.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
    c.append(el("div", { class: "row" }, search, clear), crumbs, list, bottom);
    draw();
  },

  newtag() {
    const path = state.tagPath;
    const c = frame({
      question: path.length ? "Neues Unterthema anlegen" : "Neues Thema anlegen",
      hint: path.length ? `Kommt unter: ${path.join(" › ")}` : "Wird ein Hauptthema.",
    });
    const input = el("input", { type: "text", id: "newtag-input", placeholder: "z. B. Weihnachten", maxlength: "100", autocomplete: "off" });
    const create = () => {
      const name = input.value.replace(/\//g, "-").trim();
      if (!name) {
        showError("Bitte einen Namen eintippen.");
        return;
      }
      const value = path.length ? `${path.join("/")}/${name}` : name;
      if (!state.answers.tag_values.includes(value) && !state.asset.tagValues.includes(value)) {
        state.answers.tag_values.push(value);
      }
      back();
    };
    // preventDefault: sonst löst Enter nach dem Seitenwechsel den neu fokussierten Knopf aus
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); create(); } });
    c.append(
      el("div", { class: "row" }, input, button("Anlegen", create, "btn-primary")),
      el("p", {}, "Das neue Thema wird beim Speichern in Immich angelegt und diesem Foto zugeordnet."),
    );
  },
};

// Alle bekannten Themen: aus Immich, schon am Bild, und neu angelegte (noch nicht gespeichert)
function allTagValues() {
  return new Set([...(state.tags || []), ...state.asset.tagValues, ...state.answers.tag_values]);
}

// Direkte Unterthemen unter einem Pfad-Präfix, mit Anzahl ihrer eigenen Unterthemen
function tagChildren(prefix) {
  const values = [...allTagValues()];
  const names = new Map();
  for (const value of values) {
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

function tagLabel(value) {
  return value.split("/").join(" › ");
}

function showPlaceResults(container) {
  const a = state.answers;
  container.replaceChildren();
  if (!state.placeResults.length) return;
  for (const r of state.placeResults.slice(0, 3)) {
    container.append(el("button", {
      type: "button",
      class: `btn place-result${a.latitude === r.lat && a.longitude === r.lon ? " selected" : ""}`,
      onclick: () => {
        Object.assign(a, { latitude: r.lat, longitude: r.lon, placeName: r.name });
        goAfter("where");
      },
    }, r.name, el("small", {}, r.detail)));
  }
}

// ---------- Ablauf ----------

async function saveCurrent() {
  // Ausgeblendete Fragen schreiben nichts, auch wenn ein alter Entwurf dort Werte hat
  const on = new Set(state.settings.steps);
  const a = {
    ...state.answers,
    ...(on.has("when") ? {} : { year: null, month: null, day: null, approximate: false }),
    ...(on.has("where") ? {} : { latitude: null, longitude: null }),
    ...(on.has("what") ? {} : { description: "" }),
    ...(on.has("who") ? {} : { person_ids: [] }),
    ...(on.has("tags") ? {} : { tag_values: [] }),
  };
  busy(true, "Wird gespeichert …");
  try {
    await api(`/api/assets/${state.asset.id}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year: a.year, month: a.month, day: a.day, approximate: a.approximate,
        latitude: a.latitude, longitude: a.longitude,
        description: a.description, person_ids: a.person_ids, tag_values: a.tag_values,
      }),
    });
  } catch (err) {
    busy(false);
    // Eingaben bleiben erhalten, es kann einfach erneut gespeichert werden.
    showError(`${err.message} Ihre Eingaben bleiben erhalten.`, saveCurrent);
    return;
  }
  busy(false);
  dropDraft();
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

async function openImage(draft = null) {
  if (state.index >= state.queue.length) return finished();
  const id = state.queue[state.index];
  busy(true, "Bild wird geladen …");
  try {
    state.asset = await api(`/api/assets/${id}`);
  } catch (err) {
    busy(false);
    const c = frame({ question: "Das Bild konnte nicht geladen werden.", photo: false });
    c.append(button("Dieses Bild überspringen", skipImage, "btn-wide"));
    showError(err.message, () => openImage(draft));
    return;
  }
  Object.assign(view, { rot: 0, flip: false });
  $("photo").src = `/api/assets/${id}/preview`;
  updateView();
  const nextId = state.queue[state.index + 1];
  if (nextId) new Image().src = `/api/assets/${nextId}/preview`;
  busy(false);

  state.placeResults = [];
  state.peoplePage = 0;
  state.peopleFilter = "";
  state.tagPath = [];
  state.tagPage = 0;
  state.tagQuery = "";
  const steps = [...state.settings.steps, "done"];
  if (draft && draft.id === id && steps.includes(STEP_OF[draft.screen])) {
    Object.assign(state, { answers: { ...freshAnswers(), ...draft.answers }, screen: draft.screen, history: draft.history, decade: draft.decade });
  } else {
    Object.assign(state, { answers: freshAnswers(), screen: STEP_SCREEN[state.settings.steps[0]], history: [], decade: null });
  }
  render();
}

function finished() {
  state.asset = null;
  state.screen = null;
  dropDraft();
  $("progress-fill").style.width = "100%";
  $("progress-text").textContent = "Fertig";
  const c = frame({ question: "Geschafft!", photo: false });
  const lines = [];
  if (state.saved) lines.push(`${images(state.saved)} gespeichert.`);
  if (state.skipped) lines.push(`${images(state.skipped)} für später aufgehoben.`);
  if (!lines.length) lines.push("Im Moment gibt es keine Bilder zum Bearbeiten.");
  c.append(...lines.map((t) => el("p", { class: "big" }, t)));
  if (state.skipped) {
    c.append(button("Von vorne anfangen", restart, "btn-primary big"),
      el("p", {}, "Dann kommen die aufgehobenen Bilder noch einmal."));
  } else {
    c.append(el("p", {}, "Sie können das Fenster jetzt schließen."));
  }
  c.append(settingsButton());
}

function settingsButton() {
  return button("⚙ Fragen einstellen", showSettings, "btn-quiet settings-open");
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
    question: "Welche Fragen, in welcher Reihenfolge?",
    hint: "Antippen schaltet eine Frage ein oder aus. Mit ↑ und ↓ die Reihenfolge ändern.",
    photo: false, next: save, nextLabel: "Speichern ✔",
  });
  const list = el("div", { class: "settings-list" });
  const draw = (focus = null) => {
    list.replaceChildren();
    work.forEach((w, i) => {
      const toggle = el("button", {
        type: "button",
        class: `btn settings-toggle${w.on ? " selected" : ""}`,
        "aria-pressed": String(w.on),
      }, el("span", {}, STEP_TEXT[w.step]), el("small", {}, w.on ? "wird gefragt" : "ausgeblendet"));
      toggle.addEventListener("click", () => { w.on = !w.on; clearError(); draw([i, 0]); });
      const move = (to, label, sign) => {
        const b = el("button", { type: "button", class: "btn btn-quiet", "aria-label": `${STEP_LABEL[w.step]} ${label}`, title: label }, sign);
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
      list.append(el("div", { class: "settings-row" }, toggle, move(i - 1, "nach oben", "↑"), move(i + 1, "nach unten", "↓")));
    });
    if (focus) list.children[focus[0]]?.children[focus[1]]?.focus({ preventScroll: true });
  };
  draw();
  c.append(list, el("div", { class: "row" }, button("Abbrechen", restart, "btn-quiet")));
}

function restart() {
  Object.assign(state, { queue: [], index: 0, saved: 0, skipped: 0, tags: null, people: null });
  start();
}

async function start() {
  frame({ question: "Bilder werden gesucht …", photo: false });
  try {
    state.settings = await api("/api/settings");
    buildStepList();
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

  const c = frame({ question: "Guten Tag!", photo: false });
  c.append(
    el("p", { class: "big" }, state.queue.length === 1 ? "Es wartet 1 Bild auf Sie." : `Es warten ${state.queue.length} Bilder auf Sie.`),
    el("p", {}, "Zu jedem Bild gibt es ein paar Fragen. Wenn Sie etwas nicht wissen, ist das nicht schlimm – einfach weiter."),
    button("Los geht's", () => openImage(at >= 0 ? draft : null), "btn-primary big"),
    settingsButton(),
  );
  if (state.keyboard) c.querySelector(".btn").focus();
}

// ---------- Bildansicht: drehen, spiegeln, vergrößern ----------
// Ändert nur die Anzeige im Assistenten, das Bild in Immich bleibt wie es ist.

const ICONS = {
  left: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  right: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  flip: '<path d="M12 2v20" stroke-dasharray="2 3"/><path d="M9 6 3 18h6z" fill="currentColor"/><path d="m15 6 6 12h-6z"/>',
  reset: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m21 21-5-5M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m21 21-5-5M8 11h6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const ZOOMS = [1, 1.5, 2, 3, 4, 6];

// rot: Grad im Uhrzeigersinn, flip: gespiegelt; zoom/x/y nur in der vergrößerten Ansicht
const view = { rot: 0, flip: false, zoom: 1, x: 0, y: 0 };
const tools = {};

function toolButton(icon, label, onclick, cls = "") {
  const b = button(el("span", {}, label), onclick, `tool ${cls}`.trim());
  b.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`);
  return b;
}

// Bild so groß wie möglich einpassen; bei 90°/270° sind Breite und Höhe vertauscht
function placePhoto(img, stage, zoom = 1, x = 0, y = 0) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const cw = stage.clientWidth, ch = stage.clientHeight;
  if (!iw || !cw || !ch) return;
  const turned = view.rot % 180 !== 0;
  const scale = Math.min(cw / (turned ? ih : iw), ch / (turned ? iw : ih)) * zoom;
  img.style.width = `${iw * scale}px`;
  img.style.height = `${ih * scale}px`;
  img.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${view.rot}deg) scaleX(${view.flip ? -1 : 1})`;
}

// Verschieben nur so weit, dass das Bild das Fenster nicht verlässt
function clampPan() {
  const img = $("viewer-photo"), stage = $("viewer-stage");
  const turned = view.rot % 180 !== 0;
  const w = parseFloat(img.style.width) || 0, h = parseFloat(img.style.height) || 0;
  const maxX = Math.max(0, ((turned ? h : w) - stage.clientWidth) / 2);
  const maxY = Math.max(0, ((turned ? w : h) - stage.clientHeight) / 2);
  view.x = Math.max(-maxX, Math.min(maxX, view.x));
  view.y = Math.max(-maxY, Math.min(maxY, view.y));
}

function updateView() {
  placePhoto($("photo"), $("photo-stage"));
  if (!$("viewer").hidden) {
    placePhoto($("viewer-photo"), $("viewer-stage"), view.zoom);
    clampPan();
    placePhoto($("viewer-photo"), $("viewer-stage"), view.zoom, view.x, view.y);
    tools.level.textContent = `${Math.round(view.zoom * 100)} %`;
    tools.zoomOut.disabled = view.zoom <= ZOOMS[0];
    tools.zoomIn.disabled = view.zoom >= ZOOMS[ZOOMS.length - 1];
  }
  const changed = view.rot !== 0 || view.flip;
  for (const b of tools.reset) b.disabled = !changed;
}

function rotate(deg) {
  view.rot = (view.rot + deg + 360) % 360;
  updateView();
}

// Spiegelt immer links/rechts so, wie das Bild gerade auf dem Bildschirm steht
function flip() {
  view.flip = !view.flip;
  view.rot = (360 - view.rot) % 360;
  updateView();
}

function resetView() {
  Object.assign(view, { rot: 0, flip: false });
  updateView();
}

// Zoomstufe wechseln; der Punkt (px, py) relativ zur Fenstermitte bleibt dabei an seiner Stelle
function zoomTo(zoom, px = 0, py = 0) {
  const k = zoom / view.zoom;
  view.x = px - (px - view.x) * k;
  view.y = py - (py - view.y) * k;
  view.zoom = zoom;
  updateView();
}

function zoomStep(dir, px, py) {
  const i = ZOOMS.indexOf(view.zoom) + dir;
  if (i >= 0 && i < ZOOMS.length) zoomTo(ZOOMS[i], px, py);
}

function openViewer() {
  if (!$("photo").naturalWidth) return;
  Object.assign(view, { zoom: 1, x: 0, y: 0 });
  $("viewer-photo").src = $("photo").src;
  $("viewer").hidden = false;
  $("top").inert = $("main").inert = true;
  updateView();
  tools.close.focus({ preventScroll: true });
}

function closeViewer() {
  $("viewer").hidden = true;
  $("top").inert = $("main").inert = false;
  if (state.keyboard) tools.open.focus({ preventScroll: true });
}

function buildPhotoTools() {
  const rotateTools = () => [
    toolButton("left", "Links drehen", () => rotate(-90)),
    toolButton("right", "Rechts drehen", () => rotate(90)),
    toolButton("flip", "Spiegeln", flip),
  ];
  const sep = () => el("span", { class: "tool-sep", "aria-hidden": "true" });

  tools.open = toolButton("zoomIn", "Vergrößern", openViewer, "btn-primary");
  tools.close = toolButton("close", "Schließen", closeViewer, "btn-primary");
  tools.zoomOut = toolButton("zoomOut", "Kleiner", () => zoomStep(-1));
  tools.zoomIn = toolButton("zoomIn", "Größer", () => zoomStep(1));
  tools.level = el("output", { class: "zoom-level", "aria-live": "polite" }, "100 %");
  tools.reset = [toolButton("reset", "Original", resetView), toolButton("reset", "Original", resetView)];

  $("photo-tools").append(...rotateTools(), tools.reset[0], sep(), tools.open);
  $("viewer-tools").append(tools.zoomOut, tools.level, tools.zoomIn, sep(), ...rotateTools(), tools.reset[1], sep(), tools.close);
  updateView();

  $("photo").addEventListener("click", openViewer);
  $("photo").addEventListener("load", updateView);
  $("viewer-photo").addEventListener("load", updateView);
  new ResizeObserver(updateView).observe($("photo-stage"));
  new ResizeObserver(updateView).observe($("viewer-stage"));

  const stage = $("viewer-stage");
  const fromCenter = (e) => {
    const r = stage.getBoundingClientRect();
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2];
  };
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomStep(e.deltaY < 0 ? 1 : -1, ...fromCenter(e));
  }, { passive: false });
  // Doppelt antippen: vergrößern bzw. zurück auf ganze Größe
  stage.addEventListener("dblclick", (e) => {
    if (view.zoom > 1) zoomTo(1);
    else zoomTo(2, ...fromCenter(e));
  });
  // Ziehen mit Maus oder Finger verschiebt das vergrößerte Bild
  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    drag = { id: e.pointerId, x: e.clientX - view.x, y: e.clientY - view.y };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add("dragging");
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    view.x = e.clientX - drag.x;
    view.y = e.clientY - drag.y;
    updateView();
  });
  const endDrag = () => { drag = null; stage.classList.remove("dragging"); };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
}

// Vollbild ein/aus. Der Knopf folgt dem tatsächlichen Zustand, auch wenn per Esc verlassen wird.
function updateFullscreenButton() {
  const on = Boolean(document.fullscreenElement);
  $("fullscreen").textContent = on ? "Vollbild beenden" : "Vollbild";
  $("fullscreen").setAttribute("aria-pressed", String(on));
}
if (document.fullscreenEnabled) {
  $("fullscreen").hidden = false;
  $("fullscreen").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      showError("Vollbild ist in diesem Browser gerade nicht möglich. Alternativ die Taste F11 drücken.");
    }
  });
  document.addEventListener("fullscreenchange", updateFullscreenButton);
}

// Fenstergröße geändert (z. B. Vollbild): Themenliste neu aufteilen
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.screen === "tags") render(); }, 150);
});

$("back").addEventListener("click", back);
document.addEventListener("keydown", () => { state.keyboard = true; }, true);
document.addEventListener("pointerdown", () => { state.keyboard = false; }, true);
$("skip-image").addEventListener("click", skipImage);
$("error-retry").addEventListener("click", () => { const r = state.retry; clearError(); if (r) r(); });
$("photo").addEventListener("error", () => { $("photo").alt = "Das Bild konnte nicht angezeigt werden."; });
document.addEventListener("keydown", (e) => {
  if (!$("viewer").hidden) {
    if (e.key === "Escape") closeViewer();
    else if (e.key === "+" || e.key === "=") zoomStep(1);
    else if (e.key === "-") zoomStep(-1);
    return;
  }
  if (e.key === "Escape" && state.asset) back();
});

buildPhotoTools();
start();
