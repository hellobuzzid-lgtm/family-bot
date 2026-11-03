@echo off
title [NEX AI] Personal Life Partner & Financial Assistant 24/7 Engine
color 0a

:: Pindah ke direktori BOT FAMILY
cd /d "%~dp0"

echo ======================================================
echo    NEX AI - PERSONAL LIFE PARTNER 24/7 ENGINE
echo ======================================================
echo.
echo Memeriksa instalasi Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "D:\node.exe" (
        set "PATH=%PATH%;D:\"
    ) else (
        echo [ERROR] Node.js tidak ditemukan! Silakan install Node.js terlebih dahulu.
        pause
        exit /b 1
    )
)

echo [OK] Node.js terdeteksi.
echo.
echo ======================================================
echo Pilihan Mode:
echo [1] Jalankan Bot Normal (Tekan ENTER atau angka 1)
echo [2] Reset Sesi WhatsApp & Minta Kode / QR Code Baru
echo ======================================================
set /p "CHOICE=Pilih mode (1/2, default 1): "

if "%CHOICE%"=="2" (
    echo.
    echo [INFO] Membersihkan sesi lama yang tersangkut...
    set "RESET_AUTH=true"
    if exist "D:\app\storage\auth_info_baileys" (
        rmdir /s /q "D:\app\storage\auth_info_baileys" 2>nul
        mkdir "D:\app\storage\auth_info_baileys" 2>nul
    )
    if exist "auth_info_baileys" (
        rmdir /s /q "auth_info_baileys" 2>nul
        mkdir "auth_info_baileys" 2>nul
    )
    echo [OK] Sesi bersih! Siap meminta tautan baru...
)

echo.
echo Menjalankan NEX Bot...
echo.

:run
node src/index.js
set "ERR=%errorlevel%"
if %ERR% equ 0 (
    echo.
    echo [INFO] NEX Bot dihentikan secara normal.
    timeout /t 10
    exit /b 0
)

echo.
echo [PERINGATAN] NEX Bot berhenti (Kode Keluar: %ERR%) pada %DATE% %TIME%.
echo Melakukan restart otomatis dalam 5 detik...
timeout /t 5 /nobreak >nul
echo Menghidupkan ulang NEX Bot...
goto run
