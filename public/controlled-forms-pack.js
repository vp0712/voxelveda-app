(() => {
  'use strict';

  const CONTROLLED_PACK_VERSION = '20260908-controlled-packs-v1';
  const CONTROLLED_PACKS = [
    {
      category: 'Quality',
      title: 'Manufacturing QMS - Controlled Forms & Records',
      documentId: 'VV-QMS-FORMS-MASTER',
      revision: '1.0',
      sourcePages: 33,
      file: 'https://at.adobe.com/Q6fsFKpg97D8If0d',
      visual: 'safety',
      controlledSourcePack: true,
      note: 'Controlled manufacturing quality pack containing the Voxel Veda QMS forms and registers, including customer/RFQ, design, supplier, material, manufacturing, inspection, NCR/CAPA, conformance, packaging/dispatch and complaint records.'
    },
    {
      category: 'Operations',
      title: 'Facility, Operations & Compliance Master Plan',
      documentId: 'VV-FAC-001',
      revision: '1.0',
      sourcePages: 43,
      file: 'https://at.adobe.com/kEVp7WlQquMMEHtb',
      visual: 'machine',
      controlledSourcePack: true,
      note: 'Controlled facility and operations pack covering facility planning, safety/security procedures, compliance planning and the additional controlled forms/registers VV-FRM-028 through VV-FRM-042.'
    }
  ];

  const CONTROLLED_DOCUMENT_INDEX = [
    ['Quality', 'VV-FRM-001', 'Customer Enquiry / Request for Quotation (RFQ)', 3],
    ['Quality', 'VV-FRM-002', 'NDA & Confidentiality Register', 5],
    ['Quality', 'VV-FRM-003', 'Contract Review & Order Acceptance', 6],
    ['Quality', 'VV-FRM-004', 'Manufacturing Quotation', 7],
    ['Quality', 'VV-FRM-005', 'Purchase Order Review & Release', 9],
    ['Quality', 'VV-FRM-006', 'Design Input Record', 10],
    ['Quality', 'VV-FRM-007', 'Design Review Record', 11],
    ['Quality', 'VV-FRM-008', 'Design Verification Record', 12],
    ['Quality', 'VV-FRM-009', 'Engineering Risk Assessment / FMEA', 14],
    ['Quality', 'VV-FRM-010', 'Bill of Materials (BOM)', 15],
    ['Supplier', 'VV-FRM-011', 'Supplier Evaluation & Approval', 16],
    ['Supplier', 'VV-REG-001', 'Approved Supplier Register', 17],
    ['Quality', 'VV-FRM-012', 'Incoming Inspection Report', 18],
    ['Quality', 'VV-FRM-013', 'Material Identification & Release', 19],
    ['Production', 'VV-FRM-014', 'Manufacturing Job Traveller', 20],
    ['Production', 'VV-FRM-015', 'Additive Manufacturing Build Record', 21],
    ['Machinery', 'VV-FRM-016', 'Equipment Maintenance Record', 22],
    ['Machinery', 'VV-REG-002', 'Calibration & Measurement Equipment Register', 23],
    ['Quality', 'VV-FRM-017', 'First Article Inspection (FAI) Report', 24],
    ['Quality', 'VV-FRM-018', 'In-Process Inspection Report', 25],
    ['Quality', 'VV-FRM-019', 'Final Inspection & Release Report', 26],
    ['Quality', 'VV-FRM-020', 'Non-Conformance Report (NCR)', 27],
    ['Quality', 'VV-FRM-021', 'Corrective Action / CAPA', 28],
    ['Quality', 'VV-FRM-022', 'Deviation / Customer Concession Request', 29],
    ['Quality', 'VV-FRM-023', 'Certificate of Conformance (CoC)', 30],
    ['Operations', 'VV-FRM-024', 'Packaging & Dispatch Record', 32],
    ['Client', 'VV-FRM-025', 'Customer Complaint / Return Record', 33],
    ['Safety', 'VV-FRM-028', 'Emergency Drill & Evacuation Record', 19, 'facility'],
    ['Safety', 'VV-FRM-029', 'Incident / Injury / Near Miss Report', 20, 'facility'],
    ['Safety', 'VV-REG-004', 'Chemical & SDS Register', 21, 'facility'],
    ['Safety', 'VV-FRM-030', 'Chemical Spill / Exposure Record', 22, 'facility'],
    ['Safety', 'VV-FRM-031', 'PPE Issue & Inspection Record', 23, 'facility'],
    ['Machinery', 'VV-FRM-032', 'Machine Isolation / LOTO Permit', 24, 'facility'],
    ['Machinery', 'VV-FRM-033', 'Equipment Commissioning & Release Record', 25, 'facility'],
    ['HR', 'VV-FRM-034', 'Operator Competency Authorisation', 26, 'facility'],
    ['Operations', 'VV-FRM-035', 'Process / Engineering Change Request', 27, 'facility'],
    ['Quality', 'VV-FRM-036', 'Internal Audit Report', 28, 'facility'],
    ['Quality', 'VV-FRM-037', 'Management Review Minutes & Actions', 29, 'facility'],
    ['Quality', 'VV-REG-005', 'Document Master List', 30, 'facility'],
    ['Quality', 'VV-REG-006', 'Record Retention Register', 31, 'facility'],
    ['Operations', 'VV-REG-007', 'IT Asset Register', 32, 'facility'],
    ['Operations', 'VV-REG-008', 'User Access & Quarterly Review Register', 33, 'facility'],
    ['Operations', 'VV-FRM-038', 'Backup Restore Test Record', 34, 'facility'],
    ['Safety', 'VV-REG-009', 'Visitor / Contractor Security Register', 35, 'facility'],
    ['Operations', 'VV-FRM-039', 'Business Continuity Exercise Record', 36, 'facility'],
    ['Environment', 'VV-REG-010', 'Waste Disposal Register', 37, 'facility'],
    ['Supplier', 'VV-FRM-040', 'Supplier Quality Issue / SCAR', 38, 'facility'],
    ['Import / Export', 'VV-FRM-041', 'Export-Control / Sensitive Data Screening Gate', 39, 'facility'],
    ['Quality', 'VV-FRM-042', 'Sector Regulatory Release Gate', 40, 'facility']
  ];

  function sourceFor(row) {
    const facility = row[4] === 'facility';
    const pack = facility ? CONTROLLED_PACKS[1] : CONTROLLED_PACKS[0];
    return {
      category: row[0],
      title: `${row[1]} - ${row[2]}`,
      documentId: row[1],
      revision: '1.0',
      sourcePage: row[3],
      file: pack.file,
      visual: row[0] === 'Machinery' ? 'machine' : row[0] === 'Safety' ? 'safety' : row[0] === 'Supplier' ? 'supplier' : 'contract',
      controlledSourceOnly: true,
      note: `Controlled record from ${facility ? 'VV-FAC-001 Facility, Operations & Compliance Master Plan' : 'Manufacturing QMS Controlled Forms & Records'}, Revision 1.0. Source page ${row[3]}. Use the controlled source layout for completion and approval.`
    };
  }

  function installControlledForms() {
    if (typeof COMPANY_FORMS === 'undefined') return false;
    const existing = new Set(COMPANY_FORMS.map((form) => String(form.documentId || form.title || '').toLowerCase()));
    [...CONTROLLED_PACKS, ...CONTROLLED_DOCUMENT_INDEX.map(sourceFor)].forEach((form) => {
      const key = String(form.documentId || form.title || '').toLowerCase();
      if (!existing.has(key)) {
        COMPANY_FORMS.push(form);
        existing.add(key);
      }
    });

    if (typeof openCompanyFormFiller === 'function' && !window.__vvControlledFormFillerWrapped) {
      window.__vvControlledFormFillerWrapped = true;
      const baseFiller = openCompanyFormFiller;
      openCompanyFormFiller = function controlledFormFiller(formKey, recordId = '') {
        const form = typeof findCompanyFormByKey === 'function' ? findCompanyFormByKey(formKey) : null;
        if (form?.controlledSourceOnly || form?.controlledSourcePack) {
          const page = Number(form.sourcePage || 0);
          const pageSuffix = page ? `#page=${page}` : '';
          window.open(`${form.file}${pageSuffix}`, '_blank', 'noopener');
          if (typeof showToast === 'function') showToast('Opening the controlled source document.');
          return;
        }
        return baseFiller(formKey, recordId);
      };
    }

    window.VoxelVedaControlledForms = {
      version: CONTROLLED_PACK_VERSION,
      packs: CONTROLLED_PACKS.map(({ file, ...pack }) => pack),
      indexedDocuments: CONTROLLED_DOCUMENT_INDEX.length
    };

    if (typeof renderCompanyForms === 'function') renderCompanyForms();
    return true;
  }

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (installControlledForms() || attempts >= 40) window.clearInterval(timer);
  }, 100);
})();
