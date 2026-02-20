/* ═══════════════════════════════════════════════
   FluxMail — Auth (Login page)
   ═══════════════════════════════════════════════ */

// Redirect if already logged in
if (localStorage.getItem('fm_token')) {
  window.location.href = '/inbox';
}

// Particles
(function initParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.top = Math.random() * 100 + '%';
    p.style.animationDelay = Math.random() * 4 + 's';
    p.style.animationDuration = 3 + Math.random() * 3 + 's';
    container.appendChild(p);
  }
})();

// Login form
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const errEl = document.getElementById('errorMsg');
  const login = document.getElementById('login').value.trim();
  const password = document.getElementById('password').value;

  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Входим…';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Ошибка входа');
    }

    localStorage.setItem('fm_token', data.token);
    localStorage.setItem('fm_account', JSON.stringify(data.account));
    window.location.href = '/inbox';
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    btn.querySelector('span').textContent = 'Войти в почту';
    btn.disabled = false;
  }
});
