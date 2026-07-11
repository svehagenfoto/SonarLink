@echo off
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo First start or missing dependencies. Installing once...
  call npm install
  if errorlevel 1 goto failed
)

start "" /D "%~dp0" "%~dp0node_modules\electron\dist\electron.exe" .
exit /b 0

:failed
echo.
echo SonarLink failed to start. See errors above.
pause
exit /b 1
