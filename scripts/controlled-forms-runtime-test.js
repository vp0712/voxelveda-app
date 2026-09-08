const fs = require('fs');
const os = require('os');
const path = require('path');

const sourceHtml = path.join(__dirname, '..', 'public', 'admin-dashboard.html');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-controlled-forms-'));
const tempHtml = path.join(tempDir, 'admin-dashboard.html');
fs.copyFileSync(sourceHtml, tempHtml);

const marker = 'data-vv-controlled-forms="true"';
const scriptTag = '  <script src="/controlled-forms-pack.js?v=20260908-controlled-packs-v1" data-vv-controlled-forms="true"></script>\n';
let html = fs.readFileSync(tempHtml, 'utf8');
if (!html.includes(marker)) html = html.replace('</body>', `${scriptTag}</body>`);
fs.writeFileSync(tempHtml, html, 'utf8');
const first = fs.readFileSync(tempHtml, 'utf8');
if (!first.includes('/controlled-forms-pack.js')) throw new Error('controlled forms script was not inserted');
if ((first.match(/data-vv-controlled-forms=/g) || []).length !== 1) throw new Error('controlled forms script was inserted more than once');
console.log('Controlled forms runtime injection check passed.');
