"use strict";

// Dia-Assistent: geführte Oberfläche. Eine Frage pro Bildschirm.

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
  "August", "September", "Oktober", "November", "Dezember"];
const STEP_OF = {
  decade: "when", year: "when", month: "when", day: "when", certainty: "when",
  place: "where", what: "what", face: "who", who: "who", tags: "tags", newtag: "tags", summary: "done",
};
// Fragen-Blöcke: Reihenfolge und Sichtbarkeit kommen aus den Einstellungen
const ALL_STEPS = ["when", "where", "what", "who", "tags"];
const STEP_LABEL = { when: "Wann?", where: "Wo?", what: "Was?", who: "Wer?", tags: "Themen" };
const STEP_TEXT = {
  when: "Wann? – Datum", where: "Wo? – Ort", what: "Was? – Beschreibung",
  who: "Wer? – Personen", tags: "Themen",
};
const STEP_SCREEN = { when: "decade", where: "place", what: "what", who: "face:0", tags: "tags" };
const PEOPLE_PER_PAGE = 6;
const FACE_PEOPLE_PER_PAGE = 4;
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
    faces: {}, // Gesichts-ID -> { person_id } oder { new_name }
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

  const step = STEP_OF[screenName()];
  showFaceMark(null);
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
  SCREENS[screenName()]();
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

  // Ein von Immich erkanntes Gesicht nach dem anderen: "Wer ist das?"
  async face() {
    const a = state.answers;
    const faces = facesToName();
    const i = Number(state.screen.split(":")[1]) || 0;
    const f = faces[i];
    if (!f) {
      // keine (weiteren) unbenannten Gesichter: weiter mit der Personenliste
      state.screen = "who";
      return SCREENS.who();
    }
    const screen = state.screen;
    const choice = a.faces[f.id];
    const following = i + 1 < faces.length ? `face:${i + 1}` : "who";
    const pick = (value) => {
      if (value) a.faces[f.id] = value; else delete a.faces[f.id];
      go(following);
    };
    const c = frame({
      question: "Wer ist das?",
      hint: faces.length > 1 ? `Gesicht ${i + 1} von ${faces.length}, im Bild orange umrandet` : "Das Gesicht ist im Bild orange umrandet.",
      next: choice ? () => go(following) : null,
    });
    showFaceMark(f);
    if (!(await loadPeople(c, screen))) return;

    const input = el("input", { type: "text", placeholder: "Name eintippen …", autocomplete: "off", maxlength: "100" });
    const create = button("", () => pick({ new_name: cleanName(input.value) }), "btn-good face-new");
    const typed = () => cleanName(input.value);
    const picker = peoplePicker({
      perPage: FACE_PEOPLE_PER_PAGE,
      query: typed,
      isChosen: (p) => choice?.person_id === p.id,
      onPick: (p) => pick({ person_id: p.id }),
    });
    const update = () => {
      const name = typed();
      const exact = state.people.some((p) => p.name.toLocaleLowerCase("de") === name.toLocaleLowerCase("de"));
      create.hidden = !name || exact;
      create.textContent = `+ „${name}“ neu anlegen`;
      picker.page = 0;
      picker.draw();
    };
    input.addEventListener("input", update);
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const name = typed();
      const match = state.people.find((p) => p.name.toLocaleLowerCase("de") === name.toLocaleLowerCase("de"));
      if (match) pick({ person_id: match.id });
      else if (name) pick({ new_name: name });
    });

    const side = el("div", { class: "face-side" },
      el("div", { class: "row" }, input, button("Weiß ich nicht", () => pick(null))), create);
    if (choice?.new_name) side.append(el("div", { class: "chosen" }, `Gewählt: ${choice.new_name} (neu)`));
    c.append(el("div", { class: "face-row" }, faceCrop(f), side), picker.grid, picker.pager);
    update();
  },

  // Personen, deren Gesicht nicht erkannt wurde: Zuordnung zum ganzen Bild
  async who() {
    const a = state.answers;
    const asked = facesToName().length > 0;
    const c = frame({
      question: asked ? "Wer ist noch auf dem Foto?" : "Wer ist auf dem Foto?",
      hint: asked ? "Nur Personen, deren Gesicht nicht umrandet war." : "Alle antippen, die zu sehen sind.",
      next: () => goAfter("who"),
    });
    if (!(await loadPeople(c, "who"))) return;

    const marked = markedPeople();
    const names = state.people.filter((p) => marked.has(p.id)).map((p) => p.name);
    const filter = el("input", { type: "text", placeholder: "Name suchen …", autocomplete: "off", value: state.peopleFilter });
    const picker = peoplePicker({
      perPage: PEOPLE_PER_PAGE,
      query: () => state.peopleFilter,
      page: state.peoplePage,
      isChosen: (p) => a.person_ids.includes(p.id),
      isLocked: (p) => marked.has(p.id),
      onPick: (p, card) => {
        const i = a.person_ids.indexOf(p.id);
        if (i >= 0) a.person_ids.splice(i, 1); else a.person_ids.push(p.id);
        saveDraft();
        const pos = [...picker.grid.children].indexOf(card);
        picker.draw();
        picker.grid.children[pos]?.focus();
      },
      onPage: (page) => { state.peoplePage = page; },
    });
    filter.addEventListener("input", () => { state.peopleFilter = filter.value; picker.page = 0; picker.draw(); });
    if (names.length) c.append(el("div", { class: "existing" }, `Schon zugeordnet: ${names.join(", ")}`));
    if (state.people.length > PEOPLE_PER_PAGE) c.append(filter);
    c.append(picker.grid, picker.pager);
    picker.draw();
  },

  summary() {
    const a = state.answers;
    const c = frame({
      question: "Stimmt das so?",
      hint: "Mit „Zurück“ lässt sich noch etwas ändern.",
      next: saveCurrent,
      nextLabel: "Speichern ✔",
    });
    const names = [...new Set([
      ...Object.values(a.faces).map((v) => v.new_name || personName(v.person_id)),
      ...a.person_ids.map(personName),
    ].filter(Boolean))];
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

// ---------- Personen und Gesichter ----------

function personName(id) {
  return (state.people || []).find((p) => p.id === id)?.name;
}

function cleanName(text) {
  return text.split(/\s+/).filter(Boolean).join(" ");
}

// Gesichter, die Immich erkannt hat, die aber noch keinen Namen haben
function facesToName() {
  return (state.asset?.faces || []).filter((f) => !f.personName);
}

// Personen, die schon über ein Gesicht am Bild hängen (vorher schon oder jetzt gewählt)
function markedPeople() {
  const ids = new Set(state.asset.personIds);
  for (const v of Object.values(state.answers.faces)) if (v.person_id) ids.add(v.person_id);
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

// Fotoknöpfe der Personen mit Blättern. Gefiltert wird nach dem Text aus query().
function peoplePicker({ perPage, query, page = 0, isChosen, isLocked = () => false, onPick, onPage = () => {} }) {
  const grid = el("div", { class: "people", style: `grid-template-rows: repeat(${perPage / 2}, minmax(0, 1fr))` });
  const pager = el("div", { class: "row" });
  const picker = { grid, pager, page, draw };
  function draw() {
    const q = query().toLocaleLowerCase("de");
    const list = state.people.filter((p) => p.name.toLocaleLowerCase("de").includes(q));
    const pages = Math.max(1, Math.ceil(list.length / perPage));
    picker.page = Math.min(picker.page, pages - 1);
    onPage(picker.page);
    grid.replaceChildren();
    if (!list.length) grid.append(el("p", {}, state.people.length ? "Niemand mit diesem Namen." : "In Immich sind noch keine Personen benannt."));
    for (const p of list.slice(picker.page * perPage, (picker.page + 1) * perPage)) {
      const locked = isLocked(p);
      const chosen = locked || isChosen(p);
      const card = el("button", {
        type: "button",
        class: `btn person${chosen ? " selected" : ""}`,
        "aria-pressed": String(chosen),
        disabled: locked,
        title: locked ? "Ist schon zugeordnet" : p.name,
      }, el("img", { src: `/api/people/${p.id}/thumbnail`, alt: "", loading: "lazy" }), el("span", {}, p.name));
      card.addEventListener("click", () => onPick(p, card));
      grid.append(card);
    }
    for (const b of pager.querySelectorAll(".page-btn, .page-info")) b.remove();
    if (pages > 1) {
      const prev = button("← Vorherige", () => { picker.page--; draw(); }, "btn-quiet page-btn");
      const next = button("Weitere →", () => { picker.page++; draw(); }, "btn-quiet page-btn");
      prev.disabled = picker.page === 0;
      next.disabled = picker.page >= pages - 1;
      pager.prepend(prev, el("span", { class: "page-info", style: "align-self:center" }, `Seite ${picker.page + 1} von ${pages}`), next);
    }
  }
  return picker;
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

// Oranger Rahmen um ein Gesicht im großen Bild; null blendet ihn aus
let markedFace = null;
function showFaceMark(f) {
  markedFace = f;
  placeFaceMark();
}

function placeFaceMark() {
  const mark = $("face-mark"), img = $("photo");
  mark.hidden = !markedFace || !img.naturalWidth;
  if (mark.hidden) return;
  const f = markedFace;
  Object.assign(mark.style, {
    left: `${img.offsetLeft + f.x * img.offsetWidth}px`,
    top: `${img.offsetTop + f.y * img.offsetHeight}px`,
    width: `${f.w * img.offsetWidth}px`,
    height: `${f.h * img.offsetHeight}px`,
  });
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
        Object.assign(a, { latitude: r.lat, longitude: r.lon, placeName: r.kind ? `${r.name} (${r.kind})` : r.name });
        goAfter("where");
      },
    }, el("span", { class: "place-name" }, r.name, r.kind ? el("span", { class: "place-kind" }, r.kind) : null),
    el("small", {}, r.detail)));
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
    ...(on.has("who") ? {} : { person_ids: [], faces: {} }),
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
        faces: Object.entries(a.faces).map(([face_id, v]) => ({ face_id, ...v })),
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
  $("photo").src = `/api/assets/${id}/preview`;
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
  if (draft && draft.id === id && steps.includes(STEP_OF[screenName(draft.screen)])) {
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
  placeFaceMark();
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
    return;
  }
  if (e.key === "Escape" && state.asset) back();
});

$("photo").addEventListener("click", openViewer);
$("photo").addEventListener("load", placeFaceMark);
$("photo-full").addEventListener("click", openViewer);
$("viewer").addEventListener("click", closeViewer);
start();
