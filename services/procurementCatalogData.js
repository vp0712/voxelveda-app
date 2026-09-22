const zlib = require('zlib');

const workbookChunks = [
  require('./procurementCatalogChunks/chunk1'),
  require('./procurementCatalogChunks/chunk2'),
  require('./procurementCatalogChunks/chunk3'),
  require('./procurementCatalogChunks/chunk4'),
  require('./procurementCatalogChunks/chunk5'),
  require('./procurementCatalogChunks/chunk6'),
  require('./procurementCatalogChunks/chunk7'),
  require('./procurementCatalogChunks/chunk8')
];

function loadWorkbookData() {
  const compressed = Buffer.concat(
    workbookChunks.map((chunk) => Buffer.from(chunk, 'base64'))
  );
  const raw = zlib.inflateSync(compressed).toString('utf8');
  const data = JSON.parse(raw);

  if (!Array.isArray(data.bom) || data.bom.length !== 237) {
    throw new Error(
      `Procurement A-Z BOM row count mismatch: expected 237 rows including header, got ${Array.isArray(data.bom) ? data.bom.length : 0}`
    );
  }
  if (!Array.isArray(data.order1) || data.order1.length !== 94) {
    throw new Error(
      `Procurement Order 1 row count mismatch: expected 94 rows including header, got ${Array.isArray(data.order1) ? data.order1.length : 0}`
    );
  }

  return data;
}

module.exports = loadWorkbookData();
