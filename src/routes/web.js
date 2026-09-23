const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');
const { createUser, findByCode, resetCode, USERNAME_RE } = require('../auth');
const { db } = require('../db');
const config = require('../config');
const atlantic = require('../atlantic');
const { flash, requireLogin } = require('../middleware');
const deposits = require('../services/deposits');
const withdrawals = require('../services/withdrawals');
const apikeys = require('../services/apikeys');
const { toInt, isWithdrawOpen, withdrawHoursText, isHttpUrl } = require('../utils');

const router = express.Router();
const rules = () => ({ ...config.rules, open: isWithdrawOpen(), hours: withdrawHoursText() });

router.use((req, res, next) => {
  res.locals.rules = rules();
  res.locals.baseUrl = config.baseUrl;
  next();
});

// ---------- Publik ----------
router.get('/', (req, res) => res.render('home', { title: 'Artapedia QRIS Gateway' }));
router.get('/docs', (req, res) => res.render('docs', { title: 'Dokumentasi API' }));

// ---------- Auth ----------
router.get('/register', (req, res) => (req.user ? res.redirect('/dashboard') : res.render('register', { title: 'Daftar', form: {} })));

router.post('/register', async (req, res, next) => {
  const username = String(req.body.username || '').trim();
  const fail = (msg) => res.status(400).render('register', { title: 'Daftar', form: { username }, error: msg });

  if (!USERNAME_RE.test(username)) return fail('Nama 3-20 karakter: huruf, angka, underscore (tanpa spasi).');
  if (await db.get('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE', username)) return fail('Nama sudah dipakai, coba nama lain.');

  const { user, code } = await createUser(username, 'Web');
  req.login(user, (err) => {
    if (err) return next(err);
    req.session.newCode = code;
    res.redirect('/kode-akun');
  });
});

// Kode akun hanya ditampilkan SEKALI setelah daftar / reset
router.get('/kode-akun', requireLogin, (req, res) => {
  const code = req.session.newCode;
  if (!code) return res.redirect('/dashboard');
  delete req.session.newCode;
  res.render('account-code', { title: 'Simpan Kode Akun', code });
});

router.get('/login', (req, res) => (req.user ? res.redirect('/dashboard') : res.render('login', { title: 'Masuk' })));
router.post('/login', async (req, res, next) => {
  const user = await findByCode(req.body.code);
  if (!user) return res.status(401).render('login', { title: 'Masuk', error: 'Kode akun salah atau tidak terdaftar.' });
  req.login(user, (e) => (e ? next(e) : res.redirect('/dashboard')));
});
router.post('/logout', (req, res) => req.logout(() => res.redirect('/')));

// ---------- Setup admin lewat browser (butuh ADMIN_SETUP_KEY di env) ----------
const setupLimiter = rateLimit({ windowMs: 15 * 60000, limit: 10, skip: (req) => req.method !== 'POST' });
router.get('/setup-admin', (req, res) =>
  res.render('setup-admin', { title: 'Setup Admin', enabled: config.adminSetupKey.length >= 12, form: {} }));

router.post('/setup-admin', setupLimiter, async (req, res, next) => {
  const username = String(req.body.username || '').trim();
  const key = String(req.body.key || '');
  const render = (error) =>
    res.status(400).render('setup-admin', { title: 'Setup Admin', enabled: config.adminSetupKey.length >= 12, form: { username }, error });
  const expected = config.adminSetupKey;
  if (expected.length < 12) return render('ADMIN_SETUP_KEY belum diisi (minimal 12 karakter).');
  const a = crypto.createHash('sha256').update(key).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) return render('Kunci setup salah.');
  if (!USERNAME_RE.test(username)) return render('Nama 3-20 karakter: huruf, angka, underscore.');

  let user = await db.get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', username);
  let code;
  if (user) code = await resetCode(user.id);
  else ({ user, code } = await createUser(username, 'Setup admin'));
  await db.run("UPDATE users SET role = 'admin', banned = 0 WHERE id = ?", user.id);
  user = await db.get('SELECT * FROM users WHERE id = ?', user.id);
  req.login(user, (err) => {
    if (err) return next(err);
    req.session.newCode = code;
    res.redirect('/kode-akun');
  });
});

// ---------- Dashboard ----------
router.get('/dashboard', requireLogin, async (req, res) => {
  const uid = req.user.id;
  const [depSum, wdSum, pending, mutations] = await Promise.all([
    db.get("SELECT COALESCE(SUM(get_balance),0) s, COUNT(*) c FROM deposits WHERE user_id=? AND status='success'", uid),
    db.get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM withdrawals WHERE user_id=? AND status='success'", uid),
    db.get("SELECT COUNT(*) c FROM deposits WHERE user_id=? AND status='pending'", uid),
    db.all('SELECT * FROM mutations WHERE user_id=? ORDER BY id DESC LIMIT 10', uid),
  ]);
  res.render('dashboard', { title: 'Dashboard', stats: { depSum, wdSum, pending: pending.c }, mutations });
});

// ---------- Deposit / Buat QRIS ----------
router.get('/deposit', requireLogin, async (req, res) => {
  const list = await db.all('SELECT * FROM deposits WHERE user_id=? ORDER BY id DESC LIMIT 20', req.user.id);
  res.render('deposit', { title: 'Buat QRIS', list });
});

router.post('/deposit', requireLogin, async (req, res) => {
  try {
    const dep = await deposits.createDeposit(req.user, toInt(req.body.nominal), { source: 'web' });
    res.redirect(`/deposit/${dep.reff_id}`);
  } catch (e) {
    flash(req, 'error', e.message);
    res.redirect('/deposit');
  }
});

router.get('/deposit/:reff', requireLogin, async (req, res) => {
  const dep = await deposits.findForUser(req.user.id, req.params.reff);
  if (!dep) return res.status(404).render('error', { title: '404', message: 'Deposit tidak ditemukan' });
  const qr = dep.qr_string ? await QRCode.toDataURL(dep.qr_string, { width: 360, margin: 1 }) : null;
  res.render('deposit-detail', { title: 'Bayar QRIS', dep, qr });
});

router.get('/deposit/:reff/status', requireLogin, async (req, res) => {
  let dep = await deposits.findForUser(req.user.id, req.params.reff);
  if (!dep) return res.status(404).json({ status: false });
  try {
    dep = await deposits.refreshDeposit(dep);
  } catch (e) { /* abaikan, pakai status lokal */ }
  res.json({ status: true, data: deposits.publicView(dep) });
});

router.post('/deposit/:reff/cancel', requireLogin, async (req, res) => {
  const dep = await deposits.findForUser(req.user.id, req.params.reff);
  try {
    if (!dep) throw new Error('Deposit tidak ditemukan');
    await deposits.cancelDeposit(dep);
    flash(req, 'success', 'Deposit dibatalkan.');
  } catch (e) {
    flash(req, 'error', e.message);
  }
  res.redirect('/deposit');
});

// ---------- Penarikan ----------
router.get('/withdraw', requireLogin, async (req, res) => {
  let banks = [];
  try {
    banks = await withdrawals.bankList();
  } catch (e) {
    res.locals.flash.push({ type: 'error', msg: 'Gagal memuat daftar bank: ' + e.message });
  }
  const list = await db.all('SELECT * FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 20', req.user.id);
  res.render('withdraw', { title: 'Tarik Saldo', banks, list });
});

router.post('/withdraw/check', requireLogin, async (req, res) => {
  try {
    const data = await atlantic.checkAccount(String(req.body.bank_code || ''), String(req.body.account_number || '').replace(/[^\d]/g, ''));
    res.json({ status: true, data });
  } catch (e) {
    res.status(400).json({ status: false, message: e.message });
  }
});

router.post('/withdraw', requireLogin, async (req, res) => {
  try {
    const w = await withdrawals.createWithdrawal(req.user, {
      bankCode: req.body.bank_code,
      accountNumber: req.body.account_number,
      amount: toInt(req.body.amount),
      source: 'web',
    });
    if (w.status === 'failed') flash(req, 'error', `Penarikan gagal: ${w.note || 'ditolak'}. Saldo sudah dikembalikan.`);
    else flash(req, 'success', `Penarikan ${w.ref_id} diproses otomatis. Status: ${w.status}`);
  } catch (e) {
    flash(req, 'error', e.message);
  }
  res.redirect('/withdraw');
});

// ---------- Riwayat ----------
router.get('/history', requireLogin, async (req, res) => {
  const mutations = await db.all('SELECT * FROM mutations WHERE user_id=? ORDER BY id DESC LIMIT 200', req.user.id);
  res.render('history', { title: 'Riwayat Saldo', mutations });
});

// ---------- Developer: API key & webhook ----------
router.get('/developer', requireLogin, async (req, res) => {
  const newKey = req.session.newKey;
  delete req.session.newKey;
  res.render('developer', { title: 'Developer', keys: await apikeys.listKeys(req.user.id), newKey });
});

router.post('/developer/keys', requireLogin, async (req, res) => {
  try {
    req.session.newKey = await apikeys.createKey(req.user.id, req.body.name);
    flash(req, 'success', 'API key dibuat. Salin sekarang — hanya ditampilkan sekali!');
  } catch (e) {
    flash(req, 'error', e.message);
  }
  res.redirect('/developer');
});

router.post('/developer/keys/:id/revoke', requireLogin, async (req, res) => {
  await apikeys.revokeKey(req.user.id, parseInt(req.params.id, 10));
  flash(req, 'success', 'API key dicabut.');
  res.redirect('/developer');
});

router.post('/developer/webhook', requireLogin, async (req, res) => {
  const url = String(req.body.webhook_url || '').trim();
  if (url && !isHttpUrl(url)) {
    flash(req, 'error', 'URL webhook harus diawali http:// atau https://');
  } else {
    await db.run('UPDATE users SET webhook_url=? WHERE id=?', url || null, req.user.id);
    if (req.body.regenerate) {
      await db.run('UPDATE users SET webhook_secret=? WHERE id=?', crypto.randomBytes(24).toString('hex'), req.user.id);
    }
    flash(req, 'success', 'Pengaturan webhook disimpan.');
  }
  res.redirect('/developer');
});

module.exports = router;
