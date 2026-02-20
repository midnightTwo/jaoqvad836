/* ═══════════════════════════════════════════════
   FluxMail — Inbox (Mail client)
   ═══════════════════════════════════════════════ */

const TOKEN = localStorage.getItem('fm_token');
const ACCOUNT = JSON.parse(localStorage.getItem('fm_account') || 'null');

if (!TOKEN || !ACCOUNT) {
  window.location.href = '/';
}

let currentFolder = 'INBOX';
let currentEmailUid = null;
let refreshTimer = null;

// ── API Helper ────────────────────────────────────────
async function api(path) {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (res.status === 401) {
    localStorage.removeItem('fm_token');
    localStorage.removeItem('fm_account');
    window.location.href = '/';
    return;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

// ── Init ──────────────────────────────────────────────
function init() {
  // User info
  document.getElementById('userName').textContent = ACCOUNT.displayName || ACCOUNT.email;
  document.getElementById('userEmail').textContent = ACCOUNT.email;
  document.getElementById('userAvatar').textContent = (ACCOUNT.displayName || ACCOUNT.email).charAt(0).toUpperCase();

  // Load emails
  loadEmails();

  // Auto-refresh every 60s
  refreshTimer = setInterval(loadEmails, 60000);

  // Event listeners
  setupEvents();
}

// ── Load Emails ───────────────────────────────────────
async function loadEmails() {
  const listEl = document.getElementById('emailList');
  const loadingEl = document.getElementById('emailLoading');
  const emptyEl = document.getElementById('emailEmpty');
  const errorEl = document.getElementById('emailError');

  // Show loading only on first load
  if (!listEl.querySelector('.email-item')) {
    loadingEl.classList.remove('hidden');
  }
  emptyEl.classList.add('hidden');
  errorEl.classList.add('hidden');

  try {
    const data = await api(`/api/emails?folder=${encodeURIComponent(currentFolder)}&limit=50`);
    loadingEl.classList.add('hidden');

    // Remove existing email items
    listEl.querySelectorAll('.email-item').forEach((el) => el.remove());

    if (!data.emails || data.emails.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    // Render emails
    data.emails.forEach((email) => {
      const el = document.createElement('div');
      el.className = 'email-item' + (email.seen ? '' : ' unread');
      if (email.uid === currentEmailUid) el.classList.add('active');
      el.dataset.uid = email.uid;

      const fromName = email.from.name || email.from.address || 'Неизвестный';
      const dateStr = formatDate(email.date);

      el.innerHTML = `
        <div class="email-item-top">
          <div class="email-item-from">${escapeHtml(fromName)}</div>
          <div class="email-item-date">${dateStr}</div>
        </div>
        <div class="email-item-subject">${escapeHtml(email.subject)}</div>
      `;

      el.addEventListener('click', () => openEmail(email.uid));
      listEl.appendChild(el);
    });

    // Update badge
    const unreadCount = data.emails.filter((e) => !e.seen).length;
    const badge = document.getElementById('inboxBadge');
    if (currentFolder === 'INBOX' && unreadCount > 0) {
      badge.textContent = unreadCount;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    loadingEl.classList.add('hidden');
    if (!listEl.querySelector('.email-item')) {
      errorEl.classList.remove('hidden');
      document.getElementById('emailErrorText').textContent = err.message;
    }
  }
}

// ── Open Email ────────────────────────────────────────
async function openEmail(uid) {
  currentEmailUid = uid;

  // Highlight active item
  document.querySelectorAll('.email-item').forEach((el) => {
    el.classList.toggle('active', parseInt(el.dataset.uid) === uid);
    if (parseInt(el.dataset.uid) === uid) {
      el.classList.remove('unread');
    }
  });

  const contentPanel = document.getElementById('emailContentPanel');
  const contentEl = document.getElementById('emailContent');
  const loadingEl = document.getElementById('emailContentLoading');

  contentPanel.classList.remove('hidden');
  contentEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');

  try {
    const data = await api(`/api/emails/${uid}?folder=${encodeURIComponent(currentFolder)}`);
    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    // Subject
    document.getElementById('emailSubjectHeader').textContent = data.subject;

    // From
    const from = data.from[0] || {};
    const fromName = from.name || from.address || '?';
    document.getElementById('emailFromAvatar').textContent = fromName.charAt(0).toUpperCase();
    document.getElementById('emailFromName').textContent = fromName;
    document.getElementById('emailFromAddr').textContent = from.address || '';

    // Date
    document.getElementById('emailDate').textContent = data.date ? new Date(data.date).toLocaleString('ru-RU') : '';

    // To
    const toStr = (data.to || []).map((t) => t.name || t.address).join(', ');
    document.getElementById('emailTo').textContent = toStr || '—';

    // Body
    const iframe = document.getElementById('emailBodyFrame');
    const bodyContent = data.html || `<pre style="font-family:'Inter',-apple-system,sans-serif;white-space:pre-wrap;padding:20px;margin:0;font-size:14px;line-height:1.7;color:#333">${escapeHtml(data.text || 'Нет содержимого')}</pre>`;
    iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:20px;font-family:'Inter',-apple-system,sans-serif;font-size:14px;color:#333;background:#fff;word-break:break-word;line-height:1.6}img{max-width:100%;height:auto}a{color:#6C63FF}table{max-width:100%!important}pre{white-space:pre-wrap}</style></head><body>${bodyContent}</body></html>`;

    // Auto-resize iframe
    iframe.onload = () => {
      try {
        const h = iframe.contentDocument?.body?.scrollHeight;
        if (h) iframe.style.height = Math.max(400, h + 40) + 'px';
      } catch {}
    };

    // Attachments
    const attEl = document.getElementById('emailAttachments');
    const attList = document.getElementById('attachmentsList');
    if (data.attachments && data.attachments.length > 0) {
      attEl.classList.remove('hidden');
      attList.innerHTML = data.attachments
        .map(
          (a) => `
        <div class="attachment-item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          <span>${escapeHtml(a.filename || 'attachment')}</span>
          <span style="color:var(--text-muted);font-size:.75rem">${formatSize(a.size)}</span>
        </div>`
        )
        .join('');
    } else {
      attEl.classList.add('hidden');
    }
  } catch (err) {
    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
    contentEl.innerHTML = `
      <div class="error-state">
        <p>${escapeHtml(err.message)}</p>
        <button class="btn btn-sm btn-outline" onclick="openEmail(${uid})">Повторить</button>
      </div>`;
  }
}

// ── Events ────────────────────────────────────────────
function setupEvents() {
  // Folder navigation
  document.querySelectorAll('.nav-item[data-folder]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const folder = el.dataset.folder;
      if (folder === currentFolder) return;

      document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
      el.classList.add('active');
      currentFolder = folder;
      currentEmailUid = null;

      // Folder names map
      const folderNames = {
        INBOX: 'Входящие',
        Sent: 'Отправленные',
        Drafts: 'Черновики',
        Junk: 'Спам',
      };
      document.getElementById('folderTitle').textContent = folderNames[folder] || folder;

      // Reset content panel
      document.getElementById('emailContentPanel').classList.add('hidden');
      loadEmails();

      // Close sidebar on mobile
      closeSidebar();
    });
  });

  // Refresh
  document.getElementById('refreshBtn').addEventListener('click', () => {
    const btn = document.getElementById('refreshBtn');
    btn.style.animation = 'spin 0.8s linear';
    setTimeout(() => (btn.style.animation = ''), 800);
    // Invalidate cache by adding timestamp
    loadEmails();
  });

  // Back to list (mobile)
  document.getElementById('backToList').addEventListener('click', () => {
    document.getElementById('emailContentPanel').classList.add('hidden');
    currentEmailUid = null;
    document.querySelectorAll('.email-item').forEach((el) => el.classList.remove('active'));
  });

  // Sidebar toggle (mobile)
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.remove('hidden');
  });

  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('fm_token');
    localStorage.removeItem('fm_account');
    window.location.href = '/';
  });
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.add('hidden');
}

// ── Utilities ─────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'только что';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' мин';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' ч';

  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ── Start ─────────────────────────────────────────────
init();
