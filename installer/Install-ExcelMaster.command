#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "安裝停止：$1"; read -r -p "按 Enter 結束…"; exit 1; }
command -v docker >/dev/null 2>&1 || fail "尚未安裝 Docker Desktop：https://www.docker.com/products/docker-desktop/"
docker info >/dev/null 2>&1 || fail "請先啟動 Docker Desktop。"
[ -f .env ] || cp .env.example .env

set_env() {
  local key="$1" value="$2" temp
  temp="$(mktemp)"
  awk -v key="$key" -v value="$value" 'BEGIN{done=0} index($0,key "=")==1 {if(!done){print key "=" value;done=1};next} {print} END{if(!done) print key "=" value}' .env > "$temp"
  mv "$temp" .env
}

ensure_secret() {
  local key="$1" placeholder="$2" value
  value="$(sed -n "s/^${key}=//p" .env | tail -n 1)"
  if [ -z "$value" ] || [ "$value" = "$placeholder" ]; then set_env "$key" "$(openssl rand -hex 32)"; fi
}

echo "ExcelMaster 訂閱與裝置啟用"
DEFAULT_LICENSE_SERVER="https://excelautomation-backend.vercel.app"
read -r -p "授權伺服器（直接按 Enter 使用 $DEFAULT_LICENSE_SERVER）: " LICENSE_SERVER
LICENSE_SERVER="${LICENSE_SERVER:-$DEFAULT_LICENSE_SERVER}"
LICENSE_SERVER="${LICENSE_SERVER%/}"
read -r -p "請輸入訂閱頁顯示的一次性啟用碼: " ACTIVATION_CODE
[ "${#ACTIVATION_CODE}" -ge 24 ] || fail "啟用碼格式錯誤。請回到方案與授權頁重新產生下載。"
MACHINE_UUID="$(ioreg -rd1 -c IOPlatformExpertDevice | awk -F\" '/IOPlatformUUID/{print $(NF-1);exit}')"
[ -n "$MACHINE_UUID" ] || fail "無法取得 macOS 裝置識別碼。"
DEVICE_ID="$(printf '%s|%s' "$MACHINE_UUID" "$(scutil --get ComputerName 2>/dev/null || hostname)" | shasum -a 256 | awk '{print $1}')"
RAW_DEVICE_NAME="$(scutil --get ComputerName 2>/dev/null || hostname)"
DEVICE_NAME="$(printf '%s' "$RAW_DEVICE_NAME" | tr -cd '[:alnum:] ._-')"
ACTIVATION_RESPONSE="$(curl --fail-with-body --silent --show-error --max-time 20 -H 'Content-Type: application/json' -d "{\"activationCode\":\"$ACTIVATION_CODE\",\"deviceId\":\"$DEVICE_ID\",\"deviceName\":\"$DEVICE_NAME\"}" "$LICENSE_SERVER/api/downloads/license/activate")" || fail "裝置啟用失敗：$ACTIVATION_RESPONSE"
printf '%s' "$ACTIVATION_RESPONSE" | grep -q '"active":true' || fail "訂閱尚未生效、已到期或裝置數已達上限。"
echo "裝置啟用成功。"

ensure_secret "JWT_SECRET" "replace-with-at-least-32-random-characters"
ensure_secret "FIELD_ENCRYPTION_KEY" "replace-with-64-hex-characters"
ensure_secret "PARSER_SHARED_SECRET" ""
set_env "LICENSE_ENFORCEMENT" "true"
set_env "LICENSE_SERVER_URL" "$LICENSE_SERVER"
set_env "LICENSE_ACTIVATION_CODE" "$ACTIVATION_CODE"
set_env "LICENSE_DEVICE_ID" "$DEVICE_ID"
set_env "LICENSE_CHECK_INTERVAL_MINUTES" "15"
set_env "LICENSE_OFFLINE_GRACE_HOURS" "24"
chmod 600 .env

read -r -p "本機管理員 Email: " ADMIN_EMAIL
read -r -s -p "本機管理員密碼（至少 12 字元）: " ADMIN_PASSWORD
echo
[ "${#ADMIN_PASSWORD}" -ge 12 ] || fail "密碼長度不足。"
ADMIN_PASSWORD_BASE64="$(printf '%s' "$ADMIN_PASSWORD" | openssl base64 -A)"
unset ADMIN_PASSWORD
set_env "SEED_ADMIN_EMAIL" "$ADMIN_EMAIL"
set_env "SEED_ADMIN_PASSWORD_BASE64" "$ADMIN_PASSWORD_BASE64"

echo "正在建立 ExcelMaster Docker 服務，第一次約需 5–15 分鐘…"
docker compose up -d --build postgres parser || fail "PostgreSQL 或 Parser 建置失敗。"
docker compose run --rm api npx prisma db push --schema apps/api/prisma/schema.prisma || fail "資料庫初始化失敗。"
docker compose run --rm -e ALLOW_PRODUCTION_SEED=true api node apps/api/dist/seed.js || fail "管理員帳號初始化失敗。"
docker compose up -d --build api worker web || fail "ExcelMaster 服務啟動失敗。"
echo "安裝完成：http://localhost:8080"
open http://localhost:8080 || true
read -r -p "按 Enter 關閉安裝程式…"
