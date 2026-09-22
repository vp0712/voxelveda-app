'use strict';

const WORKSPACES = new Set(['ALL','PERSONAL','BUSINESS']);
const PERIODS = new Set(['today','yesterday','week','last7','month','last_month','last30','quarter','previous_quarter','fy','previous_fy','year','custom']);
const CATEGORY_SCOPES = new Set(['PERSONAL','BUSINESS','BOTH']);
const GST_DEFAULTS = new Set(['REVIEW','GST','GST_FREE','INPUT_TAXED','NOT_APPLICABLE']);
const DATE_FORMATS = new Set(['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD']);
const NUMBER_FORMATS = new Set(['en-AU','en-US','en-GB']);

function text(value,max=120){const v=String(value??'').trim();return v.slice(0,max)}
function normalizeCategory(input={}){
 const name=text(input.name,120); if(name.length<2) throw Object.assign(new Error('Category name must be at least 2 characters.'),{statusCode:400,code:'INVALID_CATEGORY_NAME'});
 const scope=text(input.scope||'BOTH',20).toUpperCase(); if(!CATEGORY_SCOPES.has(scope)) throw Object.assign(new Error('Category scope must be Personal, Business or Both.'),{statusCode:400,code:'INVALID_CATEGORY_SCOPE'});
 const gst=text(input.gst_default||'REVIEW',20).toUpperCase(); if(!GST_DEFAULTS.has(gst)) throw Object.assign(new Error('Choose a valid GST default.'),{statusCode:400,code:'INVALID_CATEGORY_GST_DEFAULT'});
 const colour=text(input.colour,20)||null; if(colour && !/^#[0-9a-f]{6}$/i.test(colour)) throw Object.assign(new Error('Category colour must be a six-digit hex colour.'),{statusCode:400,code:'INVALID_CATEGORY_COLOUR'});
 return {name,scope,gst_default:gst,colour,icon:text(input.icon,40)||null,parent_category_id:input.parent_category_id?Number(input.parent_category_id):null};
}
function normalizePreferences(input={}){
 const default_workspace=text(input.default_workspace||'ALL',20).toUpperCase(); if(!WORKSPACES.has(default_workspace)) throw Object.assign(new Error('Invalid default workspace.'),{statusCode:400,code:'INVALID_DEFAULT_WORKSPACE'});
 const default_period=text(input.default_period||'month',40); if(!PERIODS.has(default_period)) throw Object.assign(new Error('Invalid default period.'),{statusCode:400,code:'INVALID_DEFAULT_PERIOD'});
 const reporting_currency=text(input.reporting_currency,3).toUpperCase()||null; if(reporting_currency&&!/^[A-Z]{3}$/.test(reporting_currency)) throw Object.assign(new Error('Reporting currency must be a three-letter ISO code.'),{statusCode:400,code:'INVALID_REPORTING_CURRENCY'});
 const date_format=text(input.date_format||'DD/MM/YYYY',20); if(!DATE_FORMATS.has(date_format)) throw Object.assign(new Error('Invalid date format.'),{statusCode:400,code:'INVALID_DATE_FORMAT'});
 const number_format=text(input.number_format||'en-AU',20); if(!NUMBER_FORMATS.has(number_format)) throw Object.assign(new Error('Invalid number format.'),{statusCode:400,code:'INVALID_NUMBER_FORMAT'});
 let dashboard_cards=[]; if(Array.isArray(input.dashboard_cards)) dashboard_cards=input.dashboard_cards.map(v=>text(v,60)).filter(Boolean).slice(0,40);
 return {default_workspace,default_account_id:input.default_account_id?Number(input.default_account_id):null,reporting_currency,default_period,dashboard_cards,date_format,number_format};
}
module.exports={normalizeCategory,normalizePreferences,CATEGORY_SCOPES,GST_DEFAULTS,WORKSPACES,PERIODS};
