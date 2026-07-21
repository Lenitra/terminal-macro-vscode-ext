@echo off
setlocal
rem Se placer dans le dossier du script (racine de l'extension)
cd /d "%~dp0/.."

echo [1/2] Empaquetage de l'extension (vsce package)...
call npx --yes @vscode/vsce package -o speed-terminal-macros.vsix
if errorlevel 1 (
    echo.
    echo ECHEC de l'empaquetage. Verifiez que Node.js est installe.
    exit /b 1
)

echo.
echo [2/2] Installation dans VSCode...
call code --install-extension speed-terminal-macros.vsix --force
if errorlevel 1 (
    echo.
    echo ECHEC de l'installation. Verifiez que "code" est dans le PATH.
    echo Dans VSCode : Ctrl+Shift+P, "Shell Command: Install 'code' command in PATH".
    exit /b 1
)

echo.
echo Extension installee avec succes !
echo Rechargez les fenetres VSCode ouvertes (Ctrl+Shift+P, "Reload Window") pour l'activer.
exit /b 0
