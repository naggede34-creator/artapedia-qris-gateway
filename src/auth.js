// Login tanpa email/password: saat daftar cukup isi nama, sistem membuat KODE AKUN unik.
// Kode hanya ditampilkan sekali; yang disimpan di database hanya hash-nya.
const passport = require('passport');
const crypto = require('crypto');
const { db } = require('./db');
const { notify } = require('./telegram');
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

function createUser(username, via) {
  const code = generateCode();
  const info = db
    .prepare('INSERT INTO users (username, access_code_hash, webhook_secret) VALUES (?,?,?)')
    .run(username, hashCode(code), crypto.randomBytes(24).toString('hex'));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  notify.newUser(user, via);
  return { user, code };
}

/** Buat kode baru untuk user (kode lama langsung tidak berlaku). */
function resetCode(userId) {
  const code = generateCode();
  db.prepare('UPDATE users SET access_code_hash = ? WHERE id = ?').run(hashCode(code), userId);
  return code;
}

function findByCode(code) {
  if (normalizeCode(code).length !== 16) return null;
  return db.prepare('SELECT * FROM users WHERE access_code_hash = ?').get(hashCode(code)) || null;
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => done(null, db.prepare('SELECT * FROM users WHERE id = ?').get(id) || false));

module.exports = { passport, createUser, resetCode, findByCode, USERNAME_RE };
