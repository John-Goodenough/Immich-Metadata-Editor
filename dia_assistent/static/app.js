"use strict";

// Dia-Assistent: geführte Oberfläche. Eine Frage pro Bildschirm.

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
  "August", "September", "Oktober", "November", "Dezember"];
const STEP_OF = {
  decade: "when", year: "when", month: "when", day: "when", certainty: "when",
  place: "where", what: "what", who: "who", summary: "done",
};
const PEOPLE_PER_PAGE = 6;
const DRAFT_KEY = "dia-assistent-entwurf";

const $ = (id) => document.getElementById(id);

const state = {
  settings: { yearFrom: 1940, yearTo: 2010 },
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
  retry: null,
};

function freshAnswers() {
  return {
    year: null, month: null, day: null, approximate: false,
    latitude: null, longitude: null, placeName: null,
    description: "", person_ids: [],
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
    throw new Error((data && data.fehler) || "Da ist etwas schiefgegangen. Bitte noch einmal versuchen.");
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
  const order = ["when", "where", "what", "who", "done"];
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

function back() {
  if (!state.history.length) return;
  state.screen = state.history.pop();
  render();
}

function render() {
  saveDraft();
  SCREENS[state.screen]();
  const first = $("content").querySelector("input, textarea, .btn.selected, .btn");
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
      go("place");
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
      go("place");
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
      button("Ganz sicher", () => { a.approximate = false; go("place"); }, a.approximate ? "" : "selected"),
      button("Nur ungefähr", () => { a.approximate = true; go("place"); }, a.approximate ? "selected" : ""),
    ));
  },

  place() {
    const a = state.answers;
    const c = frame({
      question: "Wo wurde das Foto gemacht?",
      hint: "Ort eintippen, dann auf „Suchen“ drücken.",
      next: () => go("what"),
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
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
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
      next: () => go("who"),
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
      next: () => go("summary"),
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
    c.append(el("dl", { class: "summary" },
      el("dt", {}, "Wann:"), el("dd", {}, dateText(a)),
      el("dt", {}, "Wo:"), el("dd", {}, a.placeName || "nicht angegeben"),
      el("dt", {}, "Was:"), el("dd", {}, a.description.trim() || "nicht angegeben"),
      el("dt", {}, "Wer:"), el("dd", {}, names.length ? names.join(", ") : "nicht angegeben"),
    ));
  },
};

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
        go("what");
      },
    }, r.name, el("small", {}, r.detail)));
  }
}

// ---------- Ablauf ----------

async function saveCurrent() {
  const a = state.answers;
  busy(true, "Wird gespeichert …");
  try {
    await api(`/api/assets/${state.asset.id}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year: a.year, month: a.month, day: a.day, approximate: a.approximate,
        latitude: a.latitude, longitude: a.longitude,
        description: a.description, person_ids: a.person_ids,
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
  if (draft && draft.id === id) {
    Object.assign(state, { answers: { ...freshAnswers(), ...draft.answers }, screen: draft.screen, history: draft.history, decade: draft.decade });
  } else {
    Object.assign(state, { answers: freshAnswers(), screen: "decade", history: [], decade: null });
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
  if (state.saved) lines.push(`${state.saved} Bilder gespeichert.`);
  if (state.skipped) lines.push(`${state.skipped} Bilder für später aufgehoben.`);
  if (!lines.length) lines.push("Im Moment gibt es keine Bilder zum Bearbeiten.");
  c.append(...lines.map((t) => el("p", { class: "big" }, t)),
    el("p", {}, "Sie können das Fenster jetzt schließen."));
}

async function start() {
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

  const c = frame({ question: "Guten Tag!", photo: false });
  c.append(
    el("p", { class: "big" }, `Es warten ${state.queue.length} Bilder auf Sie.`),
    el("p", {}, "Zu jedem Bild gibt es ein paar Fragen. Wenn Sie etwas nicht wissen, ist das nicht schlimm – einfach weiter."),
    button("Los geht's", () => openImage(at >= 0 ? draft : null), "btn-primary big"),
  );
  c.querySelector(".btn").focus();
}

$("back").addEventListener("click", back);
$("skip-image").addEventListener("click", skipImage);
$("error-retry").addEventListener("click", () => { const r = state.retry; clearError(); if (r) r(); });
$("photo").addEventListener("error", () => { $("photo").alt = "Das Bild konnte nicht angezeigt werden."; });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.asset) back();
});

start();
