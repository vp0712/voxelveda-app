'use strict';
const { queueDocumentEmail } = require('./documentDeliveryService');
const { validateRecipients } = require('./emailService');
function releaseVerificationData(id) {
  return { title:'DOCUMENT DELIVERY VERIFICATION', reference:`RELEASE-${id}`, filename:`voxel-veda-release-${id}`, issueDate:'2026-10-11',
    columns:[{label:'Verification',width:2},{label:'Expected result',width:3}],rows:[['Document identity',`RELEASE-${id}`],['File format','Genuine parser-validated PDF'],['Attachment metadata','application/pdf; .pdf filename'],['Sender','info@voxelveda.com']],
    notes:['Authorised release test. This is a delivery verification fixture and does not represent a customer, supplier, invoice, purchase order or payroll record.','Provider acceptance is tracked separately from recipient receipt and opening.'] };
}
async function queueAuthorisedReleasePdf() {
  const recipient=String(process.env.VV_RELEASE_TEST_RECIPIENT || '').trim();
  const id=String(process.env.VV_RELEASE_TEST_ID || '').trim();
  if(!recipient || !id)return {enabled:false};
  if(!/^[a-zA-Z0-9_-]{1,60}$/.test(id))throw new Error('Release test ID must contain only letters, numbers, underscores or hyphens.');
  const result=await queueDocumentEmail({module:'security',recordId:`release:${id}`,data:releaseVerificationData(id),to:validateRecipients(recipient,'to'),
    subject:`Voxel Veda PDF release verification ${id}`,text:`The authorised release verification PDF RELEASE-${id} is attached. Please open it and verify the document identity and PDF filename. This message does not represent business records.`});
  return {enabled:true,...result};
}
module.exports={queueAuthorisedReleasePdf,releaseVerificationData};
