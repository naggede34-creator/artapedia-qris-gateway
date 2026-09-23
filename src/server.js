const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { db } = require('./db');
const { passport } = require('./auth');
const SqliteStore = require('./sessionStore');
const { locals, csrf } = require('./middleware');
const deposits = require('./services/deposits');
const withdrawals = require('./services/withdrawals');
const { rupiah } = require('./telegram');
const worker = require('./worker');

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.locals.rupiah = rupiah;
app.locals.appName = 'Artapedia QRIS Gateway';

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
      },
    },
  })
);
app.use('/public', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// ---------- API publik (tanpa session/cookie) ----------
app.use('/api/v1', require('./routes/api'));

// ---------- Webhook dari Atlantic ----------
// Payload tidak dipercaya mentah-mentah: status selalu diverifikasi ulang ke API Atlantic.
app.post('/webhook/atlantic', rateLimit({ windowMs: 60000, limit: 300 }), async (req, res) => {
  res.json({ status: true });
  try {
    const b = req.body || {};
    const d = b.data || b;
    const ids = [d.id, d.reff_id, d.ref_id].filter(Boolean).map(String);
    for (const id of ids) {
      const dep = db.prepare("SELECT * FROM deposits WHERE (atl_id=? OR reff_id=?) AND status='pending'").get(id, id);
      if (dep) await deposits.refreshDeposit(dep);
      const wd = db.prepare("SELECT * FROM withdrawals WHERE (atl_id=? OR ref_id=?) AND status IN ('pending','processing')").get(id, id);
      if (wd) await withdrawals.refreshWithdrawal(wd);
    }
  } catch (e) {
    console.error('[webhook atlantic]', e.message);
  }
});

// ---------- Web ----------
app.use(
  session({
    store: new SqliteStore(),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.baseUrl.startsWith('https'), maxAge: 7 * 86400000 },
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(locals);
app.use(['/login', '/register'], rateLimit({ windowMs: 15 * 60000, limit: 20, skip: (req) => req.method !== 'POST' }));
app.use(csrf);

app.use('/', require('./routes/web'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).render('error', { title: '404', message: 'Halaman tidak ditemukan' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: 'Terjadi kesalahan pada server' });
});

if (require.main === module) {
  if (!config.atlantic.apiKey) console.warn('⚠️  ATLANTIC_API_KEY belum diisi di .env');
  if (config.sessionSecret === 'dev-secret-change-me') console.warn('⚠️  SESSION_SECRET masih default, ganti di .env');
  app.listen(config.port, () => console.log(`🚀 Artapedia QRIS Gateway jalan di ${config.baseUrl} (port ${config.port})`));
  worker.start();
}

module.exports = app;
