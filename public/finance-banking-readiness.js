(() => {
  const load = (src, marker) => {
    if (document.querySelector(`script[data-${marker}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset[marker] = 'true';
    document.head.appendChild(script);
  };
  load('/finance-banking-readiness-core.js?v=20260916-control-center', 'bankingReadinessCore');
  load('/personal-money-center.js?v=20260916-personal-money', 'personalMoneyCenter');
})();
