const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'public', 'admin-dashboard.html');
const marker = 'data-vv-controlled-forms="true"';
const scriptTag = '  <script src="/controlled-forms-pack.js?v=20260908-controlled-packs-v1" data-vv-controlled-forms="true"></script>\n';

const html = fs.readFileSync(htmlPath, 'utf8');
if (!html.includes(marker)) {
  if (!html.includes('</body>')) throw new Error('admin-dashboard.html is missing </body>');
  fs.writeFileSync(htmlPath, html.replace('</body>', `${scriptTag}</body>`), 'utf8');
  console.log('Controlled forms catalogue installed into admin dashboard runtime.');
} else {
  console.log('Controlled forms catalogue already installed.');
}
