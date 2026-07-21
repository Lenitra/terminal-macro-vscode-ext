@echo off
setlocal
rem Se placer dans le dossier du script (racine de l'extension)
cd /d "%~dp0/.."

echo Empaquetage de l'extension (vsce package)...
echo.
call npx --yes @vscode/vsce package
if errorlevel 1 (
    echo.
    echo ECHEC de l'empaquetage. Verifiez que Node.js est installe.
    exit /b 1
)

rem Recuperer le .vsix le plus recent pour l'afficher
set "LATEST="
for /f "delims=" %%f in ('dir /b /a-d /o-d *.vsix 2^>nul') do if not defined LATEST set "LATEST=%%f"

echo.
echo Export termine : %CD%\%LATEST%
echo.
echo Pour l'installer : code --install-extension "%LATEST%"
exit /b 0
