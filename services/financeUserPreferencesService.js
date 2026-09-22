'use strict';

const WORKSPACES = new Set(['ALL','PERSONAL','BUSINESS']);
const PERIODS = new Set(['today','yesterday','week','last7','month','last_month','last30','quarter','previous_quarter','fy','previous_fy','year','custom']);
const DATE_FORMATS = new Set(['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD']);
const NUMBER_FORMATS = new Set(['en-AU','en-US','en-GB']);
const DASHBOARD_CARDS = new Set(['cashflow','expenses','accounts','recent']);

function text(value,max=120){return String(value??'').trim().slice(0,max)}
function normalizePreferences(input={}){
  const default_workspace=text(input.default_workspace||'ALL',20).toUpperCase();
  if(!WORKSPACES.has(default_workspace))throw Object.assign(new Error('Invalid default workspace.'),{statusCode:400,code:'INVALID_DEFAULT_WORKSPACE'});
  const default_period=text(input.default_period||'month',40);
  if(!PERIODS.has(default_period))throw Object.assign(new Error('Invalid default period.'),{statusCode:400,code:'INVALID_DEFAULT_PERIOD'});
  const reporting_currency=text(input.reporting_currency,3).toUpperCase()||null;
  if(reporting_currency&&!/^[A-Z]{3}$/.test(reporting_currency))throw Object.assign(new Error('Reporting currency must be a three-letter ISO code.'),{statusCode:400,code:'INVALID_REPORTING_CURRENCY'});
  const date_format=text(input.date_format||'DD/MM/YYYY',20);
  if(!DATE_FORMATS.has(date_format))throw Object.assign(new Error('Invalid date format.'),{statusCode:400,code:'INVALID_DATE_FORMAT'});
  const number_format=text(input.number_format||'en-AU',20);
  if(!NUMBER_FORMATS.has(number_format))throw Object.assign(new Error('Invalid number format.'),{statusCode:400,code:'INVALID_NUMBER_FORMAT'});
  const dashboard_cards=Array.isArray(input.dashboard_cards)
    ? [...new Set(input.dashboard_cards.map(v=>text(v,60)).filter(v=>DASHBOARD_CARDS.has(v)))].slice(0,20)
    : [];
  const default_account_id=input.default_account_id?Number(input.default_account_id):null;
  if(default_account_id!==null&&(!Number.isInteger(default_account_id)||default_account_id<=0))throw Object.assign(new Error('Invalid default account.'),{statusCode:400,code:'INVALID_DEFAULT_ACCOUNT'});
  return {default_workspace,default_account_id,reporting_currency,default_period,dashboard_cards,date_format,number_format};
}
module.exports={normalizePreferences,WORKSPACES,PERIODS,DATE_FORMATS,NUMBER_FORMATS,DASHBOARD_CARDS};
