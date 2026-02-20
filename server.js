const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fluxmail_secret_' + crypto.randomBytes(16).toString('hex');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'himarra228';
const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'data.json');

// ════════════════════════════════════════════════════════════
//  JSON DATABASE
// ════════════════════════════════════════════════════════════
let db = { accounts: [], nextId: 1 };

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      if (!db.accounts) db.accounts = [];
      if (!db.nextId) db.nextId = db.accounts.length ? Math.max(...db.accounts.map(a => a.id)) + 1 : 1;
    }
  } catch (e) {
    console.error('DB load error:', e.message);
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (e) {
    console.error('DB save error:', e.message);
  }
}

loadDb();

function findAccount(predicate) { return db.accounts.find(predicate) || null; }
function findAccountById(id) { return db.accounts.find(a => a.id === id) || null; }
function allAccounts() { return [...db.accounts].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); }

function insertAccount(data) {
  const account = { id: db.nextId++, ...data, created_at: new Date().toISOString() };
  db.accounts.push(account);
  saveDb();
  return account;
}

function updateAccount(id, updates) {
  const acc = db.accounts.find(a => a.id === id);
  if (!acc) return false;
  Object.assign(acc, updates);
  saveDb();
  return true;
}

function removeAccount(id) {
  const idx = db.accounts.findIndex(a => a.id === id);
  if (idx === -1) return false;
  db.accounts.splice(idx, 1);
  saveDb();
  return true;
}

// ════════════════════════════════════════════════════════════
//  IN-MEMORY CACHE
// ════════════════════════════════════════════════════════════
const cache = new Map();
function getCached(key, maxAgeMs) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < maxAgeMs) return entry.data;
  cache.delete(key);
  return null;
}
function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════
function generatePassword(len = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let pwd = '';
  for (let i = 0; i < len; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd;
}

// ════════════════════════════════════════════════════════════
//  CREDENTIAL PARSER  (auto-detects format)
// ════════════════════════════════════════════════════════════
function parseCredentialLine(line) {
  line = line.trim();
  if (!line) return null;
  const parts = line.split(':');
  if (parts.length < 4) return null;

  // 1. Main email (outlook / hotmail / live / msn)
  let emailIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (/^[^@\s]+@(outlook|hotmail|live|msn)\./i.test(parts[i])) { emailIdx = i; break; }
  }
  if (emailIdx === -1) {
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].includes('@')) { emailIdx = i; break; }
    }
  }
  if (emailIdx === -1) return null;
  const email = parts[emailIdx];

  // 2. Client ID — last UUID
  let clientIdIdx = -1;
  for (let i = parts.length - 1; i > emailIdx; i--) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[i])) { clientIdIdx = i; break; }
  }

  // 3. Refresh token — long field before client_id
  let refreshIdx = -1;
  if (clientIdIdx > 0) {
    refreshIdx = clientIdIdx - 1;
  } else {
    let maxLen = 0;
    for (let i = emailIdx + 1; i < parts.length; i++) {
      if (parts[i].length > maxLen && parts[i].length > 50) { maxLen = parts[i].length; refreshIdx = i; }
    }
  }
  if (refreshIdx === -1) return null;

  const refreshToken = parts[refreshIdx];
  const clientId = clientIdIdx !== -1 ? parts[clientIdIdx] : '';
  const outlookPassword = parts[emailIdx + 1] || '';

  // 4. Recovery email & password (skip)
  let recoveryEmail = null, recoveryPassword = null;
  for (let i = emailIdx + 2; i < refreshIdx; i++) {
    if (parts[i].includes('@') && parts[i] !== email) {
      recoveryEmail = parts[i];
      if (i + 1 < refreshIdx) recoveryPassword = parts[i + 1];
      break;
    }
  }

  return { email, outlookPassword, recoveryEmail, recoveryPassword, refreshToken, clientId };
}

// ════════════════════════════════════════════════════════════
//  OUTLOOK / IMAP  (OAuth 2.0)
// ════════════════════════════════════════════════════════════
async function getAccessToken(account) {
  const cacheKey = `token_${account.id}`;
  const cached = getCached(cacheKey, 45 * 60 * 1000);
  if (cached) return cached;

  const params = new URLSearchParams({
    client_id: account.client_id,
    refresh_token: account.refresh_token,
    grant_type: 'refresh_token',
    scope: 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access',
  });

  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || 'Token refresh failed');

  if (data.refresh_token && data.refresh_token !== account.refresh_token) {
    updateAccount(account.id, { refresh_token: data.refresh_token });
  }

  setCache(cacheKey, data.access_token);
  return data.access_token;
}

async function withImap(account, fn) {
  const accessToken = await getAccessToken(account);
  const client = new ImapFlow({
    host: 'outlook.office365.com', port: 993, secure: true,
    auth: { user: account.email, accessToken },
    logger: false,
  });
  await client.connect();
  try { return await fn(client); }
  finally { await client.logout(); }
}

async function fetchEmailList(account, folder = 'INBOX', page = 1, limit = 50) {
  const cacheKey = `list_${account.id}_${folder}_${page}_${limit}`;
  const cached = getCached(cacheKey, 2 * 60 * 1000);
  if (cached) return cached;

  const result = await withImap(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const total = client.mailbox.exists || 0;
      if (total === 0) return { emails: [], total: 0, page, pages: 0 };
      const end = Math.max(1, total - (page - 1) * limit);
      const start = Math.max(1, end - limit + 1);
      const messages = [];
      for await (const msg of client.fetch(`${start}:${end}`, {
        envelope: true, uid: true, flags: true, internalDate: true,
      })) {
        const from = msg.envelope?.from?.[0] || {};
        messages.push({
          uid: msg.uid,
          subject: msg.envelope?.subject || '(без темы)',
          from: { name: from.name || '', address: from.address || '' },
          to: (msg.envelope?.to || []).map(t => ({ name: t.name || '', address: t.address || '' })),
          date: msg.envelope?.date?.toISOString() || msg.internalDate?.toISOString() || '',
          seen: msg.flags?.has('\\Seen') || false,
          flagged: msg.flags?.has('\\Flagged') || false,
        });
      }
      messages.sort((a, b) => new Date(b.date) - new Date(a.date));
      return { emails: messages, total, page, pages: Math.ceil(total / limit) };
    } finally { lock.release(); }
  });

  setCache(cacheKey, result);
  return result;
}

async function fetchEmailContent(account, uid, folder = 'INBOX') {
  const cacheKey = `email_${account.id}_${folder}_${uid}`;
  const cached = getCached(cacheKey, 10 * 60 * 1000);
  if (cached) return cached;

  const result = await withImap(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const msg = await client.fetchOne(uid,
        { source: true, envelope: true, uid: true, flags: true }, { uid: true });
      if (!msg) throw new Error('Message not found');
      const parsed = await simpleParser(msg.source);
      return {
        uid: msg.uid,
        subject: parsed.subject || '(без темы)',
        from: parsed.from?.value || [],
        to: parsed.to?.value || [],
        cc: parsed.cc?.value || [],
        date: parsed.date?.toISOString() || '',
        html: parsed.html || '',
        text: parsed.text || '',
        attachments: (parsed.attachments || []).map(a => ({
          filename: a.filename, size: a.size, contentType: a.contentType,
        })),
      };
    } finally { lock.release(); }
  });

  setCache(cacheKey, result);
  return result;
}

async function fetchFolders(account) {
  const cacheKey = `folders_${account.id}`;
  const cached = getCached(cacheKey, 5 * 60 * 1000);
  if (cached) return cached;

  const folders = await withImap(account, async (client) => {
    const tree = await client.listTree();
    const list = [];
    (function walk(items) {
      for (const item of items) {
        list.push({ name: item.name, path: item.path, specialUse: item.specialUse || null });
        if (item.folders?.length) walk(item.folders);
      }
    })(tree.folders || []);
    return list;
  });

  setCache(cacheKey, folders);
  return folders;
}

// ════════════════════════════════════════════════════════════
//  MIDDLEWARE
// ════════════════════════════════════════════════════════════
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.isAdmin) return res.status(403).json({ error: 'Use user login' });
    req.user = payload;
    const account = findAccount(a => a.id === payload.accountId && a.active);
    if (!account) return res.status(401).json({ error: 'Account disabled or deleted' });
    req.account = account;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function adminMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.isAdmin) return res.status(403).json({ error: 'Forbidden' });
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════════════════
app.post('/api/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
  const account = findAccount(a => a.user_login === login && a.active);
  if (!account || account.user_password !== password) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const token = jwt.sign({ accountId: account.id, email: account.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    account: {
      id: account.id, email: account.email,
      displayName: account.display_name || account.email.split('@')[0],
      login: account.user_login,
    },
  });
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Неверный пароль' });
  const token = jwt.sign({ isAdmin: true }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token });
});

// ════════════════════════════════════════════════════════════
//  USER ROUTES
// ════════════════════════════════════════════════════════════
app.get('/api/account', authMiddleware, (req, res) => {
  const a = req.account;
  res.json({ id: a.id, email: a.email, displayName: a.display_name || a.email.split('@')[0], login: a.user_login });
});

app.get('/api/emails', authMiddleware, async (req, res) => {
  try {
    const folder = req.query.folder || 'INBOX';
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    res.json(await fetchEmailList(req.account, folder, page, limit));
  } catch (e) {
    console.error('Fetch emails error:', e.message);
    res.status(500).json({ error: 'Ошибка загрузки писем: ' + e.message });
  }
});

app.get('/api/emails/:uid', authMiddleware, async (req, res) => {
  try {
    const uid = parseInt(req.params.uid);
    const folder = req.query.folder || 'INBOX';
    res.json(await fetchEmailContent(req.account, uid, folder));
  } catch (e) {
    console.error('Fetch email error:', e.message);
    res.status(500).json({ error: 'Ошибка загрузки письма: ' + e.message });
  }
});

app.get('/api/folders', authMiddleware, async (req, res) => {
  try { res.json({ folders: await fetchFolders(req.account) }); }
  catch (e) { res.status(500).json({ error: 'Не удалось загрузить папки' }); }
});

// ════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ════════════════════════════════════════════════════════════
app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  const total = db.accounts.length;
  const active = db.accounts.filter(a => a.active).length;
  res.json({ total, active, inactive: total - active });
});

app.get('/api/admin/accounts', adminMiddleware, (req, res) => {
  const accounts = allAccounts().map(a => ({
    id: a.id, email: a.email, user_login: a.user_login, user_password: a.user_password,
    display_name: a.display_name, active: a.active, created_at: a.created_at,
    recovery_email: a.recovery_email, client_id: a.client_id,
  }));
  res.json({ accounts });
});

app.post('/api/admin/accounts/bulk', adminMiddleware, (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'Нет данных' });
  const lines = data.split('\n').filter(l => l.trim());
  const results = { success: 0, failed: 0, errors: [], accounts: [] };

  for (const line of lines) {
    try {
      const parsed = parseCredentialLine(line);
      if (!parsed) { results.failed++; results.errors.push('Не удалось распарсить: ' + line.substring(0, 60) + '…'); continue; }
      if (findAccount(a => a.email === parsed.email)) { results.failed++; results.errors.push('Уже существует: ' + parsed.email); continue; }

      insertAccount({
        email: parsed.email, outlook_password: parsed.outlookPassword,
        recovery_email: parsed.recoveryEmail, recovery_password: parsed.recoveryPassword,
        refresh_token: parsed.refreshToken, client_id: parsed.clientId,
        user_login: parsed.email, user_password: parsed.outlookPassword,
        display_name: parsed.email.split('@')[0], active: true,
      });
      results.success++;
      results.accounts.push({ email: parsed.email, login: parsed.email, password: parsed.outlookPassword });
    } catch (e) { results.failed++; results.errors.push(e.message); }
  }
  res.json(results);
});

app.put('/api/admin/accounts/:id', adminMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  if (!findAccountById(id)) return res.status(404).json({ error: 'Аккаунт не найден' });
  const { userLogin, userPassword, active, displayName } = req.body;
  const u = {};
  if (userLogin !== undefined) u.user_login = userLogin;
  if (userPassword !== undefined) u.user_password = userPassword;
  if (active !== undefined) u.active = !!active;
  if (displayName !== undefined) u.display_name = displayName;
  updateAccount(id, u);
  res.json({ success: true });
});

app.delete('/api/admin/accounts/:id', adminMiddleware, (req, res) => {
  removeAccount(parseInt(req.params.id));
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════
//  PAGE ROUTES
// ════════════════════════════════════════════════════════════
app.get('/inbox', (_r, res) => res.sendFile(path.join(__dirname, 'public', 'inbox.html')));
app.get('/admin', (_r, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ════════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════════
app.listen(PORT, () => console.log(`⚡ FluxMail running → http://localhost:${PORT}`));
