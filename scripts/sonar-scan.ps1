<#
.SYNOPSIS
  Run a local SonarQube scan for the yomibako project (projectKey: yomibako).

.DESCRIPTION
  Thin wrapper around sonar-scanner CLI. Reads config from sonar-project.properties
  in the project root, so only host URL + token need to be supplied here.

  Token priority: -Token arg > $env:SONAR_TOKEN > built-in local default below.

  NOTE: The built-in default is a LOCAL-ONLY token for http://localhost:9000 on this
  machine. It is useless against any other server. It is hardcoded here for
  convenience so `npm run sonar` works with zero setup. Do NOT reuse this pattern
  for cloud/hosted SonarQube tokens. If this repo is ever pushed anywhere public,
  revoke the token at http://localhost:9000/account/security and generate a new one.

.EXAMPLE
  $env:SONAR_TOKEN = 'sqp_057b78db6488f12e0cb64775515ec65db07b69a0'
  powershell -ExecutionPolicy Bypass -File scripts\sonar-scan.ps1

.EXAMPLE
  .\scripts\sonar-scan.ps1 -Token 'sqp_...' -HostUrl 'http://localhost:9000'

.EXAMPLE
  npm run sonar -- --Token 'sqp_...'
#>
[CmdletBinding()]
param(
  [string]$Token = $env:SONAR_TOKEN,
  [string]$HostUrl = $env:SONAR_HOST_URL,
  [string]$ProjectKey = 'yomibako'
)

$ErrorActionPreference = 'Stop'

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$PropsFile  = Join-Path $ProjectDir 'sonar-project.properties'

if (-not (Test-Path -LiteralPath $PropsFile)) {
  Write-Error "Missing $PropsFile. Run this script from the yomibako repo."
  exit 1
}

if ([string]::IsNullOrWhiteSpace($HostUrl)) { $HostUrl = 'http://localhost:9000' }
if ([string]::IsNullOrWhiteSpace($ProjectKey)) { $ProjectKey = 'yomibako' }

# LOCAL-ONLY default token for http://localhost:9000 (this machine only).
# Useless against any other SonarQube server. Override via -Token or $env:SONAR_TOKEN.
$DefaultLocalToken = 'sqp_057b78db6488f12e0cb64775515ec65db07b69a0'
if ([string]::IsNullOrWhiteSpace($Token)) { $Token = $DefaultLocalToken }

if ([string]::IsNullOrWhiteSpace($Token)) {
  Write-Host ''
  Write-Host 'ERROR: SonarQube token not set.' -ForegroundColor Red
  Write-Host "  `$env:SONAR_TOKEN = 'sqp_...'  # paste the token from http://localhost:9000/account/security"
  Write-Host '  .\scripts\sonar-scan.ps1 -Token ''sqp_...'''
  Write-Host ''
  exit 1
}

# --- Locate sonar-scanner -------------------------------------------------
$Scanner = $null
$candidates = @()
if ($env:SONAR_SCANNER_HOME) {
  $candidates += (Join-Path $env:SONAR_SCANNER_HOME 'bin\sonar-scanner.bat')
  $candidates += (Join-Path $env:SONAR_SCANNER_HOME 'bin\sonar-scanner')
}
foreach ($candidate in $candidates) {
  if ($candidate -and (Test-Path -LiteralPath $candidate)) { $Scanner = $candidate; break }
}
if (-not $Scanner) {
  $cmd = Get-Command sonar-scanner.bat -ErrorAction SilentlyContinue
  if (-not $cmd) { $cmd = Get-Command sonar-scanner -ErrorAction SilentlyContinue }
  if ($cmd) { $Scanner = $cmd.Source }
}
# Common manual-install locations (SonarScanner CLI zip extract)
if (-not $Scanner) {
  foreach ($dir in @(
    'C:\sonar-scanner\bin',
    'C:\Tools\sonar-scanner\bin',
    'D:\Tools\sonar-scanner\bin',
    (Join-Path $env:USERPROFILE 'sonar-scanner\bin')
  )) {
    $p = Join-Path $dir 'sonar-scanner.bat'
    if (Test-Path -LiteralPath $p) { $Scanner = $p; break }
  }
}
if (-not $Scanner) {
  Write-Host ''
  Write-Host 'ERROR: sonar-scanner.bat not found on PATH.' -ForegroundColor Red
  Write-Host '  1. Download SonarScanner CLI: https://docs.sonarsource.com/sonarqube/latest/analyzing-source-code/scanners/sonarscanner/'
  Write-Host '  2. Extract it, e.g. to C:\sonar-scanner'
  Write-Host '  3. Either add C:\sonar-scanner\bin to PATH or set:'
  Write-Host '       $env:SONAR_SCANNER_HOME = ''C:\sonar-scanner'''
  Write-Host '  Requires Java 17+ (you have it). Verify with: sonar-scanner.bat --version'
  Write-Host ''
  exit 1
}

# --- Quick server check ----------------------------------------------------
try {
  $uri = $HostUrl.TrimEnd('/') + '/api/system/status'
  $status = Invoke-RestMethod -Uri $uri -TimeoutSec 5
  Write-Host "SonarQube server: $HostUrl (status: $($status.status), version: $($status.version))"
} catch {
  Write-Host "WARNING: could not reach $HostUrl ($($_.Exception.Message))" -ForegroundColor Yellow
  Write-Host '  Make sure SonarQube is running (e.g. docker: http://localhost:9000). Continuing anyway...'
}

# --- Optional: refresh coverage so SonarQube shows it -----------------------
# Comment out if you don't want the scan to run tests first.
# if (Test-Path (Join-Path $ProjectDir 'package.json')) {
#   Push-Location $ProjectDir
#   try { npm run test:coverage } finally { Pop-Location }
# }

# --- Run the scan -----------------------------------------------------------
Write-Host ''
Write-Host "Scanning $ProjectDir as projectKey '$ProjectKey' against $HostUrl ..."
Write-Host "Using scanner: $Scanner"
Write-Host ''

Push-Location $ProjectDir
try {
  & $Scanner `
    "-Dsonar.projectKey=$ProjectKey" `
    "-Dsonar.host.url=$HostUrl" `
    "-Dsonar.token=$Token"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host "Done. Open $HostUrl/dashboard?id=$ProjectKey" -ForegroundColor Green
