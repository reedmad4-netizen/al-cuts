@echo off
REM CLIPX AI - Windows launcher with a visible console (for troubleshooting).
REM The normal launcher is "CLIPX AI.vbs", which hides this window.
setlocal
cd /d "%~dp0.."
node "desktop\launch.mjs"
if errorlevel 1 (
  echo.
  echo CLIPX AI could not start. See data\desktop.log for details.
  pause
)
