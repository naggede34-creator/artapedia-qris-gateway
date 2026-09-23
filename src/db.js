const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  google_id TEXT UNIQUE,
  github_id TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user',
  balance INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  webhook_url TEXT,
  webhook_secret TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reff_id TEXT UNIQUE NOT NULL,
  merchant_ref TEXT,
  atl_id TEXT,
  nominal INTEGER NOT NULL,
  fee INTEGER NOT NULL DEFAULT 0,
  get_balance INTEGER NOT NULL DEFAULT 0,
  qr_string TEXT,
  qr_image TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'web',
  callback_url TEXT,
  expired_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dep_status ON deposits(status);
CREATE INDEX IF NOT EXISTS idx_dep_user ON deposits(user_id);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ref_id TEXT UNIQUE NOT NULL,
  merchant_ref TEXT,
  atl_id TEXT,
  bank_code TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  admin_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'web',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wd_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_wd_user ON withdrawals(user_id);

CREATE TABLE IF NOT EXISTS mutations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires INTEGER NOT NULL
);
`);

/**
 * Ubah saldo user secara atomik + catat mutasi.
 * Mengembalikan saldo baru, atau null jika saldo tidak cukup (untuk debit).
 */
const changeBalance = db.transaction((userId, amount, type, description) => {
  const res = db
    .prepare('UPDATE users SET balance = balance + ? WHERE id = ? AND balance + ? >= 0')
    .run(amount, userId, amount);
  if (res.changes !== 1) return null;
  const { balance } = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
  db.prepare(
    'INSERT INTO mutations (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)'
  ).run(userId, type, amount, balance, description || null);
  return balance;
});

module.exports = { db, changeBalance };
