#Requires -Version 5.1
<#
.SYNOPSIS
    ArtiCRAFT Minecraft Bot — Bir qatorli o'rnatuvchi (Windows)
.DESCRIPTION
    irm https://raw.githubusercontent.com/lxz-401/articraft.uz/main/install.ps1 | iex
#>

Set-StrictMode -Off
$ErrorActionPreference = "Stop"

# ─── Ranglar ─────────────────────────────────────────────────────────────────
function Write-Color {
    param([string]$Text, [string]$Color = "White", [switch]$NoNewline)
    $colors = @{
        "Red"     = "Red"
        "Green"   = "Green"
        "Yellow"  = "Yellow"
        "Cyan"    = "Cyan"
        "Magenta" = "Magenta"
        "White"   = "White"
        "Gray"    = "Gray"
        "Blue"    = "Blue"
    }
    $params = @{ Object = $Text; ForegroundColor = $colors[$Color] }
    if ($NoNewline) { $params["NoNewline"] = $true }
    Write-Host @params
}

function Write-Banner {
    Clear-Host
    Write-Color ""
    Write-Color "  ╔══════════════════════════════════════════════╗" "Cyan"
    Write-Color "  ║   🎮  ArtiCRAFT Minecraft Bot Installer     ║" "Cyan"
    Write-Color "  ║           Windows — O'rnatish ustasi        ║" "Cyan"
    Write-Color "  ╚══════════════════════════════════════════════╝" "Cyan"
    Write-Color ""
}

function Write-Step {
    param([string]$Text)
    Write-Color ""
    Write-Color "  ▶ $Text" "Yellow"
}

function Write-OK   { param([string]$T); Write-Color "  ✅ $T" "Green" }
function Write-Warn { param([string]$T); Write-Color "  ⚠️  $T" "Yellow" }
function Write-Err  { param([string]$T); Write-Color "  ❌ $T" "Red" }
function Write-Info { param([string]$T); Write-Color "  ℹ️  $T" "Cyan" }
function Write-Line { Write-Color "  ─────────────────────────────────────────────" "Gray" }

function Read-Input {
    param([string]$Prompt, [string]$Default = "", [switch]$Secret)
    if ($Default) {
        Write-Color "  $Prompt [$Default]: " "White" -NoNewline
    } else {
        Write-Color "  $Prompt`: " "White" -NoNewline
    }
    if ($Secret) {
        $secure = Read-Host -AsSecureString
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        )
        if ($plain -eq "" -and $Default) { return $Default }
        return $plain
    }
    $val = Read-Host
    if ($val -eq "" -and $Default) { return $Default }
    return $val
}

# ─── Admin tekshiruvi ─────────────────────────────────────────────────────────
function Test-Admin {
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($current)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ─── Dastur mavjudligini tekshirish ──────────────────────────────────────────
function Test-Command { param([string]$Name); return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# ─── Winget orqali o'rnatish ──────────────────────────────────────────────────
function Install-WithWinget {
    param([string]$PackageId, [string]$Name)
    Write-Step "$Name o'rnatilmoqda..."
    try {
        winget install --id $PackageId --silent --accept-package-agreements --accept-source-agreements 2>$null
        # PATH'ni yangilash
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("PATH", "User")
        Write-OK "$Name o'rnatildi"
        return $true
    } catch {
        Write-Warn "$Name winget orqali o'rnatilmadi: $($_.Exception.Message)"
        return $false
    }
}

# ─── Node.js o'rnatish ────────────────────────────────────────────────────────
function Ensure-NodeJs {
    Write-Step "Node.js tekshirilmoqda..."

    if (Test-Command "node") {
        $version = node --version 2>$null
        $major = [int]($version -replace 'v(\d+)\..*', '$1')
        if ($major -ge 18) {
            Write-OK "Node.js $version allaqachon o'rnatilgan"
            return
        }
        Write-Warn "Node.js $version eski. v18+ kerak."
    }

    # Winget bor bo'lsa ishlatish
    if (Test-Command "winget") {
        Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
    } else {
        # To'g'ridan yuklab o'rnatish
        Write-Step "Node.js yuklanmoqda (winget topilmadi)..."
        $url = "https://nodejs.org/dist/v20.19.0/node-v20.19.0-x64.msi"
        $installer = "$env:TEMP\node-installer.msi"
        Write-Info "Yuklanmoqda: $url"
        Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
        Start-Process msiexec.exe -ArgumentList "/i `"$installer`" /quiet /norestart" -Wait
        Remove-Item $installer -ErrorAction SilentlyContinue
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("PATH", "User")
    }

    if (!(Test-Command "node")) {
        Write-Err "Node.js o'rnatib bo'lmadi!"
        Write-Info "Qo'lda o'rnating: https://nodejs.org"
        Write-Info "O'rnatib bo'lgach, PowerShell'ni qayta oching va skriptni qayta ishga tushiring."
        Read-Host "Davom etish uchun Enter bosing"
        exit 1
    }
    Write-OK "Node.js $(node --version) tayyor"
}

# ─── Git o'rnatish ───────────────────────────────────────────────────────────
function Ensure-Git {
    Write-Step "Git tekshirilmoqda..."

    if (Test-Command "git") {
        Write-OK "Git $(git --version) allaqachon o'rnatilgan"
        return
    }

    if (Test-Command "winget") {
        Install-WithWinget "Git.Git" "Git"
    } else {
        $url = "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe"
        $installer = "$env:TEMP\git-installer.exe"
        Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
        Start-Process $installer -ArgumentList "/VERYSILENT /NORESTART" -Wait
        Remove-Item $installer -ErrorAction SilentlyContinue
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("PATH", "User")
    }

    if (!(Test-Command "git")) {
        Write-Warn "Git o'rnatib bo'lmadi. Loyiha yuklanmaydi."
        exit 1
    }
    Write-OK "Git tayyor"
}

# ─── Repo clone/update ───────────────────────────────────────────────────────
function Get-Repo {
    param([string]$InstallDir)

    $repoUrl = "https://github.com/lxz-401/articraft.uz.git"

    Write-Step "Loyiha yuklanmoqda..."

    if (Test-Path (Join-Path $InstallDir ".git")) {
        Write-Info "Mavjud o'rnatma yangilanmoqda..."
        Set-Location $InstallDir
        git pull --quiet 2>$null
        Write-OK "Loyiha yangilandi"
    } else {
        if (Test-Path $InstallDir) {
            Remove-Item $InstallDir -Recurse -Force
        }
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        git clone $repoUrl $InstallDir --quiet
        Write-OK "Loyiha yuklandi: $InstallDir"
    }

    Set-Location $InstallDir

    # npm modullarini o'rnatish
    Write-Step "Modullar o'rnatilmoqda..."
    npm install --silent 2>$null
    Write-OK "Modullar tayyor"
}

# ─── .env yaratish ───────────────────────────────────────────────────────────
function Create-EnvFile {
    param([string]$InstallDir, [int]$Mode)

    Write-Color ""
    Write-Line
    Write-Color "  📋 Sozlamalar kiritish" "Cyan"
    Write-Line

    Write-Color ""
    Write-Color "  ℹ️  Telegram Bot Token olish uchun:" "Gray"
    Write-Color "     1. Telegram'da @BotFather ni oching" "Gray"
    Write-Color "     2. /newbot buyrug'ini yuboring" "Gray"
    Write-Color "     3. Bot nomini kiriting" "Gray"
    Write-Color "     4. Token ko'rsatiladi — uni nusxalang" "Gray"
    Write-Color ""

    $tgToken = ""
    while ($tgToken -eq "") {
        $tgToken = Read-Input "Telegram Bot Token"
        if ($tgToken -eq "") { Write-Warn "Token kiritish shart!" }
    }

    Write-Color ""
    Write-Color "  ℹ️  Chat ID olish uchun Telegram'da @userinfobot ga /start yuboring" "Gray"
    Write-Color ""

    $tgChatId = ""
    while ($tgChatId -eq "") {
        $tgChatId = Read-Input "Telegram Chat ID (raqam)"
        if ($tgChatId -eq "") { Write-Warn "Chat ID kiritish shart!" }
    }

    $envContent = @"
# ArtiCRAFT Bot — Sozlamalar
# Avtomatik yaratildi: $(Get-Date -Format 'yyyy-MM-dd HH:mm')

TELEGRAM_BOT_TOKEN=$tgToken
TELEGRAM_CHAT_IDS=$tgChatId
TELEGRAM_ENABLED=true
TELEGRAM_FORWARD_CHAT=true
"@

    if ($Mode -eq 1) {
        # Worker rejim
        Write-Color ""
        Write-Line
        Write-Color "  🎮 Minecraft Ma'lumotlari" "Cyan"
        Write-Line

        $mcUser = ""
        while ($mcUser -eq "") {
            $mcUser = Read-Input "Minecraft Username (nick)"
            if ($mcUser -eq "") { Write-Warn "Username kiritish shart!" }
        }

        $mcPass = Read-Input "Minecraft Parol (bo'sh qoldirsangiz parolsiz kiradi)" "" -Secret

        $mcHost = Read-Input "Server IP" "articraft.uz"
        $mcPort = Read-Input "Server Port" "25565"
        $mcVer  = Read-Input "Minecraft Versiya" "1.21.1"

        Write-Color ""
        Write-Line
        Write-Color "  🌐 Central Server Ulanish" "Cyan"
        Write-Line
        Write-Color ""
        Write-Color "  ℹ️  Central server admin'dan so'rang (wss://... ko'rinishida)" "Gray"
        Write-Color ""

        $centralUrl = Read-Input "Central Server URL (wss://...)"
        $centralToken = Read-Input "Central Token (admin beradi)" "" -Secret
        $workerId = Read-Input "Worker ID (o'zingizga nom bering)" "worker_1"

        $crops = Read-Input "Ekin turlari (vergul bilan)" "cocoa,wheat,carrot,potato,beetroot"

        $envContent += @"

CENTRAL_MODE=false
WORKER_ID=$workerId
WORKER_TOKEN=$centralToken
CENTRAL_WS_URL=$centralUrl
CENTRAL_HTTP_URL=$($centralUrl -replace '^wss://', 'https://' -replace '^ws://', 'http://')
WORKER_PORT=3000

MC_HOST=$mcHost
MC_PORT=$mcPort
MC_USERNAME=$mcUser
MC_PASSWORD=$mcPass
MC_VERSION=$mcVer
MC_AUTH=offline

AUTO_LOGIN=true
AUTO_RECONNECT=true
RECONNECT_DELAY_MS=5000
STOP_ON_BOT_CHECK_KICK=true

FARMING_CROPS=$crops
"@

    } else {
        # Central rejim
        Write-Color ""
        Write-Line
        Write-Color "  Central Server Sozlamalari" "Cyan"
        Write-Line

        $token = Read-Input "Central Token (yodda saqlang, worker'larga beriladi)" "" -Secret
        if ($token -eq "") {
            # Random token yaratish
            $token = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
            Write-Info "Avtomatik token yaratildi: $token"
            Write-Warn "Ushbu tokenni worker'larga bering!"
        }

        $wsPort   = Read-Input "WebSocket Port" "8765"
        $httpPort = Read-Input "HTTP API Port" "8766"

        $envContent += @"

CENTRAL_MODE=true
CENTRAL_TOKEN=$token
CENTRAL_WS_PORT=$wsPort
CENTRAL_HTTP_PORT=$httpPort
"@
    }

    $envPath = Join-Path $InstallDir ".env"
    $envContent | Out-File -FilePath $envPath -Encoding UTF8 -Force
    Write-OK ".env fayli saqlandi: $envPath"
}

# ─── Windows Service (NSSM) ───────────────────────────────────────────────────
function Install-WindowsService {
    param([string]$InstallDir, [int]$Mode)

    $serviceName = if ($Mode -eq 1) { "ArtiCRAFT-Worker" } else { "ArtiCRAFT-Central" }
    $scriptFile  = if ($Mode -eq 1) { "src\worker.js" } else { "src\manager.js" }

    Write-Step "Windows Service o'rnatilmoqda..."

    # NSSM yuklab olish
    $nssmDir = "$env:TEMP\nssm"
    $nssmExe = "$nssmDir\nssm.exe"

    if (!(Test-Path $nssmExe)) {
        Write-Info "NSSM yuklanmoqda..."
        $nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
        $nssmZip = "$env:TEMP\nssm.zip"
        try {
            Invoke-WebRequest -Uri $nssmUrl -OutFile $nssmZip -UseBasicParsing -TimeoutSec 30
            Expand-Archive -Path $nssmZip -DestinationPath "$env:TEMP\nssm_extract" -Force
            $nssmBin = Get-ChildItem -Path "$env:TEMP\nssm_extract" -Filter "nssm.exe" -Recurse |
                       Where-Object { $_.FullName -like "*win64*" } | Select-Object -First 1
            if (!$nssmBin) {
                $nssmBin = Get-ChildItem -Path "$env:TEMP\nssm_extract" -Filter "nssm.exe" -Recurse | Select-Object -First 1
            }
            New-Item -ItemType Directory -Path $nssmDir -Force | Out-Null
            Copy-Item $nssmBin.FullName -Destination $nssmExe -Force
            Remove-Item $nssmZip -ErrorAction SilentlyContinue
            Remove-Item "$env:TEMP\nssm_extract" -Recurse -ErrorAction SilentlyContinue
        } catch {
            Write-Warn "NSSM yuklab bo'lmadi. Service Task Scheduler orqali o'rnatiladi."
            Install-TaskScheduler $InstallDir $Mode
            return
        }
    }

    # Eski service'ni o'chirish
    & $nssmExe stop $serviceName 2>$null
    & $nssmExe remove $serviceName confirm 2>$null

    # Yangi service o'rnatish
    $nodePath = (Get-Command node).Source
    & $nssmExe install $serviceName $nodePath "$scriptFile"
    & $nssmExe set $serviceName AppDirectory $InstallDir
    & $nssmExe set $serviceName DisplayName "ArtiCRAFT Minecraft Bot"
    & $nssmExe set $serviceName Description "ArtiCRAFT Minecraft Bot — Telegram orqali boshqariladigan farming boti"
    & $nssmExe set $serviceName Start SERVICE_AUTO_START
    & $nssmExe set $serviceName AppStdout "$InstallDir\logs\stdout.log"
    & $nssmExe set $serviceName AppStderr "$InstallDir\logs\stderr.log"
    & $nssmExe set $serviceName AppRotateFiles 1
    & $nssmExe set $serviceName AppRotateSeconds 86400

    New-Item -ItemType Directory -Path "$InstallDir\logs" -Force | Out-Null

    # Service'ni ishga tushirish
    & $nssmExe start $serviceName
    Write-OK "Windows Service '$serviceName' o'rnatildi va ishga tushirildi"
    Write-Info "Boshqarish: services.msc (Windows Services)"
    Write-Info "Loglar: $InstallDir\logs\"
}

# ─── Task Scheduler fallback ──────────────────────────────────────────────────
function Install-TaskScheduler {
    param([string]$InstallDir, [int]$Mode)

    $taskName   = if ($Mode -eq 1) { "ArtiCRAFT-Worker" } else { "ArtiCRAFT-Central" }
    $scriptFile = if ($Mode -eq 1) { "$InstallDir\src\worker.js" } else { "$InstallDir\src\manager.js" }
    $nodePath   = (Get-Command node).Source

    # Eski task'ni o'chirish
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

    $action  = New-ScheduledTaskAction -Execute $nodePath -Argument $scriptFile -WorkingDirectory $InstallDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName

    Write-OK "Task Scheduler vazifasi '$taskName' yaratildi"
    Write-Info "Boshqarish: Task Scheduler (taskschd.msc)"
}

# ─── Yakuniy xabar ───────────────────────────────────────────────────────────
function Show-FinalMessage {
    param([string]$InstallDir, [int]$Mode)

    Write-Color ""
    Write-Color "  ╔══════════════════════════════════════════════╗" "Green"
    Write-Color "  ║   🎉 O'rnatish muvaffaqiyatli yakunlandi!   ║" "Green"
    Write-Color "  ╚══════════════════════════════════════════════╝" "Green"
    Write-Color ""
    Write-Line
    Write-Color ""

    if ($Mode -eq 1) {
        Write-Color "  📌 Keyingi qadamlar:" "Cyan"
        Write-Color "     1. Telegram'da botingizni oching" "White"
        Write-Color "     2. /start yozing — buyruqlar ro'yxati chiqadi" "White"
        Write-Color "     3. Agar bot central'ga ulansa, admin Telegram'da ko'radi" "White"
    } else {
        Write-Color "  📌 Keyingi qadamlar (Central Server):" "Cyan"
        Write-Color "     1. Cloudflare Tunnel ochish:" "White"
        Write-Color "        a) cloudflared.exe ni yuklab oling:" "Gray"
        Write-Color "           https://github.com/cloudflare/cloudflared/releases" "Yellow"
        Write-Color "        b) Ishga tushiring:" "Gray"
        Write-Color "           cloudflared.exe tunnel --url ws://localhost:8765" "Yellow"
        Write-Color "        c) Chiqadigan URL (wss://xxx.trycloudflare.com) ni" "Gray"
        Write-Color "           worker'larga bering" "Gray"
        Write-Color "     2. Worker'lar ulanganda Telegram'da /bots yozing" "White"
    }

    Write-Color ""
    Write-Line
    Write-Color "  📁 O'rnatma joyi: $InstallDir" "Gray"
    Write-Color "  🔧 Sozlamalar:    $InstallDir\.env" "Gray"
    Write-Color "  📋 Loglar:        $InstallDir\logs\" "Gray"
    Write-Color ""
}

# ═══════════════════════════════════════════════════════════
# ASOSIY O'RNATISH
# ═══════════════════════════════════════════════════════════

Write-Banner

# Admin tekshiruvi
if (-not (Test-Admin)) {
    Write-Warn "Administrator huquqi tavsiya etiladi (service o'rnatish uchun)."
    Write-Info "Service o'rnatilmasa, bot qo'lda ishga tushirilishi kerak bo'ladi."
    Write-Color ""
}

# Rejim tanlash
Write-Color "  Qaysi rejimni o'rnatmoqchisiz?" "Cyan"
Write-Color ""
Write-Color "  [1] 🤖 Worker  — Minecraft bot (oddiy foydalanuvchi)" "White"
Write-Color "  [2] 🌐 Central — Boshqaruv serveri (admin uchun)" "White"
Write-Color ""

$modeInput = ""
while ($modeInput -notin @("1", "2")) {
    $modeInput = Read-Input "Tanlovingiz" "1"
    if ($modeInput -notin @("1", "2")) { Write-Warn "1 yoki 2 kiriting!" }
}
$installMode = [int]$modeInput

$modeLabel = if ($installMode -eq 1) { "Worker (Minecraft Bot)" } else { "Central (Boshqaruv Serveri)" }
Write-OK "Tanlandi: $modeLabel"

# O'rnatma papkasi
$installDir = Join-Path $env:APPDATA "ArtiCRAFT"
Write-Info "O'rnatma joyi: $installDir"

# ─── O'rnatish bosqichlari ─────────────────────────────────────────────────
Write-Color ""
Write-Line
Write-Color "  📦 KERAKLI DASTURLAR O'RNATILMOQDA" "Cyan"
Write-Line

Ensure-NodeJs
Ensure-Git

Write-Color ""
Write-Line
Write-Color "  📥 LOYIHA YUKLANMOQDA" "Cyan"
Write-Line

Get-Repo $installDir

Write-Color ""
Write-Line
Write-Color "  ⚙️  SOZLAMALAR" "Cyan"
Write-Line

Create-EnvFile $installDir $installMode

# Service
Write-Color ""
Write-Line
$installService = Read-Input "Bot kompyuter yoqilganda avtomatik ishga tushinmi? (H/y)" "H"
Write-Line

if ($installService -in @("H", "h", "Ha", "ha", "Y", "y", "Yes", "yes", "")) {
    if (Test-Admin) {
        Install-WindowsService $installDir $installMode
    } else {
        Write-Warn "Administrator huquqi yo'q — Task Scheduler ishlatilmoqda..."
        Install-TaskScheduler $installDir $installMode
    }
} else {
    Write-Info "Service o'rnatilmadi."
    Write-Info "Qo'lda ishga tushirish uchun:"
    if ($installMode -eq 1) {
        Write-Info "  cd `"$installDir`"; node src\worker.js"
    } else {
        Write-Info "  cd `"$installDir`"; node src\manager.js"
    }
}

# Yakuniy xabar
Show-FinalMessage $installDir $installMode

Write-Color "  Davom etish uchun Enter bosing..." "Gray"
Read-Host
