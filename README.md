# Artapedia QRIS Gateway

Website QRIS payment gateway (tema 3D komik/manga) di atas **Atlantic H2H** (`https://atlantich2h.com`).

## Fitur
- Daftar pakai **username + Gmail + password**, atau login **Google** / **GitHub**
- Buat QRIS dari **web** atau lewat **API** (`/api/v1`) untuk website/bot
- **API key** untuk developer (buat/cabut sendiri, disimpan ter-hash) + **webhook callback** bertanda tangan HMAC
- Deposit min **Rp 2.000**, max **Rp 10.000.000**. Saldo masuk otomatis saat QRIS lunas
- Penarikan **otomatis** ke bank/e-wallet: min **Rp 10.000**, biaya admin **Rp 2.000**, buka **08:00–16:00 WIB**. Kalau gagal, saldo dikembalikan otomatis
- Notif **Telegram** untuk: pengguna baru, deposit pending, deposit berhasil, penarikan pending, penarikan berhasil (serta penarikan gagal)
- **Dashboard admin**: statistik, kelola pengguna (ban, role, atur saldo), transaksi, **backup ekspor/impor** (JSON penuh & CSV pengguna)
- Dokumentasi API lengkap di `/docs` (cURL, Node.js, PHP, Python, contoh bot Telegram)

## Instalasi
```bash
npm install
cp .env.example .env   # lalu isi nilainya
npm start
```
Butuh Node.js 18+. Database SQLite dibuat otomatis di `data/artapedia.db`.

### Isi `.env` yang wajib
| Variabel | Keterangan |
|---|---|
| `ATLANTIC_API_KEY` | API key Atlantic H2H kamu (**jangan pernah commit ke git**) |
| `SESSION_SECRET` | String acak panjang |
| `BASE_URL` | URL publik website, mis. `https://pay.domainkamu.com` |
| `ADMIN_EMAILS` | Gmail yang otomatis jadi admin saat daftar |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Bot dari @BotFather. Tambahkan bot sebagai admin di channel, isi chat id dengan `@namachannel` atau `-100…` |

### Login Google / GitHub
- Google Cloud Console → OAuth Client → Authorized redirect URI: `{BASE_URL}/auth/google/callback`
- GitHub → Settings → Developer settings → OAuth Apps → Callback URL: `{BASE_URL}/auth/github/callback`

Tombol login Google/GitHub otomatis muncul setelah client ID & secret diisi.

### Webhook Atlantic (opsional)
Isi URL webhook di dashboard Atlantic dengan `{BASE_URL}/webhook/atlantic`. Tanpa webhook pun status tetap dicek otomatis setiap `POLL_INTERVAL` detik.

## Catatan penting
- Saldo Atlantic kamu dipakai untuk membayar penarikan user. Pastikan saldonya cukup (terlihat di dashboard admin).
- Saldo user yang masuk = `get_balance` dari Atlantic (nominal dikurangi fee QRIS Atlantic).
- Jalankan di belakang HTTPS (nginx/Caddy) untuk produksi, dan pakai `pm2 start src/server.js --name artapedia` supaya tetap hidup.
- Backup rutin lewat **Admin → Backup**. File backup berisi data sensitif, jadi simpan dengan aman.
