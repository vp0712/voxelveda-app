const form = document.getElementById('loginForm');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.message || 'Invalid email or password');
      return;
    }

    localStorage.clear();
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    localStorage.setItem('role', data.user.role);

    if (data.user.role === 'admin') {
      window.location.href = '/dashboard.html';
    } else {
      window.location.href = '/staff-dashboard.html';
    }
  } catch (err) {
    console.error('Login error:', err);
    alert('Login request failed');
  }
});