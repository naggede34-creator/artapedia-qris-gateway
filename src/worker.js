// Pengecekan status otomatis untuk deposit & penarikan yang masih pending.
// - Server biasa (VPS/lokal): jalan sendiri tiap POLL_INTERVAL detik
// - Vercel: dipanggil lewat URL /cron/tick (cron-job.org tiap 1 menit) + otomatis saat ada pengunjung
const { db } = require('./db');
const config = require('./config');
const deposits = require('./services/deposits');
const withdrawals = require('./services/withdrawals');

let running = null;
let lastRun = 0;

async function runLimited(items, limit, deadline, fn) {
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length && Date.now() < deadline) {
      const item = items[i++];
      try {
        await fn(item);
      } catch (e) {
        console.error('[worker]', item.reff_id || item.ref_id, e.message);
      }
    }
  });
  await Promise.all(workers);
}

async function doTick() {
  const deadline = Date.now() + 40000; // aman untuk batas waktu fungsi Vercel
  const deps = await db.all(
    "SELECT * FROM deposits WHERE status='pending' AND created_at > datetime('now','-2 days') ORDER BY id LIMIT 100"
  );
  await runLimited(deps, 5, deadline, deposits.refreshDeposit);
  // Deposit yang terlalu lama pending dianggap kedaluwarsa
  await db.run("UPDATE deposits SET status='expired' WHERE status='pending' AND created_at <= datetime('now','-2 days')");

  const wds = await db.all(
    "SELECT * FROM withdrawals WHERE status IN ('pending','processing') AND atl_id IS NOT NULL ORDER BY id LIMIT 100"
  );
  await runLimited(wds, 5, deadline, withdrawals.refreshWithdrawal);
  await db.run('DELETE FROM sessions WHERE expires < ?', Date.now());
  return { deposits: deps.length, withdrawals: wds.length };
}

/** Jalankan satu putaran pengecekan (tidak dobel jika sedang berjalan). */
function tick() {
  if (!config.atlantic.apiKey) return Promise.resolve({ skipped: 'ATLANTIC_API_KEY kosong' });
  if (!running) {
    lastRun = Date.now();
    running = doTick().finally(() => (running = null));
  }
  return running;
}

/** Dipanggil saat ada pengunjung: jalankan tick jika sudah lewat intervalnya. */
function tickIfDue() {
  if (Date.now() - lastRun < config.pollInterval * 1000) return null;
  return tick();
}

function start() {
  setInterval(() => tick().catch((e) => console.error('[worker]', e.message)), config.pollInterval * 1000);
  setTimeout(() => tick().catch((e) => console.error('[worker]', e.message)), 5000);
}

module.exports = { start, tick, tickIfDue };
