// Klien Atlantic H2H (https://atlantich2h.com) - semua request POST x-www-form-urlencoded
const axios = require('axios');
const qs = require('qs');
const config = require('./config');

const http = axios.create({
  baseURL: config.atlantic.baseUrl,
  timeout: 30000,
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});

class AtlanticError extends Error {
  constructor(message, raw) {
    super(message);
    this.raw = raw;
  }
}

async function call(endpoint, params = {}) {
  if (!config.atlantic.apiKey) throw new AtlanticError('ATLANTIC_API_KEY belum diisi di .env');
  let res;
  try {
    res = await http.post(endpoint, qs.stringify({ api_key: config.atlantic.apiKey, ...params }));
  } catch (err) {
    const body = err.response && err.response.data;
    throw new AtlanticError((body && body.message) || err.message || 'Gagal menghubungi Atlantic', body);
  }
  const body = res.data || {};
  const ok = body.status === true || body.status === 'true';
  if (!ok) throw new AtlanticError(body.message || 'Atlantic menolak permintaan', body);
  return body.data;
}

module.exports = {
  AtlanticError,
  // Deposit
  createDeposit: (reffId, nominal) =>
    call('/deposit/create', { reff_id: reffId, nominal, type: 'ewallet', metode: 'qris' }),
  depositStatus: (id) => call('/deposit/status', { id }),
  cancelDeposit: (id) => call('/deposit/cancel', { id }),
  instantDeposit: (id, action) => call('/deposit/instant', { id, action: action ? 'true' : 'false' }),
  depositMethods: () => call('/deposit/metode', { type: 'ewallet', metode: 'qris' }),
  // Transfer / penarikan
  bankList: () => call('/transfer/bank_list'),
  checkAccount: (bankCode, accountNumber) =>
    call('/transfer/cek_rekening', { bank_code: bankCode, account_number: accountNumber }),
  createTransfer: (p) =>
    call('/transfer/create', {
      ref_id: p.refId,
      kode_bank: p.bankCode,
      nomor_akun: p.accountNumber,
      nama_pemilik: p.accountName,
      nominal: p.amount,
      email: p.email || '',
      phone: p.phone || '',
      note: p.note || '',
    }),
  transferStatus: (id) => call('/transfer/status', { id }),
  profile: () => call('/get_profile'),
};
