const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { db, changeBalance } = require('../db');
const atlantic = require('../atlantic');
const { flash, requireLogin, requireAdmin, csrfStrict } = require('../middleware');
const { toInt } = require('../utils');
const { resetCode } = require('../auth');

const router = express.Router();
// Batas body Vercel ±4.5MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

router.use(requireLogin, requireAdmin);

const TABLES = ['users', 'api_keys', 'deposits', 'withdrawals', 'mutations'];
const columnsOf = async (t) => (await db.all(`PRAGMA table_info(${t})`)).map((c) => c.name);

router.get('/', async (req, res) => {
  const [users, balance, depToday, depAll, wdAll, pendingDep, pendingWd, recentDep, recentWd] = await Promise.all([
    db.get('SELECT COUNT(*) c FROM users'),
    db.get('SELECT COALESCE(SUM(balance),0) s FROM users'),
    db.get("SELECT COALESCE(SUM(nominal),0) s, COUNT(*) c FROM deposits WHERE status='success' AND date(paid_at)=date('now')"),
    db.get("SELECT COALESCE(SUM(nominal),0) s, COUNT(*) c FROM deposits WHERE status='success'"),
    db.get("SELECT COALESCE(SUM(amount),0) s, COALESCE(SUM(admin_fee),0) f, COUNT(*) c FROM withdrawals WHERE status='success'"),
    db.get("SELECT COUNT(*) c FROM deposits WHERE status='pending'"),
    db.get("SELECT COUNT(*) c FROM withdrawals WHERE status IN ('pending','processing')"),
    db.all('SELECT d.*, u.username FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 10'),
    db.all('SELECT w.*, u.username FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 10'),
  ]);
  const stats = {
    users: users.c, balance: balance.s, depToday, depAll, wdAll, pendingDep: pendingDep.c, pendingWd: pendingWd.c,
  };
  let atl = null;
  try {
    atl = await atlantic.profile();
  } catch (e) { /* opsional */ }
  res.render('admin/index', { title: 'Admin', stats, atl, recentDep, recentWd });
});

router.get('/users', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const users = q
    ? await db.all('SELECT * FROM users WHERE username LIKE ? OR CAST(id AS TEXT) = ? ORDER BY id DESC LIMIT 200', `%${q}%`, q)
    : await db.all('SELECT * FROM users ORDER BY id DESC LIMIT 200');
  const resetInfo = req.session.resetInfo;
  delete req.session.resetInfo;
  res.render('admin/users', { title: 'Kelola Pengguna', users, q, resetInfo });
});

router.post('/users/:id/ban', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) flash(req, 'error', 'Tidak bisa memblokir diri sendiri');
  else await db.run('UPDATE users SET banned = 1 - banned WHERE id=?', id);
  res.redirect('/admin/users');
});

router.post('/users/:id/role', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) flash(req, 'error', 'Tidak bisa mengubah role diri sendiri');
  else await db.run("UPDATE users SET role = CASE role WHEN 'admin' THEN 'user' ELSE 'admin' END WHERE id=?", id);
  res.redirect('/admin/users');
});

// User lupa kode -> admin buatkan kode baru (kode lama langsung tidak berlaku)
router.post('/users/:id/reset-code', async (req, res) => {
  const u = await db.get('SELECT id, username FROM users WHERE id = ?', parseInt(req.params.id, 10));
  if (u) req.session.resetInfo = { username: u.username, code: await resetCode(u.id) };
  res.redirect('/admin/users');
});

router.post('/users/:id/balance', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const sign = req.body.op === 'sub' ? -1 : 1;
  const amount = toInt(req.body.amount);
  if (!amount) flash(req, 'error', 'Nominal tidak valid');
  else {
    const r = await db.tx((t) =>
      changeBalance(t, id, sign * amount, 'admin', `Penyesuaian admin: ${String(req.body.reason || '-').slice(0, 100)}`));
    flash(req, r === null ? 'error' : 'success', r === null ? 'Saldo tidak cukup untuk dikurangi' : 'Saldo diperbarui');
  }
  res.redirect('/admin/users');
});

router.get('/transactions', async (req, res) => {
  const [deps, wds] = await Promise.all([
    db.all('SELECT d.*, u.username FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 300'),
    db.all('SELECT w.*, u.username FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 300'),
  ]);
  res.render('admin/transactions', { title: 'Transaksi', deps, wds });
});

// ---------------- BACKUP ----------------
router.get('/backup', (req, res) => res.render('admin/backup', { title: 'Backup & Restore' }));

router.get('/backup/export.json', async (req, res) => {
  const tables = {};
  for (const t of TABLES) tables[t] = await db.all(`SELECT * FROM ${t}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.setHeader('Content-Disposition', `attachment; filename="artapedia-backup-${stamp}.json"`);
  res.json({ app: 'artapedia-qris-gateway', version: 2, exported_at: new Date().toISOString(), tables });
});

const CSV_COLS = ['id', 'username', 'role', 'balance', 'banned', 'created_at'];
const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // cegah formula injection di Excel
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

router.get('/backup/users.csv', async (req, res) => {
  const rows = await db.all(`SELECT ${CSV_COLS.join(',')} FROM users ORDER BY id`);
  const csv = [CSV_COLS.join(','), ...rows.map((r) => CSV_COLS.map((c) => csvCell(r[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="artapedia-users.csv"');
  res.send('﻿' + csv);
});

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || '').replace(/^'(?=[=+\-@])/, '')])));
}

router.post('/backup/import', upload.single('file'), csrfStrict, async (req, res) => {
  const mode = req.body.mode;
  try {
    if (!req.file) throw new Error('Pilih file backup dulu');
    const text = req.file.buffer.toString('utf8');
    const isCsv = /\.csv$/i.test(req.file.originalname);
    let payload = isCsv ? { tables: { users: parseCsv(text) } } : JSON.parse(text);
    if (Array.isArray(payload)) payload = { tables: { users: payload } };
    if (!payload.tables || !Array.isArray(payload.tables.users)) throw new Error('Format file tidak dikenali');

    if (mode === 'replace') {
      if (isCsv) throw new Error('Restore penuh butuh file backup .json');
      if (req.body.confirm !== 'RESTORE') throw new Error('Ketik RESTORE untuk konfirmasi restore penuh');
      const stmts = [];
      const counts = {};
      for (const t of [...TABLES].reverse()) stmts.push({ sql: `DELETE FROM ${t}` });
      for (const t of TABLES) {
        const cols = await columnsOf(t);
        const rows = Array.isArray(payload.tables[t]) ? payload.tables[t] : [];
        counts[t] = rows.length;
        for (const r of rows) {
          const keys = cols.filter((c) => r[c] !== undefined);
          stmts.push({ sql: `INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, args: keys.map((k) => r[k]) });
        }
      }
      await db.batch(stmts); // atomik: semua berhasil atau tidak sama sekali
      flash(req, 'success', 'Restore penuh selesai: ' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', '));
    } else {
      const existing = new Set((await db.all('SELECT username FROM users')).map((u) => u.username.toLowerCase()));
      const stmts = [];
      let skipped = 0;
      for (const u of payload.tables.users) {
        const username = String(u.username || '').trim();
        if (!username || existing.has(username.toLowerCase())) { skipped++; continue; }
        existing.add(username.toLowerCase());
        stmts.push({
          sql: `INSERT INTO users (username, access_code_hash, role, balance, banned, webhook_url, webhook_secret, created_at)
                VALUES (?,?,?,?,?,?,?,COALESCE(?, datetime('now')))`,
          args: [
            username,
            u.access_code_hash || null,
            u.role === 'admin' ? 'admin' : 'user',
            parseInt(u.balance, 10) || 0,
            parseInt(u.banned, 10) ? 1 : 0,
            u.webhook_url || null,
            u.webhook_secret || crypto.randomBytes(24).toString('hex'),
            u.created_at || null,
          ],
        });
      }
      if (stmts.length) await db.batch(stmts);
      flash(req, 'success', `Import pengguna selesai: ${stmts.length} ditambahkan, ${skipped} dilewati (sudah ada/tidak valid).`);
    }
  } catch (e) {
    flash(req, 'error', 'Import gagal: ' + e.message);
  }
  res.redirect('/admin/backup');
});

module.exports = router;
