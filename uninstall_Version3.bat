@echo off
SETLOCAL

echo --------------------------------------------------
echo Desinstalador: mfs-avianca-announcements
echo --------------------------------------------------

set "DEST=%ProgramFiles%\mfs-avianca-announcements"

echo Parando servicio y eliminando accesos si existen...
sc stop mfs-avianca >nul 2>&1
sc delete mfs-avianca >nul 2>&1

echo Borrando carpeta %DEST% ...
rmdir /S /Q "%DEST%"

echo Eliminando acceso directo del Escritorio...
del "%USERPROFILE%\Desktop\mfs-avianca-announcements.lnk" >nul 2>&1

echo Desinstalación completada.
pause
ENDLOCAL