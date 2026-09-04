(function installExpensePayments() {
  const expenseCategories = [
    'Fuel', 'Vehicle & Transport', 'Materials', 'Raw Material', 'Packaging',
    'Tools & Consumables', 'Machinery', 'Machine Maintenance', 'Repairs & Servicing',
    'Workshop Supplies', 'Freight & Courier', 'Rent', 'Utilities',
    'Software & Subscriptions', 'Insurance', 'Compliance & Licences', 'Safety & PPE',
    'Professional Services', 'Accounting & Bookkeeping', 'Bank Fees', 'Marketing',
    'Office Supplies', 'Cleaning & Waste', 'Staff Training', 'Meals & Travel', 'Other'
  ];

  const originalStatusBadge = statusBadge;
  statusBadge = function expenseAwareStatusBadge(status) {
    const clean = String(status || '').toLowerCase();
    if (clean === 'overdue') return `<span class="badge danger-badge">${escapeHtml(clean)}</span>`;
    if (clean === 'partially_paid') return '<span class="badge active-badge">partially paid</span>';
    return originalStatusBadge(status);
  };

  loadExpenses = async function loadExpensesWithPayments(page = expensePage) {
    const tbody = document.getElementById('expenseTableBody');
    if (!tbody) return;
    setExpenseFinancialYearOptions();
    expensePage = page;
    const params = new URLSearchParams({
      page: expensePage,
      limit: expenseLimit,
      fy: document.getElementById('expenseFinancialYear')?.value || '',
      search: document.getElementById('expenseSearch')?.value.trim() || ''
    });
    const res = await fetch(`/api/expenses?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await safeJson(res);
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="13">${escapeHtml(data.message || 'Failed to load expenses')}</td></tr>`;
      return;
    }
    expenseCache = data.expenses || [];
    renderNotificationDropdown();
    renderExpenseSummary(data.summary || {}, data.total || 0, data.page || 1, data.limit || expenseLimit);
    renderExpenseCharts(data.summary || {});
    if (!expenseCache.length) {
      tbody.innerHTML = '<tr><td colspan="13">No expenses found for this view.</td></tr>';
      return;
    }
    tbody.innerHTML = expenseCache.map((expense) => `
      <tr>
        <td>${escapeHtml(formatDate(expense.expense_date))}</td>
        <td>${expense.due_date ? escapeHtml(formatDate(expense.due_date)) : '<span class="muted-text">Not set</span>'}</td>
        <td><strong>${escapeHtml(expense.supplier_name || '-')}</strong><br><span class="muted-text">${escapeHtml(expense.description || '-')}</span></td>
        <td>${escapeHtml(expense.category || '-')}</td>
        <td>${escapeHtml(expense.invoice_no || '-')}</td>
        <td>${escapeHtml(formatMoney(expense.amount_ex_gst))}</td>
        <td>${escapeHtml(formatMoney(expense.gst_amount))}</td>
        <td><strong>${escapeHtml(formatMoney(expense.total_amount))}</strong></td>
        <td>${escapeHtml(formatMoney(expense.total_paid))}</td>
        <td><strong>${escapeHtml(formatMoney(expense.balance_due))}</strong></td>
        <td>${statusBadge(expense.status)}</td>
        <td>${Number(expense.file_count || 0) ? `<button class="file-badge-btn" onclick="openExpenseFileDialog(${expense.id})">${escapeHtml(expense.file_count)} bill${Number(expense.file_count) === 1 ? '' : 's'} attached</button>` : '<span class="muted-text">No bill</span>'}</td>
        <td>
          ${Number(expense.balance_due || 0) > 0 ? `<button class="icon-btn" onclick="openRecordExpensePaymentDialog(${expense.id})">Pay</button>` : ''}
          <button class="icon-btn" onclick="openExpensePaymentHistory(${expense.id})">Payments</button>
          <button class="icon-btn" onclick="openExpenseDialog(${expense.id})">Edit</button>
          <button class="icon-btn" onclick="openExpenseFileDialog(${expense.id})">Bill</button>
          <button class="icon-btn danger-icon" onclick="deleteExpense(${expense.id})">Delete</button>
        </td>
      </tr>`).join('');
  };

  renderExpenseSummary = function renderExpensePaymentSummary(summary, totalRows, page, limit) {
    setText('expenseTotalValue', formatMoney(summary.total_expense));
    setText('expenseGstPaid', formatMoney(summary.gst_paid));
    setText('expenseGstCollected', formatMoney(summary.gst_collected));
    setText('expenseGstPosition', formatMoney(summary.gst_position));
    setText('expenseTotalPaid', formatMoney(summary.total_paid));
    setText('expenseOutstandingDebt', formatMoney(summary.outstanding_debt));
    setText('expenseOverdueDebt', formatMoney(summary.overdue_debt));
    const info = document.getElementById('expensePageInfo');
    if (info) {
      const start = totalRows ? ((page - 1) * limit) + 1 : 0;
      const end = Math.min(page * limit, totalRows);
      info.innerText = `FY ${summary.financial_year || '-'} | Showing ${start}-${end} of ${totalRows} entries`;
    }
  };

  openExpenseDialog = function openPayableExpenseDialog(id = null) {
    const expense = expenseCache.find((row) => Number(row.id) === Number(id)) || {};
    const amountExGst = Number(expense.amount_ex_gst || 0);
    const gstRate = Number(expense.gst_rate ?? 10);
    const currentCategory = String(expense.category || '').trim();
    const categories = currentCategory && !expenseCategories.includes(currentCategory)
      ? [...expenseCategories, currentCategory] : expenseCategories;
    showDialog(id ? 'Edit Expense' : 'Add Expense', `
      <div class="expense-dialog-shell">
        <div class="dialog-card">
          <h4>Expense Details</h4>
          <label class="field-label">Expense date</label><input id="expenseDate" type="date" value="${escapeHtml(String(expense.expense_date || todayISO()).slice(0, 10))}" />
          <label class="field-label">Due date</label><input id="expenseDueDate" type="date" value="${escapeHtml(String(expense.due_date || '').slice(0, 10))}" />
          <label class="field-label">Supplier / Company</label><input id="expenseSupplier" placeholder="Supplier or company name" value="${escapeHtml(expense.supplier_name || '')}" />
          <label class="field-label">Category</label><select id="expenseCategory">${categories.map((category) => `<option value="${escapeHtml(category)}" ${currentCategory === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select>
          <label class="field-label">Description</label><textarea id="expenseDescription" rows="3" placeholder="What was purchased or paid for">${escapeHtml(expense.description || '')}</textarea>
        </div>
        <div class="dialog-card expense-money-card">
          <div class="expense-card-head"><div><h4>Bill Amount & GST</h4><p>The bill total stays fixed. Payments are recorded separately.</p></div><span class="expense-status-chip">${escapeHtml(String(expense.status || 'unpaid').toUpperCase().replaceAll('_', ' '))}</span></div>
          <label class="field-label">Invoice / bill number</label><input id="expenseInvoiceNo" placeholder="Invoice or bill reference" value="${escapeHtml(expense.invoice_no || '')}" />
          <div class="split-grid">
            <div class="form-field"><span>Amount ex GST</span><input id="expenseAmountExGst" type="number" min="0" step="0.01" value="${escapeHtml(amountExGst)}" oninput="calculateExpenseGst()" /></div>
            <div class="form-field"><span>GST rate %</span><input id="expenseGstRate" type="number" min="0" step="0.01" value="${escapeHtml(gstRate)}" oninput="calculateExpenseGst()" /></div>
          </div>
          <div class="split-grid">
            <div class="form-field"><span>GST amount</span><input id="expenseGstAmount" type="number" min="0" step="0.01" value="${escapeHtml(expense.gst_amount || (amountExGst * gstRate / 100).toFixed(2))}" oninput="updateExpenseSummaryTiles()" /></div>
            <div class="form-field"><span>Bill total</span><input id="expenseTotalAmount" type="number" min="0" step="0.01" value="${escapeHtml(expense.total_amount || (amountExGst + (amountExGst * gstRate / 100)).toFixed(2))}" oninput="updateExpenseSummaryTiles()" /></div>
          </div>
          <input id="expenseStatus" type="hidden" value="${escapeHtml(String(expense.status || 'unpaid'))}" />
          <p class="status-note">Status is calculated from payment history. Save the bill, then use Record Payment.</p>
          <div class="expense-summary-strip"><div><span>EX GST</span><strong id="expenseSummaryExGst">$0.00</strong></div><div><span>GST</span><strong id="expenseSummaryGst">$0.00</strong></div><div><span>BILL TOTAL</span><strong id="expenseSummaryTotal">$0.00</strong></div></div>
          <textarea id="expenseNotes" rows="3" placeholder="Notes, approval, GST reminder">${escapeHtml(expense.notes || '')}</textarea>
        </div>
      </div>`, async () => {
        const body = {
          id: expense.id,
          expense_date: document.getElementById('expenseDate')?.value,
          due_date: document.getElementById('expenseDueDate')?.value,
          supplier_name: document.getElementById('expenseSupplier')?.value.trim(),
          category: document.getElementById('expenseCategory')?.value,
          description: document.getElementById('expenseDescription')?.value.trim(),
          invoice_no: document.getElementById('expenseInvoiceNo')?.value.trim(),
          amount_ex_gst: Number(document.getElementById('expenseAmountExGst')?.value || 0),
          gst_rate: Number(document.getElementById('expenseGstRate')?.value || 0),
          gst_amount: Number(document.getElementById('expenseGstAmount')?.value || 0),
          total_amount: Number(document.getElementById('expenseTotalAmount')?.value || 0),
          status: document.getElementById('expenseStatus')?.value,
          notes: document.getElementById('expenseNotes')?.value.trim()
        };
        const res = await fetch('/api/expenses', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
        const data = await safeJson(res);
        if (!res.ok) return showToast(data.message || 'Expense save failed');
        hideDialog(); showToast(data.message || 'Expense saved'); await loadExpenses(1);
      }, id ? 'Update Expense' : 'Save Expense');
    document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'expense-dialog-panel');
    updateExpenseSummaryTiles();
  };

  function expensePaymentOptions(selectedId) {
    return expenseCache.filter((expense) => Number(expense.balance_due || 0) > 0).map((expense) => `<option value="${Number(expense.id)}" ${Number(selectedId) === Number(expense.id) ? 'selected' : ''}>${escapeHtml(expense.supplier_name || 'Supplier')} — ${escapeHtml(expense.invoice_no || `Expense #${expense.id}`)} — ${escapeHtml(formatMoney(expense.balance_due))} due</option>`).join('');
  }

  window.updateExpensePaymentBalance = function updateExpensePaymentBalance() {
    const id = Number(document.getElementById('expensePaymentExpense')?.value || 0);
    const expense = expenseCache.find((row) => Number(row.id) === id);
    setText('expensePaymentOriginal', formatMoney(expense?.total_amount || 0));
    setText('expensePaymentAlreadyPaid', formatMoney(expense?.total_paid || 0));
    setText('expensePaymentRemaining', formatMoney(expense?.balance_due || 0));
    const amount = document.getElementById('expensePaymentAmount');
    if (amount && expense) amount.max = Number(expense.balance_due || 0).toFixed(2);
  };

  window.fillFullExpenseBalance = function fillFullExpenseBalance() {
    const id = Number(document.getElementById('expensePaymentExpense')?.value || 0);
    const expense = expenseCache.find((row) => Number(row.id) === id);
    const amount = document.getElementById('expensePaymentAmount');
    if (amount && expense) amount.value = Number(expense.balance_due || 0).toFixed(2);
  };

  window.openRecordExpensePaymentDialog = function openRecordExpensePaymentDialog(id = null) {
    const options = expensePaymentOptions(id);
    if (!options) return showToast('There are no unpaid expenses to pay');
    const idempotencyKey = window.crypto?.randomUUID?.() || `expense-payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    showDialog('Record Expense Payment', `
      <div class="expense-dialog-shell">
        <div class="dialog-card"><h4>Select Bill</h4><label class="field-label">Expense / supplier bill</label><select id="expensePaymentExpense" onchange="updateExpensePaymentBalance()">${options}</select><div class="expense-summary-strip"><div><span>ORIGINAL</span><strong id="expensePaymentOriginal">$0.00</strong></div><div><span>PAID</span><strong id="expensePaymentAlreadyPaid">$0.00</strong></div><div><span>REMAINING</span><strong id="expensePaymentRemaining">$0.00</strong></div></div></div>
        <div class="dialog-card"><h4>Payment Details</h4>
          <label class="field-label">Payment amount</label><div class="split-grid"><input id="expensePaymentAmount" type="number" min="0.01" step="0.01" placeholder="0.00" /><button type="button" class="secondary-btn" onclick="fillFullExpenseBalance()">Pay Full Balance</button></div>
          <label class="field-label">Payment date</label><input id="expensePaymentDate" type="date" value="${todayISO()}" />
          <label class="field-label">Payment method</label><select id="expensePaymentMethod"><option value="">Select method</option><option>Bank Transfer</option><option>Business Card</option><option>Cash</option><option>Direct Debit</option><option>BPAY</option><option>Other</option></select>
          <label class="field-label">Paid from account</label><input id="expensePaymentAccount" placeholder="Business bank, card or cash account" />
          <label class="field-label">Reference</label><input id="expensePaymentReference" placeholder="Bank transaction or receipt reference" />
          <label class="field-label">Notes</label><textarea id="expensePaymentNotes" rows="3" placeholder="Optional payment note"></textarea>
        </div>
      </div>`, async () => {
        const expenseId = Number(document.getElementById('expensePaymentExpense')?.value || 0);
        const body = {
          amount: document.getElementById('expensePaymentAmount')?.value,
          payment_date: document.getElementById('expensePaymentDate')?.value,
          payment_method: document.getElementById('expensePaymentMethod')?.value,
          account_name: document.getElementById('expensePaymentAccount')?.value.trim(),
          reference: document.getElementById('expensePaymentReference')?.value.trim(),
          notes: document.getElementById('expensePaymentNotes')?.value.trim(),
          idempotency_key: idempotencyKey
        };
        if (!body.amount || Number(body.amount) <= 0) return showToast('Enter a payment amount greater than zero');
        if (!body.payment_date || !body.payment_method || !body.account_name) return showToast('Payment date, method and paid-from account are required');
        const selected = expenseCache.find((row) => Number(row.id) === expenseId);
        if (!confirm(`Record ${formatMoney(body.amount)} payment to ${selected?.supplier_name || 'this supplier'}?`)) return;
        const res = await fetch(`/api/expenses/${expenseId}/payments`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
        const data = await safeJson(res);
        if (!res.ok) return showToast(data.message || 'Payment could not be recorded');
        hideDialog(); showToast(data.message || 'Payment recorded'); await loadExpenses(expensePage);
      }, 'Record Payment');
    document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'expense-dialog-panel');
    updateExpensePaymentBalance();
  };

  window.openExpensePaymentHistory = async function openExpensePaymentHistory(id) {
    const res = await fetch(`/api/expenses/${Number(id)}/payments`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await safeJson(res);
    if (!res.ok) return showToast(data.message || 'Payment history could not be loaded');
    const rows = (data.payments || []).map((payment) => `<tr class="${payment.voided_at ? 'muted-text' : ''}"><td>${escapeHtml(formatDate(payment.payment_date))}</td><td>${escapeHtml(formatMoney(payment.amount))}</td><td>${escapeHtml(payment.payment_method || '-')}</td><td>${escapeHtml(payment.account_name || '-')}</td><td>${escapeHtml(payment.reference || '-')}</td><td>${payment.voided_at ? `Reversed: ${escapeHtml(payment.void_reason || '')}` : `<button class="mini-danger" onclick="voidExpensePayment(${Number(payment.id)}, ${Number(id)})">Reverse</button>`}</td></tr>`).join('') || '<tr><td colspan="6">No payments recorded.</td></tr>';
    showDialog('Expense Payment History', `<div class="expense-summary-strip"><div><span>ORIGINAL</span><strong>${escapeHtml(formatMoney(data.expense.total_amount))}</strong></div><div><span>PAID</span><strong>${escapeHtml(formatMoney(data.expense.total_paid))}</strong></div><div><span>BALANCE</span><strong>${escapeHtml(formatMoney(data.expense.balance_due))}</strong></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Account</th><th>Reference</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`, hideDialog, 'Close');
    document.querySelector('.dialog-panel')?.classList.add('wide-dialog');
  };

  window.voidExpensePayment = async function voidExpensePayment(paymentId, expenseId) {
    const reason = prompt('Enter the reason for reversing this payment:');
    if (!reason?.trim()) return;
    const res = await fetch(`/api/expenses/payments/${Number(paymentId)}/void`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason: reason.trim() }) });
    const data = await safeJson(res);
    if (!res.ok) return showToast(data.message || 'Payment could not be reversed');
    showToast(data.message || 'Payment reversed'); await loadExpenses(expensePage); await openExpensePaymentHistory(expenseId);
  };
})();
