'use strict';
(() => {
  const element = (id) => document.getElementById(id);
  const primary = element('primary');
  const secondary = element('secondary');
  const unlink = element('unlink');
  const actions = { CHECK_IN: 'Check in', CHECK_OUT: 'Check out' };
  const completed = { CHECK_IN: 'Checked in', CHECK_OUT: 'Checked out' };
  const statuses = { NOT_STARTED: 'Off shift', WORKING: 'Working', ON_BREAK: 'On break', COMPLETED: 'Off shift', REVIEW_REQUIRED: 'Review required' };
  const setupPath = '/setup';
  const remotePath = '/remote';
  const workplacePath = '/a';
  const remoteLinkKey = 'vv.qr.link-remote.v1';
  const pathname = location.pathname.toLowerCase().replace(/\/$/, '');
  let remote = pathname === remotePath;
  const workplace = pathname === workplacePath;
  const queryToken = workplace ? new URLSearchParams(location.search).get('t') || '' : '';
  let token = queryToken.length <= 2000 ? queryToken : '';
  let linkCode = pathname === setupPath ? new URLSearchParams(location.hash.slice(1)).get('code') : null;
  if (location.search || location.hash) history.replaceState(null, '', remote ? remotePath : workplace ? workplacePath : setupPath);
  let identity;
  let request;
  let scan;
  let locationSample = null;
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
    return [['Staff', info.staff_name], attendanceLocation(info, remote), ['Shift status', statuses[info.status] || info.status]];
  }
  const attendanceLocation = (info, isRemote) => isRemote ? ['Attendance', 'Remote'] : ['Workplace', info.site_name];
  const locationRequired = () => identity?.location_required === true;
  const freshLocation = () => window.VoxelAttendanceLocation?.isFresh(locationSample);
  function locationPrompt(message) {
    show('Location required', message || 'Share your current location to check in or check out. Your location is submitted when you confirm.', staffDetails(identity));
    bind(primary, 'Share location', async () => { if (await collectLocation()) await preview(); });
    if (request) bind(secondary, 'Check saved status', () => reconcile());
  }
  async function collectLocation() {
    try {
      if (!window.VoxelAttendanceLocation) throw new Error('Location is unavailable. Refresh the page and try again.');
      locationSample = await window.VoxelAttendanceLocation.capture();
      return true;
    } catch (error) {
      locationSample = null;
      locationPrompt(error.message);
      return false;
    }
  }
  function idle(note) {
    scan = null; locationSample = null;
    if (remote) {
      show('Attendance unavailable', note || 'Refresh to check your current attendance status.', staffDetails(identity));
      bind(primary, 'Refresh attendance', start);
      return;
    }
    show('Scan the workplace QR', note || 'Open your phone camera and scan the current code on the workplace display.', staffDetails(identity));
  }
  function showReceipt(receipt) {
    const name = completed[receipt?.action];
    if (!name || !request || receipt.request_id !== request.request_id) throw new Error('Unable to match the saved action.');
    const when = new Date(receipt.saved_at);
    if (!receipt.saved_at || !Number.isFinite(when.getTime())) throw new Error('Saved time unavailable.');
    const time = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'medium', timeZone: receipt.timezone || identity.timezone || 'UTC' }).format(when);
    const place = attendanceLocation(identity, request.source === 'remote');
    clearRequest(request); token = ''; scan = null; locationSample = null;
    show(name, 'Your attendance was saved.', [['Staff', identity.staff_name], place, ['Recorded at', time], ['Time zone', receipt.timezone || identity.timezone || 'UTC'], ['Recorded location', receipt.location_address]]);
  }
  async function confirm() {
    if (!scan || !Object.hasOwn(actions, scan.action)) return;
    const previous = loadRequest();
    if (previous && (!request || previous.request_id !== request.request_id)) {
      request = previous; await reconcile(); return;
    }
    if (locationRequired() && !freshLocation() && !await collectLocation()) return;
    const attempt = request || { request_id: crypto.randomUUID(), action: scan.action, attendance_id: scan.attendance_id, source: remote ? 'remote' : 'workplace' };
    localStorage.setItem(progressKey(), JSON.stringify(attempt));
    request = attempt;
    show('Saving attendance…', 'Keep this page open.');
    try {
      const { request_id, action, attendance_id } = attempt;
      const body = { request_id, action, attendance_id, qr_proof: scan.qr_proof };
      if (!remote) body.token = token;
      if (locationRequired()) body.location = locationSample;
      locationSample = null;
      const result = await api(remote ? 'remote/confirm' : 'confirm', body);
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
      // A delayed first request could still commit. A new preview keeps the same request ID and action.
      token = ''; scan = null;
    }
    const pendingRemote = request.source === 'remote';
    if (pendingRemote === remote && (token || (remote && !submissionError))) {
      await preview();
      return;
    }
    const reason = submissionError?.status >= 400 && submissionError.status < 500
      ? submissionError.message
      : 'No saved receipt was found for your last action.';
    let retry = ' Scan a fresh workplace code to retry the same action, or check its saved status.';
    if (pendingRemote) retry = remote ? ' Check its saved status before confirming again.' : ' Return to remote attendance to retry the same action.';
    show('Attendance needs checking', reason + retry,
      [['Requested action', actions[request.action]], ['Staff', identity.staff_name]]);
    bind(primary, 'Check saved status', () => reconcile());
    if (pendingRemote && !remote) bind(secondary, 'Open remote attendance', () => location.assign(remotePath));
  }
  async function preview() {
    if (locationRequired() && !freshLocation()) {
      scan = null;
      locationPrompt();
      return;
    }
    let result;
    try { result = await api(remote ? 'remote/scan' : 'scan', remote ? {} : { token }); }
    catch (error) {
      if (error.status >= 400 && error.status < 500 && error.status !== 429 && error.status !== 401) {
        token = ''; scan = null; idle(remote ? error.message : error.message + ' Scan a fresh code from the workplace display.'); return;
      }
      throw error;
    }
    if (!Object.hasOwn(actions, result.action)) { token = ''; idle('Check your shift status in the Operations Hub.'); return; }
    if (request && (request.action !== result.action || Number(request.attendance_id) !== Number(result.attendance_id))) {
      token = ''; scan = null;
      const next = remote ? 'trying again' : 'starting another scan';
      show('Your shift status changed', 'Review your attendance in the Operations Hub. Check for a saved receipt before ' + next + '.', staffDetails(result));
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
    show(actions[scan.action], remote
      ? 'Confirm remote attendance for the staff member shown below.'
      : 'Confirm this action for the staff member and workplace shown below.', staffDetails(result));
    bind(primary, actions[scan.action], confirm);
  }
  function askUnlink() {
    locationSample = null;
    show('Unlink this phone?', 'You will need to verify your staff account again before recording attendance on this phone.', [['Staff', identity.staff_name]]);
    unlink.hidden = true;
    bind(primary, 'Unlink this phone', async () => {
      await api('unlink', {}); token = ''; scan = null; await start();
    });
    bind(secondary, 'Cancel', start);
  }
  function failure(error) {
    if (error.status === 401) {
      identity = null; request = null; scan = null; locationSample = null;
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
    if (remote) sessionStorage.setItem(remoteLinkKey, '1');
    else sessionStorage.removeItem(remoteLinkKey);
    location.assign(result.url);
  }
  async function start() {
    if (linkCode) {
      if (sessionStorage.getItem(remoteLinkKey)) {
        sessionStorage.removeItem(remoteLinkKey);
        remote = true;
        history.replaceState(null, '', remotePath);
      }
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
      request = null; scan = null; locationSample = null;
      show('Link your phone', remote
        ? 'Verify your staff account in the Operations Hub to record attendance on this phone.'
        : 'Verify your staff account once in the Operations Hub, then scan the workplace QR to record attendance.');
      bind(primary, 'Link this phone', beginLink); return;
    }
    request = loadRequest();
    if (request) { await reconcile(); return; }
    if (token || remote) { await preview(); return; }
    idle();
  }
  unlink.onclick = () => run(askUnlink);
  window.addEventListener('pagehide', () => { locationSample = null; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) locationSample = null; });
  window.addEventListener('pageshow', (event) => { if (event.persisted) run(start); });
  run(start);
})();
