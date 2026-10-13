# Dia-Assistent

Seniorengerechte, geführte Oberfläche zum Nachpflegen gescannter Dias in [Immich](https://immich.app):
Datum, Ort, Beschreibung und Personen, eine Frage pro Bildschirm, große Schrift und große Knöpfe.

Läuft lokal auf dem Laptop (`127.0.0.1`), spricht über die Immich-REST-API mit einem API-Schlüssel.
Der Schlüssel bleibt im lokalen Backend und gelangt nie in den Browser.

Entwickelt und geprüft gegen die OpenAPI-Spezifikation und den Quellcode von **Immich v3.3.1**.

> ⚠️ **Nicht gegen eine echte Immich-Instanz getestet.** Was nur gegen Spezifikation, Quellcode und
> einen nachgebauten Server geprüft wurde, steht unter [Ungetestet](#ungetestet).

---

## Ablauf

1. In Immich die zu bearbeitenden Bilder auswählen und per Massenbearbeitung den Tag
   **`Dia-Nachpflege`** setzen (Name einstellbar).
2. Dia-Assistent per Doppelklick starten. Er zeigt alle Bilder mit diesem Tag nacheinander.
3. Zu jedem Bild:
   - **Wann?** Jahrzehnt → Jahr → Monat → Tag, jeweils mit „Weiß ich nicht“. Danach: „Ganz sicher“ oder „Nur ungefähr“.
     „Irgendwann in den 60ern“ speichert 1965 als ungefähres Datum.
   - **Wo?** Ort eintippen, Treffer antippen (Suche über OpenStreetMap/Nominatim).
   - **Was?** Freitext.
   - **Wer?** Benannte Personen aus Immich antippen (Mehrfachauswahl).
   - **Themen:** Vorhandene Immich-Tags antippen (Mehrfachauswahl). Mit „›“ geht es zu den Unterthemen,
     oben zeigt eine Pfadleiste („Alle Themen › Urlaub › Italien“), wo man ist. „+ Neues Thema“ legt
     ein Thema auf der aktuellen Ebene an, also z. B. „Venedig“ direkt unter „Urlaub › Italien“.
   - **Fertig:** Zusammenfassung, dann **Speichern ✔**.
4. **Speichern** schreibt nur die ausgefüllten Felder und entfernt danach den Tag. Das Bild erscheint nicht mehr.
   **„Dieses Bild später“** schreibt nichts, der Tag bleibt, das Bild kommt beim nächsten Start wieder.
5. Am Ende zeigt „Geschafft!“, wie viele Bilder gespeichert und aufgehoben wurden. Wurden Bilder aufgehoben,
   holt **„Von vorne anfangen“** sie sofort wieder (die Liste wird dabei neu aus Immich geladen).

Jeder Schritt ist überspringbar (Weiter ohne Eingabe bzw. „Weiß ich nicht“), **Zurück** geht immer
(auch mit der Esc-Taste). Fortschritt oben: „Bild 12 von 340“.

### Was genau gespeichert wird

| Eingabe | Wirkung in Immich |
|---|---|
| nur Jahr | Datum = **1. Juli** des Jahres, 12:00 Uhr |
| Jahr + Monat | Datum = **15.** des Monats, 12:00 Uhr |
| vollständiges Datum | genau dieser Tag, 12:00 Uhr |
| „Nur ungefähr“ | zusätzlich Tag **`Datum-ungefähr`** (wird bei Bedarf angelegt) |
| Ort | Breiten-/Längengrad |
| Beschreibung | wird an eine vorhandene Beschreibung **angehängt** (Leerzeile dazwischen) |
| Personen | manuelles Gesicht mit Rahmen über das **ganze Bild** (siehe unten) |
| Themen | Tags am Bild. Neu angelegte Themen entstehen erst beim Speichern, samt fehlender Oberthemen |
| (immer) | Tag **`Dia-bearbeitet`**, damit sich zählen und filtern lässt, was mit dem Assistenten bearbeitet wurde |

Die Uhrzeit 12:00 in der eingestellten Zeitzone (Standard `Europe/Berlin`) verhindert, dass das
Datum durch Zeitzonen-Umrechnung auf den Vor- oder Folgetag rutscht.

Der Arbeits-Tag wird **erst ganz zum Schluss** entfernt. Bricht die Verbindung mittendrin ab, bleiben
die Eingaben im Browser erhalten und „Noch einmal versuchen“ speichert erneut, ohne Beschreibung
oder Personen doppelt anzulegen. Ein angefangenes Bild wird auch nach einem Neustart fortgesetzt.

---

## Installation (Zorin OS / Ubuntu)

Voraussetzung: Python ≥ 3.10 mit `venv` (Zorin 17 / Ubuntu 22.04 und neuer).

```bash
sudo apt install python3 python3-venv git   # falls noch nicht vorhanden
git clone https://github.com/John-Goodenough/Immich-Metadata-Editor.git ~/dia-assistent
cd ~/dia-assistent
./install.sh
```

Alternativ das Archiv `dia-assistent-vX.Y.Z.tar.gz` aus den
[Releases](https://github.com/John-Goodenough/Immich-Metadata-Editor/releases) entpacken und dort `./install.sh` ausführen.

`install.sh` legt eine virtuelle Umgebung `.venv` an, installiert die Abhängigkeiten, kopiert
`config.example` nach `.env` und legt einen Starter im Startmenü und auf dem Schreibtisch an.
Der Schreibtisch-Starter wird per `gio` als vertrauenswürdig markiert, damit ein Doppelklick reicht.
Falls Zorin trotzdem nachfragt: Rechtsklick auf das Symbol → „Start erlauben“.

Ein Doppelklick startet den Server und öffnet den Browser. Läuft er schon, öffnet sich nur der Browser.
Fehlt die Konfiguration, erscheint eine Fehlermeldung als Fenster (über `zenity`, unter Zorin vorinstalliert).

**Update:** `git pull && ./install.sh` (bzw. neues Release-Archiv entpacken und `.env` mitnehmen).

### Bildschirm

Ausgelegt auf Laptop-Bildschirme ab **1280 × 720** (Browser im Vollbild: F11). Bei kleineren Auflösungen
muss auf einzelnen Seiten gescrollt werden.

---

## Konfiguration

Datei `.env` im Programmordner (wird nicht eingecheckt, Vorlage: [`config.example`](config.example)):

| Schlüssel | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `IMMICH_URL` | ja | | z. B. `https://immich.example.de` (ohne `/api`) |
| `IMMICH_API_KEY` | ja | | API-Schlüssel, Rechte siehe unten |
| `TAG_NAME` | | `Dia-Nachpflege` | Tag der zu bearbeitenden Bilder (Name oder voller Pfad bei verschachtelten Tags) |
| `APPROX_TAG_NAME` | | `Datum-ungefähr` | Tag für ungefähre Daten |
| `DONE_TAG_NAME` | | `Dia-bearbeitet` | Tag für Bilder, die im Assistenten gespeichert wurden |
| `TIMEZONE` | | `Europe/Berlin` | Zeitzone für das Datum |
| `YEAR_FROM` / `YEAR_TO` | | `1940` / `2010` | Jahre zur Auswahl |
| `NOMINATIM_CONTACT` | empfohlen | | Kontakt-E-Mail im User-Agent, laut [Nominatim-Nutzungsrichtlinie](https://operations.osmfoundation.org/policies/nominatim/) |
| `NOMINATIM_URL` | | öffentliche Instanz | eigene Nominatim-Instanz |
| `PORT` | | `8765` | lokaler Port |

### Zugang über Authentik/Pangolin

Die Bedienung läuft über den lokalen Browser gegen `127.0.0.1`, nicht über die Immich-Weboberfläche.
Das Backend ruft Immich direkt mit dem API-Schlüssel (`x-api-key`-Header) auf. Authentik-SSO spielt
dafür keine Rolle. Voraussetzung ist, dass `https://<domain>/api/...` über Pangolin **ohne**
vorgeschaltete Anmeldeseite erreichbar ist (wie bei der Immich-App auf dem Handy).

### API-Schlüssel: benötigte Rechte

Der Schlüssel muss zum **Konto gehören, dem die Bilder und der Tag gehören**. In Immich unter
*Kontoeinstellungen → API-Schlüssel → Neuer API-Schlüssel* nur diese Rechte anhaken:

| Recht | Wofür | Endpunkt |
|---|---|---|
| `asset.read` | Bilder mit Tag finden, Bilddaten lesen | `POST /search/metadata`, `GET /assets/{id}` |
| `asset.view` | Vorschaubild anzeigen | `GET /assets/{id}/thumbnail?size=preview` |
| `asset.update` | Datum, Ort, Beschreibung schreiben | `PUT /assets/{id}` |
| `tag.read` | Tag-Namen in ID umwandeln | `GET /tags` |
| `tag.create` | Themen sowie `Datum-ungefähr` und `Dia-bearbeitet` anlegen | `PUT /tags` |
| `tag.asset` | Tags setzen und entfernen | `PUT` / `DELETE /tags/{id}/assets` |
| `person.read` | Personen und Gesichtsbilder anzeigen | `GET /people`, `GET /people/{id}/thumbnail` |
| `face.read` | Prüfen, wer schon zugeordnet ist | `GET /faces?id=…` |
| `face.create` | Person einem Bild zuordnen | `POST /faces` |

Ermittelt aus `x-immich-permission` in der OpenAPI-Spezifikation von v3.3.1. Laut Quellcode prüft
Immich die Rechte des API-Schlüssels nur pro Endpunkt. Innerhalb der Dienste wird dann nur noch die
Eigentümerschaft geprüft (Bild bzw. Tag gehört dem Konto). Gelöscht wird nichts.

---

## Technische Details

**Stack:** Python ≥ 3.10, FastAPI, uvicorn, httpx. Oberfläche als schlichtes HTML/CSS/JS ohne Build-Schritt.

```
dia_assistent/
  __main__.py   Start: Server auf 127.0.0.1 + Browser öffnen
  app.py        lokale HTTP-Schnittstelle für die Oberfläche
  immich.py     Immich-Client + Speicherablauf
  logic.py      Datumslogik, Beschreibung, Aufbau der API-Aufrufe (ohne Netzwerk)
  geocode.py    Nominatim mit 1 Anfrage/s und Zwischenspeicher
  config.py     .env lesen
  static/       Oberfläche
```

**Bilder finden:** `POST /search/metadata` mit `{"filter": {"tagIds": {"any": [<id>]}}}` und
Cursor-Blättern (`nextCursor`). Die alten Felder `tagIds` und `page` auf oberster Ebene sind seit
v3.2.0 als veraltet markiert und werden nicht verwendet.

### Themen (Tags)

Die Themenliste kommt aus `GET /tags`. Ausgeblendet werden die drei Tags, die der Assistent selbst
verwaltet (`TAG_NAME`, `APPROX_TAG_NAME`, `DONE_TAG_NAME`). Gespeichert wird mit einem einzigen
`PUT /tags` (Upsert) mit den vollen Pfaden, z. B. `Urlaub/Italien/Venedig`. Laut Quellcode
(`server/src/utils/tag.ts`, `upsertTags`) legt Immich dabei fehlende Ebenen an und lässt vorhandene
unverändert. Anschließend wird jeder Tag per `PUT /tags/{id}/assets` zugeordnet. Bereits zugeordnete
Themen sind in der Auswahl grau markiert. Entfernt werden Themen vom Assistenten nicht.

Ein „/“ im Namen eines neuen Themas wird durch „-“ ersetzt, weil Immich „/“ als Trenner der Ebenen nutzt.

### Personen zuordnen

Die API hat keinen Aufruf „Person X ist auf Bild Y“. Der Weg ist `POST /faces`: Es legt ein manuelles
Gesicht an und **verlangt zwingend** einen Rahmen (`x`, `y`, `width`, `height`, `imageWidth`, `imageHeight`).
Der Dia-Assistent setzt den Rahmen auf das **ganze Bild** (`0, 0, Bildbreite, Bildhöhe` aus
`asset.width/height`). Folgen:

- Das Bild erscheint in Immich bei der Person und lässt sich nach ihr filtern.
- In der Gesichtsansicht eines Bildes ist der Rahmen das ganze Bild.
- Ist eine Person schon zugeordnet (laut `GET /faces`), wird kein zweites Gesicht angelegt.
- Ob Immich ein später neu berechnetes Personen-Titelbild aus einem solchen Ganzbild-Gesicht nimmt, ist ungetestet.

Personen müssen vorher in Immich **benannt** sein. Unbenannte und versteckte Personen werden nicht angezeigt.

### Stadt/Land nach dem Setzen der Koordinaten

**Ergebnis der Quellcode-Analyse (v3.3.1), nicht live getestet:** Ja, Immich ergänzt Stadt,
Bundesland und Land automatisch, sofern die Ortsbestimmung (Reverse-Geocoding) in den
Server-Einstellungen aktiv ist (Standard). Kette:

1. `PUT /assets/{id}` → `AssetService.update` → `updateExif` speichert die Koordinaten und reiht den Job `SidecarWrite` ein (`server/src/services/asset.service.ts`).
2. `SidecarWrite` schreibt die XMP-Datei. Nach Abschluss reiht `JobService` den Job `AssetExtractMetadata` ein (`server/src/services/job.service.ts`).
3. `AssetExtractMetadata` liest die GPS-Werte und ruft `mapRepository.reverseGeocode` auf (`server/src/services/metadata.service.ts`).

Die Ergänzung passiert asynchron über die Job-Warteschlange und kann einige Sekunden dauern.

### Diktieren

Weggelassen. Firefox (Standardbrowser unter Zorin) unterstützt die Web-Speech-API nicht, und in
Chrome läuft sie über Google-Server. Beides ist für diesen Zweck nicht zuverlässig.

### Fehlerverhalten

Alle Meldungen sind deutsch und ohne technische Details („Keine Verbindung zum Server. Ist das Internet da?“).
Eingaben bleiben bei Fehlern erhalten. Zusätzlich wird das angefangene Bild als Entwurf im Browser
(`localStorage`) gesichert.

---

## Ungetestet

Gegen eine **echte** Immich-Instanz wurde nichts getestet. Geprüft wurde gegen die OpenAPI-Spezifikation
v3.3.1, den Server-Quellcode v3.3.1, gemockte Unit-Tests und einen nachgebauten Immich-Server im Browser
(Chromium, 1280 × 720 bis 1920 × 1080). Konkret offen:

- [ ] Suche über `filter.tagIds` liefert die getaggten Bilder (inkl. archivierter Bilder?)
- [ ] `PUT /assets/{id}` mit `dateTimeOriginal` im Format `1965-07-01T12:00:00.000+01:00` wird in der Zeitleiste korrekt angezeigt
- [ ] Stadt/Land werden nach dem Setzen der Koordinaten ergänzt (siehe oben)
- [ ] `POST /faces` mit Ganzbild-Rahmen: Darstellung in der Personen- und Gesichtsansicht
- [ ] `PUT /tags` legt verschachtelte neue Themen (z. B. `Urlaub/Italien/Venedig`) wie erwartet an
- [ ] Vorschaubild über `GET /assets/{id}/thumbnail?size=preview`
- [ ] Nominatim-Anbindung (aus der Entwicklungsumgebung nicht erreichbar, nur gemockt)
- [ ] Erreichbarkeit der API durch Pangolin ohne SSO-Umleitung
- [ ] `install.sh` und Desktop-Starter auf echtem Zorin OS (getestet nur in einem Linux-Container ohne Desktop)
- [ ] Firefox (Oberfläche nur in Chromium geprüft)

---

## Entwicklung

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
.venv/bin/python -m dia_assistent --no-browser   # Server ohne Browser starten
```

### Release

1. Version in `dia_assistent/__init__.py` erhöhen und committen.
2. Tag setzen und pushen: `git tag v0.2.0 && git push origin v0.2.0`
3. GitHub Actions führt die Tests aus, prüft Tag = `__version__` und hängt
   `dia-assistent-v0.2.0.tar.gz` samt SHA-256-Prüfsumme an das Release.
