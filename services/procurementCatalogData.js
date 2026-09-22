const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function loadProcurementCatalog() {
  const chunks = [];
  for (let i = 1; i <= 8; i += 1) {
    chunks.push(fs.readFileSync(path.join(__dirname, `procurementCatalogData.part${i}.bin`)));
  }

  const compressed = Buffer.concat(chunks);
  const json = zlib.inflateSync(compressed).toString('utf8');
  const data = JSON.parse(json);

  if (!Array.isArray(data.bom) || data.bom.length !== 237) {
    throw new Error(`Procurement BOM integrity check failed: expected 237 rows including header, got ${Array.isArray(data.bom) ? data.bom.length : 'invalid'}`);
  }
  if (!Array.isArray(data.order1) || data.order1.length !== 94) {
    throw new Error(`Procurement Order 1 integrity check failed: expected 94 rows including header, got ${Array.isArray(data.order1) ? data.order1.length : 'invalid'}`);
  }

  console.log('PROCUREMENT_MASTER_BOM_OK items=236 rows=237 source=A-Z_BOM');
  return data;
}

module.exports = loadProcurementCatalog();
