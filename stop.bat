@echo off
setlocal
title Visual Object Retrieval - Stop
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows.ps1" -Action Stop %*
set "VOR_EXIT_CODE=%ERRORLEVEL%"
if not "%VOR_EXIT_CODE%"=="0" (
    echo.
    echo The app could not stop. Read the message above for the next step.
    if not defined VOR_NO_PAUSE pause
)
exit /b %VOR_EXIT_CODE%
