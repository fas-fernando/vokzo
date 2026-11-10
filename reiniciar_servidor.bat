@echo off
chcp 65001 >nul
title Reiniciar Servidor Alerta Vencimento
cd /d "%~dp0"

echo ===============================================================
echo          REINICIANDO SERVIDOR ALERTA VENCIMENTO
echo ===============================================================
echo.

echo 🛑 Finalizando processos anteriores na porta 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo     Encerrando processo PID %%a...
    taskkill /F /PID %%a >nul 2>nul
)

timeout /t 1 /nobreak >nul

echo 🚀 Iniciando novo servidor com as últimas correções...
echo 🌐 Abrindo http://localhost:3000 no navegador...
echo.
start http://localhost:3000
node server.js

pause
