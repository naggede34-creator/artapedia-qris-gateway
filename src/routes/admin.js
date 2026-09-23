const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db, changeBalance } = require('../db');
const atlantic = require('../atlantic');
const { flash, requireLogin, requireAdmin, csrfStrict } = require('../middleware');
const { toInt } = require('../utils');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.use(requireLogin, requireAdmin);

const TABLES = ['users', 'api_keys', 'deposits', 'withdrawals', 'mutations'];
const columnsOf = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

router.get('/', async (req, res) => {
  const stats = {
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    balance: db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get().s,
    depToday: db.prepare("SELECT COALESCE(SUM(nominal),0) s, COUNT(*) c FROM deposits WHERE status='success' AND date(paid_at)=date('now')").get(),
    depAll: db.prepare("SELECT COALESCE(SUM(nominal),0) s, COUNT(*) c FROM deposits WHERE status='success'").get(),
    wdAll: db.prepare("SELECT COALESCE(SUM(amount),0) s, COALESCE(SUM(admin_fee),0) f, COUNT(*) c FROM withdrawals WHERE status='success'").get(),
    pendingDep: db.prepare("SELECT COUNT(*) c FROM deposits WHERE status='pending'").get().c,
    pendingWd: db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE status IN ('pending','processing')").get().c,
  };
  let atl = null;
  try {
    atl = await atlantic.profile();
  } catch (e) { /* opsional */ }
  const recentDep = db.prepare('SELECT d.*, u.username FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 10').all();
  const recentWd = db.prepare('SELECT w.*, u.username FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 10').all();
  res.render('admin/index', { title: 'Admin', stats, atl, recentDep, recentWd });
});

router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  const users = q
    ? db.prepare('SELECT * FROM users WHERE username LIKE ? OR email LIKE ? ORDER BY id DESC LIMIT 200').all(`%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 200').all();
  res.render('admin/users', { title: 'Kelola Pengguna', users, q });
});

router.post('/users/:id/ban', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) flash(req, 'error', 'Tidak bisa memblokir diri sendiri');
  else db.prepare('UPDATE users SET banned = 1 - banned WHERE id=?').run(id);
  res.redirect('/admin/users');
});

router.post('/users/:id/role', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) flash(req, 'error', 'Tidak bisa mengubah role diri sendiri');
  else db.prepare("UPDATE users SET role = CASE role WHEN 'admin' THEN 'user' ELSE 'admin' END WHERE id=?").run(id);
  res.redirect('/admin/users');
});

router.post('/users/:id/balance', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const sign = req.body.op === 'sub' ? -1 : 1;
  const amount = toInt(req.body.amount);
  if (!amount) flash(req, 'error', 'Nominal tidak valid');
  else {
    const r = changeBalance(id, sign * amount, 'admin', `Penyesuaian admin: ${String(req.body.reason || '-').slice(0, 100)}`);
    flash(req, r === null ? 'error' : 'success', r === null ? 'Saldo tidak cukup untuk dikurangi' : 'Saldo diperbarui');
  }
  res.redirect('/admin/users');
});

router.get('/transactions', (req, res) => {
  const deps = db.prepare('SELECT d.*, u.username FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 300').all();
  const wds = db.prepare('SELECT w.*, u.username FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 300').all();
  res.render('admin/transactions', { title: 'Transaksi', deps, wds });
});

// ---------------- BACKUP ----------------
router.get('/backup', (req, res) => res.render('admin/backup', { title: 'Backup & Restore' }));

router.get('/backup/export.json', (req, res) => {
  const tables = {};
  for (const t of TABLES) tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.setHeader('Content-Disposition', `attachment; filename="artapedia-backup-${stamp}.json"`);
  res.json({ app: 'artapedia-qris-gateway', version: 1, exported_at: new Date().toISOString(), tables });
});

const CSV_COLS = ['id', 'username', 'email', 'role', 'balance', 'banned', 'google_id', 'github_id', 'created_at'];
const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // cegah formula injection di Excel
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

router.get('/backup/users.csv', (req, res) => {
  const rows = db.prepare(`SELECT ${CSV_COLS.join(',')} FROM users ORDER BY id`).all();
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

router.post('/backup/import', upload.single('file'), csrfStrict, (req, res) => {
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
      const counts = {};
      db.transaction(() => {
        for (const t of [...TABLES].reverse()) db.prepare(`DELETE FROM ${t}`).run();
        for (const t of TABLES) {
          const cols = columnsOf(t);
          const rows = Array.isArray(payload.tables[t]) ? payload.tables[t] : [];
          counts[t] = 0;
          for (const r of rows) {
            const keys = cols.filter((c) => r[c] !== undefined);
            db.prepare(`INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => r[k]));
            counts[t]++;
          }
        }
      })();
      flash(req, 'success', 'Restore penuh selesai: ' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', '));
    } else {
      let added = 0, skipped = 0;
      db.transaction(() => {
        for (const u of payload.tables.users) {
          const email = String(u.email || '').toLowerCase().trim();
          const username = String(u.username || '').trim();
          if (!email || !username || db.prepare('SELECT 1 FROM users WHERE email=? OR username=?').get(email, username)) { skipped++; continue; }
          db.prepare(
            `INSERT INTO users (username, email, password_hash, google_id, github_id, role, balance, banned, webhook_url, webhook_secret, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,COALESCE(?, datetime('now')))`
          ).run(
            username, email,
            u.password_hash || (u.password ? bcrypt.hashSync(String(u.password), 10) : null),
            u.google_id || null, u.github_id || null,
            u.role === 'admin' ? 'admin' : 'user',
            parseInt(u.balance, 10) || 0,
            parseInt(u.banned, 10) ? 1 : 0,
            u.webhook_url || null,
            u.webhook_secret || crypto.randomBytes(24).toString('hex'),
            u.created_at || null
          );
          added++;
        }
      })();
      flash(req, 'success', `Import pengguna selesai: ${added} ditambahkan, ${skipped} dilewati (sudah ada/tidak valid).`);
    }
  } catch (e) {
    flash(req, 'error', 'Import gagal: ' + e.message);
  }
  res.redirect('/admin/backup');
});

module.exports = router;
