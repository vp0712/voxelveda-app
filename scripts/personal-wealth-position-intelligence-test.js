const fs=require('fs');
const assert=require('assert');
const wealth=fs.readFileSync('public/personal-wealth-position-intelligence.js','utf8');
assert(wealth.includes('/api/finance/personal-money/net-worth'),'Must read owner-private Net Worth dashboard.');
assert(wealth.includes('/api/finance/personal-money/health'),'Must reuse Personal Financial Health.');
assert(wealth.includes("credentials:'same-origin'"),'Must use same-origin authentication.');
assert(!/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)/i.test(wealth),'Must remain API read-only.');
for(const text of ['What-if wealth scenario','Liquidity-to-liabilities','Liabilities-to-assets','Snapshot trend','No FX conversion is applied','Currencies are never combined','must require explicit user approval'])assert(wealth.includes(text),`Missing safeguard or explanation: ${text}`);
console.log('Personal Wealth Position Intelligence regression checks passed.');
