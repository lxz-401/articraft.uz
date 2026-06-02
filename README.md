# ArtiCRAFT Minecraft bot

Bu loyiha `mineflayer` orqali `articraft.uz` Minecraft serveriga ulanadigan oddiy bot.

Default sozlamalar `articraft.uz:25565`, Java `1.21.11`, `offline` auth uchun tayyorlangan.

## O'rnatish

1. `.env.example` faylidan `.env` yarating.
2. `.env` ichida server sozlamalarini yozing.
3. Paketlarni o'rnating:

```bash
corepack pnpm install
```

## Ishga tushirish

```bash
node src/bot.js
```

Windows uchun yana qulayroq yo'l:

```powershell
.\start-bot.cmd
```

Bot ishga tushgandan keyin panelni brauzerda oching:

```text
http://127.0.0.1:3000
```

Panelda server chatini real vaqtda ko'rasiz, pastdagi input orqali chatga xabar yuborasiz, o'ng tomonda bot holati va inventory ko'rinadi.

3D ko'rish oynasi:

- Panelning yuqori qismida bot atrofidagi dunyo 3D ko'rinishda chiqadi.
- Alohida oynada ochish: `http://127.0.0.1:3007`
- Bu Minecraft clientdagi shader/HUD bilan bir xil video stream emas; botga yuborilgan chunklar asosida browserda chizilgan viewer.

Inventory boshqarish:

- Backpack yoki Hotbar slotidagi itemni bosing.
- Keyin ko'chirmoqchi bo'lgan slotni bosing.
- Armor va offhand slotlari hozircha faqat ko'rish uchun.
- Bo'sh slotlar ham ko'rinadi, shuning uchun item joylashuvi real slot tartibida chiqadi.

Harakat boshqaruvi:

- Paneldagi tugmalar bilan oldinga, orqaga, chapga, o'ngga, sakrash, sprint va sneak yuboriladi.
- `Stop` tugmasi barcha control state'larni o'chiradi.
- `Kamera` sliderlari botning qarash yo'nalishini o'zgartiradi.
- 3D viewer ustiga bossangiz klaviatura rejimi yoqiladi.
- `WASD`, `Space`, `Shift`, `Ctrl` ishlaydi.
- `Esc` klaviatura boshqaruvini o'chiradi.

Container boshqarish:

- Bot chest, ender chest, barrel yoki shulker yonida turgan bo'lishi kerak.
- Paneldagi `Chest`, `Ender chest`, `Barrel`, `Shulker` tugmalaridan birini bosing.
- Ochilgan oynadagi container slotlari va bot inventory slotlari ko'rinadi.
- Item bor slotni tanlab, boshqa slotga bossangiz joyi almashadi.
- `Yopish` tugmasi ochilgan oynani yopadi.

Serverdagi hamma chestlarni masofadan ko'rish mumkin emas. Minecraft server faqat bot ochgan container oynasidagi itemlarni clientga yuboradi.

## Chat buyruqlari

Bot serverga kirgandan keyin chatdan quyidagilarni yozish mumkin:

- `!help` - buyruqlar ro'yxati
- `!status` - bot holati
- `!come` - buyruq bergan o'yinchi yoniga boradi
- `!follow` - buyruq bergan o'yinchini kuzatadi
- `!stop` - yurishni to'xtatadi
- `!jump` - sakraydi
- `!say salom` - chatga xabar yozadi

`MC_OWNER` to'ldirilsa, bot faqat shu nickname buyruqlarini bajaradi. Bo'sh bo'lsa, hamma buyruq bera oladi.

## Muhim sozlamalar

- `MC_HOST` - server IP yoki domeni, default: `articraft.uz`
- `MC_PORT` - server porti
- `MC_USERNAME` - bot nickname
- `MC_VERSION` - ArtiCRAFT uchun default: `1.21.11`
- `MC_AUTH` - cracked/offline server uchun `offline`, Microsoft login uchun `microsoft`
- `MC_PASSWORD` - server `/register` va `/login` paroli. Bo'sh bo'lsa login komandasi yuborilmaydi
- `AUTO_LOGIN` - `true` bo'lsa bot kirganda `/register` va `/login` yuboradi
- `AUTO_ANTIAFK` - `true` bo'lsa bot har 45 soniyada sakrab AFK kick ehtimolini kamaytiradi
- `STOP_ON_BOT_CHECK_KICK` - server bot tekshiruvidan o'tmadi deb kick qilsa, qayta ulanishni to'xtatadi
- `VIEWER_ENABLED` - 3D ko'rish oynasini yoqadi
- `VIEWER_PORT` - 3D viewer porti

## ArtiCRAFT uchun tavsiya etilgan `.env`

```env
MC_HOST=articraft.uz
MC_PORT=25565
MC_USERNAME=ArticraftBot
MC_VERSION=1.21.11
MC_AUTH=offline
MC_OWNER=SizningNick
MC_PASSWORD=kuchli_parol
AUTO_LOGIN=true
AUTO_ANTIAFK=true
AUTO_RECONNECT=true
RECONNECT_DELAY_MS=5000
STOP_ON_BOT_CHECK_KICK=true
WEB_HOST=127.0.0.1
WEB_PORT=3000
VIEWER_ENABLED=true
VIEWER_PORT=3007
```

`MC_OWNER` ni o'z nickname'ingizga almashtiring. Shunda bot chat buyruqlarini faqat sizdan qabul qiladi.

`MC_PASSWORD` bo'sh qolsa bot avtomatik ro'yxatdan o'tmaydi. Bunday holatda paneldagi chat inputiga qo'lda quyidagicha yozing:

```text
/register parol parol
```

Keyingi kirishda:

```text
/login parol
```

## Bot tekshiruvi haqida

Agar server `Вы не успели пройти проверку на бота!` deb kick qilsa, bu serverning anti-bot tekshiruvi. Bot bu tekshiruvni aylanib o'tmaydi. `STOP_ON_BOT_CHECK_KICK=true` bo'lsa, bot qayta-qayta ulanib serverga spam qilmasdan to'xtaydi.
