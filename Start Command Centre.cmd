@echo off
rem Double-click to open the Content Command Centre. Starts the server if it is not running yet.
rem Closing the "Command Centre server" window stops the server.
cd /d "%~dp0"
set "URL=http://localhost:4319"
curl.exe -s -o NUL %URL%/ && goto open
start "Command Centre server" /min node dashboard\server.mjs
for /l %%i in (1,1,20) do (
  timeout /t 1 /nobreak >nul
  curl.exe -s -o NUL %URL%/ && goto open
)
echo The Command Centre did not start. Open the "Command Centre server" window to see why.
pause
exit /b 1
:open
start "" %URL%
