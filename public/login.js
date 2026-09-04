async function redirectSavedSession() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Saved session is no longer valid');
    const data = await res.json();
    const savedUser = data.user || {};
    const role = String(savedUser.role || '').toLowerCase();
    localStorage.removeItem('token');
    localStorage.setItem('user', JSON.stringify(savedUser));
    localStorage.setItem('role', role);
    window.location.replace(hasOperationsWorkspaceAccess(role, savedUser) ? '/admin' : '/dashboard');
    return true;
  } catch {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('role');
    return false;
  }
}

function hasOperationsWorkspaceAccess(role, user = {}) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return ['admin', 'super_admin', 'finance_admin', 'finance_user', 'accountant'].includes(normalizedRole)
    || permissions.includes('finance')
    || permissions.includes('tasks');
}

function safeReturnTo(role, user = {}) {
  const operationsAccess = hasOperationsWorkspaceAccess(role, user);
  const value = new URLSearchParams(window.location.search).get('returnTo');
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return operationsAccess ? '/admin' : '/dashboard';
  }
  if (!operationsAccess && value.startsWith('/admin')) return '/dashboard';
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
  const password = document.getElementById('password')?.value;

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

    if (data.mfa_required && data.challenge_token) {
      sessionStorage.setItem('vv_mfa_challenge', data.challenge_token);
      sessionStorage.setItem('vv_mfa_setup', data.mfa_setup_required ? '1' : '0');
      const returnTo = new URLSearchParams(window.location.search).get('returnTo') || '';
      sessionStorage.setItem('vv_mfa_return_to', returnTo);
      window.location.href = `/mfa?setup=${data.mfa_setup_required ? '1' : '0'}`;
      return;
    }

    if (!data.user || !data.user.role) {
      loginStatus.innerText = 'Login response missing user details.';
      loginStatus.style.color = '#f87171';
      return;
    }

    const role = String(data.user.role).trim().toLowerCase();

    localStorage.removeItem('token');
    localStorage.setItem('user', JSON.stringify({ ...data.user, role }));
    localStorage.setItem('role', role);

    loginStatus.innerText = 'Login successful. Redirecting...';
    loginStatus.style.color = '#22c55e';

    window.location.href = data.requires_password_change ? '/security?password_change=required' : safeReturnTo(role, data.user);
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
