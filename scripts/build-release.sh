#!/bin/bash
set -euo pipefail

VERSION="${1:-1.0.0}"
PLATFORM="${2:-WINDOWS}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="$ROOT/dist/releases"
mkdir -p "$OUTPUT_DIR"
[ -f "$ROOT/安裝說明.md" ] || { echo "缺少安裝說明.md"; exit 1; }
[ -f "$ROOT/release-manifest.json" ] || { echo "缺少 release-manifest.json"; exit 1; }

case "$PLATFORM" in
  WINDOWS)
    NAME="ExcelMaster-${VERSION}-Windows.zip"
    EXCLUDES=(':(exclude)installer/Install-ExcelMaster.command')
    ;;
  MACOS)
    NAME="ExcelMaster-${VERSION}-macOS.zip"
    EXCLUDES=(':(exclude)installer/Install-ExcelMaster.cmd' ':(exclude)installer/Install-ExcelMaster.ps1')
    ;;
  *) echo "平台必須是 WINDOWS 或 MACOS"; exit 1 ;;
esac

git -C "$ROOT" archive --format=zip --prefix=ExcelMaster/ -o "$OUTPUT_DIR/$NAME" HEAD -- . "${EXCLUDES[@]}"
if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$OUTPUT_DIR/$NAME" > "$OUTPUT_DIR/$NAME.sha256"; else sha256sum "$OUTPUT_DIR/$NAME" > "$OUTPUT_DIR/$NAME.sha256"; fi
node "$ROOT/scripts/verify-release.mjs" "$OUTPUT_DIR/$NAME"
echo "$OUTPUT_DIR/$NAME"
