(() => {
  'use strict';
  const invoiceId = new URLSearchParams(location.search).get('id');
  const status = document.getElementById('status');
  const frame = document.getElementById('preview');
  const download = document.getElementById('download');
  const retry = document.getElementById('retry');
  let documentUrl = null;
  let filename = null;
  let loading = false;
  async function load() {
    if (loading) return;
    if (!/^\d+$/.test(invoiceId || '')) { status.textContent = 'Select a valid invoice to view its PDF.'; status.className = 'error'; return; }
    loading = true; download.disabled = true; retry.hidden = true;
    status.className = ''; status.textContent = 'Generating the official invoice PDF…';
    try {
      const response = await fetch(`/api/invoice/${encodeURIComponent(invoiceId)}/pdf?download=1`, { credentials:'same-origin', cache:'no-store' });
      if (response.status === 401) { location.replace('/login?returnTo=' + encodeURIComponent(location.pathname + location.search)); return; }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'The invoice PDF could not be generated. Retry after reviewing the invoice.');
      }
      if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf') throw new Error('The document service returned an invalid PDF content type. No file was downloaded.');
      const disposition = response.headers.get('content-disposition') || '';
      const name = disposition.match(/filename="?([^";]+)"?/i)?.[1];
      if (!name || !/^[A-Za-z0-9._ -]+\.pdf$/.test(name)) throw new Error('The document service returned an invalid PDF filename. No file was downloaded.');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength < 100 || new TextDecoder('ascii').decode(bytes.slice(0,5)) !== '%PDF-') throw new Error('The document service returned invalid PDF bytes. No file was downloaded.');
      // The service parses every document before responding. Preview and download share these exact bytes.
      if (documentUrl) URL.revokeObjectURL(documentUrl);
      documentUrl = URL.createObjectURL(new Blob([bytes], { type:'application/pdf' }));
      filename = name; frame.src = documentUrl; frame.hidden = false; download.disabled = false;
      status.textContent = `${filename} · official PDF ready. Preview and download use the same document.`;
    } catch (error) { status.textContent = error.message; status.className = 'error'; retry.hidden = false; frame.hidden = true; }
    finally { loading = false; }
  }
  download.onclick = () => {
    if (!documentUrl || !filename || download.disabled) return;
    const link = document.createElement('a'); link.href = documentUrl; link.download = filename;
    document.body.append(link); link.click(); link.remove();
  };
  retry.onclick = load;
  window.addEventListener('pagehide', () => { if (documentUrl) URL.revokeObjectURL(documentUrl); });
  load();
})();
