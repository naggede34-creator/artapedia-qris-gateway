// Membuat akun admin (atau menjadikan user yang sudah ada sebagai admin) lalu mencetak KODE AKUN baru.
// Pemakaian: npm run admin -- namakamu
// (Untuk database Turso, isi TURSO_DATABASE_URL & TURSO_AUTH_TOKEN di .env dulu.)
// Alternatif tanpa terminal: buka {BASE_URL}/setup-admin dengan ADMIN_SETUP_KEY.
const { db, ready } = require('../src/db');
const { createUser, resetCode, USERNAME_RE } = require('../src/auth');

(async () => {
  const name = String(process.argv[2] || '').trim();
  if (!USERNAME_RE.test(name)) {
    console.error('Pemakaian: npm run admin -- <nama>   (3-20 karakter: huruf, angka, underscore)');
    process.exit(1);
  }
  await ready();
  let user = await db.get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', name);
  let code;
  if (user) code = await resetCode(user.id);
  else ({ user, code } = await createUser(name, 'CLI admin'));
  await db.run("UPDATE users SET role = 'admin', banned = 0 WHERE id = ?", user.id);

  console.log('\n✅ Admin siap!');
  console.log(`   Nama      : ${user.username}`);
  console.log(`   Kode akun : ${code}`);
  console.log('\nSimpan kode ini untuk login di /login. Kode lama (jika ada) sudah tidak berlaku.\n');
  setTimeout(() => process.exit(0), 1500); // beri waktu notif Telegram terkirim
})().catch((e) => {
  console.error('Gagal:', e.message);
  process.exit(1);
});
