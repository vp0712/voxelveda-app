(() => {
  'use strict';
  const missing = 'Not recorded';
  const text = value => value === null || value === undefined || value === '' ? missing
    : typeof value === 'string' || typeof value === 'number' ? String(value) : missing;
  const yesNo = value => value === true || value === 1 || value === '1' ? 'Yes'
    : value === false || value === 0 || value === '0' ? 'No' : missing;
  function recordedDate(value) {
    const raw = text(value); if (raw === missing) return raw;
    // Preserve the recorded time and any supplied offset; do not infer a local
    // timezone for a database DATETIME that did not include one.
    const parts = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](.*))?$/);
    if (!parts) return raw;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[Number(parts[2]) - 1]; if (!month) return raw;
    return `${Number(parts[3])} ${month} ${parts[1]}${parts[4] ? ' · ' + parts[4].replace(/\.000Z$/, ' UTC').replace(/Z$/, ' UTC') : ''}`;
  }
  function element(tag, content, className) {
    const node = document.createElement(tag); if (content !== undefined) node.textContent = String(content);
    if (className) node.className = className; return node;
  }
  function heading(output, title, reference, status) {
    const header = element('div', undefined, 'hub-record-heading'); header.append(element('h3', `${title}${text(reference) === missing ? '' : ' · ' + text(reference)}`));
    if (text(status) !== missing) header.append(element('span', text(status).replace(/_/g, ' '), 'hub-record-status'));
    output.append(header);
  }
  function details(output, record, fields) {
    const list = element('dl', undefined, 'hub-record-details');
    for (const [label, key, format = text] of fields) {
      const pair = element('div', undefined, 'hub-record-field'); pair.append(element('dt', label), element('dd', format(record[key]))); list.append(pair);
    }
    output.append(list);
  }
  function table(output, title, rows, columns, empty) {
    const section = element('section', undefined, 'hub-record-section'); section.append(element('h4', title));
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
      section.append(element('p', 'These related records are unavailable in this response. Refresh the record to check them.', 'hub-record-empty'));
    } else if (!rows.length) section.append(element('p', empty, 'hub-record-empty'));
    else {
      const wrap = element('div', undefined, 'hub-record-table-wrap'), grid = element('table', undefined, 'hub-record-table'); grid.setAttribute('aria-label', title);
      const head = element('thead'), headers = element('tr');
      for (const [label] of columns) { const cell = element('th', label); cell.setAttribute('scope', 'col'); headers.append(cell); }
      head.append(headers); const body = element('tbody');
      for (const row of rows) {
        const line = element('tr');
        for (const [label, key, format = text] of columns) { const cell = element('td', format(typeof key === 'function' ? key(row) : row[key])); cell.setAttribute('data-label', label); line.append(cell); }
        body.append(line);
      }
      grid.append(head, body); wrap.append(grid); section.append(wrap);
    }
    output.append(section);
  }
  function holds(output, rows) {
    table(output, 'Active quality holds', rows, [['Hold', 'hold_no'], ['Applies to', 'entity_type'], ['Reason', 'reason'], ['Placed', 'placed_at', recordedDate]], 'No active quality holds were returned for this record.');
  }
  function job(output, data) {
    const record = data.job; heading(output, 'Manufacturing job', record.job_no, record.status);
    details(output, record, [['Part number', 'part_no'], ['Description', 'part_description'], ['Quantity', 'quantity'], ['Customer purchase order', 'customer_po'],
      ['Drawing', 'drawing_no'], ['Drawing revision', 'drawing_revision'], ['Sector', 'sector'], ['Classification', 'confidentiality_classification'],
      ['Export review required', 'export_review_required', yesNo], ['Regulatory review required', 'regulatory_review_required', yesNo], ['Created', 'created_at', recordedDate], ['Updated', 'updated_at', recordedDate]]);
    table(output, 'Material allocations', data.materials, [['Lot', 'lot_no'], ['Material', 'material_code'], ['Grade', 'grade'], ['Release status', 'release_status'], ['Allocated quantity', 'quantity_allocated'], ['Consumed quantity', 'quantity_consumed']], 'No material allocations recorded.');
    table(output, 'Builds', data.builds, [['Build', 'build_no'], ['Status', 'status'], ['Machine reference', 'machine_id'], ['Operator reference', 'operator_user_id'], ['Started', 'started_at', recordedDate], ['Completed', 'completed_at', recordedDate]], 'No builds recorded.');
    holds(output, data.holds);
  }
  function machine(output, data) {
    const record = data.machine; heading(output, 'Machine', record.equipment_code, record.status);
    details(output, record, [['Description', 'description'], ['Manufacturer', 'manufacturer'], ['Model', 'model'], ['Serial number', 'serial_no'], ['Location', 'location'],
      ['Commissioned', 'commissioned', yesNo], ['Critical safety issue', 'critical_safety_issue', yesNo], ['Created', 'created_at', recordedDate]]);
    const readiness = element('section', undefined, 'hub-record-section'); readiness.append(element('h4', 'Server readiness'));
    readiness.append(element('p', data.allowed === true ? 'Ready for operation.' : data.allowed === false ? 'Operation blocked by server readiness checks.' : 'Readiness was not supplied in this response.'));
    if (Array.isArray(data.reasons) && data.reasons.length) { const reasons = element('ul', undefined, 'hub-record-reasons'); for (const reason of data.reasons) reasons.append(element('li', text(reason))); readiness.append(reasons); }
    output.append(readiness);
    table(output, 'Maintenance plans', data.maintenance, [['Plan', row => row.plan_name ?? row.maintenance_type], ['Next due', 'next_due_date', recordedDate], ['Blocks when overdue', 'blocking_when_overdue', yesNo], ['Active', 'active', yesNo]], 'No maintenance plans recorded.');
    table(output, 'Unresolved faults', data.faults, [['Severity', 'severity'], ['Description', 'description'], ['Status', 'status'], ['Reported', 'reported_at', recordedDate]], 'No unresolved faults were returned for this machine.');
    table(output, 'Active lockout / tagout permits', data.loto, [['Permit', 'permit_no'], ['Reason', 'reason'], ['Zero energy verified', 'zero_energy_verified', yesNo], ['Isolated', 'isolated_at', recordedDate]], 'No active lockout / tagout permits were returned for this machine.');
  }
  function material(output, data) {
    const record = data.lot; heading(output, 'Material lot', record.lot_no, record.release_status);
    details(output, record, [['Material', 'material_code'], ['Description', 'material_description'], ['Grade', 'grade'], ['Supplier lot', 'supplier_lot'], ['Certificate reference', 'certificate_ref'],
      ['Safety data sheet reference', 'sds_ref'], ['Received quantity', 'quantity_received'], ['Available quantity', 'quantity_available'], ['Unit', 'unit'], ['Expiry', 'expiry_date', recordedDate], ['Created', 'created_at', recordedDate]]);
    const use = element('p', `Available for use: ${yesNo(data.usable)}`, 'hub-record-readiness'); output.append(use);
    table(output, 'Material genealogy', data.genealogy, [['Job', 'job_no'], ['Build', 'build_no'], ['Serial', 'serial_no'], ['Relationship', 'relationship'], ['Quantity', 'quantity'], ['Recorded', 'created_at', recordedDate]], 'No material genealogy recorded.');
    holds(output, data.holds);
  }
  function render(output, type, data) {
    const key = { job: 'job', machine: 'machine', material: 'lot' }[type];
    if (!key || !data || typeof data !== 'object' || !data[key] || typeof data[key] !== 'object' || Array.isArray(data[key])) throw new Error('Record details could not be verified. Retry the record lookup.');
    output.replaceChildren(); output.className = 'hub-record-view'; ({ job, machine, material })[type](output, data);
  }
  function renderError(output, message) {
    output.replaceChildren(); output.className = 'hub-record-view'; output.append(element('h3', 'Record unavailable'), element('p', text(message), 'hub-record-error'));
  }
  window.VoxelShopFloorRecord = Object.freeze({ render, renderError });
})();
