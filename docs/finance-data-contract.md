# Finance Data Contract

- **available_balance**: provider/account-reported spendable balance when available; never period-filtered.
- **current_ledger_balance**: latest known ledger/statement balance for the account; never period-filtered.
- **balance**: must always identify which balance definition it uses.
- **income / money_in**: credits in the selected activity period excluding internal transfers and ignored transactions.
- **expense / money_out**: debits in the selected activity period excluding internal transfers and ignored transactions.
- **net_cash_flow**: money_in minus money_out for the selected period. It is not account balance.
- **transfer**: linked/identified movement between owned accounts. Visible as movement but excluded from income/expense totals.
- **refund**: must eventually link to an original expense; until a canonical relationship exists it must not be assumed to be revenue or automatically netted.
- **reimbursement**: must eventually link expense, claimant and reimbursement payment; not currently canonical.
- **ownership_scope**: PERSONAL, BUSINESS, MIXED or UNCLASSIFIED, subject to account ownership and privacy rules.
- **original_category**: immutable raw source/bank category in provenance storage.
- **system_category**: current user/system classification; it may change without overwriting original source evidence.
- **currency**: native transaction/account currency. Values from different currencies must not be added unless a verified FX rate, rate date and reporting currency are stored.
