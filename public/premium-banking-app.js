
(() => {
  'use strict';
  if (location.pathname !== '/banking' || window.__vvPremiumBankInstalled) return;
  window.__vvPremiumBankInstalled = true;

  const BANK = '/api/integrations/webhooks/banking';
  const STANDALONE = location.pathname === '/banking';