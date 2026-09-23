const { db, changeBalance } = require('../db');
const atlantic = require('../atlantic');
const config = require('../config');
const { notify } = require('../telegram');
const { randomId, isWithdrawOpen, withdrawHoursText } = require('../utils');
const { background } = require('../background');
const { sendMerchantWebhook } = require('./merchantWebhook');

const FAIL = ['failed', 'gagal', 'cancel', 'canceled', 'cancelled', 'refund', 'error', 'rejected'];

const getUser = (id) => db.get('SELECT * FROM users WHERE id = ?', id);
const getW = (id) => db.get('SELECT * FROM withdrawals WHERE id = ?', id);

function publicView(w) {
  return {
    id: w.ref_id,
    merchant_ref: w.merchant_ref,
    bank_code: w.bank_code,
    account_number: w.account_number,
    account_name: w.account_name,
    amount: w.amount,
    admin_fee: w.admin_fee,
    total: w.total,
    status: w.status,
    source: w.source,
    created_at: w.created_at,
    done_at: w.done_at,
  };
}

let bankCache = { at: 0, data: [] };
async function bankList() {
  if (Date.now() - bankCache.at < 6 * 3600 * 1000 && bankCache.data.length) return bankCache.data;
  const data = await atlantic.bankList();
  bankCache = { at: Date.now(), data: Array.isArray(data) ? data : [] };
  return bankCache.data;
}

async function failAndRefund(w, reason) {
  const refunded = await db.tx(async (t) => {
    const r = await t.run(
      "UPDATE withdrawals SET status='failed', note=?, done_at=datetime('now') WHERE id=? AND status IN ('pending','processing')",
      String(reason || '').slice(0, 250), w.id
    );
    if (r.changes !== 1) return false;
    await changeBalance(t, w.user_id, w.total, 'refund', `Refund penarikan ${w.ref_id}`);
    return true;
  });
  const fresh = await getW(w.id);
  if (refunded) {
    background(notify.withdrawFailed(fresh, await getUser(w.user_id), reason));
    background(sendMerchantWebhook(w.user_id, 'withdraw.failed', publicView(fresh)));
  }
  return fresh;
}

async function markSuccess(w) {
  const r = await db.run(
    "UPDATE withdrawals SET status='success', done_at=datetime('now') WHERE id=? AND status IN ('pending','processing')",
    w.id
  );
  const fresh = await getW(w.id);
  if (r.changes === 1) {
    background(notify.withdrawSuccess(fresh, await getUser(w.user_id)));
    background(sendMerchantWebhook(w.user_id, 'withdraw.success', publicView(fresh)));
  }
  return fresh;
}

async function createWithdrawal(user, p) {
  const { withdrawMin, withdrawFee } = config.rules;
  if (!isWithdrawOpen()) throw new Error(`Penarikan hanya dibuka pukul ${withdrawHoursText()}`);
  const amount = p.amount;
  if (!Number.isInteger(amount) || amount < withdrawMin) {
    throw new Error(`Minimal penarikan Rp ${withdrawMin.toLocaleString('id-ID')}`);
  }
  const bankCode = String(p.bankCode || '').trim();
  const accountNumber = String(p.accountNumber || '').replace(/[^\d]/g, '');
  if (!bankCode || accountNumber.length < 5) throw new Error('Kode bank / nomor rekening tidak valid');
  if (p.merchantRef) {
    const dup = await db.get('SELECT id FROM withdrawals WHERE user_id = ? AND merchant_ref = ?', user.id, p.merchantRef);
    if (dup) throw new Error('merchant_ref sudah pernah dipakai');
  }

  // Validasi rekening otomatis & ambil nama pemilik
  const acc = await atlantic.checkAccount(bankCode, accountNumber);
  if (acc && acc.status && String(acc.status).toLowerCase() !== 'valid') throw new Error('Rekening tujuan tidak valid');
  const accountName = (acc && acc.nama_pemilik) || p.accountName || '-';

  const total = amount + withdrawFee;
  const refId = randomId('WD');
  const id = await db.tx(async (t) => {
    const bal = await changeBalance(t, user.id, -total, 'withdraw', `Penarikan ${refId} (+admin ${withdrawFee})`);
    if (bal === null) throw new Error(`Saldo tidak cukup. Dibutuhkan Rp ${total.toLocaleString('id-ID')} (termasuk biaya admin)`);
    const r = await t.run(
      `INSERT INTO withdrawals (user_id, ref_id, merchant_ref, bank_code, account_number, account_name, amount, admin_fee, total, source)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      user.id, refId, p.merchantRef || null, bankCode, accountNumber, accountName, amount, withdrawFee, total, p.source || 'web'
    );
    return r.lastInsertRowid;
  });

  let w = await getW(id);
  background(notify.withdrawPending(w, user));
  try {
    const data = await atlantic.createTransfer({
      refId,
      bankCode,
      accountNumber,
      accountName,
      amount,
      note: `Withdraw ${refId}`,
    });
    await db.run('UPDATE withdrawals SET atl_id = ? WHERE id = ?', data.id || null, id);
    w = await getW(id);
    const st = String(data.status || '').toLowerCase();
    if (st === 'success') return markSuccess(w);
    if (FAIL.includes(st)) return failAndRefund(w, 'Ditolak oleh penyedia');
    return w;
  } catch (err) {
    return failAndRefund(w, err.message);
  }
}

async function refreshWithdrawal(w) {
  if (!['pending', 'processing'].includes(w.status)) return w;
  const data = await atlantic.transferStatus(w.atl_id || w.ref_id);
  const st = String(data.status || '').toLowerCase();
  if (st === 'success') return markSuccess(w);
  if (FAIL.includes(st)) return failAndRefund(w, `Status penyedia: ${st}`);
  return w;
}

const findForUser = (userId, id) =>
  db.get('SELECT * FROM withdrawals WHERE user_id = ? AND (ref_id = ? OR merchant_ref = ?)', userId, id, id);

module.exports = { createWithdrawal, refreshWithdrawal, publicView, bankList, findForUser };
