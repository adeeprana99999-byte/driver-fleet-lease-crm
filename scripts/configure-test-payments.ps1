param(
  [int]$BookingDepositAmount = 100
)

$ErrorActionPreference = "Stop"
$appRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $appRoot ".env"

if (-not (Test-Path -LiteralPath $envPath)) {
  New-Item -ItemType File -Force -Path $envPath | Out-Null
}

$lines = @(Get-Content -LiteralPath $envPath -ErrorAction SilentlyContinue)

function Set-EnvValue {
  param([string]$Name, [string]$Value)
  $script:lines = @($script:lines | Where-Object { $_ -notmatch "^$([Regex]::Escape($Name))=" })
  if ($Value -and $Value.Trim()) {
    $script:lines += "$Name=$($Value.Trim())"
  }
}

Set-EnvValue "PAYMENT_MODE" "test"
Set-EnvValue "BOOKING_DEPOSIT_AMOUNT" ([string]$BookingDepositAmount)

Set-Content -LiteralPath $envPath -Value $lines -Encoding UTF8

Write-Host "Test booking payment settings saved."
Write-Host "Restart the app, then open http://localhost:4330/booking"
