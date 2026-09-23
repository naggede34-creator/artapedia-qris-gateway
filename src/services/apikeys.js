const crypto = require('crypto');
const { db } = require('../db');
const { sha256 } = require('../utils');

async function createKey(userId, name) {
  const { c } = await db.get('SELECT COUNT(*) c FROM api_keys WHERE user_id = ? AND revoked = 0', userId);
  if (c >= 10) throw new Error('Maksimal 10 API key aktif per akun');
  const raw = 'ap_live_' + crypto.randomBytes(24).toString('hex');
  await db.run(
    'INSERT INTO api_keys (user_id, name, key_prefix, key_hash) VALUES (?,?,?,?)',
    userId, String(name || 'Default').slice(0, 50), raw.slice(0, 14), sha256(raw)
  );
  return raw; // hanya ditampilkan sekali
}

async function findUserByKey(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const row = await db.get(
    `SELECT k.id key_id, u.* FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = ? AND k.revoked = 0`,
    sha256(raw.trim())
  );
  if (!row) return null;
  await db.run("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?", row.key_id);
  return row;
}

const listKeys = (userId) =>
  db.all('SELECT id, name, key_prefix, revoked, last_used_at, created_at FROM api_keys WHERE user_id = ? ORDER BY id DESC', userId);

const revokeKey = async (userId, id) =>
  (await db.run('UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?', id, userId)).changes === 1;

module.exports = { createKey, findUserByKey, listKeys, revokeKey };
