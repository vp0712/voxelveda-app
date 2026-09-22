# Finance Data Contract

- **available_balance**: provider/account-reported spendable balance when available; never period-filtered.
- **current_ledger_balance**: latest known ledger/statement balance for the account; never period-filtered.
- **balance**: must always identify which balance definition it uses.
- **income / money_in**: credits in the selected activity period excluding internal transfers and ignored transactions.
- **expense / money_out**: debits in the selected activity period excluding internal transfers and ignored transactions.
- **net_cash_flow**: money_in minus money_out for the selected period. It is not account balance.
- **transfer**: confirmed `finance_transfer_links` pair between owned-account debit and credit movements. Visible as movement but excluded from income/expense totals.
- **split**: child classification allocations in `bank_transaction_splits` whose exact sum equals the immutable parent bank transaction amount. Reporting uses children for category/ownership allocation without counting the parent again.
- **refund**: an active `finance_refund_links` relationship connects a credit to an original expense. Linked refunds remain visible cash inflow, are excluded from ordinary-revenue interpretation, and reduce net economic expense only by the linked amount.
- **reimbursement**: `finance_reimbursements` links an expense, claimant and lifecycle state; `finance_reimbursement_payments` links approved settlement transactions. Reimbursement payments must not duplicate the original expense or create synthetic cash movement.
- **ownership_scope**: PERSONAL, BUSINESS, MIXED or UNCLASSIFIED, subject to account ownership and privacy rules.
- **original_category**: immutable raw source/bank category in provenance storage.
- **system_category**: current user/system classification; it may change without overwriting original source evidence.
- **currency**: native transaction/account currency. Values from different currencies must not be added unless a verified FX rate, rate date and reporting currency are stored.


## Trusted totals rules

- **money_in** is cash inflow in the selected period, excluding confirmed internal transfers. It may include linked merchant refunds and must never be labelled business revenue by itself.
- **ordinary_money_in** is money_in less active linked-refund amounts. It is still a banking cash metric, not automatically accounting revenue.
- **linked_refund_inflow** is the amount of selected-period credits actively linked to original expense transactions.
- **money_out** is cash outflow in the selected period, excluding confirmed internal transfers.
- **net_cash_flow** is money_in minus money_out. Refunds remain cash inflow because cash actually returned to the account.
- **net_economic_expense** is money_out minus linked_refund_inflow for the same selected population. This provides the requested economic-expense view without misclassifying refunds as revenue.
- **split category allocation** uses child split amounts when a transaction has splits. The parent amount is not also added to category totals. The immutable bank transaction remains the source cash movement.
- **mixed-currency reporting** returns separate per-currency totals. A consolidated total is unavailable until a verified FX rate, rate date and reporting currency are stored.
- **internal transfer movement** may be displayed as movement, but confirmed transfer pairs contribute zero to income and expense totals.
