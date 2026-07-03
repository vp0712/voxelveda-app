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

const voxelAiState = {
  step: 'name',
  lead: { name: '', email: '', phone: '', company: '', need: '' },
  transcript: []
};

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
    ensureVoxelAiIntro();
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

  voxelAiState.transcript.push(`${sender}: ${message}`);
}

function setVoxelAiPlaceholder(text) {
  const input = document.getElementById('vvAiInput');
  if (input) input.placeholder = text;
}

function ensureVoxelAiIntro() {
  if (voxelAiState.started) return;
  voxelAiState.started = true;
  appendVoxelAiMessage('Hi, I am Voxel Veda AI. First I will collect your details so the engineering team can contact you. What is your full name?');
  setVoxelAiPlaceholder('Your full name');
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function getVoxelAiResponse(question) {
  const q = String(question || '').toLowerCase();

  if (q.includes('material') || q.includes('pla') || q.includes('abs') || q.includes('nylon') || q.includes('resin') || q.includes('carbon')) {
    return 'Material guide: PLA is best for visual prototypes, PETG for tougher functional parts, ABS/ASA for heat and outdoor use, Nylon or carbon-filled Nylon for strength, TPU for flexible parts, and resin for fine detail.';
  }

  if (q.includes('file') || q.includes('stl') || q.includes('step') || q.includes('drawing') || q.includes('cad')) {
    return 'Best RFQ files: STEP or Parasolid for engineering review, STL/3MF for printing geometry, and PDF drawings for critical tolerances.';
  }

  if (q.includes('nda') || q.includes('confidential') || q.includes('sensitive') || q.includes('defence')) {
    return 'For confidential work, mention NDA required. Voxel Veda can review sensitive defence, aerospace, medical, and robotics projects through a controlled workflow.';
  }

  if (q.includes('tolerance') || q.includes('precision') || q.includes('finish')) {
    return 'For precision work, include target tolerance, mating surfaces, surface finish, inspection needs, and the part function.';
  }

  return 'Thanks. I have sent your details to the Voxel Veda team. You can also use the RFQ form on this page if you want to add structured quote details.';
}

async function sendVoxelAiLead() {
  const payload = {
    ...voxelAiState.lead,
    source: 'Voxel Veda app AI assistant',
    page: window.location.href,
    transcript: voxelAiState.transcript
  };

  const res = await fetch('/api/public/ai-lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || 'Lead email failed.');
  return data;
}

async function handleVoxelAiLeadAnswer(answer) {
  const value = String(answer || '').trim();

  if (voxelAiState.step === 'name') {
    voxelAiState.lead.name = value;
    voxelAiState.step = 'email';
    appendVoxelAiMessage('Thanks. What is your email address?');
    setVoxelAiPlaceholder('Email address');
    return;
  }

  if (voxelAiState.step === 'email') {
    if (!isEmail(value)) {
      appendVoxelAiMessage('Please enter a valid email address so we can send the lead to the team.');
      return;
    }
    voxelAiState.lead.email = value;
    voxelAiState.step = 'phone';
    appendVoxelAiMessage('Great. What phone number should the team use?');
    setVoxelAiPlaceholder('Phone number');
    return;
  }

  if (voxelAiState.step === 'phone') {
    voxelAiState.lead.phone = value;
    voxelAiState.step = 'company';
    appendVoxelAiMessage('Company name? You can type individual if this is personal.');
    setVoxelAiPlaceholder('Company or individual');
    return;
  }

  if (voxelAiState.step === 'company') {
    voxelAiState.lead.company = value;
    voxelAiState.step = 'need';
    appendVoxelAiMessage('Now tell me what you need: part type, material, quantity, deadline, tolerance, NDA needs, or any project notes.');
    setVoxelAiPlaceholder('What do you need?');
    return;
  }

  if (voxelAiState.step === 'need') {
    voxelAiState.lead.need = value;
    voxelAiState.step = 'sent';
    appendVoxelAiMessage('Sending your information to Voxel Veda now...');
    setVoxelAiPlaceholder('Ask a follow-up question');
    try {
      const result = await sendVoxelAiLead();
      if (result.email_sent) {
        appendVoxelAiMessage('Done. Your details were emailed to the Voxel Veda team in a lead table and saved in the app. ' + getVoxelAiResponse(value));
      } else {
        appendVoxelAiMessage('Done. Your details were saved in the Voxel Veda app for the team to review. Email notification needs SMTP setup before it can send automatically.');
      }
    } catch {
      appendVoxelAiMessage('I could not save this automatically. Please email info@voxelveda.com or try again shortly.');
    }
    return;
  }

  appendVoxelAiMessage(getVoxelAiResponse(value));
}

function askVoxelAi(question) {
  toggleVoxelAi(true);
  appendVoxelAiMessage(question, 'user');

  if (voxelAiState.step !== 'sent') {
    appendVoxelAiMessage('I will help with that after I collect your contact details. What is your full name?');
    voxelAiState.step = 'name';
    setVoxelAiPlaceholder('Your full name');
    return;
  }

  appendVoxelAiMessage(getVoxelAiResponse(question), 'bot');
}

async function sendVoxelAiQuestion() {
  ensureVoxelAiIntro();
  const input = document.getElementById('vvAiInput');
  const question = input?.value.trim();
  if (!question) return;
  input.value = '';
  appendVoxelAiMessage(question, 'user');
  await handleVoxelAiLeadAnswer(question);
}

function handleVoxelAiKey(event) {
  if (event.key === 'Enter') sendVoxelAiQuestion();
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') toggleVoxelAi(false);
});
