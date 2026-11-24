import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { flags, runtimes } from './stats.js';

const API = 'https://iot.controlmyspa.com/web';
const { CMS_EMAIL, CMS_PASSWORD, NTFY_URL } = process.env;
const POLL_MS = Number(process.env.POLL_SECONDS || 60) * 1000;
if (!CMS_EMAIL || !CMS_PASSWORD) { console.error('CMS_EMAIL et CMS_PASSWORD requis (voir .env.example)'); process.exit(1); }

mkdirSync('data', { recursive: true });
const db = new DatabaseSync('data/spa.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS samples(ts INTEGER, spa TEXT, state TEXT, c8z TEXT);
  CREATE INDEX IF NOT EXISTS samples_spa_ts ON samples(spa, ts);
  CREATE TABLE IF NOT EXISTS events(ts INTEGER, spa TEXT, msg TEXT);
  CREATE TABLE IF NOT EXISTS spas(id TEXT PRIMARY KEY, serial TEXT, model TEXT);
`);

let token = null;
// shortcut: corps/réponse du login supposés {email,password} -> {data:{accessToken}}; à confirmer au premier lancement.
async function login() {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: CMS_EMAIL, password: CMS_PASSWORD }) });
  const j = await r.json().catch(() => ({}));
  const d = j.data ?? j;
  token = d.accessToken ?? d.access_token ?? d.token;
  if (!r.ok || !token) throw new Error(`login refusé (${r.status}): ${j.message ?? 'réponse inattendue, clés: ' + Object.keys(d)}`);
}
async function get(path, retry = true) {
  if (!token) await login();
  const r = await fetch(API + path, { headers: { authorization: 'Bearer ' + token } });
  if (r.status === 401 && retry) { token = null; return get(path, false); }
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return (await r.json()).data;
}

function event(spa, msg) {
  db.prepare('INSERT INTO events VALUES(?,?,?)').run(Date.now(), spa, msg);
  console.log(new Date().toISOString(), spa, msg);
  if (NTFY_URL) fetch(NTFY_URL, { method: 'POST', body: `${spa}: ${msg}` }).catch(() => {});
}

const last = {}; // dernier état connu par spa, pour détecter les changements
async function poll() {
  try {
    const { spas } = await get('/spas?page=0&pageSize=100');
    for (const s of spas) {
      db.prepare('INSERT OR REPLACE INTO spas VALUES(?,?,?)').run(s._id, s.serialNumber, s.modelType ?? '');
      const state = await get(`/spas/${s._id}/current-state`);
      const c8z = await get(`/spas/${s._id}/current-c8z`).catch(() => null);
      db.prepare('INSERT INTO samples VALUES(?,?,?,?)').run(Date.now(), s._id, JSON.stringify(state), JSON.stringify(c8z));
      const p = last[s._id], f = flags(state, c8z);
      if (p && p.online !== f.online) event(s._id, f.online ? 'de nouveau en ligne' : 'HORS LIGNE');
      if (p && p.errorCode !== state.errorCode) event(s._id, `code erreur ${p.errorCode} -> ${state.errorCode}`);
      last[s._id] = { online: f.online, errorCode: state.errorCode };
    }
  } catch (e) { console.error(new Date().toISOString(), 'poll:', e.message); }
}
poll(); setInterval(poll, POLL_MS);

const json = (res, o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/spas') {
    return json(res, db.prepare('SELECT * FROM spas').all().map(s => {
      const l = db.prepare('SELECT ts,state,c8z FROM samples WHERE spa=? ORDER BY ts DESC LIMIT 1').get(s.id);
      return { ...s, ts: l?.ts, state: l && JSON.parse(l.state), c8z: l && JSON.parse(l.c8z) };
    }));
  }
  if (u.pathname === '/api/events') return json(res, db.prepare('SELECT * FROM events ORDER BY ts DESC LIMIT 100').all());
  if (u.pathname === '/api/stats') {
    const days = Math.min(Number(u.searchParams.get('days')) || 7, 365);
    const out = {};
    for (const s of db.prepare('SELECT id FROM spas').all()) {
      const rows = db.prepare('SELECT ts,state,c8z FROM samples WHERE spa=? AND ts>? ORDER BY ts').all(s.id, Date.now() - days * 864e5)
        .map(r => ({ ts: r.ts, state: JSON.parse(r.state), c8z: JSON.parse(r.c8z) }));
      out[s.id] = runtimes(rows, POLL_MS * 3);
    }
    return json(out);
  }
  if (u.pathname === '/') return res.setHeader('content-type', 'text/html; charset=utf-8'), res.end(await readFile('public/index.html'));
  res.statusCode = 404; res.end();
}).listen(process.env.PORT || 3000, process.env.HOST || '127.0.0.1', () => console.log('http://' + (process.env.HOST || '127.0.0.1') + ':' + (process.env.PORT || 3000)));
