param(
  [ValidateSet("WINDOWS", "MACOS")][string]$Platform = "WINDOWS",
  [string]$Version = "1.0.0"
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$OutputDirectory = Join-Path $Root "dist/releases"
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
foreach ($required in @("安裝說明.md", "release-manifest.json", "docker-compose.yml", ".env.example")) {
  if (-not (Test-Path (Join-Path $Root $required))) { throw "缺少打包必要檔案：$required" }
}

$Name = if ($Platform -eq "WINDOWS") { "ExcelMaster-$Version-Windows.zip" } else { "ExcelMaster-$Version-macOS.zip" }
$Output = Join-Path $OutputDirectory $Name
$GitArguments = @("-C", $Root, "archive", "--format=zip", "--prefix=ExcelMaster/", "-o", $Output, "HEAD", "--", ".")
if ($Platform -eq "WINDOWS") { $GitArguments += ":(exclude)installer/Install-ExcelMaster.command" }
else { $GitArguments += @(
  ":(exclude)installer/Install-ExcelMaster.cmd",
  ":(exclude)installer/Install-ExcelMaster.ps1"
) }
& git @GitArguments
if ($LASTEXITCODE -ne 0) { throw "git archive 建立安裝包失敗" }
$Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Output).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$Output.sha256", "$Hash  $Name`n", (New-Object Text.UTF8Encoding($false)))
& node (Join-Path $Root "scripts/verify-release.mjs") $Output
if ($LASTEXITCODE -ne 0) { throw "安裝包完整性驗證失敗" }
Write-Output $Output
