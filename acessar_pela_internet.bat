@echo off
chcp 65001 >nul
title Acesso pela Internet - Alerta Vencimento
cd /d "%~dp0"

echo ===============================================================
echo     CRIAR LINK DE ACESSO EXTERNO (QUALQUER LUGAR / 4G)
echo ===============================================================
echo.
echo Este utilitário cria um link HTTPS público e seguro para você
echo acessar o Alerta Vencimento do seu celular de qualquer lugar,
echo mesmo fora da sua rede Wi-Fi.
echo.
echo OBS: O servidor local (iniciar_servidor.bat) deve estar rodando!
echo.
echo Iniciando túnel seguro na porta 3000...
echo.

npx --yes localtunnel --port 3000

echo.
pause
