const crypto = require('crypto');
const { findUserByKey } = require('./services/apikeys');

function flash(req, type, msg) {
  req.session.flash = req.session.flash || [];
  req.session.flash.push({ type, msg });
}

function locals(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  res.locals.user = req.user || null;
  res.locals.flash = req.session.flash || [];
  res.locals.path = req.path;
  req.session.flash = [];
  next();
}

function csrf(req, res, next) {
  if (req.method !== 'POST') return next();
  // multipart diperiksa setelah multer mem-parsing body (lihat csrfStrict)
  if (req.is('multipart/form-data') && !req._multipartParsed) return next();
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!token || !req.session.csrf || token.length !== req.session.csrf.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrf))) {
    if (req.xhr || req.get('accept') === 'application/json') return res.status(403).json({ status: false, message: 'CSRF token tidak valid' });
    flash(req, 'error', 'Sesi kedaluwarsa, silakan coba lagi.');
    return res.redirect(req.get('referer') || '/');
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    flash(req, 'error', 'Silakan login dulu.');
    return res.redirect('/login');
  }
  if (req.user.banned) {
    req.logout(() => {});
    return res.status(403).render('error', { title: 'Akun diblokir', message: 'Akun kamu diblokir. Hubungi admin.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).render('error', { title: '403', message: 'Khusus admin.' });
  next();
}

async function apiAuth(req, res, next) {
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const key = req.get('x-api-key') || bearer || (req.body && req.body.api_key) || req.query.api_key;
  const user = await findUserByKey(key);
  if (!user) return res.status(401).json({ status: false, code: 401, message: 'API key tidak valid atau sudah dicabut' });
  if (user.banned) return res.status(403).json({ status: false, code: 403, message: 'Akun diblokir' });
  req.apiUser = user;
  next();
}

const csrfStrict = (req, res, next) => {
  req._multipartParsed = true;
  csrf(req, res, next);
};

module.exports = { flash, locals, csrf, csrfStrict, requireLogin, requireAdmin, apiAuth };
