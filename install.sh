#!/usr/bin/env bash
# ArtiCRAFT Minecraft Bot — Bir qatorli o'rnatuvchi (Linux/Ubuntu)
# Foydalanish: curl -fsSL https://raw.githubusercontent.com/lxz-401/articraft.uz/main/install.sh | bash

set -e

# ─── Ranglar ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
GRAY='\033[0;37m'
BOLD='\033[1m'
NC='\033[0m' # No Color

ok()   { echo -e "  ${GREEN}✅ $1${NC}"; }
warn() { echo -e "  ${YELLOW}⚠️  $1${NC}"; }
err()  { echo -e "  ${RED}❌ $1${NC}"; }
info() { echo -e "  ${CYAN}ℹ️  $1${NC}"; }
step() { echo -e "\n  ${YELLOW}▶ $1${NC}"; }
line() { echo -e "  ${GRAY}─────────────────────────────────────────────${NC}"; }

# ─── Banner ──────────────────────────────────────────────────────────────────
show_banner() {
    clear
    echo ""
    echo -e "  ${CYAN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "  ${CYAN}║   🎮  ArtiCRAFT Minecraft Bot Installer     ║${NC}"
    echo -e "  ${CYAN}║          Linux/Ubuntu — O'rnatish ustasi    ║${NC}"
    echo -e "  ${CYAN}╚══════════════════════════════════════════════╝${NC}"
    echo ""
}

# ─── Input olish ─────────────────────────────────────────────────────────────
read_input() {
    local var_name="$1"
    local prompt="$2"
    local default="$3"
    local secret="${4:-}"
    local value

    if [ -n "$default" ]; then
        printf "  ${WHITE}%s [%s]: ${NC}" "$prompt" "$default"
    else
        printf "  ${WHITE}%s: ${NC}" "$prompt"
    fi

    if [ -t 0 ]; then
        if [ "$secret" = "secret" ]; then
            read -rs value
            echo ""
        else
            read -r value
        fi
    else
        if [ "$secret" = "secret" ]; then
            read -rs value < /dev/tty
            echo ""
        else
            read -r value < /dev/tty
        fi
    fi

    if [ -z "$value" ] && [ -n "$default" ]; then
        value="$default"
    fi

    eval "$var_name=\"\$value\""
}

# ─── Sudo moslamasi ───────────────────────────────────────────────────────────
SUDO_CMD=""
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo &>/dev/null; then
        SUDO_CMD="sudo"
    else
        warn "Siz root emassiz va 'sudo' dasturi topilmadi!"
        warn "Ba'zi funksiyalar (papka yaratish, dastur o'rnatish) xato berishi mumkin."
    fi
fi



# ─── Paket menejeri ───────────────────────────────────────────────────────────
detect_pkg_manager() {
    if command -v apt-get &>/dev/null; then echo "apt"
    elif command -v dnf &>/dev/null; then echo "dnf"
    elif command -v yum &>/dev/null; then echo "yum"
    elif command -v pacman &>/dev/null; then echo "pacman"
    else echo "unknown"
    fi
}

# ─── Node.js o'rnatish ────────────────────────────────────────────────────────
ensure_nodejs() {
    step "Node.js tekshirilmoqda..."

    if command -v node &>/dev/null; then
        local ver
        ver=$(node --version 2>/dev/null)
        local major
        major=$(echo "$ver" | sed 's/v\([0-9]*\).*/\1/')
        if [ "$major" -ge 18 ] 2>/dev/null; then
            ok "Node.js $ver allaqachon o'rnatilgan"
            return
        fi
        warn "Node.js $ver eski. v18+ o'rnatilmoqda..."
    fi

    # NodeSource orqali o'rnatish
    info "Node.js 20 LTS o'rnatilmoqda (NodeSource)..."
    local pkg_mgr
    pkg_mgr=$(detect_pkg_manager)

    if [ "$pkg_mgr" = "apt" ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO_CMD bash - >/dev/null 2>&1
        $SUDO_CMD apt-get install -y nodejs >/dev/null 2>&1
    elif [ "$pkg_mgr" = "dnf" ]; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO_CMD bash - >/dev/null 2>&1
        $SUDO_CMD dnf install -y nodejs >/dev/null 2>&1
    elif [ "$pkg_mgr" = "yum" ]; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO_CMD bash - >/dev/null 2>&1
        $SUDO_CMD yum install -y nodejs >/dev/null 2>&1
    else
        err "Paket menejeri topilmadi. Node.js ni qo'lda o'rnating: https://nodejs.org"
        exit 1
    fi

    if ! command -v node &>/dev/null; then
        err "Node.js o'rnatib bo'lmadi!"
        exit 1
    fi
    ok "Node.js $(node --version) tayyor"
}

# ─── Git o'rnatish ───────────────────────────────────────────────────────────
ensure_git() {
    step "Git tekshirilmoqda..."

    if command -v git &>/dev/null; then
        ok "Git $(git --version) allaqachon o'rnatilgan"
        return
    fi

    info "Git o'rnatilmoqda..."
    local pkg_mgr
    pkg_mgr=$(detect_pkg_manager)

    case "$pkg_mgr" in
        apt)    $SUDO_CMD apt-get install -y git >/dev/null 2>&1 ;;
        dnf)    $SUDO_CMD dnf install -y git >/dev/null 2>&1 ;;
        yum)    $SUDO_CMD yum install -y git >/dev/null 2>&1 ;;
        pacman) $SUDO_CMD pacman -S --noconfirm git >/dev/null 2>&1 ;;
        *)      err "Git'ni qo'lda o'rnating"; exit 1 ;;
    esac

    ok "Git tayyor"
}

# ─── Repo clone/update ───────────────────────────────────────────────────────
get_repo() {
    local install_dir="$1"
    local repo_url="https://github.com/lxz-401/articraft.uz.git"

    step "Loyiha yuklanmoqda..."

    if [ -d "$install_dir/.git" ]; then
        info "Mavjud o'rnatma yangilanmoqda..."
        cd "$install_dir"
        $SUDO_CMD git pull --quiet 2>/dev/null || true
        ok "Loyiha yangilandi"
    else
        $SUDO_CMD mkdir -p "$(dirname "$install_dir")"
        $SUDO_CMD git clone "$repo_url" "$install_dir" --quiet
        ok "Loyiha yuklandi: $install_dir"
    fi

    $SUDO_CMD chown -R "$USER:$USER" "$install_dir"
    cd "$install_dir"

    # npm o'rnatish
    step "Modullar o'rnatilmoqda..."
    npm install --silent 2>/dev/null
    ok "Modullar tayyor"
}

# ─── .env yaratish ───────────────────────────────────────────────────────────
create_env() {
    local install_dir="$1"
    local mode="$2"

    echo ""
    line
    echo -e "  ${CYAN}📋 Sozlamalar kiritish${NC}"
    line
    echo ""
    info "Telegram Bot Token olish uchun:"
    info "  1. Telegram'da @BotFather ni oching"
    info "  2. /newbot buyrug'ini yuboring"
    info "  3. Bot nomini kiriting"
    info "  4. Token ko'rsatiladi — uni nusxalang"
    echo ""

    local tg_token=""
    while [ -z "$tg_token" ]; do
        read_input tg_token "Telegram Bot Token"
        [ -z "$tg_token" ] && warn "Token kiritish shart!"
    done

    echo ""
    info "Chat ID olish uchun Telegram'da @userinfobot ga /start yuboring"
    echo ""

    local tg_chat_id=""
    while [ -z "$tg_chat_id" ]; do
        read_input tg_chat_id "Telegram Chat ID (raqam)"
        [ -z "$tg_chat_id" ] && warn "Chat ID kiritish shart!"
    done

    local env_content="# ArtiCRAFT Bot — Sozlamalar
# Avtomatik yaratildi: $(date '+%Y-%m-%d %H:%M')

TELEGRAM_BOT_TOKEN=$tg_token
TELEGRAM_CHAT_IDS=$tg_chat_id
TELEGRAM_ENABLED=true
TELEGRAM_FORWARD_CHAT=true
"

    if [ "$mode" = "1" ]; then
        # Worker rejim
        echo ""
        line
        echo -e "  ${CYAN}🎮 Minecraft Ma'lumotlari${NC}"
        line

        local mc_user=""
        while [ -z "$mc_user" ]; do
            read_input mc_user "Minecraft Username (nick)"
            [ -z "$mc_user" ] && warn "Username kiritish shart!"
        done

        local mc_pass
        read_input mc_pass "Minecraft Parol (bo'sh qoldirsangiz parolsiz)" "" "secret"

        local mc_host
        read_input mc_host "Server IP" "articraft.uz"
        local mc_port
        read_input mc_port "Server Port" "25565"
        local mc_ver
        read_input mc_ver "Minecraft Versiya" "1.21.1"

        echo ""
        line
        echo -e "  ${CYAN}🌐 Central Server Ulanish${NC}"
        line
        echo ""
        info "Central server URL'ni admin'dan so'rang (wss://... ko'rinishida)"
        echo ""

        local central_url
        read_input central_url "Central Server URL (wss://...)"
        local central_token
        read_input central_token "Central Token (admin beradi)" "" "secret"
        local worker_id
        read_input worker_id "Worker ID (o'zingizga nom bering)" "worker_1"
        local crops
        read_input crops "Ekin turlari (vergul bilan)" "cocoa,wheat,carrot,potato,beetroot"

        # http URL hosil qilish
        local http_url
        http_url=$(echo "$central_url" | sed 's|^wss://|https://|' | sed 's|^ws://|http://|')

        env_content+="
CENTRAL_MODE=false
WORKER_ID=$worker_id
WORKER_TOKEN=$central_token
CENTRAL_WS_URL=$central_url
CENTRAL_HTTP_URL=$http_url
WORKER_PORT=3000

MC_HOST=$mc_host
MC_PORT=$mc_port
MC_USERNAME=$mc_user
MC_PASSWORD=$mc_pass
MC_VERSION=$mc_ver
MC_AUTH=offline

AUTO_LOGIN=true
AUTO_RECONNECT=true
RECONNECT_DELAY_MS=5000
STOP_ON_BOT_CHECK_KICK=true

FARMING_CROPS=$crops
"
    else
        # Central rejim
        echo ""
        line
        echo -e "  ${CYAN}🌐 Central Server Sozlamalari${NC}"
        line

        local token
        read_input token "Central Token (bo'sh qoldirsangiz avtomatik yaratiladi)" "" "secret"
        if [ -z "$token" ]; then
            token=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 32 | head -n 1)
            info "Avtomatik token yaratildi: $token"
            warn "Ushbu tokenni worker'larga bering!"
        fi

        local ws_port
        read_input ws_port "WebSocket Port" "8765"
        local http_port
        read_input http_port "HTTP API Port" "8766"

        env_content+="
CENTRAL_MODE=true
CENTRAL_TOKEN=$token
CENTRAL_WS_PORT=$ws_port
CENTRAL_HTTP_PORT=$http_port
"
    fi

    echo "$env_content" > "$install_dir/.env"
    chmod 600 "$install_dir/.env"
    ok ".env fayli saqlandi: $install_dir/.env"
}

# ─── systemd service ─────────────────────────────────────────────────────────
install_systemd_service() {
    local install_dir="$1"
    local mode="$2"

    local service_name
    service_name=$([ "$mode" = "1" ] && echo "articraft-worker" || echo "articraft-central")
    local script_file
    script_file=$([ "$mode" = "1" ] && echo "$install_dir/src/worker.js" || echo "$install_dir/src/manager.js")
    local node_path
    node_path=$(which node)

    step "systemd service o'rnatilmoqda..."

    mkdir -p "$install_dir/logs"

    # Service faylini yaratish
    cat > "/tmp/${service_name}.service" << EOF
[Unit]
Description=ArtiCRAFT Minecraft Bot
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$install_dir
ExecStart=$node_path $script_file
Restart=always
RestartSec=5
StandardOutput=append:$install_dir/logs/stdout.log
StandardError=append:$install_dir/logs/stderr.log
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    $SUDO_CMD mv "/tmp/${service_name}.service" "/etc/systemd/system/${service_name}.service"
    $SUDO_CMD systemctl daemon-reload
    $SUDO_CMD systemctl enable "$service_name" >/dev/null 2>&1
    $SUDO_CMD systemctl start "$service_name"

    ok "systemd service '$service_name' o'rnatildi va ishga tushirildi"
    info "Holati ko'rish:  systemctl status $service_name"
    info "Loglar:          journalctl -u $service_name -f"
    info "To'xtatish:      systemctl stop $service_name"
    info "Qayta ishga tushirish: systemctl restart $service_name"
}

# ─── Yakuniy xabar ───────────────────────────────────────────────────────────
show_final_message() {
    local install_dir="$1"
    local mode="$2"

    echo ""
    echo -e "  ${GREEN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "  ${GREEN}║   🎉 O'rnatish muvaffaqiyatli yakunlandi!   ║${NC}"
    echo -e "  ${GREEN}╚══════════════════════════════════════════════╝${NC}"
    echo ""
    line
    echo ""

    if [ "$mode" = "1" ]; then
        echo -e "  ${CYAN}📌 Keyingi qadamlar:${NC}"
        echo -e "  ${WHITE}   1. Telegram'da botingizni oching${NC}"
        echo -e "  ${WHITE}   2. /start yozing — buyruqlar ro'yxati chiqadi${NC}"
        echo -e "  ${WHITE}   3. Agar bot central'ga ulansa, admin Telegram'da ko'radi${NC}"
    else
        echo -e "  ${CYAN}📌 Keyingi qadamlar (Central Server):${NC}"
        echo -e "  ${WHITE}   1. Cloudflare Tunnel ochish:${NC}"
        echo -e "  ${GRAY}      a) cloudflared o'rnatish:${NC}"
        echo -e "  ${YELLOW}         curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cf.deb${NC}"
        echo -e "  ${YELLOW}         sudo dpkg -i cf.deb${NC}"
        echo -e "  ${GRAY}      b) Tunnel ochish:${NC}"
        echo -e "  ${YELLOW}         cloudflared tunnel --url ws://localhost:8765${NC}"
        echo -e "  ${GRAY}      c) Chiqadigan URL (wss://xxx.trycloudflare.com) ni${NC}"
        echo -e "  ${GRAY}         worker'larga bering${NC}"
        echo -e "  ${WHITE}   2. Worker'lar ulanganda Telegram'da /bots yozing${NC}"
    fi

    echo ""
    line
    echo -e "  ${GRAY}📁 O'rnatma joyi: $install_dir${NC}"
    echo -e "  ${GRAY}🔧 Sozlamalar:    $install_dir/.env${NC}"
    echo -e "  ${GRAY}📋 Loglar:        $install_dir/logs/${NC}"
    echo ""
}

# ═══════════════════════════════════════════════════════════
# ASOSIY O'RNATISH
# ═══════════════════════════════════════════════════════════

show_banner

# Rejim tanlash
echo -e "  ${CYAN}Qaysi rejimni o'rnatmoqchisiz?${NC}"
echo ""
echo -e "  ${WHITE}[1] 🤖 Worker  — Minecraft bot (oddiy foydalanuvchi)${NC}"
echo -e "  ${WHITE}[2] 🌐 Central — Boshqaruv serveri (admin uchun)${NC}"
echo ""

INSTALL_MODE=""
while [[ "$INSTALL_MODE" != "1" && "$INSTALL_MODE" != "2" ]]; do
    read_input INSTALL_MODE "Tanlovingiz" "1"
    if [[ "$INSTALL_MODE" != "1" && "$INSTALL_MODE" != "2" ]]; then
        warn "1 yoki 2 kiriting!"
    fi
done

if [ "$INSTALL_MODE" = "1" ]; then
    ok "Tanlandi: Worker (Minecraft Bot)"
else
    ok "Tanlandi: Central (Boshqaruv Serveri)"
fi

# O'rnatma joyi
INSTALL_DIR="/opt/articraft"
info "O'rnatma joyi: $INSTALL_DIR"

# ─── O'rnatish bosqichlari ────────────────────────────────────────────────────
echo ""
line
echo -e "  ${CYAN}📦 KERAKLI DASTURLAR O'RNATILMOQDA${NC}"
line

ensure_nodejs
ensure_git

echo ""
line
echo -e "  ${CYAN}📥 LOYIHA YUKLANMOQDA${NC}"
line

get_repo "$INSTALL_DIR"

echo ""
line
echo -e "  ${CYAN}⚙️  SOZLAMALAR${NC}"
line

create_env "$INSTALL_DIR" "$INSTALL_MODE"

# Service
echo ""
line
INSTALL_SERVICE=""
read_input INSTALL_SERVICE "Bot server yoqilganda avtomatik ishga tushinmi? (H/y)" "H"
line

if [[ "$INSTALL_SERVICE" =~ ^[Hh]$ ]] || [ -z "$INSTALL_SERVICE" ]; then
    if command -v systemctl &>/dev/null; then
        if [ "$(id -u)" -ne 0 ] && [ -z "$SUDO_CMD" ]; then
             warn "systemd service o'rnatish uchun sudo kerak, biroq tizimda sudo mavjud emas."
             warn "Service o'rnatilmadi."
        else
             install_systemd_service "$INSTALL_DIR" "$INSTALL_MODE"
        fi
    else
        warn "systemd topilmadi. Service o'rnatilmadi."
    fi
else
    info "Service o'rnatilmadi."
    if [ "$INSTALL_MODE" = "1" ]; then
        info "Qo'lda ishga tushirish: cd $INSTALL_DIR && node src/worker.js"
    else
        info "Qo'lda ishga tushirish: cd $INSTALL_DIR && node src/manager.js"
    fi
fi

# Yakuniy xabar
show_final_message "$INSTALL_DIR" "$INSTALL_MODE"
