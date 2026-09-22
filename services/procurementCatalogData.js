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
  const sheets = JSON.parse(raw);

  const bom = sheets['A-Z BOM'] || [];
  if (!Array.isArray(bom) || bom.length !== 237) {
    throw new Error(
      `Procurement A-Z BOM row count mismatch: expected 237 rows including header, got ${Array.isArray(bom) ? bom.length : 0}`
    );
  }

  return {
    bom,
    dashboard: sheets['Dashboard'] || [],
    packaging: sheets['Packaging System'] || [],
    suppliers: sheets['Supplier Directory'] || [],
    storage: sheets['Storage Map'] || [],
    readme: sheets['Read Me'] || [],
    order1: sheets['Order 1 - Launch'] || [],
    order2: sheets['Order 2 - Scale'] || [],
    order3: sheets['Order 3 - Expansion'] || [],
    buyingSequence: sheets['Buying Sequence'] || []
  };
}

module.exports = loadWorkbookData();
