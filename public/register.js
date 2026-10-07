async function createCustomerAccount() {
  const status = document.getElementById('registerStatus');
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
  status.style.color = 'var(--danger)';

  try {
    const res = await fetch('/api/auth/customer-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        password,
        confirm_privacy: confirmPrivacy
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      status.innerText = data.message || 'Account creation failed.';
      status.style.color = 'var(--danger)';
      return;
    }

    status.innerText = data.message || 'Account created. You can login now.';
    status.style.color = 'var(--danger)';
    setTimeout(() => {
      window.location.href = `/login?message=${encodeURIComponent('Customer account created. Please login.')}`;
    }, 1200);
  } catch (error) {
    console.error('Customer account creation error:', error);
    status.innerText = 'Server error creating account.';
    status.style.color = 'var(--danger)';
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') createCustomerAccount();
});
