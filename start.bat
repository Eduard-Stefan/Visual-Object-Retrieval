@echo off
setlocal
title Visual Object Retrieval - Start
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows.ps1" -Action Start %*
set "VOR_EXIT_CODE=%ERRORLEVEL%"
if not "%VOR_EXIT_CODE%"=="0" (
    echo.
    echo The app could not start. Read the message above for the next step.
    if not defined VOR_NO_PAUSE pause
)
exit /b %VOR_EXIT_CODE%
