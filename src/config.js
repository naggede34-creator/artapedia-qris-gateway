require('dotenv').config({ quiet: true });

const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));

module.exports = {
  port: int(process.env.PORT, 3000),
  baseUrl: (
    process.env.BASE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : 'http://localhost:3000')
  ).replace(/\/$/, ''),
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  db: {
    url: process.env.TURSO_DATABASE_URL || '',
    authToken: process.env.TURSO_AUTH_TOKEN || '',
  },
  // Kunci rahasia untuk URL cron (cron-job.org) : {BASE_URL}/cron/tick?key=CRON_SECRET
  cronSecret: process.env.CRON_SECRET || '',
  // Kunci untuk membuat akun admin lewat browser di /setup-admin
  adminSetupKey: process.env.ADMIN_SETUP_KEY || '',
  isVercel: !!process.env.VERCEL,
  dbPath: process.env.DB_PATH || require('path').join(__dirname, '..', 'data', 'artapedia.db'),

  atlantic: {
    baseUrl: (process.env.ATLANTIC_BASE_URL || 'https://atlantich2h.com').replace(/\/$/, ''),
    apiKey: process.env.ATLANTIC_API_KEY || '',
  },

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },

  rules: {
    depositMin: int(process.env.DEPOSIT_MIN, 2000),
    depositMax: int(process.env.DEPOSIT_MAX, 10000000),
    withdrawMin: int(process.env.WITHDRAW_MIN, 10000),
    withdrawFee: int(process.env.WITHDRAW_FEE, 2000),
    withdrawOpenHour: int(process.env.WITHDRAW_OPEN_HOUR, 8),
    withdrawCloseHour: int(process.env.WITHDRAW_CLOSE_HOUR, 16),
    timezone: process.env.TIMEZONE || 'Asia/Jakarta',
  },

  pollInterval: int(process.env.POLL_INTERVAL, 20),
};
