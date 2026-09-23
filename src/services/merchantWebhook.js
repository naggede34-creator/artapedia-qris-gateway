// Mengirim callback ke URL webhook milik developer, ditandatangani HMAC-SHA256
const axios = require('axios');
const crypto = require('crypto');
const { db } = require('../db');

async function sendMerchantWebhook(userId, event, data, overrideUrl) {
  const user = await db.get('SELECT webhook_url, webhook_secret FROM users WHERE id = ?', userId);
  const url = overrideUrl || (user && user.webhook_url);
  if (!url || !user) return;
  const body = JSON.stringify({ event, data, sent_at: new Date().toISOString() });
  const signature = crypto.createHmac('sha256', user.webhook_secret || '').update(body).digest('hex');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await axios.post(url, body, {
        timeout: 8000,
        headers: { 'Content-Type': 'application/json', 'X-Artapedia-Event': event, 'X-Artapedia-Signature': signature },
      });
      return;
    } catch (err) {
      if (attempt === 3) console.error(`[webhook] gagal kirim ke ${url}:`, err.message);
      else await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
}

module.exports = { sendMerchantWebhook };
