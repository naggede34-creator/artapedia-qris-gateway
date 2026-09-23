// REST API publik untuk developer (web/bot) - base: /api/v1
const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const config = require('../config');
const atlantic = require('../atlantic');
const { apiAuth } = require('../middleware');
const deposits = require('../services/deposits');
const withdrawals = require('../services/withdrawals');
const { toInt, isHttpUrl, isWithdrawOpen, withdrawHoursText } = require('../utils');

const router = express.Router();

router.use(rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false,
  message: { status: false, code: 429, message: 'Terlalu banyak request, coba lagi sebentar' } }));

const ok = (res, data) => res.json({ status: true, code: 200, data });
const bad = (res, message, code = 400) => res.status(code).json({ status: false, code, message });
const field = (req, name) => (req.body && req.body[name] !== undefined ? req.body[name] : req.query[name]);
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    bad(res, e.message || 'Terjadi kesalahan');
  }
};

router.get('/info', (req, res) =>
  ok(res, {
    deposit_min: config.rules.depositMin,
    deposit_max: config.rules.depositMax,
    withdraw_min: config.rules.withdrawMin,
    withdraw_fee: config.rules.withdrawFee,
    withdraw_hours: withdrawHoursText(),
    withdraw_open: isWithdrawOpen(),
  })
);

router.use(apiAuth);

const profile = async (req, res) => {
  ok(res, await db.get('SELECT username, balance, created_at FROM users WHERE id=?', req.apiUser.id));
};
router.get('/profile', profile);
router.post('/profile', profile);
router.get('/balance', profile);

// ----- Deposit / QRIS -----
router.post('/deposit/create', wrap(async (req, res) => {
  const callbackUrl = field(req, 'callback_url');
  if (callbackUrl && !isHttpUrl(callbackUrl)) return bad(res, 'callback_url tidak valid');
  const merchantRef = field(req, 'merchant_ref') ? String(field(req, 'merchant_ref')).slice(0, 64) : null;
  const dep = await deposits.createDeposit(req.apiUser, toInt(field(req, 'nominal')), {
    source: 'api',
    merchantRef,
    callbackUrl: callbackUrl || null,
  });
  ok(res, deposits.publicView(dep));
}));

router.post('/deposit/status', wrap(async (req, res) => {
  let dep = await deposits.findForUser(req.apiUser.id, String(field(req, 'id') || ''));
  if (!dep) return bad(res, 'Deposit tidak ditemukan', 404);
  try {
    dep = await deposits.refreshDeposit(dep);
  } catch (e) { /* pakai status lokal */ }
  ok(res, deposits.publicView(dep));
}));

router.post('/deposit/cancel', wrap(async (req, res) => {
  const dep = await deposits.findForUser(req.apiUser.id, String(field(req, 'id') || ''));
  if (!dep) return bad(res, 'Deposit tidak ditemukan', 404);
  ok(res, deposits.publicView(await deposits.cancelDeposit(dep)));
}));

router.get('/deposit/list', async (req, res) => {
  const limit = Math.min(100, toInt(req.query.limit) || 20);
  const rows = await db.all('SELECT * FROM deposits WHERE user_id=? ORDER BY id DESC LIMIT ?', req.apiUser.id, limit);
  ok(res, rows.map(deposits.publicView));
});

// ----- Penarikan -----
router.get('/withdraw/banks', wrap(async (req, res) => ok(res, await withdrawals.bankList())));
router.post('/withdraw/banks', wrap(async (req, res) => ok(res, await withdrawals.bankList())));

router.post('/withdraw/check-account', wrap(async (req, res) => {
  const bank = String(field(req, 'bank_code') || '');
  const acc = String(field(req, 'account_number') || '').replace(/[^\d]/g, '');
  if (!bank || !acc) return bad(res, 'bank_code dan account_number wajib diisi');
  ok(res, await atlantic.checkAccount(bank, acc));
}));

router.post('/withdraw/create', wrap(async (req, res) => {
  const w = await withdrawals.createWithdrawal(req.apiUser, {
    bankCode: field(req, 'bank_code'),
    accountNumber: field(req, 'account_number'),
    amount: toInt(field(req, 'amount')),
    merchantRef: field(req, 'merchant_ref') ? String(field(req, 'merchant_ref')).slice(0, 64) : null,
    source: 'api',
  });
  if (w.status === 'failed') return bad(res, `Penarikan gagal: ${w.note || 'ditolak'}. Saldo dikembalikan.`);
  ok(res, withdrawals.publicView(w));
}));

router.post('/withdraw/status', wrap(async (req, res) => {
  let w = await withdrawals.findForUser(req.apiUser.id, String(field(req, 'id') || ''));
  if (!w) return bad(res, 'Penarikan tidak ditemukan', 404);
  try {
    if (w.atl_id) w = await withdrawals.refreshWithdrawal(w);
  } catch (e) { /* pakai status lokal */ }
  ok(res, withdrawals.publicView(w));
}));

router.get('/withdraw/list', async (req, res) => {
  const limit = Math.min(100, toInt(req.query.limit) || 20);
  const rows = await db.all('SELECT * FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT ?', req.apiUser.id, limit);
  ok(res, rows.map(withdrawals.publicView));
});

router.get('/mutations', async (req, res) => {
  const limit = Math.min(200, toInt(req.query.limit) || 50);
  ok(res, await db.all('SELECT type, amount, balance_after, description, created_at FROM mutations WHERE user_id=? ORDER BY id DESC LIMIT ?', req.apiUser.id, limit));
});

router.use((req, res) => bad(res, 'Endpoint tidak ditemukan', 404));

module.exports = router;
