const express = require('express');
const QRCode = require('qrcode');
const { passport, createUser, USERNAME_RE } = require('../auth');
const { db } = require('../db');
const config = require('../config');
const { flash, requireLogin } = require('../middleware');
const deposits = require('../services/deposits');
const withdrawals = require('../services/withdrawals');
const apikeys = require('../services/apikeys');
const { toInt, isWithdrawOpen, withdrawHoursText, isHttpUrl } = require('../utils');

const router = express.Router();
const rules = () => ({ ...config.rules, open: isWithdrawOpen(), hours: withdrawHoursText() });

router.use((req, res, next) => {
  res.locals.rules = rules();
  res.locals.oauth = { google: !!config.google.clientID, github: !!config.github.clientID };
  res.locals.baseUrl = config.baseUrl;
  next();
});

// ---------- Publik ----------
router.get('/', (req, res) => res.render('home', { title: 'Artapedia QRIS Gateway' }));
router.get('/docs', (req, res) => res.render('docs', { title: 'Dokumentasi API' }));

// ---------- Auth ----------
router.get('/register', (req, res) => (req.user ? res.redirect('/dashboard') : res.render('register', { title: 'Daftar', form: {} })));

router.post('/register', (req, res, next) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const confirm = String(req.body.password_confirm || '');
  const fail = (msg) => res.status(400).render('register', { title: 'Daftar', form: { username, email }, error: msg });

  if (!USERNAME_RE.test(username)) return fail('Username 3-20 karakter: huruf, angka, underscore.');
  if (!/^[^\s@]+@gmail\.com$/i.test(email)) return fail('Gunakan alamat Gmail yang valid (contoh: kamu@gmail.com).');
  if (password.length < 8) return fail('Password minimal 8 karakter.');
  if (password !== confirm) return fail('Konfirmasi password tidak sama.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return fail('Username sudah dipakai.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return fail('Gmail sudah terdaftar.');

  const user = createUser({ username, email, password }, 'Form (username + gmail)');
  req.login(user, (err) => {
    if (err) return next(err);
    flash(req, 'success', `Selamat datang, ${user.username}! 🎉`);
    res.redirect('/dashboard');
  });
});

router.get('/login', (req, res) => (req.user ? res.redirect('/dashboard') : res.render('login', { title: 'Masuk' })));
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).render('login', { title: 'Masuk', error: info && info.message, login: req.body.login });
    req.login(user, (e) => (e ? next(e) : res.redirect('/dashboard')));
  })(req, res, next);
});
router.post('/logout', (req, res) => req.logout(() => res.redirect('/')));

const oauthCallback = (provider) => (req, res, next) =>
  passport.authenticate(provider, (err, user, info) => {
    if (err || !user) {
      flash(req, 'error', (info && info.message) || (err && err.message) || 'Login gagal');
      return res.redirect('/login');
    }
    req.login(user, (e) => (e ? next(e) : res.redirect('/dashboard')));
  })(req, res, next);

router.get('/auth/google', (req, res, next) =>
  config.google.clientID ? passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next) : res.redirect('/login'));
router.get('/auth/google/callback', oauthCallback('google'));
router.get('/auth/github', (req, res, next) =>
  config.github.clientID ? passport.authenticate('github')(req, res, next) : res.redirect('/login'));
router.get('/auth/github/callback', oauthCallback('github'));

// ---------- Dashboard ----------
router.get('/dashboard', requireLogin, (req, res) => {
  const uid = req.user.id;
  const stats = {
    depSum: db.prepare("SELECT COALESCE(SUM(get_balance),0) s, COUNT(*) c FROM deposits WHERE user_id=? AND status='success'").get(uid),
    wdSum: db.prepare("SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM withdrawals WHERE user_id=? AND status='success'").get(uid),
    pending: db.prepare("SELECT COUNT(*) c FROM deposits WHERE user_id=? AND status='pending'").get(uid).c,
  };
  const mutations = db.prepare('SELECT * FROM mutations WHERE user_id=? ORDER BY id DESC LIMIT 10').all(uid);
  res.render('dashboard', { title: 'Dashboard', stats, mutations });
});

// ---------- Deposit / Buat QRIS ----------
router.get('/deposit', requireLogin, (req, res) => {
  const list = db.prepare('SELECT * FROM deposits WHERE user_id=? ORDER BY id DESC LIMIT 20').all(req.user.id);
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
  const dep = deposits.findForUser(req.user.id, req.params.reff);
  if (!dep) return res.status(404).render('error', { title: '404', message: 'Deposit tidak ditemukan' });
  const qr = dep.qr_string ? await QRCode.toDataURL(dep.qr_string, { width: 360, margin: 1 }) : null;
  res.render('deposit-detail', { title: 'Bayar QRIS', dep, qr });
});

router.get('/deposit/:reff/status', requireLogin, async (req, res) => {
  let dep = deposits.findForUser(req.user.id, req.params.reff);
  if (!dep) return res.status(404).json({ status: false });
  try {
    dep = await deposits.refreshDeposit(dep);
  } catch (e) { /* abaikan, pakai status lokal */ }
  res.json({ status: true, data: deposits.publicView(dep) });
});

router.post('/deposit/:reff/cancel', requireLogin, async (req, res) => {
  const dep = deposits.findForUser(req.user.id, req.params.reff);
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
  const list = db.prepare('SELECT * FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 20').all(req.user.id);
  res.render('withdraw', { title: 'Tarik Saldo', banks, list });
});

router.post('/withdraw/check', requireLogin, async (req, res) => {
  try {
    const atlantic = require('../atlantic');
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
router.get('/history', requireLogin, (req, res) => {
  const mutations = db.prepare('SELECT * FROM mutations WHERE user_id=? ORDER BY id DESC LIMIT 200').all(req.user.id);
  res.render('history', { title: 'Riwayat Saldo', mutations });
});

// ---------- Developer: API key & webhook ----------
router.get('/developer', requireLogin, (req, res) => {
  const newKey = req.session.newKey;
  delete req.session.newKey;
  res.render('developer', { title: 'Developer', keys: apikeys.listKeys(req.user.id), newKey });
});

router.post('/developer/keys', requireLogin, (req, res) => {
  try {
    req.session.newKey = apikeys.createKey(req.user.id, req.body.name);
    flash(req, 'success', 'API key dibuat. Salin sekarang — hanya ditampilkan sekali!');
  } catch (e) {
    flash(req, 'error', e.message);
  }
  res.redirect('/developer');
});

router.post('/developer/keys/:id/revoke', requireLogin, (req, res) => {
  apikeys.revokeKey(req.user.id, parseInt(req.params.id, 10));
  flash(req, 'success', 'API key dicabut.');
  res.redirect('/developer');
});

router.post('/developer/webhook', requireLogin, (req, res) => {
  const url = String(req.body.webhook_url || '').trim();
  if (url && !isHttpUrl(url)) {
    flash(req, 'error', 'URL webhook harus diawali http:// atau https://');
  } else {
    db.prepare('UPDATE users SET webhook_url=? WHERE id=?').run(url || null, req.user.id);
    if (req.body.regenerate) {
      db.prepare('UPDATE users SET webhook_secret=? WHERE id=?').run(require('crypto').randomBytes(24).toString('hex'), req.user.id);
    }
    flash(req, 'success', 'Pengaturan webhook disimpan.');
  }
  res.redirect('/developer');
});

module.exports = router;
