async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function setCustomerStatus(message, type = 'info') {
  const el = document.getElementById('customerStatus');
  if (!el) return;

  el.innerText = message;
  el.style.color = type === 'error' ? '#f87171' : type === 'success' ? '#22c55e' : '#9ca3af';
}

async function submitCustomerRFQ() {
  const accepted = document.getElementById('privacyAccepted')?.checked;

  if (!accepted) {
    setCustomerStatus('Please read and accept the Privacy Policy before submitting.', 'error');
    return;
  }

  const body = {
    customer_name: document.getElementById('customerName')?.value.trim(),
    email: document.getElementById('customerEmail')?.value.trim(),
    phone: document.getElementById('customerPhone')?.value.trim(),
    material: document.getElementById('customerMaterial')?.value.trim(),
    quantity: Number(document.getElementById('customerQuantity')?.value || 1),
    application: document.getElementById('customerApplication')?.value.trim()
  };

  if (!body.customer_name || !body.email) {
    setCustomerStatus('Customer name and email are required.', 'error');
    return;
  }

  setCustomerStatus('Submitting your request...');

  try {
    const res = await fetch('/api/public/rfq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await safeJson(res);

    if (!res.ok) {
      setCustomerStatus(data.message || 'RFQ submission failed.', 'error');
      return;
    }

    setCustomerStatus(`RFQ submitted successfully. Reference #${data.rfq_id}.`, 'success');

    ['customerName', 'customerEmail', 'customerPhone', 'customerMaterial', 'customerQuantity', 'customerApplication']
      .forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });

    const privacy = document.getElementById('privacyAccepted');
    if (privacy) privacy.checked = false;
  } catch {
    setCustomerStatus('Server error. Please try again or contact info@voxelveda.com.', 'error');
  }
}
