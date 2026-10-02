@echo off
chcp 65001 >nul
title Tienda Eben-Ezer - NO CERRAR
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Falta instalar Node.js. Descarguelo de https://nodejs.org ^(version LTS^) e instalelo.
  echo.
  pause
  exit /b 1
)
start "" http://localhost:8080
node servidor.js
echo.
echo  El servidor se detuvo. Si no fue a proposito, revise el mensaje de arriba.
pause
