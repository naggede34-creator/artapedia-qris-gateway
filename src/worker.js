// Pengecekan status otomatis untuk deposit & penarikan yang masih pending
const { db } = require('./db');
const config = require('./config');
const deposits = require('./services/deposits');
const withdrawals = require('./services/withdrawals');

let running = false;

async function tick() {
  if (running || !config.atlantic.apiKey) return;
  running = true;
  try {
    const deps = db
      .prepare("SELECT * FROM deposits WHERE status='pending' AND created_at > datetime('now','-2 days') ORDER BY id LIMIT 100")
      .all();
    for (const d of deps) {
      try {
        await deposits.refreshDeposit(d);
      } catch (e) {
        console.error('[worker] deposit', d.reff_id, e.message);
      }
    }
    // Deposit yang terlalu lama pending dianggap kedaluwarsa
    db.prepare("UPDATE deposits SET status='expired' WHERE status='pending' AND created_at <= datetime('now','-2 days')").run();

    const wds = db
      .prepare("SELECT * FROM withdrawals WHERE status IN ('pending','processing') AND atl_id IS NOT NULL ORDER BY id LIMIT 100")
      .all();
    for (const w of wds) {
      try {
        await withdrawals.refreshWithdrawal(w);
      } catch (e) {
        console.error('[worker] withdraw', w.ref_id, e.message);
      }
    }
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  } finally {
    running = false;
  }
}

function start() {
  setInterval(tick, config.pollInterval * 1000);
  setTimeout(tick, 5000);
}

module.exports = { start, tick };
