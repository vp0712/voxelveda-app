'use strict';
const assert=require('node:assert/strict');
const {emailTransportReadiness:check}=require('../services/emailTransportReadiness');
const {CONTROL_STATES:S}=require('../services/runtimeState');

assert.equal(check({transport:'resend',configured:true,connectivity_verified:true,credentials_verified:false,sender_domain_verified:false}).state,S.CONFIGURED);
assert.equal(check({transport:'resend',verification:'CONFIGURED',recipient_receipt_verified:false}).state,S.CONFIGURED);
assert.equal(check({transport:'resend',credentials_verified:true,sender_domain_verified:false}).state,S.OPERATIONAL);
assert.equal(check({transport:'resend',credentials_verified:false,sender_domain_verified:true}).state,S.CONFIGURED,'A domain flag alone cannot verify sending credentials');
const verified=check({transport:'resend',credentials_verified:true,sender_domain_verified:true});
assert.equal(verified.state,S.EXTERNALLY_VERIFIED);
assert.match(verified.detail,/recipient delivery is not confirmed/);
assert.equal(check(undefined,'resend').state,S.CONFIGURED,'Sending-access API keys need not have permission to list domains');
for(const transport of ['smtp','https_relay'])assert.equal(check({transport}).state,S.EXTERNALLY_VERIFIED);
console.log('Email readiness passed: Resend configuration, authenticated access, sender identity and recipient evidence remain distinct; restricted sending keys do not become false external-verification claims.');
