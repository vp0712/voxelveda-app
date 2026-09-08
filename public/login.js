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

function setLoginStatus(message, tone = 'error') {
  const loginStatus = document.getElementById('loginStatus');
  if (!loginStatus) return;
  const colours = {
    error: '#f87171',
    info: '#38bdf8',
    success: '#22c55e',
    warning: '#facc15'
  };
  loginStatus.innerText = message;
  loginStatus.style.color = colours[tone] || colours.error;
}

function setLoginBusy(busy) {
  const button = document.getElementById('loginButton');
  if (!button) return;
  button.disabled = busy;
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
  button.textContent = busy ? 'Signing In...' : 'Sign In';
}

async function readResponse(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) return {};
  return response.json().catch(() => ({}));
}

async function resolveAuthenticatedUser(loginData) {
  if (loginData?.user?.role) return loginData.user;

  // Cookie-only sessions may return a minimal success body. Confirm the session
  // with the canonical identity endpoint instead of expecting a browser token.
  const response = await fetch('/api/auth/me', {
    credentials: 'same-origin',
    cache: 'no-store'
  });
  if (!response.ok) return null;
  const data = await readResponse(response);
  return data?.user?.role ? data.user : null;
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
  const message = new URLSearchParams(window.location.search).get('message');
  if (!message) return;
  setLoginStatus(message, 'warning');

  const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
  window.history.replaceState({}, document.title, cleanUrl);
}

async function login() {
  const email = document.getElementById('email')?.value.trim();
  const password = document.getElementById('password')?.value;

  if (!email || !password) {
    setLoginStatus('Email and password are required.');
    return;
  }

  setLoginBusy(true);
  setLoginStatus('Authenticating...', 'info');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await readResponse(res);

    if (!res.ok) {
      setLoginStatus(data.message || (res.status === 429
        ? 'Too many sign-in attempts. Please wait and try again.'
        : 'Login failed.'));
      return;
    }

    if (data.mfa_required) {
      if (!data.challenge_token) {
        setLoginStatus('Security verification could not start. Please try again.');
        return;
      }
      sessionStorage.setItem('vv_mfa_challenge', data.challenge_token);
      sessionStorage.setItem('vv_mfa_setup', data.mfa_setup_required ? '1' : '0');
      const returnTo = new URLSearchParams(window.location.search).get('returnTo') || '';
      sessionStorage.setItem('vv_mfa_return_to', returnTo);
      window.location.href = `/mfa?setup=${data.mfa_setup_required ? '1' : '0'}`;
      return;
    }

    const authenticatedUser = await resolveAuthenticatedUser(data);
    if (!authenticatedUser) {
      setLoginStatus('Your account was verified, but the session could not be opened. Please try again.');
      return;
    }

    const role = String(authenticatedUser.role).trim().toLowerCase();

    localStorage.removeItem('token');
    localStorage.setItem('user', JSON.stringify({ ...authenticatedUser, role }));
    localStorage.setItem('role', role);

    setLoginStatus('Login successful. Redirecting...', 'success');

    window.location.href = data.requires_password_change
      ? '/security?password_change=required'
      : safeReturnTo(role, authenticatedUser);
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    setLoginStatus('Unable to reach the secure sign-in service. Check your connection and try again.');
  } finally {
    setLoginBusy(false);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('loginForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    login();
  });
  const params = new URLSearchParams(window.location.search);
  const explicitMessage = params.get('message');
  if (!explicitMessage && await redirectSavedSession()) return;
  showLoginMessageFromUrl();
});
