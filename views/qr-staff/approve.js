'use strict';
(() => {
  const challenge = new URLSearchParams(location.search).get('challenge');
  const button = document.getElementById('approve');
  const title = document.getElementById('title');
  const message = document.getElementById('message');
  const cancel = document.getElementById('cancel');
  let confirmRevocation = false;
  if (location.search) history.replaceState(null, '', location.pathname);

  if (!challenge) {
    title.textContent = 'Manage attendance phones';
    message.textContent = 'Lost or replaced a phone? Unlink all attendance phones for your signed-in staff account. You can link your current phone again from the staff attendance page.';
    button.textContent = 'Unlink all my attendance phones';
    cancel.textContent = 'Return to Operations Hub';
  }
  button.disabled = false;
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    if (!challenge && !confirmRevocation) {
      confirmRevocation = true;
      title.textContent = 'Unlink all your phones?';
      message.textContent = 'Confirm to remove attendance access from every phone linked to your account.';
      button.textContent = 'Confirm unlink all phones';
      cancel.textContent = 'Cancel';
      return;
    }
    button.disabled = true;
    const path = challenge ? '/attendance/link-phone' : '/attendance/phones/revoke-all';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(path, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(challenge ? { challenge } : {}), signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'This request could not be completed.');
      if (challenge) { location.assign(result.url); return; }
      title.textContent = 'Phones unlinked';
      message.textContent = 'All attendance phones linked to this staff account have been revoked.';
      button.hidden = true;
      cancel.textContent = 'Return to Operations Hub';
    } catch (error) {
      message.textContent = error.name === 'AbortError' || error instanceof TypeError
        ? 'The server could not confirm the result. Check your connection and try again.'
        : error.message;
      button.disabled = false;
    } finally { clearTimeout(timer); }
  });
})();
