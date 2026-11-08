@echo off
rem Instala o abridor de PDFs do Painel de Estudos (so para este usuario do Windows).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
pause
