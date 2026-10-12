#!/usr/bin/env bash
# Installation für Zorin OS / Ubuntu: virtuelle Umgebung, Abhängigkeiten, Desktop-Symbol.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
cd "$APP_DIR"

echo "==> Dia-Assistent wird in $APP_DIR eingerichtet"

if ! command -v python3 >/dev/null; then
  echo "Python 3 fehlt. Bitte installieren: sudo apt install python3 python3-venv" >&2
  exit 1
fi

if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "Python 3.10 oder neuer wird benötigt (gefunden: $(python3 --version))." >&2
  exit 1
fi

if [ ! -x .venv/bin/python ]; then
  if ! python3 -m venv .venv; then
    PYVER="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
    echo "Konnte keine virtuelle Umgebung anlegen. Bitte installieren: sudo apt install python${PYVER}-venv" >&2
    rm -rf .venv
    exit 1
  fi
fi

.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet -r requirements.txt
chmod +x start.sh

if [ ! -f .env ]; then
  cp config.example .env
  chmod 600 .env
  echo "==> .env wurde angelegt. Bitte IMMICH_URL und IMMICH_API_KEY eintragen:"
  echo "    $APP_DIR/.env"
fi

DESKTOP_FILE_CONTENT="[Desktop Entry]
Type=Application
Version=1.0
Name=Dia-Assistent
Comment=Alte Dias beschriften
Exec=\"$APP_DIR/start.sh\"
Path=$APP_DIR
Icon=$APP_DIR/packaging/dia-assistent.svg
Terminal=false
Categories=Graphics;Photography;
StartupNotify=false"

APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS_DIR"
printf '%s\n' "$DESKTOP_FILE_CONTENT" > "$APPS_DIR/dia-assistent.desktop"
chmod +x "$APPS_DIR/dia-assistent.desktop"
echo "==> Startmenü-Eintrag angelegt"

DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
if [ -d "$DESKTOP_DIR" ] && [ "$DESKTOP_DIR" != "$HOME" ]; then
  printf '%s\n' "$DESKTOP_FILE_CONTENT" > "$DESKTOP_DIR/dia-assistent.desktop"
  chmod +x "$DESKTOP_DIR/dia-assistent.desktop"
  # GNOME/Zorin: Starter als vertrauenswürdig markieren, damit Doppelklick ohne Rückfrage startet
  gio set "$DESKTOP_DIR/dia-assistent.desktop" metadata::trusted true 2>/dev/null || true
  echo "==> Desktop-Symbol angelegt: $DESKTOP_DIR/dia-assistent.desktop"
fi

echo "==> Fertig. Start per Doppelklick auf „Dia-Assistent“ oder mit: $APP_DIR/start.sh"
