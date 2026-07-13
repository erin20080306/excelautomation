$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "尚未安裝 Docker Desktop。請先安裝：https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
  Read-Host "按 Enter 結束"
  exit 1
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { Write-Host "請先啟動 Docker Desktop。" -ForegroundColor Yellow; Read-Host "按 Enter 結束"; exit 1 }
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }

function New-HexSecret([int]$Bytes = 32) {
  $buffer = New-Object byte[] $Bytes
  [Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return [Convert]::ToHexString($buffer).ToLowerInvariant()
}

function Add-SecretIfMissing([string]$Key, [string]$Placeholder = "") {
  $match = Get-Content ".env" | Where-Object { $_ -match "^$([Regex]::Escape($Key))=" } | Select-Object -Last 1
  $value = if ($match) { $match.Substring($match.IndexOf("=") + 1) } else { "" }
  if ([String]::IsNullOrWhiteSpace($value) -or $value -eq $Placeholder) { Add-Content ".env" "`n$Key=$(New-HexSecret)" }
}

Add-SecretIfMissing "JWT_SECRET" "replace-with-at-least-32-random-characters"
Add-SecretIfMissing "FIELD_ENCRYPTION_KEY" "replace-with-64-hex-characters"
Add-SecretIfMissing "PARSER_SHARED_SECRET"

$AdminEmail = Read-Host "管理員 Email"
$SecurePassword = Read-Host "管理員密碼（至少 12 字元）" -AsSecureString
$Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
try { $AdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer) }
if ($AdminPassword.Length -lt 12) { throw "密碼長度不足" }
$AdminPasswordBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($AdminPassword))
$AdminPassword = $null

Add-Content ".env" "`nSEED_ADMIN_EMAIL=$AdminEmail"
Add-Content ".env" "SEED_ADMIN_PASSWORD_BASE64=$AdminPasswordBase64"

Write-Host "正在建立 ExcelMaster Docker 服務，第一次約需 5–15 分鐘…" -ForegroundColor Cyan
docker compose up -d --build postgres parser
docker compose run --rm api npx prisma db push --schema apps/api/prisma/schema.prisma
docker compose run --rm -e ALLOW_PRODUCTION_SEED=true api node apps/api/dist/seed.js
docker compose up -d --build api worker web
Start-Process "http://localhost:8080"
Write-Host "安裝完成：http://localhost:8080" -ForegroundColor Green
Read-Host "按 Enter 關閉安裝程式"
