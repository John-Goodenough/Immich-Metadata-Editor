# Prompt für Claude Design: Überarbeitung der Oberfläche „Dia-Assistent“

> Alles ab „## Auftrag“ in Claude Design einfügen. Stellen mit **[PRÜFEN]** sind Annahmen und sollten vor dem
> Absenden bestätigt oder angepasst werden. Zusätzlich 3–5 Screenshots der aktuellen Oberfläche anhängen
> (Startseite, Wann?, Wo? mit Treffern, Wer ist das?, Themen).

---

## Auftrag

Gestalte die Oberfläche des **„Dia-Assistent“** neu. Liefere ein klickbares Design (HTML/CSS-Prototyp) für alle
unten genannten Bildschirme und Zustände sowie ein kleines Design-System (Farben, Schrift, Abstände, Knopfarten).
Das Ergebnis wird anschließend von Hand in die bestehende App übernommen.

### Was die App ist

Eine lokale Web-App, mit der ältere Menschen gescannte Dias in ihrer Fotoverwaltung (Immich) beschriften. Pro Bild
werden nacheinander kurze Fragen gestellt, jede darf mit „Weiß ich nicht“ übersprungen werden. Am Ende wird
gespeichert und das nächste Bild kommt. Die App ist komplett auf Deutsch und spricht die Nutzer mit „Sie“ an.

### Zielgruppe

- Seniorinnen und Senioren, **wenig Computererfahrung**, teils nachlassende Sehkraft und unsichere Mausführung.
- Bedienung meist mit **Maus und Tastatur** an einem Laptop oder Monitor, gelegentlich per Touch. [PRÜFEN]
- Sitzungen von 30–60 Minuten, viele Bilder hintereinander: die Oberfläche darf nicht ermüden.
- Typische Bildschirme: **1366×768 bis 1920×1080**, oft mit Systemskalierung 125–150 %, Browserfenster nicht immer
  maximiert. Effektiv muss alles ab **ca. 1024×600 CSS-Pixel** funktionieren. [PRÜFEN]

### Grundprinzipien (verbindlich)

1. **Eine Frage pro Bildschirm.** Kein Formular mit vielen Feldern.
2. **Nichts darf aus dem Bild rutschen.** Frage, Antwortmöglichkeiten, „Zurück“ und „Weiter“ müssen ohne
   Seiten-Scrollen sichtbar sein. Wo eine Liste länger ist, wird **innerhalb der Liste** geblättert (Seiten mit
   „← Vorherige / Weitere →“) oder gescrollt – mit sichtbarem Hinweis, dass noch mehr kommt.
3. **Große, klar unterscheidbare Bedienelemente.** Grundschrift mindestens 22–26 px, Knöpfe mindestens 56–72 px hoch,
   Abstand zwischen klickbaren Flächen mindestens 8–12 px. Benachbarte Knöpfe müssen sich eindeutig voneinander
   abheben (Rand, Fläche, Abstand), nicht nur durch die Farbe.
4. **Ruhig und übersichtlich.** Die bisherige Oberfläche wurde als zu überladen empfunden, sobald mehr als eine
   Handvoll Knöpfe gleichzeitig sichtbar war. Nur zeigen, was für die aktuelle Frage nötig ist.
5. **Lange Texte nie stumm abschneiden.** Wenn ein Name gekürzt werden muss (Ort, Thema, Album, Person), ist der
   volle Text beim Drüberfahren mit der Maus und beim Tastaturfokus direkt im Element lesbar (nicht nur als kleiner
   Browser-Tooltip). Auf Touch-Geräten ohne Hover: voller Text immer sichtbar.
6. **Kontrast nach WCAG 2.2 AA mindestens, Text möglichst AAA.** Keine hellgrauen Hinweistexte.
7. **Zustände eindeutig:** ausgewählt (✔ + grüne Fläche), schon vorhanden/gesperrt („schon drin“, ausgegraut, nicht
   klickbar), Fokus (dicker, gut sichtbarer Rahmen, nur bei Tastaturbedienung), deaktiviert, „läuft gerade“.
8. **Sprache:** kurze Sätze, keine Fachbegriffe („Thema“ statt „Tag“, „Bild“ statt „Asset“), Fehlermeldungen sagen,
   was zu tun ist.

### Grundaufbau eines Fragen-Bildschirms (heute)

- **Kopfleiste:** „Bild 12 von 340“, Fortschrittsbalken, Knöpfe „Dieses Bild später“ und „Vollbild“.
- **Links:** das aktuelle Foto, so groß wie möglich. Beim Drüberfahren erscheint „⛶ Bild groß“ (Großansicht mit
  „✕ Bild klein“). Bei Gesichtern wird das gemeinte Gesicht im Foto orange umrandet.
- **Rechts:** Schrittleiste (Wann? · Wo? · Was? · Wer? · Themen · Album · Fertig, **anklickbar** zum Springen),
  Frage als Überschrift, ein Satz Hilfetext, Antwortbereich, unten „← Zurück“ und „Weiter →“.
- Das Verhältnis Foto/Bedienbereich darf geändert werden, das Foto muss aber auf jedem Bildschirm gut erkennbar
  bleiben. Bei Hochformat-Dias und schmalen Fenstern ist eine andere Anordnung erlaubt (z. B. Foto oben).

### Bildschirme und Inhalte

Die Fragen sind **ein- und ausschaltbar und in der Reihenfolge änderbar**; jeder Bildschirm muss also für sich stehen.

1. **Start („Guten Tag!“):** Anzahl wartender Bilder, ein beruhigender Satz („Wenn Sie etwas nicht wissen, ist das
   nicht schlimm“), großer Knopf „Los geht's“, kleiner Knopf „⚙ Fragen einstellen“.
2. **Wann? – Jahrzehnt:** 6–8 Jahrzehnt-Knöpfe (z. B. 1940er–2010er) + „Weiß ich nicht“.
3. **Wann? – Jahr:** 10 Jahres-Knöpfe + „Irgendwann in den 60ern“.
4. **Wann? – Monat:** 12 Monate + „Weiß ich nicht“.
5. **Wann? – Tag:** Tage 1–31 als Raster + „Weiß ich nicht“ (muss ohne Scrollen passen).
6. **Wann? – Wie sicher?:** „Ganz sicher“ / „Nur ungefähr“.
7. **Wo?:** Eingabefeld + „Suchen“ + „Weiß ich nicht“. Bis zu 3 Treffer, je mit Name, **Art des Ortes als Etikett**
   (Stadt, Kreis, Land …) und langer Adresszeile (z. B. „Kigoma, Kigoma Municipal-Ujiji, Kigoma, Westzone, 47101,
   Tansania“). Danach „Gewählt: Kassel (Stadt) [Entfernen]“ bzw. „In Immich steht bisher: …“.
8. **Was ist zu sehen?:** mehrzeiliges Textfeld, darüber ggf. die schon vorhandene Beschreibung.
9. **Wer ist das? (pro erkanntem Gesicht):** Gesichtsausschnitt groß, „Gesicht 2 von 3“, Namensfeld mit
   Live-Filter, Personen als Karten mit rundem Foto + Name (4 pro Seite), grüner Knopf „+ „Name“ neu anlegen“,
   „Weiß ich nicht“.
10. **Wer ist noch auf dem Foto?:** Zeile „Schon zugeordnet: …“, Suchfeld (Suchen oder neuen Namen eintippen),
    „+ „Name“ neu anlegen“, neue Personen als entfernbare Chips „Name (neu) ✕“, Personenkarten (6 pro Seite,
    Mehrfachauswahl, bereits zugeordnete gesperrt), Blättern.
11. **Themen:** Suchfeld, Pfadleiste („Alle Themen › Urlaub › Italien“), Themenliste in 2 Spalten mit Knopf „›“
    bzw. „3 ›“ für Unterthemen, Mehrfachauswahl, Blättern, „+ Neues Thema“. Themen können sehr lang sein.
12. **Album:** Suchfeld, „+ Album „…“ neu anlegen“, Alben als Knöpfe mit Name und „12 Fotos“ bzw. „schon drin“,
    Mehrfachauswahl, Blättern.
13. **Fertig – „Stimmt das so?“:** Zusammenfassung Wann/Wo/Was/Wer/Themen/Album, grüner Knopf „Speichern ✔“.
14. **Geschafft!:** Anzahl gespeichert / aufgehoben, ggf. „Von vorne anfangen“.
15. **Fragen einstellen:** Liste der 6 Fragen, Antippen schaltet ein/aus (✔ „wird gefragt“ / durchgestrichen
    „ausgeblendet“), Knöpfe ↑ ↓ zum Umsortieren, „Abbrechen“ und „Speichern ✔“. Muss auch bei 1024×600 vollständig
    bedienbar sein.
16. **Zustände:** Lade-Overlay („Wird gespeichert …“), Fehlerkasten mit „Noch einmal versuchen“ (Eingaben bleiben
    erhalten), „Das Bild konnte nicht geladen werden“, leere Listen („Niemand mit diesem Namen.“).

### Technische Rahmenbedingungen (verbindlich)

- Umsetzung später in **einfachem HTML, CSS und Vanilla-JavaScript**, ohne Build-Schritt, ohne Framework,
  **ohne externe Ressourcen** (keine Web-Fonts oder Icons aus dem Netz, kein CDN). Schriften: Systemschriften
  (z. B. „Noto Sans“, „Ubuntu“, „DejaVu Sans“). Icons nur als Unicode-Zeichen oder Inline-SVG.
- Läuft in aktuellem **Firefox und Chromium unter Linux (Zorin OS)**. [PRÜFEN]
- Farben, Größen und Abstände als **CSS-Variablen** in `:root`, damit sie zentral anpassbar sind.
- Volle **Tastaturbedienung** muss erhalten bleiben (Tab-Reihenfolge, Enter, Esc = Zurück/Großansicht schließen).
- Kein Dunkelmodus nötig. [PRÜFEN]

### Was sich bewährt hat und bleiben soll

- Eine Frage pro Bildschirm, „Weiß ich nicht“ überall, „Zurück“ jederzeit.
- Ausgewählt = grüne Fläche mit ✔; Hauptaktion dunkelblau („Weiter“), Speichern grün.
- Aktives Eingabefeld gelblich hinterlegt mit deutlichem Rand.
- Gesichtsmarkierung im Foto + vergrößerter Ausschnitt daneben.

### Was ausdrücklich verbessert werden soll

- Gesamteindruck **freundlicher und hochwertiger**, weniger „Formular“, ohne verspielt zu werden.
- Klarere **visuelle Hierarchie**: Frage > Antwortmöglichkeiten > Navigation > Nebenfunktionen.
- **Kopfleiste entschlacken** („Dieses Bild später“ und „Vollbild“ sind Nebenfunktionen).
- Einheitliches Muster für die vier Auswahllisten (Personen, Themen, Alben, Orte): Suche, „neu anlegen“,
  Mehrfachauswahl, Blättern, „schon vorhanden“ sollen überall gleich aussehen und sich gleich verhalten.
- Robuste Darstellung bei **kleinen Fenstern und hoher Skalierung** (siehe Grundprinzip 2).
- [PRÜFEN: eigene Wünsche ergänzen, z. B. Farbwelt, wärmerer Ton, Logo/Name]

### Lieferumfang

1. Design-System: Farbpalette mit Kontrastwerten, Schriftgrößen, Abstände, Knopfarten (primär, normal, still,
   Erfolg, ausgewählt, gesperrt, Fokus), Eingabefeld, Etikett, Chip, Personenkarte, Listen-Eintrag.
2. Alle Bildschirme aus der Liste oben als klickbarer Prototyp, jeweils bei **1366×768** und **1024×600**.
3. Kurze Begründung der wichtigsten Entscheidungen und eine Liste, was gegenüber den Screenshots geändert wurde.
