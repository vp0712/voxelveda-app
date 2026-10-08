async function createCustomerAccount() {
  const status = document.getElementById('registerStatus');
  const button = document.getElementById('registerButton');
  if (button?.disabled) return;
  const name = document.getElementById('name')?.value.trim();
  const email = document.getElementById('email')?.value.trim();
  const password = document.getElementById('password')?.value;
  const confirmPrivacy = document.getElementById('privacyAccepted')?.checked;

  if (!name || !email || !password) {
    status.innerText = 'Name, email and password are required.';
    status.style.color = 'var(--danger)';
    return;
  }

  if (password.length < 14) {
    status.innerText = 'Password must contain at least 14 characters.';
    status.style.color = 'var(--danger)';
    return;
  }

  if (!confirmPrivacy) {
    status.innerText = 'Please accept the privacy policy first.';
    status.style.color = 'var(--danger)';
    return;
  }

  status.innerText = 'Creating customer account...';
  status.style.color = 'var(--primary)';
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Creating account...';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let created = false;

  try {
    const res = await fetch('/api/auth/customer-register', {
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        password,
        confirm_privacy: confirmPrivacy
      })
    });

    const data = String(res.headers.get('Content-Type') || '').includes('application/json')
      ? await res.json().catch(() => ({})) : {};

    if (!res.ok) {
      status.innerText = data.message || (res.status === 429
        ? 'Too many attempts. Please wait and try again.' : 'Account creation failed. Please try again.');
      status.style.color = 'var(--danger)';
      return;
    }

    status.innerText = data.message || 'Account created. You can login now.';
    status.style.color = 'var(--success)';
    created = true;
    setTimeout(() => {
      window.location.href = `/login?message=${encodeURIComponent('Customer account created. Please login.')}`;
    }, 1200);
  } catch (error) {
    console.error('Customer account creation error:', error);
    status.innerText = error.name === 'AbortError'
      ? 'Account creation timed out. Try signing in first, or retry if your account was not created.'
      : 'Unable to reach account registration. Check your connection and try again.';
    status.style.color = 'var(--danger)';
  } finally {
    clearTimeout(timer);
    button.removeAttribute('aria-busy');
    button.disabled = created;
    button.textContent = created ? 'Account created' : 'Create Account';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('registerForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    createCustomerAccount();
  });
});
