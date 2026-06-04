# ArtiCRAFT Minecraft Bot

Multi-bot Minecraft farming bot, Telegram orqali boshqariladigan. Bitta IP limitini chetlab o'tish uchun botlarni turli serverlarda ishga tushirish imkonini beradi.

## Arxitektura

```
Ubuntu PC (24/7)
├── Central Server (CENTRAL_MODE=true)
│   ├── Telegram Bot ← siz boshqarasiz
│   ├── WebSocket Server (port 8765)
│   └── HTTP API Server (port 8766)
│   └── Cloudflare Tunnel (wss://xxx.trycloudflare.com)
│
Replit / Railway / Render
├── Worker #1 (CENTRAL_MODE=false, WORKER_ID=replit_1)
│   └── Bot Account: Account1 → articraft.uz
└── Worker #2 (CENTRAL_MODE=false, WORKER_ID=railway_1)
    └── Bot Account: Account2 → articraft.uz
```

## O'rnatish

```bash
git clone <repo-url>
cd articraft.uz
pnpm install   # yoki: npm install
cp .env.example .env
# .env faylini o'zingizga moslab to'ldiring
```

## Rejimlar

### 1. Central Server (Ubuntu PC'ingizda)

`.env` faylida:
```env
CENTRAL_MODE=true
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_IDS=your_chat_id
CENTRAL_TOKEN=secret_token_change_this
CENTRAL_WS_PORT=8765
CENTRAL_HTTP_PORT=8766
```

Ishga tushirish:
```bash
node src/manager.js
# yoki:
npm start
```

**Cloudflare Tunnel sozlash:**
```bash
# cloudflared o'rnatish (Ubuntu)
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# Tunnel ochish
cloudflared tunnel --url ws://localhost:8765
# Chiqadigan URL: wss://xxx.trycloudflare.com — bu CENTRAL_WS_URL bo'ladi
```

### 2. Worker (Replit / Railway / Render)

`.env` faylida:
```env
CENTRAL_MODE=false
WORKER_ID=replit_bot_1
WORKER_TOKEN=secret_token_change_this   # Central TOKEN bilan bir xil
CENTRAL_WS_URL=wss://xxx.trycloudflare.com
CENTRAL_HTTP_URL=https://xxx.trycloudflare.com

MC_HOST=articraft.uz
MC_PORT=25565
MC_USERNAME=BotAccount1
MC_PASSWORD=your_password
MC_VERSION=1.21.1
MC_AUTH=offline

FARMING_CROPS=cocoa,wheat,carrot,potato
```

Ishga tushirish:
```bash
node src/worker.js
```

#### Replit uchun:
- Yangi Replit yarating (Node.js)
- Repo'ni import qiling
- Secrets'ga `.env` qiymatlarini qo'shing
- `Run` bosing

#### Railway uchun:
- `railway up` yoki GitHub'dan deploy qiling
- Environment variables'ni sozlang
- `Procfile` avtomatik `node src/worker.js` ishlatadi

#### Render uchun:
- New Web Service → GitHub repo
- Start Command: `node src/worker.js`
- Environment variables sozlang

## Telegram Buyruqlari

### Central Mode (multi-bot boshqaruv):
| Buyruq | Tavsif |
|--------|--------|
| `/bots` | Barcha worker'lar ro'yxati |
| `/bot <id> status` | Aniq bot holati |
| `/bot <id> start` | Botni ishga tushirish |
| `/bot <id> stop` | Botni to'xtatish |
| `/bot <id> restart` | Qayta ishga tushirish |
| `/bot <id> inventory` | Inventar ro'yxati |
| `/bot <id> chat <xabar>` | Chatga yozish |
| `/bot <id> logs` | So'nggi loglar |
| `/bot <id> stats` | Bot statistikasi |
| `/allstats` | Barcha botlar umumiy statistikasi |

### Single-Bot Mode:
| Buyruq | Tavsif |
|--------|--------|
| `/status` | Bot holati |
| `/stats` | Farming statistikasi |
| `/chat <xabar>` | Chatga yozish |
| `/inventory` | Inventar |
| `/stop` | Pathfinder'ni to'xtatish |
| `/stop_all` | Barcha harakatni to'xtatish |
| `/jump` | Sakrash |
| `/forward`, `/back`, `/left`, `/right` | Harakat (1s) |
| `/sprint`, `/sneak` | Sprint/Sneak toggle |
| `/reconnect` | Qayta ulash |

## Qo'llab-quvvatlanadigan ekinlar

`FARMING_CROPS` o'zgaruvchisida vergul bilan ajratib ko'rsating:

| Ekin | Config nomi |
|------|-------------|
| Kakao | `cocoa` |
| Bug'doy | `wheat` |
| Sabzi | `carrot` |
| Kartoshka | `potato` |
| Lavlagi | `beetroot` |
| Tarvuz | `melon` |
| Qovoq | `pumpkin` |
| Shakarqamish | `sugarcane` |
| Bambuk | `bamboo` |

Misol: `FARMING_CROPS=cocoa,wheat,carrot,potato,beetroot`

## Fayl tuzilmasi

```
src/
├── manager.js          — Asosiy entry point (central/single rejim tanlaydi)
├── worker.js           — Remote worker entry point
├── bot-instance.js     — Minecraft bot logikasi
├── telegram-bot.js     — Telegram bot (single + multi-bot)
├── central-server.js   — WebSocket + HTTP server
├── worker-registry.js  — Worker'lar boshqaruvi
├── auto-sell.js        — /shop GUI orqali sotuv
├── profiles.js         — Bot profil boshqaruvi
├── utils.js            — Yordamchi funksiyalar
└── farming/
    └── crop-manager.js — Barcha ekin turlari
```
