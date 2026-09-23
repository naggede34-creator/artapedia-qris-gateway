// Login tanpa email/password: saat daftar cukup isi nama, sistem membuat KODE AKUN unik.
// Kode hanya ditampilkan sekali; yang disimpan di database hanya hash-nya.
const passport = require('passport');
const crypto = require('crypto');
const { db } = require('./db');
const { notify } = require('./telegram');
const { background } = require('./background');
const { sha256 } = require('./utils');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
// Tanpa huruf/angka yang mirip (0/O, 1/I/L) supaya mudah dicatat
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode() {
  const bytes = crypto.randomBytes(16);
  let raw = '';
  for (let i = 0; i < 16; i++) raw += ALPHABET[bytes[i] % ALPHABET.length];
  return `ARTA-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

/** Samakan format: huruf besar, buang spasi/strip, buang awalan ARTA. */
function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^ARTA/, '');
}
const hashCode = (code) => sha256(normalizeCode(code));

async function createUser(username, via) {
  const code = generateCode();
  const info = await db.run(
    'INSERT INTO users (username, access_code_hash, webhook_secret) VALUES (?,?,?)',
    username, hashCode(code), crypto.randomBytes(24).toString('hex')
  );
  const user = await db.get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid);
  background(notify.newUser(user, via));
  return { user, code };
}

/** Buat kode baru untuk user (kode lama langsung tidak berlaku). */
async function resetCode(userId) {
  const code = generateCode();
  await db.run('UPDATE users SET access_code_hash = ? WHERE id = ?', hashCode(code), userId);
  return code;
}

async function findByCode(code) {
  if (normalizeCode(code).length !== 16) return null;
  return (await db.get('SELECT * FROM users WHERE access_code_hash = ?', hashCode(code))) || null;
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  db.get('SELECT * FROM users WHERE id = ?', id).then((u) => done(null, u || false), done);
});

module.exports = { passport, createUser, resetCode, findByCode, USERNAME_RE };
