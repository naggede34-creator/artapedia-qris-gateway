const session = require('express-session');
const { db } = require('./db');

// Menyimpan sesi login di database (bukan memori) supaya tetap login di semua instance serverless.
class DbStore extends session.Store {
  get(sid, cb) {
    db.get('SELECT sess, expires FROM sessions WHERE sid = ?', sid)
      .then((row) => cb(null, row && row.expires >= Date.now() ? JSON.parse(row.sess) : null))
      .catch(cb);
  }
  set(sid, sess, cb) {
    const maxAge = (sess.cookie && sess.cookie.maxAge) || 86400000;
    db.run('INSERT OR REPLACE INTO sessions (sid, sess, expires) VALUES (?,?,?)', sid, JSON.stringify(sess), Date.now() + maxAge)
      .then(() => cb && cb(null))
      .catch((e) => cb && cb(e));
  }
  destroy(sid, cb) {
    db.run('DELETE FROM sessions WHERE sid = ?', sid)
      .then(() => cb && cb(null))
      .catch((e) => cb && cb(e));
  }
  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

module.exports = DbStore;
