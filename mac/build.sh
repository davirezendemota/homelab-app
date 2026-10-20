#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! xcodebuild -version >/dev/null 2>&1; then
  echo "Xcode não encontrado. Instale o Xcode (App Store) e rode:"
  echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  exit 1
fi

DERIVED="$ROOT/build"
CONFIG="${1:-Debug}"

echo "→ Resolvendo pacotes Swift (Citadel)…"
xcodebuild -resolvePackageDependencies \
  -project HomelabBar.xcodeproj \
  -scheme HomelabBar

echo "→ Compilando HomelabBar ($CONFIG)…"
xcodebuild build \
  -project HomelabBar.xcodeproj \
  -scheme HomelabBar \
  -configuration "$CONFIG" \
  -derivedDataPath "$DERIVED" \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO \
  DEVELOPMENT_TEAM=""

APP="$DERIVED/Build/Products/$CONFIG/HomelabBar.app"
if [[ ! -d "$APP" ]]; then
  echo "App não encontrado em $APP"
  find "$DERIVED" -name 'HomelabBar.app' -type d
  exit 1
fi

echo ""
echo "Pronto: $APP"
echo "Abrir: open \"$APP\""
