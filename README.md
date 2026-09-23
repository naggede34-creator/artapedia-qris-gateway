# Artapedia QRIS Gateway

Website QRIS payment gateway (tema 3D komik/manga) di atas **Atlantic H2H** (`https://atlantich2h.com`).

## Fitur
- Daftar **cukup isi nama**, lalu dapat **kode akun unik** (contoh `ARTA-7KQ2-M9XD-P4TR-8WHN`) untuk login. Tanpa email, tanpa password
- Buat QRIS dari **web** atau lewat **API** (`/api/v1`) untuk website/bot
- **API key** untuk developer (buat/cabut sendiri, disimpan ter-hash) + **webhook callback** bertanda tangan HMAC
- Deposit min **Rp 2.000**, max **Rp 10.000.000**. Saldo masuk otomatis saat QRIS lunas
- Penarikan **otomatis**: min **Rp 10.000**, biaya admin **Rp 2.000**, buka **08:00–16:00 WIB**. Kalau gagal, saldo dikembalikan otomatis
- Notif **Telegram**: pengguna baru, deposit pending/berhasil, penarikan pending/berhasil (+ gagal)
- **Dashboard admin**: statistik, kelola pengguna (ban, role, atur saldo, reset kode), transaksi, **backup ekspor/impor**
- Dokumentasi API di `/docs`

---

## Deploy ke Vercel (+ database Turso)

### 1. Buat database Turso (gratis)
1. Daftar di **https://turso.tech** (bisa login pakai GitHub).
2. **Create Database**: beri nama `artapedia`, pilih region **Singapore** (dekat server Vercel `sin1`).
3. Buka database → salin **URL** (diawali `libsql://...`) → ini `TURSO_DATABASE_URL`.
4. Klik **Create Token** (Read & Write) → salin token → ini `TURSO_AUTH_TOKEN`.

### 2. Isi Environment Variables di Vercel
Vercel → project → **Settings → Environment Variables**, tambahkan:

| Nama | Isi |
|---|---|
| `TURSO_DATABASE_URL` | URL dari Turso |
| `TURSO_AUTH_TOKEN` | Token dari Turso |
| `ATLANTIC_API_KEY` | API key Atlantic |
| `SESSION_SECRET` | String acak panjang |
| `CRON_SECRET` | String acak min 12 karakter |
| `ADMIN_SETUP_KEY` | String acak min 12 karakter |
| `BASE_URL` | mis. `https://artapedia.vercel.app` (tanpa `/` di akhir) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Untuk notif ke channel |

Opsional: `DEPOSIT_MIN`, `DEPOSIT_MAX`, `WITHDRAW_MIN`, `WITHDRAW_FEE`, `WITHDRAW_OPEN_HOUR`, `WITHDRAW_CLOSE_HOUR`, `TIMEZONE`, `POLL_INTERVAL`.

Setelah itu: **Deployments → titik tiga → Redeploy**.

### 3. Buat akun admin
Buka `https://web-kamu/setup-admin`, masukkan `ADMIN_SETUP_KEY` dan nama admin. Kode akun admin akan muncul, simpan untuk login.

### 4. Pasang cron (cek status otomatis tiap 1 menit)
Vercel paket gratis tidak bisa menjalankan proses terus-menerus, jadi pakai **https://cron-job.org** (gratis):
1. Daftar → **Create cronjob**.
2. URL: `https://web-kamu/cron/tick?key=ISI_CRON_SECRET`
3. Schedule: **Every 1 minute** → Save.

Status juga dicek otomatis saat ada pengunjung, saat user membuka halaman bayar QRIS, dan saat developer memanggil API status.

### 5. (Opsional) Webhook Atlantic
Isi URL webhook di dashboard Atlantic dengan `https://web-kamu/webhook/atlantic` supaya saldo masuk lebih cepat.

---

## Jalan di VPS / lokal
```bash
npm install
cp .env.example .env   # isi nilainya, TURSO_* boleh dikosongkan
npm start
```
Tanpa `TURSO_*`, database otomatis memakai file `data/artapedia.db` dan pengecekan status jalan sendiri tiap `POLL_INTERVAL` detik (tidak perlu cron). Admin bisa dibuat lewat `/setup-admin` atau `npm run admin -- namakamu`.

## Pengguna lupa kode akun
Admin → Pengguna → **RESET KODE**. Kode baru muncul sekali, kirimkan ke pengguna. Kode lama langsung tidak berlaku.

## Catatan penting
- Jangan pernah commit `ATLANTIC_API_KEY` atau `.env` ke git.
- Saldo Atlantic kamu dipakai untuk membayar penarikan user. Pastikan saldonya cukup (terlihat di dashboard admin).
- Saldo user yang masuk = `get_balance` dari Atlantic (nominal dikurangi fee QRIS Atlantic).
- Backup rutin lewat **Admin → Backup**. File backup berisi data sensitif.
