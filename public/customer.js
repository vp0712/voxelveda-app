(() => {
  'use strict';
  let submitting = false;
  const el = (id) => document.getElementById(id);
  function status(message, tone = 'info') {
    el('customerStatus').textContent = message;
    el('customerStatus').dataset.tone = tone;
  }
  el('customerRfqForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || !el('customerRfqForm').reportValidity()) return;
    if (!el('privacyAccepted').checked) return status('Accept the Privacy Policy before submitting.', 'error');
    const body = {
      customer_name: el('customerName').value.trim(), email: el('customerEmail').value.trim(),
      phone: el('customerPhone').value.trim(), material: el('customerMaterial').value.trim(),
      quantity: Number(el('customerQuantity').value), application: el('customerApplication').value.trim()
    };
    if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 1000000) return status('Quantity must be a whole number from 1 to 1,000,000.', 'error');
    submitting = true;
    el('customerSubmit').disabled = true;
    el('customerSubmit').setAttribute('aria-busy', 'true');
    el('customerSubmit').textContent = 'Submitting…';
    status('Submitting your request…');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api/public/rfq', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const type = String(response.headers.get('content-type') || '').toLowerCase();
      const data = type.includes('application/json') ? await response.json() : {};
      if (!response.ok) return status(data.message || 'Your request could not be submitted. Please try again.', 'error');
      if (!data.rfq_id) return status('The server did not confirm a request reference. Contact support before submitting again.', 'error');
      status('Your request was submitted. Reference #' + data.rfq_id + '.', 'success');
      ['customerName', 'customerEmail', 'customerPhone', 'customerMaterial', 'customerApplication'].forEach((id) => { el(id).value = ''; });
      el('customerQuantity').value = '1';
      el('privacyAccepted').checked = false;
    } catch (error) {
      status(error.name === 'AbortError' ? 'Confirmation timed out. Your request may have been received. Contact support before submitting again.' : 'We could not confirm your request. Contact support before submitting again.', 'error');
    } finally {
      clearTimeout(timer);
      submitting = false;
      el('customerSubmit').disabled = false;
      el('customerSubmit').setAttribute('aria-busy', 'false');
      el('customerSubmit').textContent = 'Submit request';
    }
  });
})();
