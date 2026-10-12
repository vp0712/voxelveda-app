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
  transcript: [],
  rfqId: null,
  emailSent: false,
  analysis: null
};

const voxelAiSteps = {
  name: { label: 'Contact', progress: '1/5', placeholder: 'Your full name' },
  email: { label: 'Email', progress: '2/5', placeholder: 'Email address' },
  phone: { label: 'Phone', progress: '3/5', placeholder: 'Phone number' },
  company: { label: 'Company', progress: '4/5', placeholder: 'Company or individual' },
  need: { label: 'Project', progress: '5/5', placeholder: 'Part, material, qty, deadline...' },
  sent: { label: 'Queued', progress: 'Saved', placeholder: 'Ask about material, files, tolerance...' }
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

function updateVoxelAiStage() {
  const meta = voxelAiSteps[voxelAiState.step] || voxelAiSteps.name;
  const stepEl = document.getElementById('vvAiStep');
  const progressEl = document.getElementById('vvAiProgress');
  const input = document.getElementById('vvAiInput');

  if (stepEl) stepEl.textContent = meta.label;
  if (progressEl) progressEl.textContent = meta.progress;
  if (input) input.placeholder = meta.placeholder;
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

function appendVoxelAiCard(items, title = 'Engineering intake') {
  const messages = document.getElementById('vvAiMessages');
  if (!messages) return;

  const card = document.createElement('div');
  card.className = 'vv-ai-insight-card bot';
  const heading = document.createElement('h3');
  heading.textContent = title;
  card.appendChild(heading);

  items.forEach(({ label, value }) => {
    const row = document.createElement('div');
    const strong = document.createElement('strong');
    const span = document.createElement('span');
    strong.textContent = label;
    span.textContent = value || '-';
    row.append(strong, span);
    card.appendChild(row);
  });

  messages.appendChild(card);
  messages.scrollTop = messages.scrollHeight;
}

function appendVoxelAiChips(chips) {
  const messages = document.getElementById('vvAiMessages');
  if (!messages || !chips.length) return;

  const wrap = document.createElement('div');
  wrap.className = 'vv-ai-chip-row';
  chips.forEach((chip) => {
    const span = document.createElement('span');
    span.textContent = chip;
    wrap.appendChild(span);
  });
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
}

function ensureVoxelAiIntro() {
  const messages = document.getElementById('vvAiMessages');
  if (messages && !voxelAiState.transcript.length) {
    const first = messages.querySelector('.vv-ai-message.bot');
    if (first) voxelAiState.transcript.push(`bot: ${first.textContent.trim()}`);
  }
  updateVoxelAiStage();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function extractQuantity(text) {
  const value = String(text || '');
  const explicit = value.match(/(?:qty|quantity)\D{0,12}(\d{1,6})/i);
  if (explicit) return Number(explicit[1]);
  const parts = value.match(/(\d{1,6})\s*(?:pcs|pieces|parts|units)\b/i);
  return parts ? Number(parts[1]) : 1;
}

function extractMaterial(text) {
  const q = String(text || '').toLowerCase();
  const materials = ['carbon-filled nylon', 'stainless steel', 'carbon fiber', 'aluminium', 'aluminum', 'nylon', 'resin', 'petg', 'abs', 'asa', 'tpu', 'pla', 'fdm', 'sla', 'sls'];
  return materials.find((material) => q.includes(material)) || 'AI recommendation requested';
}

function detectProjectSignals(text) {
  const q = String(text || '').toLowerCase();
  return {
    hasCad: /\b(step|stp|stl|3mf|cad|drawing|iges|igs|pdf)\b/.test(q),
    hasTolerance: /\b(tolerance|precision|accurate|fit|thread|insert|surface finish|micron|mm)\b/.test(q),
    hasDeadline: /\b(deadline|urgent|asap|rush|lead time|tomorrow|week|date)\b/.test(q),
    hasNda: /\b(nda|confidential|sensitive|defence|defense|aerospace|medical)\b/.test(q),
    hasMaterial: extractMaterial(q) !== 'AI recommendation requested',
    hasQuantity: extractQuantity(q) > 1
  };
}

function buildProjectAnalysis(text) {
  const signals = detectProjectSignals(text);
  const missing = [];
  let score = 35;

  if (signals.hasMaterial) score += 15; else missing.push('Preferred material or application conditions');
  if (signals.hasQuantity) score += 12; else missing.push('Quantity or production batch size');
  if (signals.hasCad) score += 15; else missing.push('CAD file type: STEP/STL/3MF/PDF drawing');
  if (signals.hasTolerance) score += 13; else missing.push('Critical tolerances or mating surfaces');
  if (signals.hasDeadline) score += 10; else missing.push('Deadline or target delivery window');

  score = Math.min(score, 100);

  const tags = [];
  if (signals.hasNda) tags.push('NDA-sensitive');
  if (signals.hasDeadline) tags.push('Time-critical');
  if (signals.hasTolerance) tags.push('Precision review');
  if (signals.hasCad) tags.push('CAD mentioned');
  if (!tags.length) tags.push('Standard RFQ');

  return {
    score,
    material: extractMaterial(text),
    quantity: extractQuantity(text),
    tags,
    missing,
    route: signals.hasTolerance || signals.hasNda ? 'Engineering review' : 'Fast quote review'
  };
}

function getLeadSummary() {
  const analysis = voxelAiState.analysis;
  return [
    'Voxel Veda AI Intake Summary',
    voxelAiState.rfqId ? `Reference: #${voxelAiState.rfqId}` : '',
    `Name: ${voxelAiState.lead.name}`,
    `Email: ${voxelAiState.lead.email}`,
    `Phone: ${voxelAiState.lead.phone || '-'}`,
    `Company: ${voxelAiState.lead.company || '-'}`,
    `Need: ${voxelAiState.lead.need}`,
    analysis ? `Readiness: ${analysis.score}%` : '',
    analysis ? `Detected Material: ${analysis.material}` : '',
    analysis ? `Detected Quantity: ${analysis.quantity}` : '',
    analysis ? `Review Route: ${analysis.route}` : '',
    analysis ? `Missing Info: ${analysis.missing.join('; ') || 'None'}` : ''
  ].filter(Boolean).join('\n');
}

function syncLeadToRFQForm() {
  const analysis = voxelAiState.analysis || buildProjectAnalysis(voxelAiState.lead.need);
  const application = [
    voxelAiState.lead.need,
    voxelAiState.rfqId ? `AI assistant reference #${voxelAiState.rfqId}` : '',
    `Readiness score: ${analysis.score}%`,
    `Review route: ${analysis.route}`,
    analysis.missing.length ? `Missing info: ${analysis.missing.join('; ')}` : '',
    voxelAiState.lead.company ? `Company: ${voxelAiState.lead.company}` : ''
  ].filter(Boolean).join('\n');

  const values = {
    customerName: voxelAiState.lead.company || voxelAiState.lead.name,
    customerEmail: voxelAiState.lead.email,
    customerPhone: voxelAiState.lead.phone,
    customerMaterial: analysis.material,
    customerQuantity: analysis.quantity,
    customerApplication: application
  };

  Object.entries(values).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el && value) el.value = value;
  });
}

function getVoxelAiResponse(question) {
  const q = String(question || '').toLowerCase();

  if (q.includes('readiness') || q.includes('score') || q.includes('missing')) {
    const analysis = voxelAiState.analysis || buildProjectAnalysis(voxelAiState.lead.need || question);
    return `Quote readiness is ${analysis.score}%. Missing: ${analysis.missing.join(', ') || 'nothing major'}.`;
  }

  if (q.includes('checklist') || q.includes('next')) {
    const analysis = voxelAiState.analysis || buildProjectAnalysis(voxelAiState.lead.need || question);
    return `Next checklist: ${analysis.missing.join('; ') || 'upload CAD/drawing files and wait for engineering review'}.`;
  }

  if (q.includes('material') || q.includes('pla') || q.includes('abs') || q.includes('nylon') || q.includes('resin') || q.includes('carbon')) {
    return 'Material guide: PLA for visual prototypes, PETG for tougher functional parts, ABS/ASA for heat or outdoor use, Nylon or carbon-filled Nylon for strength, TPU for flexible parts, and resin for fine detail.';
  }

  if (q.includes('file') || q.includes('stl') || q.includes('step') || q.includes('drawing') || q.includes('cad')) {
    return 'Best RFQ package: STEP or Parasolid for engineering review, STL/3MF for print geometry, and a PDF drawing for critical tolerances or inserts.';
  }

  if (q.includes('nda') || q.includes('confidential') || q.includes('sensitive') || q.includes('defence')) {
    return 'For confidential work, mark NDA required and avoid unnecessary public details. The team can review sensitive defence, aerospace, medical, and robotics projects through controlled workflows.';
  }

  if (q.includes('tolerance') || q.includes('precision') || q.includes('finish')) {
    return 'For precision work, include target tolerance, mating surfaces, surface finish, inspection needs, load, heat, and whether the part is prototype-only or production-intent.';
  }

  if (q.includes('deadline') || q.includes('urgent') || q.includes('lead time')) {
    return 'For fast turnaround, include deadline, quantity, material flexibility, and whether partial delivery is acceptable. That helps engineering choose the fastest route.';
  }

  return 'Your request is in the engineering queue. Ask me about quote readiness, missing details, material choice, CAD file prep, tolerances, or NDA handling.';
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
  if (!res.ok) throw new Error(data.message || 'Lead save failed.');
  return data;
}

async function handleVoxelAiLeadAnswer(answer) {
  const value = String(answer || '').trim();

  if (voxelAiState.step === 'name') {
    voxelAiState.lead.name = value;
    voxelAiState.step = 'email';
    appendVoxelAiMessage('Thanks. What is your email address?');
    updateVoxelAiStage();
    return;
  }

  if (voxelAiState.step === 'email') {
    if (!isEmail(value)) {
      appendVoxelAiMessage('Please enter a valid email address so the team can contact you.');
      return;
    }
    voxelAiState.lead.email = value;
    voxelAiState.step = 'phone';
    appendVoxelAiMessage('Great. What phone number should the team use?');
    updateVoxelAiStage();
    return;
  }

  if (voxelAiState.step === 'phone') {
    voxelAiState.lead.phone = value;
    voxelAiState.step = 'company';
    appendVoxelAiMessage('Company name? You can type individual if this is personal.');
    updateVoxelAiStage();
    return;
  }

  if (voxelAiState.step === 'company') {
    voxelAiState.lead.company = value;
    voxelAiState.step = 'need';
    appendVoxelAiMessage('Now describe the job: part type, material, quantity, deadline, tolerance, NDA needs, and any CAD file status.');
    updateVoxelAiStage();
    return;
  }

  if (voxelAiState.step === 'need') {
    voxelAiState.lead.need = value;
    voxelAiState.step = 'sent';
    voxelAiState.analysis = buildProjectAnalysis(value);
    updateVoxelAiStage();
    appendVoxelAiMessage('Running engineering triage and saving your request...');

    try {
      const result = await sendVoxelAiLead();
      voxelAiState.rfqId = result.rfq_id || null;
      voxelAiState.emailSent = Boolean(result.email_sent);
      syncLeadToRFQForm();

      appendVoxelAiMessage(`Saved. Your project is in the Voxel Veda app${voxelAiState.rfqId ? ` as reference #${voxelAiState.rfqId}` : ''}.`);
      appendVoxelAiChips(voxelAiState.analysis.tags);
      appendVoxelAiCard([
        { label: 'Readiness', value: `${voxelAiState.analysis.score}%` },
        { label: 'Route', value: voxelAiState.analysis.route },
        { label: 'Material', value: voxelAiState.analysis.material },
        { label: 'Quantity', value: String(voxelAiState.analysis.quantity) },
        { label: 'Missing', value: voxelAiState.analysis.missing.join('; ') || 'Nothing major' }
      ], 'AI triage result');
      appendVoxelAiMessage('I filled the RFQ form with this intake. Add CAD files or tolerance notes if available, then the team has a cleaner package to review.');
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
    appendVoxelAiMessage('I can answer that after the intake details are captured. Please continue with the current question in the input box.');
    updateVoxelAiStage();
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

function startNewVoxelAiLead() {
  voxelAiState.step = 'name';
  voxelAiState.lead = { name: '', email: '', phone: '', company: '', need: '' };
  voxelAiState.transcript = [];
  voxelAiState.rfqId = null;
  voxelAiState.emailSent = false;
  voxelAiState.analysis = null;

  const messages = document.getElementById('vvAiMessages');
  if (messages) {
    messages.innerHTML = '<div class="vv-ai-message bot">Fresh intake started. What is your full name?</div>';
    voxelAiState.transcript.push('bot: Fresh intake started. What is your full name?');
  }

  updateVoxelAiStage();
  toggleVoxelAi(true);
}

async function copyVoxelAiSummary() {
  if (!voxelAiState.lead.need) {
    appendVoxelAiMessage('No project summary is ready yet. Complete the intake first.');
    return;
  }

  const summary = getLeadSummary();
  try {
    await navigator.clipboard.writeText(summary);
    appendVoxelAiMessage('Project summary copied. You can paste it into an email, drawing note, or internal handoff.');
  } catch {
    appendVoxelAiMessage(summary);
  }
}

function showVoxelAiReadiness() {
  if (!voxelAiState.lead.need) {
    appendVoxelAiMessage('Complete the project intake first, then I can score quote readiness.');
    return;
  }
  const analysis = voxelAiState.analysis || buildProjectAnalysis(voxelAiState.lead.need);
  appendVoxelAiCard([
    { label: 'Readiness', value: `${analysis.score}%` },
    { label: 'Route', value: analysis.route },
    { label: 'Missing', value: analysis.missing.join('; ') || 'Nothing major' }
  ], 'Quote readiness');
}

function showVoxelAiChecklist() {
  if (!voxelAiState.lead.need) {
    appendVoxelAiMessage('Complete the project intake first, then I can build the checklist.');
    return;
  }
  const analysis = voxelAiState.analysis || buildProjectAnalysis(voxelAiState.lead.need);
  appendVoxelAiMessage(`Checklist: ${analysis.missing.join('; ') || 'Upload CAD/drawing files and wait for engineering review.'}`);
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') toggleVoxelAi(false);
});

window.addEventListener('DOMContentLoaded', updateVoxelAiStage);