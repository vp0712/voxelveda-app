'use strict';

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

const CANONICAL = new Set([
  'Cash',
  'Groceries',
  'Fuel & Vehicle',
  'Eating Out',
  'Software & Subscriptions',
  'Website & Hosting',
  'Materials & Manufacturing',
  'Phone & Internet',
  'Insurance',
  'Rent & Housing',
  'Utilities',
  'Health & Pharmacy',
  'Transport',
  'Shopping',
  'Education & Training',
  'Tax & Government',
  'Bank Fees & Interest',
  'Travel',
  'Income',
  'Transfer'
]);

const STRONG_MERCHANT_RULES = [
  ['Fuel & Vehicle', /\b(SHELL|AMPOL|CALTEX|UNITED PETROLEUM|BP\b|MOBIL|7[- ]?ELEVEN FUEL|PETROL|FUEL|SERVICE STATION|TYRE|TIRE|MECHANIC|AUTOMOTIVE|CAR WASH)\b/],
  ['Groceries', /\b(COLES|WOOLWORTHS|ALDI|IGA|COSTCO|SUPERMARKET|GROCER(?:Y|IES))\b/],
  ['Eating Out', /\b(MCDONALD|KFC|SUBWAY|UBER EATS|MENULOG|DOORDASH|RESTAURANT|CAFE|COFFEE|TAKEAWAY|PIZZA)\b/],
  ['Software & Subscriptions', /\b(ADOBE|MICROSOFT|OPENAI|CHATGPT|CANVA|AUTODESK|GITHUB|DROPBOX|NOTION|ZOOM|SOFTWARE|SAAS|SUBSCRIPTION)\b/],
  ['Website & Hosting', /\b(HOSTINGER|CLOUDFLARE|RAILWAY|VERCEL|NETLIFY|DOMAIN|WEB HOST|HOSTING)\b/],
  ['Materials & Manufacturing', /\b(BUNNINGS|TOTAL TOOLS|SYDNEY TOOLS|RS COMPONENTS|ELEMENT14|JAYCAR|FILAMENT|RESIN|3D PRINT|MATERIAL|FASTENER|HARDWARE)\b/],
  ['Phone & Internet', /\b(TELSTRA|OPTUS|VODAFONE|TPG|AUSSIE BROADBAND|NBN|MOBILE PLAN|INTERNET)\b/],
  ['Insurance', /\b(AAMI|ALLIANZ|BINGLE|NRMA|RACV|INSURANCE|PREMIUM)\b/],
  ['Rent & Housing', /\b(RENT|REAL ESTATE|PROPERTY MANAGEMENT|BODY CORP|STRATA|MORTGAGE|HOME LOAN)\b/],
  ['Utilities', /\b(AGL|ORIGIN ENERGY|ENERGY AUSTRALIA|RED ENERGY|WATER BILL|ELECTRICITY|GAS BILL|UTILITY)\b/],
  ['Health & Pharmacy', /\b(CHEMIST WAREHOUSE|PRICELINE PHARMACY|PHARMACY|MEDICAL|DENTAL|DENTIST|DOCTOR|GP CLINIC|HOSPITAL|BUPA|MEDIBANK)\b/],
  ['Transport', /\b(UBER(?! EATS)|DIDI|13CABS|TAXI|MYKI|PTV|METRO TRAINS|V\/LINE|PARKING|TOLL|LINKT|EASTLINK)\b/],
  ['Shopping', /\b(KMART|TARGET|BIG W|AMAZON|EBAY|TEMU|SHEIN|MYER|DAVID JONES|JB HI-?FI|OFFICEWORKS|RETAIL)\b/],
  ['Education & Training', /\b(UNIVERSITY|TAFE|COLLEGE|INSTITUTE|COURSE|TUITION|UDEMY|COURSERA|TRAINING)\b/],
  ['Tax & Government', /\b(ATO|AUSTRALIAN TAXATION OFFICE|VICROADS|SERVICE VICTORIA|COUNCIL RATE|GOVERNMENT FEE|ASIC|TAX OFFICE)\b/],
  ['Bank Fees & Interest', /\b(BANK FEE|ACCOUNT FEE|CARD FEE|INTEREST CHARGE|OVERDRAWN FEE|FOREIGN TRANSACTION FEE|ATM FEE)\b/],
  ['Travel', /\b(QANTAS|VIRGIN AUSTRALIA|JETSTAR|AIRBNB|BOOKING\.COM|EXPEDIA|HOTEL|AIRLINE|FLIGHT)\b/],
  ['Cash', /\b(ATM|CASH WITHDRAWAL|CASH WDL|CASH OUT|CASH ADVANCE|BRANCH WITHDRAWAL|CASH DISPENSED)\b/]
];

const PROVIDER_RULES = [
  ['Fuel & Vehicle', /\b(FUEL|PETROL|SERVICE STATION|AUTOMOTIVE|VEHICLE MAINTENANCE)\b/],
  ['Groceries', /\b(GROCERY|GROCERIES|SUPERMARKET)\b/],
  ['Eating Out', /\b(RESTAURANT|CAFE|DINING|TAKEAWAY|FAST FOOD)\b/],
  ['Software & Subscriptions', /\b(SOFTWARE|SAAS|DIGITAL SUBSCRIPTION)\b/],
  ['Website & Hosting', /\b(WEB HOSTING|DOMAIN REGISTRATION|HOSTING)\b/],
  ['Phone & Internet', /\b(TELECOMMUNICATION|MOBILE|INTERNET|BROADBAND)\b/],
  ['Insurance', /\b(INSURANCE)\b/],
  ['Rent & Housing', /\b(RENT|MORTGAGE|HOUSING|PROPERTY MANAGEMENT)\b/],
  ['Utilities', /\b(UTILIT(?:Y|IES)|ELECTRICITY|GAS|WATER)\b/],
  ['Health & Pharmacy', /\b(HEALTH|PHARMACY|MEDICAL|DENTAL)\b/],
  ['Transport', /\b(PUBLIC TRANSPORT|TAXI|RIDESHARE|PARKING|TOLL)\b/],
  ['Shopping', /\b(RETAIL|SHOPPING|DEPARTMENT STORE)\b/],
  ['Education & Training', /\b(EDUCATION|TRAINING|TUITION)\b/],
  ['Tax & Government', /\b(TAX|GOVERNMENT|COUNCIL|REGISTRATION FEE)\b/],
  ['Bank Fees & Interest', /\b(BANK FEE|FINANCIAL FEE|INTEREST CHARGE)\b/],
  ['Travel', /\b(TRAVEL|AIRLINE|ACCOMMODATION|HOTEL)\b/],
  ['Cash', /\b(CASH|ATM WITHDRAWAL)\b/]
];

function canonicalFromRules(text, rules) {
  for (const [category, pattern] of rules) if (pattern.test(text)) return category;
  return null;
}

function suggestConnectedBankCategory(tx, direction) {
  const merchantText = clean([tx?.merchant?.name, tx?.merchantName, tx?.description, tx?.narrative].filter(Boolean).join(' '));
  const providerCategory = clean(tx?.category || tx?.class?.title || tx?.class?.name || tx?.categoryName);
  const directCanonical = [...CANONICAL].find((category) => clean(category) === providerCategory);
  if (directCanonical) return { category: directCanonical, source: 'BANK_PROVIDER_CATEGORY', confidence: 'HIGH' };

  const merchantCategory = canonicalFromRules(merchantText, STRONG_MERCHANT_RULES);
  if (merchantCategory) return { category: merchantCategory, source: 'BANK_MERCHANT_EVIDENCE', confidence: 'HIGH' };

  const providerMapped = canonicalFromRules(providerCategory, PROVIDER_RULES);
  if (providerMapped) return { category: providerMapped, source: 'BANK_PROVIDER_CATEGORY_MAPPED', confidence: 'MEDIUM' };

  const providerAndText = clean(providerCategory + ' ' + merchantText);
  if (String(direction || '').toUpperCase() === 'CREDIT' && /\b(SALARY|PAYROLL|WAGES|DIVIDEND|CREDIT INTEREST|COMMISSION)\b/.test(providerAndText)) {
    return { category: 'Income', source: 'BANK_INCOME_EVIDENCE', confidence: 'HIGH' };
  }
  if (/\b(INTERNAL TRANSFER|ACCOUNT TRANSFER|OSKO TRANSFER|PAYID TRANSFER)\b/.test(providerAndText)) {
    return { category: 'Transfer', source: 'BANK_TRANSFER_EVIDENCE', confidence: 'HIGH' };
  }
  return { category: null, source: 'UNCLASSIFIED', confidence: 'LOW' };
}

module.exports = { CANONICAL, suggestConnectedBankCategory };
