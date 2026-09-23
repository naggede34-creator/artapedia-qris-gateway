const passport = require('passport');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const { db } = require('./db');
const config = require('./config');
const { notify } = require('./telegram');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function roleFor(email) {
  return config.adminEmails.includes(String(email).toLowerCase()) ? 'admin' : 'user';
}

function createUser({ username, email, password, googleId, githubId }, via) {
  const hash = password ? bcrypt.hashSync(password, 10) : null;
  const info = db
    .prepare(
      `INSERT INTO users (username, email, password_hash, google_id, github_id, role, webhook_secret)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(username, email.toLowerCase(), hash, googleId || null, githubId || null, roleFor(email), crypto.randomBytes(24).toString('hex'));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  notify.newUser(user, via);
  return user;
}

function uniqueUsername(base) {
  let name = String(base || 'user').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 15) || 'user';
  if (name.length < 3) name = name + 'usr';
  let candidate = name;
  while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate)) {
    candidate = name + Math.floor(Math.random() * 10000);
  }
  return candidate;
}

function oauthUser(provider, profile) {
  const col = provider === 'google' ? 'google_id' : 'github_id';
  let user = db.prepare(`SELECT * FROM users WHERE ${col} = ?`).get(String(profile.id));
  if (user) return user;
  const email = profile.emails && profile.emails[0] && profile.emails[0].value;
  if (!email) throw new Error(`Akun ${provider} kamu tidak punya email publik/terverifikasi`);
  user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (user) {
    db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(String(profile.id), user.id);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }
  const base = profile.username || (profile.displayName || '').replace(/\s+/g, '') || email.split('@')[0];
  return createUser(
    { username: uniqueUsername(base), email, [provider === 'google' ? 'googleId' : 'githubId']: String(profile.id) },
    provider === 'google' ? 'Google' : 'GitHub'
  );
}

passport.use(
  new LocalStrategy({ usernameField: 'login' }, (login, password, done) => {
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(login, String(login).toLowerCase());
    if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
      return done(null, false, { message: 'Username/email atau password salah' });
    }
    return done(null, user);
  })
);

if (config.google.clientID) {
  passport.use(
    new GoogleStrategy(
      { ...config.google, callbackURL: `${config.baseUrl}/auth/google/callback` },
      (at, rt, profile, done) => {
        try {
          done(null, oauthUser('google', profile));
        } catch (e) {
          done(null, false, { message: e.message });
        }
      }
    )
  );
}
if (config.github.clientID) {
  passport.use(
    new GitHubStrategy(
      { ...config.github, callbackURL: `${config.baseUrl}/auth/github/callback`, scope: ['user:email'] },
      (at, rt, profile, done) => {
        try {
          done(null, oauthUser('github', profile));
        } catch (e) {
          done(null, false, { message: e.message });
        }
      }
    )
  );
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => done(null, db.prepare('SELECT * FROM users WHERE id = ?').get(id) || false));

module.exports = { passport, createUser, USERNAME_RE, roleFor };
