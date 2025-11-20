@echo off
REM install.bat - Ejecutar como Administrador
SETLOCAL

echo --------------------------------------------------
echo Instalador: mfs-avianca-announcements
echo --------------------------------------------------

:: Comprobar privilegios de administrador
NET SESSION >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Este instalador requiere permisos de Administrador.
  echo Haz clic derecho sobre este archivo y elige "Ejecutar como administrador".
  pause
  exit /B 1
)

rem Carpeta destino (Program Files)
set "DEST=%ProgramFiles%\mfs-avianca-announcements"

echo Creando carpeta destino: %DEST%
if not exist "%DEST%" mkdir "%DEST%"

echo Copiando archivos a %DEST%...
xcopy "%~dp0*" "%DEST%\" /E /I /Y >nul

rem Buscar node.exe incluido (portable) o usar node del PATH
set "NODE_BUNDLED=%DEST%\node.exe"
set "NODE_PATH="
if exist "%NODE_BUNDLED%" (
  set "NODE_PATH=%NODE_BUNDLED%"
  echo Usando node incluido en el paquete: %NODE_PATH%
) else (
  for /f "delims=" %%a in ('where node 2^>nul') do set "NODE_PATH=%%a" & goto :got_node
)
:got_node

if "%NODE_PATH%"=="" (
  echo.
  echo No se ha encontrado node.exe ni en el paquete ni en el PATH.
  echo Si no tienes Node.js instalado, descarga e instala desde: https://nodejs.org/
  echo O incluye node.exe portable en el ZIP para que se ejecute sin instalar Node.
) else (
  echo Node detectado en: %NODE_PATH%
)

rem Crear acceso directo en el Escritorio que ejecute node server.js
echo Creando acceso directo en el Escritorio...
powershell -NoProfile -Command ^
  "$W = New-Object -ComObject WScript.Shell; ^
   $link = [Environment]::GetFolderPath('Desktop') + '\mfs-avianca-announcements.lnk'; ^
   $s = $W.CreateShortcut($link); ^
   $s.TargetPath = '%NODE_PATH%'; ^
   $s.Arguments = '%DEST%\src\server.js'; ^
   $s.WorkingDirectory = '%DEST%'; ^
   if (Test-Path '%DEST%\html_ui\icons\icon-64.png') { $s.IconLocation = '%DEST%\html_ui\icons\icon-64.png' } ^
   $s.Save();"

echo.
echo Instalación completada.
echo Carpeta de instalación: %DEST%

echo.
echo Para iniciar el servicio/manualmente:
if "%NODE_PATH%"=="" (
  echo   Instala Node.js y luego ejecuta:
  echo     node "%DEST%\src\server.js"
) else (
  echo   Ejecuta:
  echo     "%NODE_PATH%" "%DEST%\src\server.js"
)

pause
ENDLOCAL