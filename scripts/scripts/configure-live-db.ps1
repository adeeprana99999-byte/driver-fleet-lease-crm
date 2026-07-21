param(
  [string]$MongoUri,
  [string]$DbName = "fleetwebco",
  [int]$Port = 4330
)

$ErrorActionPreference = "Stop"
$appRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

if (-not $MongoUri) {
  $MongoUri = Read-Host "Paste MongoDB URI"
}

if (-not $MongoUri -or $MongoUri.Trim().Length -lt 20) {
  throw "MongoDB URI is required."
}

$envPath = Join-Path $appRoot ".env"
$content = @(
  "MONGODB_URI=$MongoUri",
  "MONGODB_DB=$DbName",
  "PORT=$Port"
) -join [Environment]::NewLine

Set-Content -LiteralPath $envPath -Value $content -Encoding UTF8

Write-Host "MongoDB settings saved to .env"
Write-Host "Next run:"
Write-Host "  npm.cmd run db:migrate-leasing"
Write-Host "  npm.cmd start"
