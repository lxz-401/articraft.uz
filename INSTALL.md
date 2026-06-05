# ArtiCRAFT Bot — O'rnatish Ko'rsatmalari

## Bir qatorli o'rnatish

### Windows uchun

PowerShell'ni **Administrator** sifatida oching va quyidagini kiriting:

```powershell
irm https://raw.githubusercontent.com/lxz-401/articraft.uz/main/install.ps1 | iex
```

> **PowerShell'ni Administrator sifatida qanday ochish?**
> 1. `Win + S` bosing
> 2. `PowerShell` yozing
> 3. O'ng tugma → **"Administrator sifatida ishga tushirish"**

---

### Linux/Ubuntu uchun

Terminalda quyidagini kiriting:

```bash
curl -fsSL https://raw.githubusercontent.com/lxz-401/articraft.uz/main/install.sh | bash
```

---

## O'rnatish jarayoni

Skript avtomatik ravishda:
1. ✅ Node.js va Git o'rnatadi (agar yo'q bo'lsa)
2. ✅ Loyihani GitHub'dan yuklab oladi
3. ✅ Sizdan rejim so'raydi: **Worker** yoki **Central**
4. ✅ Telegram token, Minecraft login va boshqa sozlamalarni so'raydi
5. ✅ Bot kompyuter yoqilganda avtomatik ishga tushadigan qilib o'rnatadi

---

## Nimalar kerak bo'ladi?

O'rnatishdan oldin quyidagilarni tayyorlab qo'ying:

### Barcha foydalanuvchilar uchun:
- **Telegram Bot Token** — [@BotFather](https://t.me/BotFather) dan oling (`/newbot` buyrug'i)
- **Telegram Chat ID** — [@userinfobot](https://t.me/userinfobot) ga `/start` yuboring

### Worker rejim uchun qo'shimcha:
- **Minecraft username** (nick)
- **Minecraft parol** (agar server `/login` talab qilsa)
- **Central Server URL** — admin'dan oling (`wss://...` ko'rinishida)
- **Central Token** — admin'dan oling

### Central rejim uchun qo'shimcha:
- Ubuntu Linux server yoki shaxsiy kompyuter (24/7 ishlashi kerak)
- Cloudflare akkaunt (bepul) — tunnel uchun

---

## O'rnatishdan keyin

### Worker uchun:
Telegram'da botingizni oching va `/start` yozing. Barcha buyruqlar ko'rsatiladi.

### Central uchun:
O'rnatishdan so'ng Cloudflare Tunnel ochish kerak:

1. `cloudflared` yuklab oling: https://github.com/cloudflare/cloudflared/releases
2. Ishga tushiring:
   ```
   cloudflared tunnel --url ws://localhost:8765
   ```
3. Chiqadigan URL (`wss://xxx.trycloudflare.com`) ni worker'larga bering
4. Telegram'da `/bots` buyrug'i bilan ulanganlarni ko'ring

---

## Muammolar bo'lsa

**"Skript ishga tushmadi"** (Windows):
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```
Keyin qayta urinib ko'ring.

**Node.js o'rnatilmadi**:
https://nodejs.org/en/download sahifasidan qo'lda yuklab o'rnating.

**Qo'lda ishga tushirish** (service o'rnatilmagan bo'lsa):
- Windows: `cd %APPDATA%\ArtiCRAFT` → `node src\worker.js`
- Linux: `cd ~/.articraft` → `node src/worker.js`
