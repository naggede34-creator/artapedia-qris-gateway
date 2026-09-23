// Membuat akun admin (atau menjadikan user yang sudah ada sebagai admin) lalu mencetak KODE AKUN baru.
// Pemakaian: npm run admin -- namakamu
const { db } = require('../src/db');
const { createUser, resetCode, USERNAME_RE } = require('../src/auth');

const name = String(process.argv[2] || '').trim();
if (!USERNAME_RE.test(name)) {
  console.error('Pemakaian: npm run admin -- <nama>   (3-20 karakter: huruf, angka, underscore)');
  process.exit(1);
}

let user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(name);
let code;
if (user) {
  code = resetCode(user.id);
} else {
  ({ user, code } = createUser(name, 'CLI admin'));
}
db.prepare("UPDATE users SET role = 'admin', banned = 0 WHERE id = ?").run(user.id);

console.log('\n✅ Admin siap!');
console.log(`   Nama      : ${user.username}`);
console.log(`   Kode akun : ${code}`);
console.log('\nSimpan kode ini untuk login di /login. Kode lama (jika ada) sudah tidak berlaku.\n');
setTimeout(() => process.exit(0), 1500); // beri waktu notif Telegram terkirim
