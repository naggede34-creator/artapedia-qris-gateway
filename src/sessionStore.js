const session = require('express-session');
const { db } = require('./db');

class SqliteStore extends session.Store {
  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?').get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (e) {
      cb(e);
    }
  }
  set(sid, sess, cb) {
    try {
      const maxAge = (sess.cookie && sess.cookie.maxAge) || 86400000;
      db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expires) VALUES (?,?,?)').run(sid, JSON.stringify(sess), Date.now() + maxAge);
      cb && cb(null);
    } catch (e) {
      cb && cb(e);
    }
  }
  destroy(sid, cb) {
    db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    cb && cb(null);
  }
  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

module.exports = SqliteStore;
