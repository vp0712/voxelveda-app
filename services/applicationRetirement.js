'use strict';
// Deliberate compatibility responses for removed features, without loading any
// Banking or ERP implementation or accessing their historical records.
const retiredApi=/^\/api\/(?:banking|finance|high-risk-finance|erp|dashboard|rfq|invoice|customers|suppliers|procurement|stock|materials|tasks|meetings|roster|attendance|expenses|qms|compliance|competitors|workflows|trash|careers|employee-identities|email|upload|notifications|integrations|access-attempts)(?:\/|$)/;
const retiredSecurity=/^\/api\/security\/(?:operations|assurance|governance)(?:\/|$)/;
const retiredPublic=/^\/api\/public\/(?:finance-report|careers|employee-id|shift-qr|qms|ai-lead)(?:\/|$)/;
const retiredPage=/^\/(?:finance(?:-intelligence|-reconciliation)?|banking|financial-years|quality|shop-floor|attendance-terminal|employee-id|employee\/verify|careers-admin|invoice|invoices|approvals|internal\/layout-check|rfqs|customers|suppliers|procurement|inventory|stock|tasks|roster|timesheets|expenses|qms|compliance|workflows|trash)(?:\/|\.html|$)/;
function retiredRequest(path){return [retiredApi,retiredSecurity,retiredPublic,retiredPage].some(pattern=>pattern.test(String(path||'')))}
function retiredAsset(path){const file=String(path||'').split('/').pop();return /^(?:finance[-.]|personal[-.]|advanced-banking|banking[-.]|premium-banking|erp[-.]|report-viewer\.|expense-payments\.|procurement[-.]|workflow[-.]|controlled-forms\.|quality\.|shop-floor\.|shift-qr|staff\.|role-portal\.|workspace-layout-check\.|recovery[-.]|production-readiness-assurance|financial-decision|predictive-money)/i.test(file)}
const retainedDocumentModules=new Set(['rfq','profile','security']);
function documentModuleAvailable(module){return retainedDocumentModules.has(String(module||'').toLowerCase())}
module.exports={retiredRequest,retiredAsset,documentModuleAvailable,retainedDocumentModules};
