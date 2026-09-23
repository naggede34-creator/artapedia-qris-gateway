// Database: Turso/libSQL (online, cocok untuk Vercel) atau file SQLite lokal.
// - Vercel / produksi: isi TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
// - Lokal / VPS: kosongkan, otomatis pakai file data/artapedia.db
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const config = require('./config');

let _client = null;
function getClient() {
  if (_client) return _client;
  let url = config.db.url;
  if (!url) {
    if (process.env.VERCEL) {
      throw new Error('Database belum diatur: isi TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN di Vercel → Settings → Environment Variables, lalu Redeploy.');
    }
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
    url = 'file:' + config.dbPath;
  }
  _client = createClient({ url, authToken: config.db.authToken || undefined });
  return _client;
}

const clean = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a));
const toObjects = (rs) =>
  rs.rows.map((r) => {
    const o = {};
    rs.columns.forEach((c, i) => (o[c] = r[i]));
    return o;
  });

function wrap(exec) {
  return {
    async all(sql, ...args) {
      return toObjects(await exec({ sql, args: clean(args) }));
    },
    async get(sql, ...args) {
      return (await this.all(sql, ...args))[0];
    },
    async run(sql, ...args) {
      const rs = await exec({ sql, args: clean(args) });
      return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid == null ? null : Number(rs.lastInsertRowid) };
    },
  };
}

const db = wrap((stmt) => getClient().execute(stmt));

// Transaksi tulis dijalankan berurutan dalam 1 proses (hindari SQLITE_BUSY di file lokal),
// dan dicoba ulang sebentar jika database sedang sibuk.
let txQueue = Promise.resolve();
db.tx = function (fn) {
  const job = txQueue.then(async () => {
    for (let attempt = 1; ; attempt++) {
      const tx = await getClient().transaction('write');
      try {
        const result = await fn(wrap((stmt) => tx.execute(stmt)));
        await tx.commit();
        return result;
      } catch (err) {
        await tx.rollback().catch(() => {});
        if (attempt < 4 && /SQLITE_BUSY|database is locked/i.test(String(err && err.message))) {
          await new Promise((r) => setTimeout(r, 150 * attempt));
          continue;
        }
        throw err;
      } finally {
        tx.close();
      }
    }
  });
  txQueue = job.catch(() => {});
  return job;
};

/** Jalankan banyak statement sekaligus secara atomik (1 request ke Turso). */
db.batch = (stmts) => getClient().batch(stmts.map((s) => ({ sql: s.sql, args: clean(s.args || []) })), 'write');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  access_code_hash TEXT UNIQUE,
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
`;

async function init() {
  // Migrasi dari versi lama (login email/password/Google/GitHub) ke login kode akun.
  const old = await db.all('PRAGMA table_info(users)');
  if (old.some((c) => c.name === 'email')) {
    await getClient().executeMultiple(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        access_code_hash TEXT UNIQUE,
        role TEXT NOT NULL DEFAULT 'user',
        balance INTEGER NOT NULL DEFAULT 0,
        banned INTEGER NOT NULL DEFAULT 0,
        webhook_url TEXT,
        webhook_secret TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, username, role, balance, banned, webhook_url, webhook_secret, created_at)
        SELECT id, username, role, balance, banned, webhook_url, webhook_secret, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT;
    `);
  }
  await getClient().executeMultiple(SCHEMA);
}

let readyPromise = null;
/** Pastikan tabel sudah dibuat (dipanggil sekali per proses / instance serverless). */
function ready() {
  if (!readyPromise) readyPromise = init().catch((e) => { readyPromise = null; throw e; });
  return readyPromise;
}

/**
 * Ubah saldo user secara atomik + catat mutasi. Wajib dipanggil di dalam db.tx().
 * Mengembalikan saldo baru, atau null jika saldo tidak cukup (untuk debit).
 */
async function changeBalance(t, userId, amount, type, description) {
  const res = await t.run('UPDATE users SET balance = balance + ? WHERE id = ? AND balance + ? >= 0', amount, userId, amount);
  if (res.changes !== 1) return null;
  const { balance } = await t.get('SELECT balance FROM users WHERE id = ?', userId);
  await t.run(
    'INSERT INTO mutations (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
    userId, type, amount, balance, description || null
  );
  return balance;
}

module.exports = { db, ready, changeBalance };
