param(
  [string]$KeyId,
  [string]$KeySecret,
  [string]$WebhookSecret,
  [int]$BookingDepositAmount = 100
)

$ErrorActionPreference = "Stop"
$appRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $appRoot ".env"

if (-not $KeyId) {
  $KeyId = Read-Host "Paste Razorpay KEY_ID"
}
if (-not $KeySecret) {
  $KeySecret = Read-Host "Paste Razorpay KEY_SECRET"
}
if (-not $WebhookSecret) {
  $WebhookSecret = Read-Host "Paste Razorpay webhook secret (optional)"
}

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

Set-EnvValue "BOOKING_DEPOSIT_AMOUNT" ([string]$BookingDepositAmount)
Set-EnvValue "PAYMENT_MODE" "razorpay"
Set-EnvValue "RAZORPAY_KEY_ID" $KeyId
Set-EnvValue "RAZORPAY_KEY_SECRET" $KeySecret
Set-EnvValue "RAZORPAY_WEBHOOK_SECRET" $WebhookSecret

Set-Content -LiteralPath $envPath -Value $lines -Encoding UTF8

Write-Host "Razorpay booking payment settings saved."
Write-Host "Restart the app, then open http://localhost:4330/booking"
