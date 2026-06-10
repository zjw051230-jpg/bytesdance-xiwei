@echo off
chcp 65001 >nul
cd /d "%~dp0" 2>nul
if errorlevel 1 (
  cd /d "%~dp0." 2>nul
)

call "scripts\start-workbench.bat"
exit /b %ERRORLEVEL%
