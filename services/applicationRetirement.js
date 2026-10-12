'use strict';
// Deliberate compatibility responses for removed features, without loading any
// Banking or ERP implementation or accessing their historical records.
const retiredApi=/^\/api\/(?:banking|finance|high-risk-finance|erp(?:-workspace)?)(?:\/|$)/;
const retiredPublic=/^\/api\/public\/finance-report(?:\/|$)/;
const retiredPage=/^\/(?:finance(?:-intelligence|-reconciliation)?|banking|financial-years|erp(?:-workspace)?|internal\/layout-check)(?:\/|\.html|$)/;
function retiredRequest(path){return [retiredApi,retiredPublic,retiredPage].some(pattern=>pattern.test(String(path||'')))}
function retiredAsset(path){const file=String(path||'').split('/').pop();return /^(?:finance[-.]|personal[-.]|advanced-banking|banking[-.]|premium-banking|erp[-.]|report-viewer\.|workspace-layout-check\.|recovery[-.]|production-readiness-assurance|financial-decision|predictive-money)/i.test(file)}
const retainedDocumentModules=new Set(['profile','security','rfq','invoice','invoices','quotation','quotes','customer','customers','supplier','suppliers','procurement','stock','materials','task','tasks','meeting','meetings','roster','attendance','timesheet','timesheets','expense','expenses','qms','compliance','careers','employee-identities','staff','hr']);
function documentModuleAvailable(module){return retainedDocumentModules.has(String(module||'').toLowerCase())}
module.exports={retiredRequest,retiredAsset,documentModuleAvailable,retainedDocumentModules};
