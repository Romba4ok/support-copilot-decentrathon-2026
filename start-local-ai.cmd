@echo off
setlocal
cd /d "%~dp0"
if not defined GENERATOR_ACTIVATION_MANIFEST if exist "%~dp0runtime\models\operator-generation.json" set "GENERATOR_ACTIVATION_MANIFEST=%~dp0runtime\models\operator-generation.json"
if defined GENERATOR_ACTIVATION_MANIFEST (
  set "LOCAL_GENERATOR=1"
  set "GENERATOR_FOCUS_MODE=model"
) else (
  echo Verified generator is not configured. Starting the support workspace with native generation disabled.
  set "LOCAL_GENERATOR=0"
  set "GENERATOR_FOCUS_MODE=deterministic"
)
node src\server.mjs
set "SUPPORT_EXIT_CODE=%ERRORLEVEL%"
if not "%~1"=="--no-pause" pause
endlocal & exit /b %SUPPORT_EXIT_CODE%
