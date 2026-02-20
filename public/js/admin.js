/* ═══════════════════════════════════════════════
   FluxMail — Admin Panel
   ═══════════════════════════════════════════════ */

let adminToken = localStorage.getItem('fm_admin_token');

// ── Init ──────────────────────────────────────────────
if (adminToken) {
  showDashboard();
} else {
  showLogin();
}

// ── Views ─────────────────────────────────────────────
function showLogin() {
  document.getElementById('adminLoginView').classList.remove('hidden');
  document.getElementById('adminDashboard').classList.add('hidden');
}

function showDashboard() {
  document.getElementById('adminLoginView').classList.add('hidden');
  document.getElementById('adminDashboard').classList.remove('hidden');
  loadStats();
  loadAccounts();
}

// ── API Helper ────────────────────────────────────────
async function adminApi(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      ...options.headers,
    },
  });
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem('fm_admin_token');
    adminToken = null;
    showLogin();
    throw new Error('Сессия истекла');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

// ── Admin Login ──────────────────────────────────────
document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('adminLoginError');
  errEl.classList.add('hidden');

  const password = document.getElementById('adminPass').value;

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Неверный пароль');

    adminToken = data.token;
    localStorage.setItem('fm_admin_token', adminToken);
    showDashboard();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

// ── Admin Logout ─────────────────────────────────────
document.getElementById('adminLogout').addEventListener('click', () => {
  localStorage.removeItem('fm_admin_token');
  adminToken = null;
  showLogin();
});

// ── Tabs ──────────────────────────────────────────────
document.querySelectorAll('.tab[data-tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');

    const target = tab.dataset.tab;
    document.getElementById('tabAccounts').classList.toggle('hidden', target !== 'accounts');
    document.getElementById('tabUpload').classList.toggle('hidden', target !== 'upload');
  });
});

// ── Stats ─────────────────────────────────────────────
async function loadStats() {
  try {
    const data = await adminApi('/api/admin/stats');
    document.getElementById('statTotal').textContent = data.total;
    document.getElementById('statActive').textContent = data.active;
    document.getElementById('statInactive').textContent = data.inactive;
  } catch {}
}

// ── Accounts ──────────────────────────────────────────
let allAccounts = [];

async function loadAccounts() {
  try {
    const data = await adminApi('/api/admin/accounts');
    allAccounts = data.accounts;
    renderAccounts(allAccounts);
  } catch (err) {
    document.getElementById('accountsBody').innerHTML = `<tr><td colspan="6" class="text-center text-muted">${err.message}</td></tr>`;
  }
}

function renderAccounts(accounts) {
  const body = document.getElementById('accountsBody');

  if (accounts.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Нет аккаунтов</td></tr>';
    return;
  }

  body.innerHTML = accounts
    .map(
      (a) => `
    <tr>
      <td>
        <div style="font-weight:500">${escapeHtml(a.email)}</div>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <code style="font-size:.82rem">${escapeHtml(a.user_login)}</code>
          <button class="copy-btn" onclick="copyText('${escapeAttr(a.user_login)}', this)" title="Копировать логин">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <code style="font-size:.82rem">${escapeHtml(a.user_password)}</code>
          <button class="copy-btn" onclick="copyText('${escapeAttr(a.user_password)}', this)" title="Копировать пароль">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
      </td>
      <td>
        <span class="status-badge ${a.active ? 'status-badge--active' : 'status-badge--inactive'}">
          ${a.active ? 'Активен' : 'Неактивен'}
        </span>
      </td>
      <td style="font-size:.78rem;color:var(--text-muted)">${formatDateShort(a.created_at)}</td>
      <td>
        <div class="actions-cell">
          <button class="btn btn-xs btn-outline" onclick="editAccount(${a.id})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-xs btn-danger" onclick="deleteAccount(${a.id}, '${escapeAttr(a.email)}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`
    )
    .join('');
}

// ── Search ────────────────────────────────────────────
document.getElementById('searchAccounts').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  if (!q) return renderAccounts(allAccounts);
  const filtered = allAccounts.filter(
    (a) =>
      a.email.toLowerCase().includes(q) ||
      a.user_login.toLowerCase().includes(q) ||
      (a.display_name || '').toLowerCase().includes(q)
  );
  renderAccounts(filtered);
});

// ── Bulk Upload ───────────────────────────────────────
document.getElementById('bulkUploadBtn').addEventListener('click', async () => {
  const btn = document.getElementById('bulkUploadBtn');
  const textData = document.getElementById('bulkData').value.trim();

  if (!textData) {
    toast('Вставьте данные аккаунтов', 'error');
    return;
  }

  btn.disabled = true;
  btn.querySelector('span').textContent = 'Загружаем…';

  try {
    const data = await adminApi('/api/admin/accounts/bulk', {
      method: 'POST',
      body: JSON.stringify({ data: textData }),
    });

    // Show results
    const resultsEl = document.getElementById('uploadResults');
    resultsEl.classList.remove('hidden');

    document.getElementById('uploadOk').textContent = data.success;
    document.getElementById('uploadFail').textContent = data.failed;

    // Errors
    const errorsEl = document.getElementById('uploadErrors');
    if (data.errors && data.errors.length > 0) {
      errorsEl.classList.remove('hidden');
      errorsEl.innerHTML = data.errors.map((e) => `<div>• ${escapeHtml(e)}</div>`).join('');
    } else {
      errorsEl.classList.add('hidden');
    }

    // Created accounts
    const createdBody = document.getElementById('uploadCreatedBody');
    const createdWrap = document.getElementById('uploadCreated');
    if (data.accounts && data.accounts.length > 0) {
      createdWrap.classList.remove('hidden');
      createdBody.innerHTML = data.accounts
        .map(
          (a) => `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              <code>${escapeHtml(a.login)}</code>
              <button class="copy-btn" onclick="copyText('${escapeAttr(a.login)}', this)" title="Копировать логин">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              <code style="color:var(--success)">${escapeHtml(a.password)}</code>
              <button class="copy-btn" onclick="copyText('${escapeAttr(a.password)}', this)" title="Копировать пароль">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
          </td>
        </tr>`
        )
        .join('');
    } else {
      createdWrap.classList.add('hidden');
    }

    // Refresh data
    loadStats();
    loadAccounts();

    if (data.success > 0) {
      toast(`Загружено ${data.success} аккаунтов`, 'success');
      document.getElementById('bulkData').value = '';
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Загрузить';
  }
});

// ── Edit Account ──────────────────────────────────────
function editAccount(id) {
  const account = allAccounts.find((a) => a.id === id);
  if (!account) return;

  document.getElementById('editId').value = id;
  document.getElementById('editLogin').value = account.user_login;
  document.getElementById('editPassword').value = account.user_password;
  document.getElementById('editName').value = account.display_name || '';
  document.getElementById('editActive').value = account.active ? '1' : '0';

  document.getElementById('editModal').classList.remove('hidden');
}

document.getElementById('closeModal').addEventListener('click', closeEditModal);
document.getElementById('cancelEdit').addEventListener('click', closeEditModal);

document.getElementById('editModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeEditModal();
});

function closeEditModal() {
  document.getElementById('editModal').classList.add('hidden');
}

document.getElementById('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('editId').value;

  try {
    await adminApi(`/api/admin/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        userLogin: document.getElementById('editLogin').value,
        userPassword: document.getElementById('editPassword').value,
        displayName: document.getElementById('editName').value,
        active: document.getElementById('editActive').value === '1',
      }),
    });

    closeEditModal();
    loadAccounts();
    loadStats();
    toast('Аккаунт обновлён', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ── Delete Account ────────────────────────────────────
async function deleteAccount(id, email) {
  if (!confirm(`Удалить аккаунт ${email}?`)) return;

  try {
    await adminApi(`/api/admin/accounts/${id}`, { method: 'DELETE' });
    loadAccounts();
    loadStats();
    toast('Аккаунт удалён', 'info');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Utilities ─────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function copyText(text, btnEl) {
  navigator.clipboard.writeText(text).then(() => {
    toast('Скопировано в буфер обмена', 'success');
    // Visual feedback on button
    if (btnEl) {
      btnEl.classList.add('copied');
      const origHTML = btnEl.innerHTML;
      btnEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => {
        btnEl.classList.remove('copied');
        btnEl.innerHTML = origHTML;
      }, 1200);
    }
  });
}

const TOAST_ICONS = {
  success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
};

function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `
    <span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
    <span class="toast-text">${escapeHtml(message)}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    <div class="toast-progress"></div>
  `;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastSlideOut 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards';
    setTimeout(() => el.remove(), 350);
  }, 3500);
}
