$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Stop-WithMessage([string]$Message) {
  Write-Host $Message -ForegroundColor Red
  Read-Host "按 Enter 結束"
  exit 1
}

function New-HexSecret([int]$Bytes = 32) {
  $buffer = New-Object byte[] $Bytes
  [Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return [Convert]::ToHexString($buffer).ToLowerInvariant()
}

function Set-EnvValue([string]$Key, [string]$Value) {
  $lines = if (Test-Path ".env") { @(Get-Content ".env") } else { @() }
  $escaped = [Regex]::Escape($Key)
  $updated = $false
  $next = foreach ($line in $lines) {
    if ($line -match "^$escaped=") { if (-not $updated) { "$Key=$Value"; $updated = $true } }
    else { $line }
  }
  if (-not $updated) { $next += "$Key=$Value" }
  [IO.File]::WriteAllLines((Join-Path $Root ".env"), $next, (New-Object Text.UTF8Encoding($false)))
}

function Ensure-Secret([string]$Key, [string]$Placeholder = "") {
  $match = Get-Content ".env" | Where-Object { $_ -match "^$([Regex]::Escape($Key))=" } | Select-Object -Last 1
  $value = if ($match) { $match.Substring($match.IndexOf("=") + 1) } else { "" }
  if ([String]::IsNullOrWhiteSpace($value) -or $value -eq $Placeholder) { Set-EnvValue $Key (New-HexSecret) }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Stop-WithMessage "尚未安裝 Docker Desktop。請先安裝：https://www.docker.com/products/docker-desktop/" }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "請先啟動 Docker Desktop。" }
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }

Write-Host "ExcelMaster 訂閱與裝置啟用" -ForegroundColor Cyan
$DefaultLicenseServer = "https://excelautomation-backend.vercel.app"
$LicenseServer = Read-Host "授權伺服器（直接按 Enter 使用 $DefaultLicenseServer）"
if ([String]::IsNullOrWhiteSpace($LicenseServer)) { $LicenseServer = $DefaultLicenseServer }
$LicenseServer = $LicenseServer.TrimEnd("/")
$ActivationCode = (Read-Host "請輸入訂閱頁顯示的一次性啟用碼").Trim()
if ($ActivationCode.Length -lt 24) { Stop-WithMessage "啟用碼格式錯誤。請回到方案與授權頁重新產生下載。" }
$MachineGuid = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Cryptography" -Name MachineGuid).MachineGuid
$DeviceSource = "$MachineGuid|$env:COMPUTERNAME"
$DeviceBytes = [Text.Encoding]::UTF8.GetBytes($DeviceSource)
$DeviceId = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($DeviceBytes)).ToLowerInvariant()
$ActivationBody = @{ activationCode = $ActivationCode; deviceId = $DeviceId; deviceName = $env:COMPUTERNAME } | ConvertTo-Json -Compress
try {
  $Activation = Invoke-RestMethod -Method Post -Uri "$LicenseServer/api/downloads/license/activate" -ContentType "application/json" -Body $ActivationBody -TimeoutSec 20
} catch {
  $detail = $_.ErrorDetails.Message
  Stop-WithMessage "裝置啟用失敗。$detail"
}
if (-not $Activation.active) { Stop-WithMessage "訂閱尚未生效、已到期或裝置數已達上限。" }
Write-Host "裝置啟用成功，訂閱有效至 $($Activation.expiresAt)" -ForegroundColor Green

Ensure-Secret "JWT_SECRET" "replace-with-at-least-32-random-characters"
Ensure-Secret "FIELD_ENCRYPTION_KEY" "replace-with-64-hex-characters"
Ensure-Secret "PARSER_SHARED_SECRET"
Set-EnvValue "LICENSE_ENFORCEMENT" "true"
Set-EnvValue "LICENSE_SERVER_URL" $LicenseServer
Set-EnvValue "LICENSE_ACTIVATION_CODE" $ActivationCode
Set-EnvValue "LICENSE_DEVICE_ID" $DeviceId
Set-EnvValue "LICENSE_CHECK_INTERVAL_MINUTES" "15"
Set-EnvValue "LICENSE_OFFLINE_GRACE_HOURS" "24"

$AdminEmail = Read-Host "本機管理員 Email"
$SecurePassword = Read-Host "本機管理員密碼（至少 12 字元）" -AsSecureString
$Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
try { $AdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer) }
if ($AdminPassword.Length -lt 12) { Stop-WithMessage "密碼長度不足" }
$AdminPasswordBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($AdminPassword))
$AdminPassword = $null
Set-EnvValue "SEED_ADMIN_EMAIL" $AdminEmail
Set-EnvValue "SEED_ADMIN_PASSWORD_BASE64" $AdminPasswordBase64

Write-Host "正在建立 ExcelMaster Docker 服務，第一次約需 5–15 分鐘…" -ForegroundColor Cyan
docker compose up -d --build postgres parser
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "PostgreSQL 或 Parser 建置失敗，請查看 Docker Desktop 記錄。" }
docker compose run --rm api npx prisma db push --schema apps/api/prisma/schema.prisma
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "資料庫初始化失敗。" }
docker compose run --rm -e ALLOW_PRODUCTION_SEED=true api node apps/api/dist/seed.js
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "管理員帳號初始化失敗。" }
docker compose up -d --build api worker web
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "ExcelMaster 服務啟動失敗。" }
Start-Process "http://localhost:8080" | Out-Null
Write-Host "安裝完成：http://localhost:8080" -ForegroundColor Green
Write-Host "請保留根目錄的安裝說明.md；授權問題可由平台管理員查看裝置最後連線時間。"
Read-Host "按 Enter 關閉安裝程式"
