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


function toggleVoxelAi(forceOpen) {
  const widget = document.getElementById('vvAiWidget');
  const panel = document.getElementById('vvAiPanel');
  const toggle = document.getElementById('vvAiToggle');
  if (!widget || !panel || !toggle) return;

  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : panel.hidden;
  panel.hidden = !shouldOpen;
  widget.classList.toggle('is-open', shouldOpen);
  toggle.setAttribute('aria-expanded', String(shouldOpen));

  if (shouldOpen) {
    const input = document.getElementById('vvAiInput');
    setTimeout(() => input?.focus(), 80);
  }
}

function focusCustomerField(id) {
  toggleVoxelAi(false);
  const field = document.getElementById(id);
  if (!field) return;
  field.focus();
  field.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function appendVoxelAiMessage(message, sender = 'bot') {
  const messages = document.getElementById('vvAiMessages');
  if (!messages) return;

  const item = document.createElement('div');
  item.className = `vv-ai-message ${sender}`;
  item.textContent = message;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

function getVoxelAiResponse(question) {
  const q = String(question || '').toLowerCase();

  if (q.includes('material') || q.includes('pla') || q.includes('abs') || q.includes('nylon') || q.includes('resin') || q.includes('carbon')) {
    return 'Material guide: PLA is best for visual prototypes, PETG for tougher functional parts, ABS/ASA for heat and outdoor use, Nylon or carbon-filled Nylon for strength, TPU for flexible parts, and resin for fine detail. Add your load, heat, tolerance, and finish needs in the RFQ.';
  }

  if (q.includes('file') || q.includes('stl') || q.includes('step') || q.includes('drawing') || q.includes('cad')) {
    return 'Best RFQ files: STEP or Parasolid for engineering review, STL/3MF for printing geometry, and PDF drawings for critical tolerances. If you only have photos or sketches, submit them and describe the dimensions.';
  }

  if (q.includes('nda') || q.includes('confidential') || q.includes('sensitive') || q.includes('defence')) {
    return 'For confidential work, mention NDA required in the RFQ and avoid unnecessary public details. The team can review sensitive defence, aerospace, medical, and robotics projects through a controlled workflow.';
  }

  if (q.includes('tolerance') || q.includes('precision') || q.includes('finish')) {
    return 'For precision work, include target tolerance, mating surfaces, surface finish, and inspection needs. If unsure, describe how the part will be used and Voxel Veda can recommend a practical manufacturing route.';
  }

  if (q.includes('quote') || q.includes('rfq') || q.includes('price') || q.includes('cost') || q.includes('help')) {
    return 'To get a fast quote, include your name, email, material or technology, quantity, part use, deadline, and any CAD/drawing details. Use the RFQ form on this page and the request will go into the Voxel Veda app.';
  }

  return 'I can help with material selection, file preparation, tolerance notes, NDA-sensitive projects, and RFQ next steps. Tell me what part you are making, how it will be used, quantity, material preference, and deadline.';
}

function askVoxelAi(question) {
  toggleVoxelAi(true);
  appendVoxelAiMessage(question, 'user');
  appendVoxelAiMessage(getVoxelAiResponse(question), 'bot');
}

function sendVoxelAiQuestion() {
  const input = document.getElementById('vvAiInput');
  const question = input?.value.trim();
  if (!question) return;
  input.value = '';
  askVoxelAi(question);
}

function handleVoxelAiKey(event) {
  if (event.key === 'Enter') sendVoxelAiQuestion();
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') toggleVoxelAi(false);
});