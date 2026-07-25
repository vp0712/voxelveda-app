let terminalRefreshTimer = null;
let terminalCountdownTimer = null;
let terminalSecondsLeft = 20;

function setTerminalText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

function startTerminalCountdown(seconds) {
  terminalSecondsLeft = Number(seconds || 20);
  setTerminalText('terminalCountdown', `${terminalSecondsLeft}s`);
  clearInterval(terminalCountdownTimer);
  terminalCountdownTimer = setInterval(() => {
    terminalSecondsLeft -= 1;
    setTerminalText('terminalCountdown', `${Math.max(0, terminalSecondsLeft)}s`);
    if (terminalSecondsLeft <= 0) clearInterval(terminalCountdownTimer);
  }, 1000);
}

async function loadShiftTerminalQr(force = false) {
  const image = document.getElementById('terminalQrImage');
  if (!image) return;

  try {
    setTerminalText('terminalStatus', 'Auto refresh');
    const res = await fetch(`/api/public/shift-qr?t=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'QR terminal unavailable');

    const qrData = data.qr_data || data.token;
    image.src = `/api/qr?data=${encodeURIComponent(qrData)}&v=${Date.now()}`;
    setTerminalText('terminalStatus', 'Auto refresh');
    setTerminalText('terminalTokenState', '');
    startTerminalCountdown(data.expires_in_seconds || data.refresh_seconds || 20);

    clearTimeout(terminalRefreshTimer);
    terminalRefreshTimer = setTimeout(loadShiftTerminalQr, Number(data.refresh_seconds || 20) * 1000);
  } catch (err) {
    setTerminalText('terminalStatus', 'Connection paused');
    setTerminalText('terminalTokenState', err.message || 'Unable to issue attendance code. Check server connection.');
    clearTimeout(terminalRefreshTimer);
    terminalRefreshTimer = setTimeout(loadShiftTerminalQr, 8000);
  }
}

function toggleTerminalFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadShiftTerminalQr(true);
});

loadShiftTerminalQr();
