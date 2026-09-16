function parseDate(value){
  const s=String(value||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Invalid recurrence date.');
  const [y,m,d]=s.split('-').map(Number);
  return {y,m,d};
}
function daysInMonth(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate();}
function fmt(y,m,d){return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
function addMonthsClamped(value,months){
  const {y,m,d}=parseDate(value), wasMonthEnd=d===daysInMonth(y,m);
  const zero=(y*12+(m-1))+Number(months||0), ny=Math.floor(zero/12), nm=(zero%12+12)%12+1;
  const nd=wasMonthEnd?daysInMonth(ny,nm):Math.min(d,daysInMonth(ny,nm));
  return fmt(ny,nm,nd);
}
function addYearsClamped(value,years){
  const {y,m,d}=parseDate(value), ny=y+Number(years||0), wasMonthEnd=d===daysInMonth(y,m);
  const nd=wasMonthEnd?daysInMonth(ny,m):Math.min(d,daysInMonth(ny,m));
  return fmt(ny,m,nd);
}
function addDays(value,days){
  const {y,m,d}=parseDate(value), x=new Date(Date.UTC(y,m-1,d));
  x.setUTCDate(x.getUTCDate()+Number(days||0));
  return x.toISOString().slice(0,10);
}
function nextRecurringDate(value,frequency){
  const f=String(frequency||'').toUpperCase();
  if(f==='WEEKLY')return addDays(value,7);
  if(f==='FORTNIGHTLY')return addDays(value,14);
  if(f==='MONTHLY')return addMonthsClamped(value,1);
  if(f==='QUARTERLY')return addMonthsClamped(value,3);
  if(f==='YEARLY')return addYearsClamped(value,1);
  throw new Error(`Unsupported recurrence frequency: ${f}`);
}
module.exports={nextRecurringDate,addMonthsClamped,addYearsClamped};
