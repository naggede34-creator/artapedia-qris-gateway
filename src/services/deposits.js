const { db, changeBalance } = require('../db');
const atlantic = require('../atlantic');
const config = require('../config');
const { notify } = require('../telegram');
const { randomId } = require('../utils');
const { sendMerchantWebhook } = require('./merchantWebhook');

const FINAL_FAIL = ['cancel', 'canceled', 'cancelled', 'expired', 'failed', 'gagal'];

const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

function publicView(d) {
  return {
    id: d.reff_id,
    merchant_ref: d.merchant_ref,
    nominal: d.nominal,
    fee: d.fee,
    amount_received: d.get_balance,
    qr_string: d.qr_string,
    qr_image: d.qr_image,
    status: d.status,
    source: d.source,
    created_at: d.created_at,
    expired_at: d.expired_at,
    paid_at: d.paid_at,
  };
}

async function createDeposit(user, nominal, opts = {}) {
  const { depositMin, depositMax } = config.rules;
  if (!Number.isInteger(nominal) || nominal < depositMin || nominal > depositMax) {
    throw new Error(`Nominal deposit minimal Rp ${depositMin.toLocaleString('id-ID')} dan maksimal Rp ${depositMax.toLocaleString('id-ID')}`);
  }
  if (opts.merchantRef) {
    const dup = db.prepare('SELECT id FROM deposits WHERE user_id = ? AND merchant_ref = ?').get(user.id, opts.merchantRef);
    if (dup) throw new Error('merchant_ref sudah pernah dipakai');
  }
  const reffId = randomId('DEP');
  const data = await atlantic.createDeposit(reffId, nominal);
  db.prepare(
    `INSERT INTO deposits (user_id, reff_id, merchant_ref, atl_id, nominal, qr_string, qr_image, status, source, callback_url, expired_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    user.id,
    reffId,
    opts.merchantRef || null,
    data.id,
    parseInt(data.nominal, 10) || nominal,
    data.qr_string || null,
    data.qr_image || null,
    'pending',
    opts.source || 'web',
    opts.callbackUrl || null,
    data.expired_at || null
  );
  const dep = db.prepare('SELECT * FROM deposits WHERE reff_id = ?').get(reffId);
  notify.depositPending(dep, user);
  return dep;
}

/** Sinkronkan status deposit dari Atlantic. Aman dipanggil berkali-kali (tidak double kredit). */
async function refreshDeposit(dep) {
  if (dep.status !== 'pending') return dep;
  const data = await atlantic.depositStatus(dep.atl_id);
  const status = String(data.status || '').toLowerCase();

  if (status === 'success') {
    const fee = parseInt(data.fee, 10) || 0;
    const credit = parseInt(data.get_balance, 10) || Math.max(0, dep.nominal - fee);
    const done = db.transaction(() => {
      const r = db
        .prepare("UPDATE deposits SET status='success', fee=?, get_balance=?, paid_at=datetime('now') WHERE id=? AND status='pending'")
        .run(fee, credit, dep.id);
      if (r.changes !== 1) return false;
      changeBalance(dep.user_id, credit, 'deposit', `Deposit QRIS ${dep.reff_id}`);
      return true;
    })();
    const fresh = db.prepare('SELECT * FROM deposits WHERE id = ?').get(dep.id);
    if (done) {
      notify.depositSuccess(fresh, getUser(dep.user_id));
      sendMerchantWebhook(dep.user_id, 'deposit.success', publicView(fresh), fresh.callback_url);
    }
    return fresh;
  }

  if (FINAL_FAIL.includes(status)) {
    const newStatus = status === 'expired' ? 'expired' : status.startsWith('cancel') ? 'cancel' : 'failed';
    const r = db.prepare("UPDATE deposits SET status=? WHERE id=? AND status='pending'").run(newStatus, dep.id);
    const fresh = db.prepare('SELECT * FROM deposits WHERE id = ?').get(dep.id);
    if (r.changes === 1) sendMerchantWebhook(dep.user_id, `deposit.${newStatus}`, publicView(fresh), fresh.callback_url);
    return fresh;
  }
  return dep;
}

async function cancelDeposit(dep) {
  if (dep.status !== 'pending') throw new Error('Deposit tidak dalam status pending');
  await atlantic.cancelDeposit(dep.atl_id);
  db.prepare("UPDATE deposits SET status='cancel' WHERE id=? AND status='pending'").run(dep.id);
  const fresh = db.prepare('SELECT * FROM deposits WHERE id = ?').get(dep.id);
  sendMerchantWebhook(dep.user_id, 'deposit.cancel', publicView(fresh), fresh.callback_url);
  return fresh;
}

const findForUser = (userId, id) =>
  db.prepare('SELECT * FROM deposits WHERE user_id = ? AND (reff_id = ? OR merchant_ref = ?)').get(userId, id, id);

module.exports = { createDeposit, refreshDeposit, cancelDeposit, publicView, findForUser };
