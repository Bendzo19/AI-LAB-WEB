@echo off
rem Builds f1sim (Release), runs the tests and installs the Python packages. See setup.ps1 for options.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
pause
