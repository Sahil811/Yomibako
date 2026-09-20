@echo off
REM Local SonarQube scan for yomibako (projectKey: yomibako)
REM Usage:
REM   scripts\sonar-scan.bat
REM   scripts\sonar-scan.bat sqp_... [http://localhost:9000]
REM   set SONAR_TOKEN=sqp_... & scripts\sonar-scan.bat
REM NOTE: LOCAL-ONLY default token below works only against http://localhost:9000
REM on this machine. Useless against any other server. Arg/env override it.
REM Do NOT reuse this pattern for cloud/hosted tokens. If this repo is ever
REM pushed anywhere public, revoke the token at http://localhost:9000/account/security.
REM Config comes from sonar-project.properties.
setlocal EnableDelayedExpansion

set "PROJECT_DIR=%~dp0.."
set "HOST_URL=%~2"
if "%HOST_URL%"=="" if defined SONAR_HOST_URL set "HOST_URL=%SONAR_HOST_URL%"
if "%HOST_URL%"=="" set "HOST_URL=http://localhost:9000"

REM LOCAL-ONLY default token (localhost only, see NOTE above).
set "LOCAL_TOKEN=sqp_057b78db6488f12e0cb64775515ec65db07b69a0"
set "TOKEN=%~1"
if "%TOKEN%"=="" set "TOKEN=%SONAR_TOKEN%"
if "%TOKEN%"=="" set "TOKEN=%LOCAL_TOKEN%"

if "%TOKEN%"=="" (
  echo.
  echo ERROR: SonarQube token not set.
  echo   set SONAR_TOKEN=sqp_...  ^(from http://localhost:9000/account/security^)
  echo   scripts\sonar-scan.bat
  echo.
  exit /b 1
)

if not exist "%PROJECT_DIR%\sonar-project.properties" (
  echo ERROR: sonar-project.properties not found in %PROJECT_DIR%
  exit /b 1
)

REM Locate scanner
set "SCANNER=sonar-scanner.bat"
where sonar-scanner.bat >nul 2>nul
if errorlevel 1 (
  if defined SONAR_SCANNER_HOME (
    if exist "%SONAR_SCANNER_HOME%\bin\sonar-scanner.bat" set "SCANNER=%SONAR_SCANNER_HOME%\bin\sonar-scanner.bat"
  )
)
if not exist "%SCANNER%" (
  if exist "C:\sonar-scanner\bin\sonar-scanner.bat" set "SCANNER=C:\sonar-scanner\bin\sonar-scanner.bat"
)
where "%SCANNER%" >nul 2>nul
if errorlevel 1 if not exist "%SCANNER%" (
  echo.
  echo ERROR: sonar-scanner.bat not found on PATH.
  echo   Download: https://docs.sonarsource.com/sonarqube/latest/analyzing-source-code/scanners/sonarscanner/
  echo   Add its bin folder to PATH or set SONAR_SCANNER_HOME.
  echo.
  exit /b 1
)

echo Scanning %PROJECT_DIR% as yomibako against %HOST_URL% ...
echo Using scanner: %SCANNER%
echo.
cd /d "%PROJECT_DIR%" || exit /b 1
"%SCANNER%" "-Dsonar.projectKey=yomibako" "-Dsonar.host.url=%HOST_URL%" "-Dsonar.token=%TOKEN%"
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" exit /b %CODE%
echo.
echo Done. Open %HOST_URL%/dashboard?id=yomibako
