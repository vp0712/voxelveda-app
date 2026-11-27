'use strict';
(() => {
  const element = (id) => document.getElementById(id);
  const primary = element('primary');
  const secondary = element('secondary');
  const unlink = element('unlink');
  const actions = { CHECK_IN: 'Check in', CHECK_OUT: 'Check out' };
  const completed = { CHECK_IN: 'Checked in', CHECK_OUT: 'Checked out' };
  const statuses = { NOT_STARTED: 'Off shift', WORKING: 'Working', ON_BREAK: 'On break', COMPLETED: 'Off shift', REVIEW_REQUIRED: 'Review required' };
  const queryToken = new URLSearchParams(location.search).get('t') || '';
  let token = queryToken.length <= 2000 ? queryToken : '';
  let linkCode = new URLSearchParams(location.hash.slice(1)).get('code');
  if (location.search || location.hash) history.replaceState(null, '', '/');
  let identity;
  let request;
  let scan;
  let busy = false;

  function bind(button, label, handle) {
    button.hidden = !handle;
    button.textContent = label || '';
    button.onclick = handle ? () => run(handle) : null;
  }
  function show(title, message, rows = []) {
    element('title').textContent = title;
    element('message').textContent = message;
    const details = element('details');
    details.replaceChildren();
    for (const [key, value] of rows.filter(([, value]) => value !== null && value !== undefined && value !== '')) {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const desc = document.createElement('dd');
      term.textContent = key;
      desc.textContent = String(value);
      row.append(term, desc);
      details.append(row);
    }
    details.hidden = !details.childElementCount;
    bind(primary); bind(secondary);
    unlink.hidden = !identity?.linked || Boolean(request);
  }

  async function api(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const options = { signal: controller.signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error' };
      if (body !== undefined) {
        Object.assign(options, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(body) });
      }
      const response = await fetch('/qr-api/' + path, options);
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.message || 'Request unavailable.'), { status: response.status, code: data.code });
      return data;
    } finally { clearTimeout(timer); }
  }
  async function run(task) {
    if (busy) return;
    busy = true;
    [primary, secondary, unlink].forEach((button) => { button.disabled = true; });
    try { await task(); } catch (error) { failure(error); }
    finally {
      busy = false;
      [primary, secondary, unlink].forEach((button) => { button.disabled = false; });
    }
  }
  const progressKey = () => 'vv.qr.pending.v1.' + identity.staff_id;
  function loadRequest() {
    const saved = localStorage.getItem(progressKey());
    if (!saved) return null;
    const entry = JSON.parse(saved);
    if (entry && Object.hasOwn(actions, entry.action) && typeof entry.request_id === 'string') return entry;
    throw new Error('The saved attendance reference cannot be read.');
  }
  function clearRequest(expected) {
    // Another tab may already be recording a different action.
    if (expected && loadRequest()?.request_id === expected.request_id) localStorage.removeItem(progressKey());
    request = null;
  }
  function staffDetails(info) {
    return [['Staff', info.staff_name], ['Workplace', info.site_name], ['Shift status', statuses[info.status] || info.status]];
  }
  function idle(note) {
    scan = null;
    show('Scan the workplace QR', note || 'Open your phone camera and scan the current code on the workplace display.', staffDetails(identity));
  }
  function showReceipt(receipt) {
    const name = completed[receipt?.action];
    if (!name || !request || receipt.request_id !== request.request_id) throw new Error('Unable to match the saved action.');
    const when = new Date(receipt.saved_at);
    if (!receipt.saved_at || !Number.isFinite(when.getTime())) throw new Error('Saved time unavailable.');
    const time = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'medium', timeZone: receipt.timezone || identity.timezone || 'UTC' }).format(when);
    clearRequest(request); token = ''; scan = null;
    show(name, 'Your attendance was saved.', [['Staff', identity.staff_name], ['Workplace', identity.site_name], ['Recorded at', time], ['Time zone', receipt.timezone || identity.timezone || 'UTC']]);
  }
  async function confirm() {
    if (!scan || !Object.hasOwn(actions, scan.action)) return;
    const previous = loadRequest();
    if (previous && (!request || previous.request_id !== request.request_id)) {
      request = previous; await reconcile(); return;
    }
    const attempt = request || { request_id: crypto.randomUUID(), action: scan.action, attendance_id: scan.attendance_id };
    localStorage.setItem(progressKey(), JSON.stringify(attempt));
    request = attempt;
    show('Saving attendance…', 'Keep this page open.');
    try {
      const result = await api('confirm', { ...attempt, token, qr_proof: scan.qr_proof });
      showReceipt(result.receipt);
    } catch (error) {
      // Reconcile even when the server returns an error: the response or a later read can fail after a committed write.
      await reconcile(error);
    }
  }
  async function reconcile(submissionError) {
    const result = await api('reconcile', { request_id: request.request_id });
    if (result.found) { showReceipt(result.receipt); return; }
    if (submissionError) {
      // A delayed first request could still commit. A fresh scan reuses the same request ID and action.
      token = ''; scan = null;
    }
    if (token) {
      await preview();
      return;
    }
    const reason = submissionError?.status >= 400 && submissionError.status < 500
      ? submissionError.message
      : 'No saved receipt was found for your last action.';
    show('Attendance needs checking', reason + ' Scan a fresh workplace code to retry the same action, or check its saved status.',
      [['Requested action', actions[request.action]], ['Staff', identity.staff_name]]);
    bind(primary, 'Check saved status', () => reconcile());
  }
  async function preview() {
    let result;
    try { result = await api('scan', { token }); }
    catch (error) {
      if (error.status >= 400 && error.status < 500 && error.status !== 429 && error.status !== 401) {
        token = ''; scan = null; idle(error.message + ' Scan a fresh code from the workplace display.'); return;
      }
      throw error;
    }
    if (!Object.hasOwn(actions, result.action)) { token = ''; idle('Check your shift status in the Operations Hub.'); return; }
    if (request && (request.action !== result.action || Number(request.attendance_id) !== Number(result.attendance_id))) {
      token = ''; scan = null;
      show('Your shift status changed', 'Review your attendance in the Operations Hub. Check for a saved receipt before starting another scan.', staffDetails(result));
      bind(primary, 'Check saved status', () => reconcile());
      bind(secondary, 'I reviewed my attendance', async () => {
        const last = await api('reconcile', { request_id: request.request_id });
        if (last.found) { showReceipt(last.receipt); return; }
        clearRequest(request);
        await start();
      });
      return;
    }
    scan = result;
    show(actions[scan.action], 'Confirm this action for the staff member and workplace shown below.', staffDetails(result));
    bind(primary, actions[scan.action], confirm);
  }
  function askUnlink() {
    show('Unlink this phone?', 'You will need to verify your staff account again before recording attendance on this phone.', [['Staff', identity.staff_name]]);
    unlink.hidden = true;
    bind(primary, 'Unlink this phone', async () => {
      await api('unlink', {}); token = ''; scan = null; await start();
    });
    bind(secondary, 'Cancel', start);
  }
  function failure(error) {
    if (error.status === 401) {
      identity = null; request = null; scan = null;
      show('Verify your phone', 'Your attendance session is no longer available. Link this phone to your active staff account.');
      bind(primary, 'Link this phone', beginLink);
      return;
    }
    show(request ? 'Saved status unavailable' : 'Attendance unavailable',
      error.status ? error.message : 'Check your connection and allow cookies and site storage in this browser, then try again.');
    bind(primary, request ? 'Check saved status' : 'Try again', request ? () => reconcile() : start);
  }
  async function beginLink() {
    const result = await api('link/start', {});
    location.assign(result.url);
  }
  async function start() {
    if (linkCode) {
      const code = linkCode;
      try { await api('link/finish', { code }); linkCode = null; }
      catch (error) {
        if (error.status >= 400 && error.status < 500 && error.status !== 429) {
          linkCode = null;
          const current = await api('session');
          if (!current.linked) {
            identity = null; request = null;
            show('Phone link expired', 'Start again in this browser to link your staff account.');
            bind(primary, 'Link this phone', beginLink);
            return;
          }
        } else { throw error; }
      }
    }
    identity = await api('session');
    if (!identity.linked) {
      request = null; scan = null;
      show('Link your phone', 'Verify your staff account once in the Operations Hub, then scan the workplace QR to record attendance.');
      bind(primary, 'Link this phone', beginLink); return;
    }
    request = loadRequest();
    if (request) { await reconcile(); return; }
    if (token) { await preview(); return; }
    idle();
  }
  unlink.onclick = () => run(askUnlink);
  window.addEventListener('pageshow', (event) => { if (event.persisted) run(start); });
  run(start);
})();
