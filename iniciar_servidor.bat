@echo off
chcp 65001 >nul
title Servidor Alerta Vencimento
cd /d "%~dp0"

echo ===============================================================
echo          INICIANDO SERVIDOR DO ALERTA VENCIMENTO
echo ===============================================================
echo.

echo [1/3] Limpando processos antigos na porta 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo     Encerrando processo anterior (PID %%a)...
    taskkill /F /PID %%a >nul 2>nul
)

timeout /t 1 /nobreak >nul

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [2/3] Usando Node.js para rodar o servidor atualizado...
    echo [3/3] Abrindo navegador em http://localhost:3000 ...
    echo.
    start http://localhost:3000
    node server.js
) else (
    echo Node.js não foi encontrado no PATH. Tentando com Python...
    where python >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        echo Iniciando servidor Python na porta 3000...
        echo Acesse no navegador: http://localhost:3000
        start http://localhost:3000
        python -m http.server 3000 --bind 0.0.0.0
    ) else (
        echo ERRO: Nem Node.js nem Python foram encontrados instalados.
        echo Por favor, instale o Node.js em https://nodejs.org/
    )
)

echo.
pause
