#!/bin/bash
set -euo pipefail

VERSION="${1:-1.0.0}"
PLATFORM="${2:-WINDOWS}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="$ROOT/dist/releases"
mkdir -p "$OUTPUT_DIR"

case "$PLATFORM" in
  WINDOWS) NAME="ExcelMaster-${VERSION}-Windows.zip" ;;
  MACOS) NAME="ExcelMaster-${VERSION}-macOS.zip" ;;
  *) echo "平台必須是 WINDOWS 或 MACOS"; exit 1 ;;
esac

git -C "$ROOT" archive --format=zip --prefix=ExcelMaster/ -o "$OUTPUT_DIR/$NAME" HEAD
if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$OUTPUT_DIR/$NAME" > "$OUTPUT_DIR/$NAME.sha256"; else sha256sum "$OUTPUT_DIR/$NAME" > "$OUTPUT_DIR/$NAME.sha256"; fi
echo "$OUTPUT_DIR/$NAME"
