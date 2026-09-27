@echo off
if not exist "%~dp0build\Release\f1sim.exe" (
  echo The game is not built yet - run build.bat first.
  pause
  exit /b 1
)
start "" /D "%~dp0build\Release" "%~dp0build\Release\f1sim.exe" %*
