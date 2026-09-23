const axios = require('axios');
const config = require('./config');

const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function send(text) {
  const { token, chatId } = config.telegram;
  if (!token || !chatId) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true },
      { timeout: 15000 }
    );
  } catch (err) {
    console.error('[telegram] gagal kirim:', err.response ? JSON.stringify(err.response.data) : err.message);
  }
}

const notify = {
  newUser: (u, via) =>
    send(`🆕 <b>PENGGUNA BARU</b>\n👤 ${esc(u.username)}\n🆔 ID: ${u.id}\n🔑 Daftar via: ${esc(via)}`),
  depositPending: (d, u) =>
    send(
      `⏳ <b>DEPOSIT PENDING</b>\n👤 ${esc(u.username)}\n🧾 ${esc(d.reff_id)}\n💰 ${rupiah(d.nominal)}\n📡 Sumber: ${esc(d.source)}`
    ),
  depositSuccess: (d, u) =>
    send(
      `✅ <b>DEPOSIT BERHASIL</b>\n👤 ${esc(u.username)}\n🧾 ${esc(d.reff_id)}\n💰 Nominal: ${rupiah(d.nominal)}\n💵 Masuk saldo: ${rupiah(d.get_balance)}`
    ),
  withdrawPending: (w, u) =>
    send(
      `⏳ <b>PENARIKAN PENDING</b>\n👤 ${esc(u.username)}\n🧾 ${esc(w.ref_id)}\n🏦 ${esc(w.bank_code)} - ${esc(w.account_number)} (${esc(w.account_name)})\n💰 ${rupiah(w.amount)} (+admin ${rupiah(w.admin_fee)})`
    ),
  withdrawSuccess: (w, u) =>
    send(
      `✅ <b>PENARIKAN BERHASIL</b>\n👤 ${esc(u.username)}\n🧾 ${esc(w.ref_id)}\n🏦 ${esc(w.bank_code)} - ${esc(w.account_number)}\n💰 ${rupiah(w.amount)}`
    ),
  withdrawFailed: (w, u, reason) =>
    send(
      `❌ <b>PENARIKAN GAGAL</b> (saldo dikembalikan)\n👤 ${esc(u.username)}\n🧾 ${esc(w.ref_id)}\n💰 ${rupiah(w.amount)}\n📝 ${esc(reason || '-')}`
    ),
};

module.exports = { send, notify, rupiah };
