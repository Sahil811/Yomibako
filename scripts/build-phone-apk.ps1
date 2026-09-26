<#
.SYNOPSIS
  Build Yomibako APK for your Android phone (cloud + local fallback) and optionally install it.

.DESCRIPTION
  Automates everything done manually before:
    1. Checks node/npm/eas + Android SDK.
    2. npm install (if node_modules missing).
    3. Tries EAS cloud build (profile 'preview' -> APK) and prints the Expo
       build page link (QR + download link appear there when FINISHED).
    4. Falls back to a local Gradle release build when EAS is unreachable
       (e.g. IPv6 timeout to api.expo.dev on some WiFi) or when -Local is passed.
    5. Copies the APK to yomibako-<profile>.apk in the project root.
    6. Optionally installs via adb when a device is connected (-Install).

.EXAMPLE
  .\scripts\build-phone-apk.ps1
  # Cloud preview build, fallback to local release APK on failure.

.EXAMPLE
  .\scripts\build-phone-apk.ps1 -Local -Install
  # Skip cloud, build locally with Gradle and adb install -r if a phone is attached.

.EXAMPLE
  .\scripts\build-phone-apk.ps1 -Profile development -Install
  # Dev-client build + install for live 'npx expo start --dev-client' work.

.EXAMPLE
  npm run build:phone -- -Local -Install
#>
[CmdletBinding()]
param(
  [ValidateSet('preview', 'development')]
  [string]$Profile = 'preview',

  [switch]$Local,
  [switch]$CloudOnly,
  [switch]$Install,
  [switch]$Wait,
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = 'Stop'

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
Push-Location $ProjectDir
try {
  $ApkName = "yomibako-$Profile.apk"
  $ApkDest = Join-Path $ProjectDir $ApkName

  function Test-Cmd($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
  }

  # --- 1. Prereqs ---------------------------------------------------------
  Write-Host "== Yomibako phone build (profile: $Profile) ==" -ForegroundColor Cyan
  foreach ($cmd in @('node', 'npm')) {
    if (-not (Test-Cmd $cmd)) { Write-Error "Missing required command: $cmd. Install Node.js LTS first." }
  }
  Write-Host "node: $(node --version)  npm: $(npm --version)"

  $HasEas = Test-Cmd 'eas'
  if ($HasEas) { Write-Host "eas: $(eas --version 2>$null | Select-Object -First 1)" }
  elseif (-not $Local) {
    Write-Host "WARNING: 'eas' CLI not found; will use local Gradle build only." -ForegroundColor Yellow
    $Local = $true
  }

  $HasAdb = Test-Cmd 'adb'
  $HasGradleWrapper = Test-Path -LiteralPath (Join-Path $ProjectDir 'android\gradlew.bat')

  # --- 2. Dependencies ----------------------------------------------------
  if (-not $SkipNpmInstall -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'node_modules'))) {
    Write-Host ''
    Write-Host 'Installing npm dependencies (this takes a few minutes)...'
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } else {
    Write-Host 'node_modules: present (skipping npm install).'
  }

  # --- 3. Cloud build -----------------------------------------------------
  $CloudOk = $false
  $BuildPageUrl = $null
  if (-not $Local) {
    Write-Host ''
    Write-Host '--- EAS cloud build ---'
    try {
      $whoami = eas whoami 2>&1 | Out-String
      if ($LASTEXITCODE -ne 0) { throw $whoami }
      Write-Host ($whoami.Trim() -split "`r?`n" | Select-Object -First 3 | Out-String)

      $args = @('build', '-p', 'android', '--profile', $Profile, '--non-interactive')
      if (-not $Wait) { $args += '--no-wait' }
      Write-Host "Running: eas $($args -join ' ')"
      $out = & eas @args 2>&1 | Out-String
      Write-Host $out
      if ($LASTEXITCODE -ne 0) { throw $out }

      if ($out -match 'https://expo\.dev/accounts/\S+/builds/\S+') {
        $BuildPageUrl = $Matches[0].TrimEnd('.', ')')
        Write-Host ''
        Write-Host "Build submitted: $BuildPageUrl" -ForegroundColor Green
        Write-Host 'When it says FINISHED, that page has the QR code + direct .apk download.'
      }
      $CloudOk = $true
      if ($CloudOnly) {
        Write-Host ''
        Write-Host 'Done (--CloudOnly, skipping local build).' -ForegroundColor Green
        return
      }
    } catch {
      $msg = $_.Exception.Message + "`n" + ($_ | Out-String)
      Write-Host ''
      Write-Host 'EAS cloud build failed:' -ForegroundColor Yellow
      Write-Host ($msg | Select-Object -First 1)
      if ($msg -match 'ETIMEDOUT|2606:4700|GraphQL request failed') {
        Write-Host '  Looks like api.expo.dev is unreachable over IPv6 on this network.' -ForegroundColor Yellow
        Write-Host '  Fix: switch to your phone hotspot (worked before as OnePlus 12),'
        Write-Host '  or disable IPv6 / set DNS to 1.1.1.1, then re-run.'
      }
      if ($CloudOnly) { exit 1 }
      Write-Host 'Falling back to local Gradle build...' -ForegroundColor Yellow
    }
  }

  # --- 4. Local build fallback --------------------------------------------
  $NeedLocal = $Local -or (-not $CloudOk) -or $Install
  if ($NeedLocal) {
    Write-Host ''
    Write-Host '--- Local Gradle build ---'
    if (-not $HasGradleWrapper) { Write-Error 'Missing android\gradlew.bat. Run `npx expo prebuild` first.' }
    if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
      Write-Host 'WARNING: ANDROID_HOME not set; Gradle may fail to find the SDK.' -ForegroundColor Yellow
    }
    $variant = 'assembleRelease'
    Push-Location (Join-Path $ProjectDir 'android')
    try {
      Write-Host "Running: gradlew.bat $variant (10-20 min on first run)..."
      & .\gradlew.bat $variant --console=plain
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
      Pop-Location
    }
    $built = Join-Path $ProjectDir 'android\app\build\outputs\apk\release\app-release.apk'
    if (-not (Test-Path -LiteralPath $built)) { Write-Error "Expected APK not found: $built" }
    Copy-Item -LiteralPath $built -Destination $ApkDest -Force
    $mb = [math]::Round((Get-Item -LiteralPath $ApkDest).Length / 1MB, 1)
    Write-Host ''
    Write-Host "Local APK ready: $ApkDest ($mb MB)" -ForegroundColor Green
  }

  # --- 5. Optional adb install ---------------------------------------------
  if ($Install) {
    Write-Host ''
    Write-Host '--- Install via adb ---'
    if (-not $HasAdb) {
      Write-Host "WARNING: 'adb' not found; copy $ApkName to your phone manually." -ForegroundColor Yellow
    } else {
      $devices = (adb devices -l 2>&1 | Out-String).Trim()
      Write-Host $devices
      if ($devices -match 'device\s+product:') {
        $apk = if (Test-Path -LiteralPath $ApkDest) { $ApkDest } else { Join-Path $ProjectDir 'android\app\build\outputs\apk\release\app-release.apk' }
        adb install -r $apk
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Write-Host 'Installed.' -ForegroundColor Green
      } else {
        Write-Host 'No USB device found. Options:' -ForegroundColor Yellow
        Write-Host '  1. Enable USB debugging, plug in via USB, re-run with -Install'
        Write-Host "  2. Copy $ApkName to the phone (File Transfer / Drive) and tap it to install"
      }
    }
  }

  # --- Summary --------------------------------------------------------------
  Write-Host ''
  Write-Host '== Summary ==' -ForegroundColor Cyan
  if ($BuildPageUrl) { Write-Host "  Expo build page: $BuildPageUrl" }
  if (Test-Path -LiteralPath $ApkDest) { Write-Host "  Local APK:       $ApkDest" }
  if (-not $BuildPageUrl -and -not (Test-Path -LiteralPath $ApkDest)) {
    Write-Host '  Nothing produced. Re-run with -Local to force a Gradle build.' -ForegroundColor Yellow
  } else {
    Write-Host '  On phone: tap the APK > Allow unknown apps > Install, then set JPDB token in Settings.'
  }
} finally {
  Pop-Location
}
