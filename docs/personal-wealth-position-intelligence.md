# Personal Net Worth & Wealth Position Intelligence

Read-only intelligence over the existing owner-private Net Worth Center and Personal Financial Health data.

## What it shows
- net worth, total assets, total liabilities and liquid position by currency
- composition of liquid funds, registered assets, money lent, registered liabilities and borrowed money
- liquidity-to-liabilities and liabilities-to-assets ratios
- recent saved snapshot history and current-versus-oldest-snapshot change
- what-if illustration for registered asset value %, registered liability balance %, and liquid cash change

## Safety rules
- currencies remain separate; no FX conversion is assumed
- no POST/PUT/PATCH/DELETE calls
- no valuation, liability, cash, transaction, snapshot or accounting mutation
- bank/wallet cash is already included; avoid duplicate cash assets
- borrowed money should not be duplicated as both Personal Money debt and Net Worth liability
- future record-changing actions require explicit user approval
