(function installControlledDocumentLibrary() {
  'use strict';

  if (typeof COMPANY_FORMS === 'undefined' || typeof companyFormFieldId !== 'function') return;

  const REVISION = '1.0';
  const DIGITAL_SOURCE = 'about:blank#voxel-veda-controlled-digital-form';
  const commonFields = ['Notes / actions', 'Record / Evidence References', 'Prepared / completed by', 'Reviewed / approved by', 'Status'];

  function inferType(label) {
    const value = String(label || '').toLowerCase();
    if (value === 'date' || value.endsWith(' date') || value.includes('date received') || value.includes('received date') || value.includes('due date') || value.includes('review date') || value.includes('closure date') || value.includes('dispatch date') || value.includes('issue date') || value.includes('commission date') || value.includes('purchase date') || value.includes('training date') || value.includes('assessment date') || value.includes('approval date') || value.includes('effective date') || value.includes('expiry / review date') || value.includes('last calibrated') || value.includes('next due date')) return 'date';
    if (value.includes('notes') || value.includes('description') || value.includes('requirements') || value.includes('controls') || value.includes('actions') || value.includes('statement') || value.includes('justification') || value.includes('investigation') || value.includes('results') || value.includes('evidence') || value.includes('assumptions') || value.includes('exclusions') || value.includes('limitations') || value.includes('risk assessment')) return 'textarea';
    return 'text';
  }

  function form(id, title, category, sourcePack, fields, checks) {
    const source = sourcePack === 'QMS'
      ? 'Manufacturing Quality Management System — Controlled Forms & Records'
      : 'Facility, Operations & Compliance Master Plan';
    const allFields = [...fields, ...(checks?.length ? checks.map((check) => `Check — ${check}`) : []), ...commonFields];
    return {
      category,
      title: `${id} — ${title}`,
      file: DIGITAL_SOURCE,
      visual: category === 'Safety' ? 'safety' : category === 'Machinery' ? 'machine' : category === 'Supplier' ? 'supplier' : category === 'Client' ? 'client' : category === 'Production' ? 'machine' : category === 'Environment' ? 'hazard-chart' : 'contract',
      note: `Controlled digital record from ${source}. Document ${id}, Rev ${REVISION}.`,
      controlledDocument: true,
      documentId: id,
      revision: REVISION,
      sourcePack,
      fields: [...new Set(allFields)].map((label) => ({ label, type: inferType(label), required: false }))
    };
  }

  const qms = [
    form('VV-FRM-001', 'Customer Enquiry / Request for Quotation (RFQ)', 'Client', 'QMS', ['RFQ No.', 'Date received', 'Customer legal name', 'Contact person', 'Email / phone', 'Project name', 'Part number', 'Drawing revision', 'Quantity', 'Requested delivery date', 'Intended application / environment', 'Requested material / grade', 'Requested manufacturing process', 'Critical dimensions / tolerances', 'Required certificates / reports', 'Special packaging', 'Customer notes', 'Attachments received', 'Received by']),
    form('VV-FRM-002', 'NDA & Confidentiality Register', 'Contract', 'QMS', ['NDA ID', 'Customer / counterparty', 'Project', 'Effective date', 'Expiry / review date', 'Mutual or one-way NDA', 'Information classification', 'Authorised Voxel Veda personnel', 'Approved storage location', 'External sharing restrictions', 'Export-control flag', 'Termination / return requirements', 'Owner']),
    form('VV-FRM-003', 'Contract Review & Order Acceptance', 'Contract', 'QMS', [], ['Current drawing / specification revision verified', 'Quantity, price and delivery agreed', 'Material availability confirmed', 'Manufacturing capability confirmed', 'Inspection capability confirmed', 'Special process requirements identified', 'Customer quality clauses reviewed', 'Traceability requirements identified', 'CoC / FAI / inspection reports identified', 'Subcontractor requirements identified', 'NDA / IP restrictions reviewed', 'Regulatory / DSGL / export-control screening completed where applicable', 'Risks and exceptions documented', 'Approval to accept order obtained']),
    form('VV-FRM-004', 'Manufacturing Quotation', 'Operations', 'QMS', ['Quotation No.', 'Customer RFQ reference', 'Customer', 'Project', 'Part / drawing / revision', 'Quantity break', 'Material', 'Manufacturing process', 'Engineering hours', 'Setup / tooling', 'Machine time', 'Post-processing', 'Inspection / documentation', 'Outside processing', 'Freight', 'GST', 'Lead time', 'Validity', 'Payment terms', 'Assumptions', 'Exclusions', 'Prepared by', 'Approved by']),
    form('VV-FRM-005', 'Purchase Order Review & Release', 'Operations', 'QMS', ['Customer PO number and date', 'Quotation reference', 'Part number / revision', 'Quantity', 'Price', 'Delivery date / address', 'Quality clauses', 'Required certificates', 'Special packaging / labelling', 'Customer-supplied material / tooling', 'Changes from quotation identified and resolved', 'Release status']),
    form('VV-FRM-006', 'Design Input Record', 'Quality', 'QMS', ['Project / design ID', 'Customer requirements', 'Functional requirements', 'Interfaces', 'Load / duty requirements', 'Operating environment', 'Materials / prohibited materials', 'Dimensions / envelope', 'Tolerance requirements', 'Safety requirements', 'Regulatory / standards requirements', 'Manufacturing constraints', 'Service / maintenance requirements', 'Verification criteria', 'Validation criteria', 'Assumptions', 'Approved design inputs']),
    form('VV-FRM-007', 'Design Review Record', 'Quality', 'QMS', ['Project / design ID', 'Review stage', 'Design revision', 'Review attendees', 'Inputs reviewed', 'Calculations / simulation reviewed', 'DFM / DFA review', 'Risks / FMEA review', 'Compliance review', 'Open actions', 'Action owner', 'Due date', 'Disposition', 'Approval to progress']),
    form('VV-FRM-008', 'Design Verification Record', 'Quality', 'QMS', ['Design ID / revision', 'Requirement ID', 'Verification method', 'Acceptance criterion', 'Test / calculation / inspection result', 'Evidence reference', 'Pass / fail', 'Deviation reference', 'Verified by', 'Date', 'Approval']),
    form('VV-FRM-009', 'Engineering Risk Assessment / FMEA', 'Quality', 'QMS', ['Item / function', 'Potential failure mode', 'Potential effect', 'Severity (1-10)', 'Potential cause', 'Occurrence (1-10)', 'Current controls', 'Detection (1-10)', 'RPN', 'Required action', 'Owner', 'Due date', 'Residual risk / status']),
    form('VV-FRM-010', 'Bill of Materials (BOM)', 'Quality', 'QMS', ['Item', 'Part number', 'Description', 'Drawing / specification', 'Revision', 'Material / grade', 'Supplier / source', 'Quantity', 'Unit', 'Traceability required?', 'Notes']),
    form('VV-FRM-011', 'Supplier Evaluation & Approval', 'Supplier', 'QMS', ['Quality performance', 'Technical capability', 'Capacity', 'Lead time / delivery', 'Certifications / accreditation', 'Traceability', 'Calibration / inspection capability', 'Special process control', 'Cyber / confidentiality capability where relevant', 'Commercial stability', 'Corrective-action responsiveness', 'Overall risk and approval status']),
    form('VV-REG-001', 'Approved Supplier Register', 'Supplier', 'QMS', ['Supplier ID', 'Legal name', 'Category / process', 'Approval status', 'Certification / accreditation', 'Approval date', 'Review due', 'Quality rating', 'Delivery rating', 'Risk level', 'Restrictions', 'Owner']),
    form('VV-FRM-012', 'Incoming Inspection Report', 'Quality', 'QMS', ['Receipt / lot ID', 'Supplier', 'Supplier PO', 'Delivery docket', 'Part / material', 'Supplier lot / heat / batch', 'Quantity received', 'Packaging condition', 'Identification / labelling', 'CoA / CoC received', 'SDS received where applicable', 'Visual inspection', 'Dimensional / document checks', 'Nonconformance reference', 'Accepted quantity', 'Rejected quantity', 'Inspection status', 'Inspector']),
    form('VV-FRM-013', 'Material Identification & Release', 'Quality', 'QMS', ['Internal material ID', 'Material family', 'Manufacturer / trade name', 'Grade', 'Colour', 'Supplier', 'Supplier batch / lot', 'Received date', 'Certificate reference', 'SDS reference', 'Drying / conditioning requirement', 'Storage requirement', 'Expiry / retest date where applicable', 'Quantity', 'Release status', 'Released by']),
    form('VV-FRM-014', 'Manufacturing Job Traveller', 'Production', 'QMS', ['Operation No.', 'Process / instruction', 'Work instruction / drawing reference', 'Machine / equipment ID', 'Operator', 'Start / finish', 'Quantity in', 'Quantity accepted', 'Quantity rejected', 'Inspection / record reference', 'Signature / e-sign', 'Remarks']),
    form('VV-FRM-015', 'Additive Manufacturing Build Record', 'Production', 'QMS', ['Job / build ID', 'Part number / revision', 'Machine ID / serial number', 'Slicer / software and version', 'Build file / profile version', 'Material / grade / lot', 'Material condition / drying record', 'Nozzle / laser / resin tank / build platform ID as applicable', 'Layer height', 'Orientation', 'Support strategy', 'Key temperatures / energy settings as applicable', 'Build start / finish', 'Operator', 'Interruptions / alarms', 'Post-processing route', 'Build result', 'Linked inspection / NCR']),
    form('VV-FRM-016', 'Equipment Maintenance Record', 'Machinery', 'QMS', ['Equipment ID', 'Description', 'Manufacturer / model', 'Serial number', 'Maintenance type', 'Trigger / interval', 'Date due', 'Date completed', 'Tasks performed', 'Parts replaced', 'Faults found', 'Functional check', 'Return-to-service status', 'Technician', 'Next due date']),
    form('VV-REG-002', 'Calibration & Measurement Equipment Register', 'Machinery', 'QMS', ['Equipment ID', 'Description', 'Manufacturer / model', 'Serial number', 'Range / resolution', 'Calibration source', 'Certificate No.', 'Last calibrated', 'Due date', 'Status', 'Location', 'Owner', 'Out-of-tolerance action']),
    form('VV-FRM-017', 'First Article Inspection (FAI) Report', 'Quality', 'QMS', ['FAI No.', 'Date', 'Customer', 'Part number / revision', 'Job / PO', 'Manufacturing route', 'Material / lot', 'Drawing / specification', 'Characteristic / balloon No.', 'Requirement / nominal', 'Tolerance', 'Actual result', 'Measurement equipment ID', 'Pass / fail', 'Evidence / attachment', 'Inspector', 'Approval']),
    form('VV-FRM-018', 'In-Process Inspection Report', 'Quality', 'QMS', ['Job', 'Operation', 'Part / revision', 'Lot / serial range', 'Characteristic', 'Specification / tolerance', 'Sampling plan / frequency', 'Results', 'Equipment ID', 'Quantity checked', 'Quantity accepted', 'Quantity rejected', 'NCR reference', 'Inspector']),
    form('VV-FRM-019', 'Final Inspection & Release Report', 'Quality', 'QMS', ['Job', 'Customer', 'PO', 'Part / revision', 'Quantity produced', 'Material / lot', 'Visual inspection', 'Critical dimensions', 'Functional checks', 'Surface finish / workmanship', 'Documentation complete', 'Concessions / deviations', 'NCR status', 'Quantity released', 'Quantity rejected', 'Inspection equipment', 'Final disposition', 'Inspector', 'Quality approval']),
    form('VV-FRM-020', 'Non-Conformance Report (NCR)', 'Quality', 'QMS', ['NCR No.', 'Date', 'Job / part / revision', 'Requirement not met', 'Description of nonconformance', 'Quantity affected', 'Detected at', 'Immediate containment', 'Photos / evidence', 'Suspected cause', 'Disposition: rework / scrap / return / concession', 'Disposition authority', 'Reinspection result', 'Customer approval reference if required', 'Closure approval']),
    form('VV-FRM-021', 'Corrective Action / CAPA', 'Quality', 'QMS', ['CAPA No.', 'Source / trigger', 'Problem statement', 'Immediate containment', 'Scope / affected product', 'Root-cause analysis method', 'Root cause', 'Corrective action', 'Systemic / preventive action where appropriate', 'Owner', 'Due dates', 'Evidence', 'Effectiveness check', 'Residual risk', 'Closure approval']),
    form('VV-FRM-022', 'Deviation / Customer Concession Request', 'Quality', 'QMS', ['Request No.', 'Customer', 'PO / job', 'Part / revision', 'Requirement', 'Actual condition', 'Quantity affected', 'Technical justification', 'Risk assessment', 'Proposed disposition', 'Duration / lot limitation', 'Internal approvals', 'Customer approval / rejection', 'Approval reference', 'Conditions of acceptance']),
    form('VV-FRM-023', 'Certificate of Conformance (CoC)', 'Quality', 'QMS', ['CoC No.', 'Customer', 'Customer PO', 'Voxel Veda job', 'Part number / description', 'Drawing / revision', 'Quantity', 'Material / batch / heat', 'Manufacturing process', 'Applicable specifications', 'Inspection report reference', 'FAI reference where applicable', 'Approved concession references', 'Statement of conformity', 'Authorised quality representative', 'Signature / date']),
    form('VV-FRM-024', 'Packaging & Dispatch Record', 'Operations', 'QMS', ['Dispatch No.', 'Customer', 'Job / PO', 'Part / revision', 'Lot / serial numbers', 'Quantity', 'Packaging method', 'Protection / cleanliness requirements', 'Labels applied', 'Documents included: CoC / inspection / material certificates / FAI', 'Special handling', 'Courier / freight', 'Tracking', 'Dispatch date', 'Packed by', 'Final release']),
    form('VV-FRM-025', 'Customer Complaint / Return Record', 'Client', 'QMS', ['Complaint No.', 'Customer', 'Date received', 'Contact', 'Job / PO / part / revision', 'Quantity affected', 'Complaint description', 'Photos / evidence', 'Safety / regulatory significance', 'Containment', 'Return authorisation', 'Investigation', 'NCR / CAPA reference', 'Customer response', 'Replacement / credit / repair', 'Closure date', 'Customer confirmation', 'Approved by'])
  ];

  const facility = [
    form('VV-FRM-028', 'Emergency Drill & Evacuation Record', 'Safety', 'Facility', ['Drill No.', 'Date', 'Site', 'Scenario', 'Start time', 'Finish time', 'Warden / lead', 'Assembly point', 'Approval / closure'], ['Alarm heard/seen by all?', 'Exits unobstructed?', 'Visitors accounted for?', 'First aid/fire equipment accessible?', 'Any unsafe re-entry?', 'Corrective actions raised?']),
    form('VV-FRM-029', 'Incident / Injury / Near Miss Report', 'Safety', 'Facility', ['Report No.', 'Date/time', 'Location', 'Reported by', 'People involved', 'Equipment / job ID', 'Immediate action', 'Medical treatment required?', 'Approval / closure'], ['Describe event', 'Immediate hazards controlled', 'Product/WIP potentially affected', 'Regulatory notification assessed', 'Root cause/CAPA required', 'Manager review completed']),
    form('VV-REG-004', 'Chemical & SDS Register', 'Environment', 'Facility', ['Product', 'Supplier', 'Hazard / DG class', 'Max quantity', 'Storage location', 'SDS revision/date', 'SDS file link', 'Responsible person', 'Approval / closure']),
    form('VV-FRM-030', 'Chemical Spill / Exposure Record', 'Safety', 'Facility', ['Event No.', 'Date/time', 'Chemical', 'Quantity estimate', 'Location', 'People exposed', 'SDS consulted', 'Emergency services / medical', 'Approval / closure'], ['Area isolated', 'Ignition controls applied if relevant', 'Correct PPE used', 'Waste disposed correctly', 'Stock/register updated', 'CAPA required']),
    form('VV-FRM-031', 'PPE Issue & Inspection Record', 'Safety', 'Facility', ['Employee', 'Role', 'PPE item', 'Standard/spec if applicable', 'Issue date', 'Size', 'Replacement due', 'Authoriser', 'Approval / closure'], ['PPE inspected', 'Training provided', 'Fit/use limitations explained', 'Damaged PPE removed from use']),
    form('VV-FRM-032', 'Machine Isolation / LOTO Permit', 'Machinery', 'Facility', ['Permit No.', 'Equipment ID', 'Job/maintenance task', 'Authorised person', 'Date/time isolated', 'Energy sources', 'Isolation points', 'Stored energy controlled', 'Approval / closure'], ['Affected people notified', 'Normal stop completed', 'Isolation applied', 'Zero-energy state verified', 'Work area inspected before restart', 'Lock/tag removed by authorised process', 'Functional test completed']),
    form('VV-FRM-033', 'Equipment Commissioning & Release Record', 'Machinery', 'Facility', ['Equipment ID', 'Manufacturer/model', 'Serial no.', 'Location', 'Purchase date', 'Commission date', 'Manual received', 'Responsible owner', 'Approval / closure'], ['Electrical/install check complete', 'Risk assessment complete', 'Guards/interlocks checked', 'Maintenance schedule entered', 'Training completed', 'Consumables/SDS controlled', 'Release approved']),
    form('VV-FRM-034', 'Operator Competency Authorisation', 'HR', 'Facility', ['Employee', 'Employee ID', 'Machine/process', 'Training date', 'Trainer/assessor', 'Assessment date', 'Authorisation level', 'Review date', 'Approval / closure'], ['Theory understood', 'Practical setup demonstrated', 'Emergency stop/isolation understood', 'Quality checks demonstrated', 'Limitations communicated']),
    form('VV-FRM-035', 'Process / Engineering Change Request', 'Quality', 'Facility', ['Change No.', 'Requested by', 'Date', 'Affected part/process', 'Affected document rev', 'Reason', 'Proposed implementation date', 'Approver', 'Approval / closure'], ['Risk assessment updated', 'Customer approval needed', 'Validation/FAI needed', 'Training update needed', 'Supplier impact', 'Regulatory/security impact', 'Old revision withdrawn']),
    form('VV-FRM-036', 'Internal Audit Report', 'Quality', 'Facility', ['Audit No.', 'Date', 'Scope', 'Criteria', 'Auditor', 'Area owner', 'Previous findings reviewed', 'Report issue date', 'Approval / closure'], ['Objective evidence sampled', 'Conformities recorded', 'Nonconformities recorded', 'Opportunities for improvement', 'CAPA references', 'Follow-up due date']),
    form('VV-FRM-037', 'Management Review Minutes & Actions', 'Quality', 'Facility', ['Meeting No.', 'Date', 'Chair', 'Attendees', 'Period reviewed', 'Next meeting', 'Minutes owner', 'Approval date', 'Approval / closure'], ['Customer feedback', 'Quality objectives/KPIs', 'NCR/CAPA trends', 'Supplier performance', 'Audit results', 'Resources/capacity', 'Risks/opportunities', 'Changes affecting QMS', 'Improvement actions']),
    form('VV-REG-005', 'Document Master List', 'Quality', 'Facility', ['Document ID', 'Title', 'Revision', 'Owner', 'Approver', 'Effective date', 'Review due', 'Status', 'Approval / closure']),
    form('VV-REG-006', 'Record Retention Register', 'Quality', 'Facility', ['Record type', 'Owner', 'Storage location', 'Retention period', 'Trigger date', 'Security class', 'Disposal method', 'Authority', 'Approval / closure']),
    form('VV-REG-007', 'IT Asset Register', 'Policy', 'Facility', ['Asset ID', 'Device/system', 'Serial/identifier', 'Assigned user', 'OS/version', 'Security status', 'Last patch/review', 'Disposition', 'Approval / closure']),
    form('VV-REG-008', 'User Access & Quarterly Review Register', 'Policy', 'Facility', ['User', 'System/project', 'Role', 'Privilege', 'MFA', 'Approved by', 'Last review', 'Remove/change action', 'Approval / closure']),
    form('VV-FRM-038', 'Backup Restore Test Record', 'Policy', 'Facility', ['Test No.', 'Date', 'System/data set', 'Backup source', 'Tester', 'Restore target', 'Start time', 'Completion time', 'Approval / closure'], ['Backup readable', 'Restore successful', 'Integrity checked', 'RTO/RPO target met if defined', 'Issues/CAPA raised', 'Evidence retained']),
    form('VV-REG-009', 'Visitor / Contractor Security Register', 'Safety', 'Facility', ['Date/time in', 'Name', 'Company', 'Host', 'Purpose', 'Areas approved', 'NDA/induction', 'Time out', 'Approval / closure']),
    form('VV-FRM-039', 'Business Continuity Exercise Record', 'Operations', 'Facility', ['Exercise No.', 'Date', 'Scenario', 'Facilitator', 'Participants', 'Systems/processes tested', 'Target recovery', 'Actual recovery', 'Approval / closure'], ['Customer communication tested', 'Alternative supplier/machine tested', 'Backup/restore considered', 'Safety impacts assessed', 'Actions assigned', 'Re-test date']),
    form('VV-REG-010', 'Waste Disposal Register', 'Environment', 'Facility', ['Date', 'Waste stream', 'Quantity', 'Hazardous?', 'Container/label', 'Contractor/destination', 'Docket/reference', 'Authoriser', 'Approval / closure']),
    form('VV-FRM-040', 'Supplier Quality Issue / SCAR', 'Supplier', 'Facility', ['SCAR No.', 'Supplier', 'PO', 'Part/material', 'Lot/batch', 'Issue date', 'Quantity affected', 'Containment due', 'Approval / closure'], ['Supplier containment received', 'Root cause received', 'Corrective action approved', 'Replacement/credit complete', 'Effectiveness verified', 'Supplier score updated']),
    form('VV-FRM-041', 'Export-Control / Sensitive Data Screening Gate', 'Import / Export', 'Facility', ['Screening No.', 'Customer/project', 'Country/end user', 'Technology/product', 'Data source', 'Reviewer', 'Date', 'Escalation owner', 'Approval / closure'], ['Defence/military use indicated?', 'Dual-use concern?', 'Overseas person/access?', 'Technical data transfer planned?', 'DSGL/legal advice required?', 'Permit/exemption evidence attached?', 'Release authorised?']),
    form('VV-FRM-042', 'Sector Regulatory Release Gate', 'Quality', 'Facility', ['Gate No.', 'Customer/project', 'Sector', 'Part/device', 'Intended use', 'Risk class/criticality if known', 'Reviewer', 'Date', 'Approval / closure'], ['Prototype-only status confirmed', 'Customer regulatory requirements reviewed', 'Required certification/approval available', 'Traceability level defined', 'FAI/validation required', 'CoC wording approved', 'Release authority confirmed'])
  ];

  const controlled = [...qms, ...facility];
  const existingIds = new Set(COMPANY_FORMS.map((item) => item.documentId).filter(Boolean));
  controlled.forEach((item) => {
    if (!existingIds.has(item.documentId)) COMPANY_FORMS.push(item);
  });

  const originalFields = companyFormFields;
  companyFormFields = function controlledCompanyFormFields(selectedForm) {
    if (selectedForm?.controlledDocument && Array.isArray(selectedForm.fields)) {
      return selectedForm.fields.map((field) => ({ ...field, id: companyFormFieldId(field.label) }));
    }
    return originalFields(selectedForm);
  };

  function removeUnavailablePdfActions() {
    document.querySelectorAll('article.form-card').forEach((card) => {
      const text = card.textContent || '';
      const match = controlled.find((item) => text.includes(item.documentId));
      if (!match) return;
      card.querySelectorAll('button, a').forEach((action) => {
        const label = (action.textContent || '').trim();
        if (label === 'Preview PDF' || label === 'Download') action.remove();
      });
      if (!card.querySelector('.controlled-digital-source')) {
        const badge = document.createElement('div');
        badge.className = 'form-record-line controlled-digital-source';
        badge.textContent = `${match.documentId} • Rev ${match.revision} • ${match.sourcePack === 'QMS' ? 'QMS Controlled Pack' : 'Facility & Operations Controlled Pack'} • Digital controlled record`;
        const actions = card.querySelector('.form-action-stack');
        if (actions) card.insertBefore(badge, actions);
      }
    });
  }

  const originalRender = renderCompanyForms;
  renderCompanyForms = function controlledRenderCompanyForms() {
    const result = originalRender.apply(this, arguments);
    removeUnavailablePdfActions();
    return result;
  };

  const categorySelect = document.getElementById('companyFormCategory');
  if (categorySelect) {
    const available = new Set([...categorySelect.options].map((option) => option.value || option.textContent));
    [...new Set(controlled.map((item) => item.category))].forEach((category) => {
      if (!available.has(category)) categorySelect.add(new Option(category, category));
    });
  }

  renderCompanyForms();
  window.voxelVedaControlledForms = { count: controlled.length, revision: REVISION, documentIds: controlled.map((item) => item.documentId) };
})();
