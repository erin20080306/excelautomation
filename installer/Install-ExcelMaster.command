#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "尚未安裝 Docker Desktop。請先安裝：https://www.docker.com/products/docker-desktop/"
  read -r -p "按 Enter 結束…"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "請先啟動 Docker Desktop，再重新執行本安裝程式。"
  read -r -p "按 Enter 結束…"
  exit 1
fi

if [ ! -f .env ]; then cp .env.example .env; fi

ensure_secret() {
  local key="$1" placeholder="$2" value
  value="$(sed -n "s/^${key}=//p" .env | tail -n 1)"
  if [ -z "$value" ] || [ "$value" = "$placeholder" ]; then
    printf '\n%s=%s\n' "$key" "$(openssl rand -hex 32)" >> .env
  fi
}

ensure_secret "JWT_SECRET" "replace-with-at-least-32-random-characters"
ensure_secret "FIELD_ENCRYPTION_KEY" "replace-with-64-hex-characters"
ensure_secret "PARSER_SHARED_SECRET" ""
read -r -p "管理員 Email: " ADMIN_EMAIL
read -r -s -p "管理員密碼（至少 12 字元）: " ADMIN_PASSWORD
echo
if [ "${#ADMIN_PASSWORD}" -lt 12 ]; then echo "密碼長度不足。"; exit 1; fi
ADMIN_PASSWORD_BASE64="$(printf '%s' "$ADMIN_PASSWORD" | openssl base64 -A)"
unset ADMIN_PASSWORD
{
  echo
  echo "SEED_ADMIN_EMAIL=$ADMIN_EMAIL"
  echo "SEED_ADMIN_PASSWORD_BASE64=$ADMIN_PASSWORD_BASE64"
} >> .env

echo "正在建立 ExcelMaster Docker 服務，第一次約需 5–15 分鐘…"
docker compose up -d --build postgres parser
docker compose run --rm api npx prisma db push --schema apps/api/prisma/schema.prisma
docker compose run --rm -e ALLOW_PRODUCTION_SEED=true api node apps/api/dist/seed.js
docker compose up -d --build api worker web

echo "安裝完成：http://localhost:8080"
open http://localhost:8080 || true
read -r -p "按 Enter 關閉安裝程式…"
