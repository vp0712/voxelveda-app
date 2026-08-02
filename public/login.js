async function redirectSavedSession() {
  const token = localStorage.getItem('token');
  const role = String(localStorage.getItem('role') || '').trim().toLowerCase();
  const user = localStorage.getItem('user');

  if (!token || !role || !user) return false;

  try {
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Saved session is no longer valid');
    window.location.replace(role === 'admin' ? '/admin' : '/dashboard');
    return true;
  } catch {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('role');
    return false;
  }
}

function safeReturnTo(role) {
  const value = new URLSearchParams(window.location.search).get('returnTo');
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return role === 'admin' ? '/admin' : '/dashboard';
  }
  if (role !== 'admin' && value.startsWith('/admin')) return '/dashboard';
  return value;
}

function showLoginMessageFromUrl() {
  const loginStatus = document.getElementById('loginStatus');
  if (!loginStatus) return;

  const message = new URLSearchParams(window.location.search).get('message');
  if (!message) return;

  loginStatus.innerText = message;
  loginStatus.style.color = '#facc15';

  const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
  window.history.replaceState({}, document.title, cleanUrl);
}

async function login() {
  const loginStatus = document.getElementById('loginStatus');
  const email = document.getElementById('email')?.value.trim();
  const password = document.getElementById('password')?.value.trim();

  if (!email || !password) {
    loginStatus.innerText = 'Email and password are required.';
    loginStatus.style.color = '#f87171';
    return;
  }

  loginStatus.innerText = 'Authenticating...';
  loginStatus.style.color = '#00d5ff';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      loginStatus.innerText = data.message || 'Login failed.';
      loginStatus.style.color = '#f87171';
      return;
    }

    if (!data.token || !data.user || !data.user.role) {
      loginStatus.innerText = 'Login response missing token/user/role.';
      loginStatus.style.color = '#f87171';
      return;
    }

    const role = String(data.user.role).trim().toLowerCase();

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify({ ...data.user, role }));
    localStorage.setItem('role', role);

    loginStatus.innerText = 'Login successful. Redirecting...';
    loginStatus.style.color = '#22c55e';

    window.location.href = safeReturnTo(role);
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    loginStatus.innerText = 'Server error. Check backend terminal.';
    loginStatus.style.color = '#f87171';
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    login();
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const explicitMessage = params.get('message');
  if (!explicitMessage && await redirectSavedSession()) return;
  showLoginMessageFromUrl();
});
