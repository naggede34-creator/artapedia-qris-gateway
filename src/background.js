// Menjalankan tugas di belakang layar (notif Telegram, webhook ke developer, dll).
// Di Vercel, fungsi berhenti setelah respon dikirim; waitUntil() menjaga tugas tetap selesai.
const { waitUntil } = require('@vercel/functions');

function background(task) {
  const p = Promise.resolve()
    .then(typeof task === 'function' ? task : () => task)
    .catch((e) => console.error('[background]', e && e.message));
  try {
    waitUntil(p);
  } catch (e) { /* di luar Vercel tidak perlu */ }
  return p;
}

module.exports = { background };
