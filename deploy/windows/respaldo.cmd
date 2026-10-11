@echo off
REM Respaldo diario de PharmaPOS (Programador de tareas de Windows).
REM Copia este archivo a C:\PharmaPOS\respaldo.cmd y ajusta las 3 rutas.
REM Guia: docs\produccion\04-OPERACION.md (Respaldos).

REM 1) Herramientas de PostgreSQL (pg_dump). Cambia 16 si instalaste otra version.
set "PATH=C:\Program Files\PostgreSQL\16\bin;%PATH%"

REM 2) Donde se guardan los respaldos. Una carpeta de OneDrive o Google Drive
REM    hace que ademas se copien a la nube automaticamente (fuera de la PC).
set "BACKUP_DIR=%USERPROFILE%\OneDrive\PharmaPOS-respaldos"
set "BACKUP_KEEP_DAYS=30"

REM 3) Carpeta del backend (ahi esta el .env con DATABASE_URL).
cd /d "C:\PharmaPOS\pharma-back"

if not exist "C:\PharmaPOS\logs" mkdir "C:\PharmaPOS\logs"
echo ===== %DATE% %TIME% ===== >> "C:\PharmaPOS\logs\respaldo.log"
node scripts\backup.js >> "C:\PharmaPOS\logs\respaldo.log" 2>&1
exit /b %ERRORLEVEL%
