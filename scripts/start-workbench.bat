@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.." 2>nul
if errorlevel 1 (
  cd /d "%~dp0\.." 2>nul
)

echo.
echo Codex Workbench Windows bootstrap
echo Project directory: %CD%
echo.
echo [1/7] Checking Node.js / npm

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js / npm was not detected. Please install Node.js and retry.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js / npm was not detected. Please install Node.js and retry.
  pause
  exit /b 1
)

node -v
call npm -v

echo.
echo [2/7] Stopping previous Workbench processes
call :killworkbenchprocesses
call :killport 9999
call :killport 8787

echo.
echo [3/7] Checking dependencies
if not exist "node_modules\" (
  echo node_modules was not found. Running npm install...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Please check the error above.
    pause
    exit /b 1
  )
) else (
  echo node_modules exists. Skipping npm install.
)

echo.
echo [4/7] Checking local API config
if not exist "configs\" (
  mkdir "configs"
)

if not exist "configs\api_config.local.json" (
  if exist "configs\api_config.template.json" (
    copy "configs\api_config.template.json" "configs\api_config.local.json" >nul
    echo Created configs\api_config.local.json from the template.
    echo Please fill your own API key and model, then run this script again.
    echo This script never auto-fills or prints secrets.
    pause
    exit /b 1
  ) else (
    echo configs\api_config.template.json was not found. Cannot create local config.
    pause
    exit /b 1
  )
) else (
  echo Local config exists.
)

echo.
echo [5/7] Initializing database
call npm run db:init
if errorlevel 1 (
  echo Database initialization failed. Please check the error above.
  pause
  exit /b 1
)

echo.
echo [6/7] Verifying ports 9999 / 8787 are free
call :killport 9999
call :killport 8787

if "%START_WORKBENCH_PRECHECK_ONLY%"=="1" (
  echo.
  echo Precheck mode completed. Dev environment was not started.
  exit /b 0
)

echo.
echo [7/7] Starting development environment
echo URL: http://127.0.0.1:9999
echo.
echo Starting backend API on http://127.0.0.1:8787 ...
start "Codex Workbench API" /b cmd /d /c "call npm run dev:server"
ping -n 3 127.0.0.1 >nul

if not "%START_WORKBENCH_SKIP_BROWSER%"=="1" (
  start "" "http://127.0.0.1:9999"
)
echo Starting web UI on http://127.0.0.1:9999 ...
call npm run dev
set "DEV_EXIT=%ERRORLEVEL%"

echo.
if not "%DEV_EXIT%"=="0" (
  echo Development environment failed or exited unexpectedly. Please check the error above.
) else (
  echo Development environment exited.
)
pause
exit /b %DEV_EXIT%

:killworkbenchprocesses
set "WORKBENCH_ROOT=%CD%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=[System.IO.Path]::GetFullPath($env:WORKBENCH_ROOT); $pattern=[regex]::Escape($root); $targets=Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -match $pattern -and $_.Name -match '^(node|npm|cmd)\.exe$' -and ($_.CommandLine -match 'server[\\/]+index\.js|scripts[\\/]+run-web-dev\.mjs|node_modules[\\/]+vite|npm(\.cmd)?\s+run\s+(dev|dev:server)') }; if (-not $targets) { Write-Host 'No old Workbench node processes found.' } else { $targets | ForEach-Object { Write-Host ('Stopping old Workbench process PID {0} ({1})' -f $_.ProcessId,$_.Name); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }"
if errorlevel 1 (
  echo Process scan failed. Continuing with port cleanup.
)
exit /b 0

:killport
set "TARGET_PORT=%~1"
set "FOUND_PORT_PID="

for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /R /C:":%TARGET_PORT% .*LISTENING"') do (
  if not "%%P"=="0" (
    echo !FOUND_PORT_PID! | findstr /C:" %%P " >nul
    if errorlevel 1 (
      set "FOUND_PORT_PID=!FOUND_PORT_PID! %%P "
      echo Port %TARGET_PORT% is occupied by PID %%P. Stopping old process...
      taskkill /PID %%P /T /F >nul 2>nul
      if errorlevel 1 (
        echo Failed to stop PID %%P on port %TARGET_PORT%. Please check manually.
      ) else (
        echo Cleared PID %%P on port %TARGET_PORT%.
      )
    )
  )
)

if not defined FOUND_PORT_PID (
  echo Port %TARGET_PORT% is free.
)
exit /b 0
