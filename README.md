# Artapedia QRIS Gateway

Website QRIS payment gateway (tema 3D komik/manga) di atas **Atlantic H2H** (`https://atlantich2h.com`).

## Fitur
- Daftar **cukup isi nama** → dapat **kode akun unik** (contoh `ARTA-7KQ2-M9XD-P4TR-8WHN`) yang dipakai untuk login. Tanpa email, tanpa password
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
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Bot dari @BotFather. Tambahkan bot sebagai admin di channel, isi chat id dengan `@namachannel` atau `-100…` |

### Membuat akun admin
Jalankan di server (setelah `npm install`):
```bash
npm run admin -- namakamu
```
Kode akun admin akan tampil di terminal, simpan lalu login di `/login`. Perintah yang sama untuk nama yang sudah ada akan menjadikannya admin dan membuat kode baru.

### Pengguna lupa kode akun
Admin → Pengguna → **RESET KODE**. Kode baru muncul sekali, kirimkan ke pengguna. Kode lama langsung tidak berlaku.

### Webhook Atlantic (opsional)
Isi URL webhook di dashboard Atlantic dengan `{BASE_URL}/webhook/atlantic`. Tanpa webhook pun status tetap dicek otomatis setiap `POLL_INTERVAL` detik.

## Catatan penting
- Saldo Atlantic kamu dipakai untuk membayar penarikan user. Pastikan saldonya cukup (terlihat di dashboard admin).
- Saldo user yang masuk = `get_balance` dari Atlantic (nominal dikurangi fee QRIS Atlantic).
- Jalankan di belakang HTTPS (nginx/Caddy) untuk produksi, dan pakai `pm2 start src/server.js --name artapedia` supaya tetap hidup.
- Backup rutin lewat **Admin → Backup**. File backup berisi data sensitif, jadi simpan dengan aman.
