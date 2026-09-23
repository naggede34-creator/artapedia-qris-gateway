const crypto = require('crypto');
const config = require('./config');

const randomId = (prefix, len = 10) =>
  prefix + Date.now().toString(36).toUpperCase() + crypto.randomBytes(len).toString('hex').slice(0, len).toUpperCase();

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Jam sekarang di zona waktu yang dikonfigurasi (default WIB). */
function nowInTz() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.rules.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parseInt(parts.find((p) => p.type === t).value, 10);
  return { hour: get('hour') % 24, minute: get('minute') };
}

function isWithdrawOpen() {
  const { hour } = nowInTz();
  return hour >= config.rules.withdrawOpenHour && hour < config.rules.withdrawCloseHour;
}

const withdrawHoursText = () =>
  `${String(config.rules.withdrawOpenHour).padStart(2, '0')}:00 - ${String(config.rules.withdrawCloseHour).padStart(2, '0')}:00 WIB`;

const toInt = (v) => {
  const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : NaN;
};

const isHttpUrl = (s) => {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

module.exports = { randomId, sha256, nowInTz, isWithdrawOpen, withdrawHoursText, toInt, isHttpUrl };
