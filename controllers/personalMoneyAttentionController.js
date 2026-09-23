const crypto = require('node:crypto');
const pool = require('../config/db');

function uid(req) {
  const value = req.user?.id ?? req.user?.user_id;
  if (value === undefined || value === null || value === '') throw Object.assign(new Error('User identity unavailable.'), { statusCode: 401 });
  return String(value);
}

function clean(value, max = 200) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function amount(value, field = 'Amount') {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 999999999999) throw Object.assign(new Error(`${field} must be greater than zero.`), { statusCode: 400 });
  return Math.round(n * 10000) / 10000;
}

function currency(value) {
  const code = String(value || 'AUD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw Object.assign(new Error('Currency must be a three-letter code such as AUD, USD or INR.'), { statusCode: 400 });
  return code;
}

function dateOnly(value, required = false) {
  if (!value && !required) return null;
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw Object.assign(new Error('Date must use YYYY-MM-DD.'), { statusCode: 400 });
  return text;
}

function dateTime(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) throw Object.assign(new Error('Date/time is invalid.'), { statusCode: 400 });
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function respondError(res, error, fallback) {
  const status = Number(error?.statusCode || 500);
  if (status >= 500) console.error(fallback, error);
  return res.status(status).json({ message: status >= 500 ? fallback : error.message });
}

function nextDate(date, frequency) {
  const d = new Date(`${date}T12:00:00Z`);
  if (frequency === 'WEEKLY') d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === 'FORTNIGHTLY') d.setUTCDate(d.getUTCDate() + 14);
  else if (frequency === 'MONTHLY') d.setUTCMonth(d.getUTCMonth() + 1);
  else if (frequency === 'QUARTERLY') d.setUTCMonth(d.getUTCMonth() + 3);
  else if (frequency === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function annualized(value, frequency) {
  const factors = { WEEKLY: 52, FORTNIGHTLY: 26, MONTHLY: 12, QUARTERLY: 4, YEARLY: 1 };
  return Math.round(Number(value || 0) * (factors[frequency] || 0) * 100) / 100;
}

exports.getAttentionCenter = async (req, res) => {
  try {
    const userId = uid(req);
    const [recurring] = await pool.query(
      `SELECT id,name,item_type,amount,currency,frequency,next_due_date,category,counterparty,reminder_days,active,last_completed_date,note
       FROM personal_money_recurring_items WHERE user_id=? AND active=1 ORDER BY next_due_date,name`, [userId]
    );
    const [archivedRecurring] = await pool.query(
      `SELECT id,name,item_type,amount,currency,frequency,next_due_date,category,counterparty,reminder_days,active,last_completed_date,note
       FROM personal_money_recurring_items WHERE user_id=? AND active=0 ORDER BY updated_at DESC LIMIT 100`, [userId]
    );
    const [goals] = await pool.query(
      `SELECT id,name,target_amount,current_amount,currency,target_date,priority,status,note,created_at
       FROM personal_money_savings_goals WHERE user_id=? ORDER BY FIELD(status,'ACTIVE','PAUSED','COMPLETED'), FIELD(priority,'HIGH','MEDIUM','LOW'), target_date IS NULL, target_date`, [userId]
    );
    const [debts] = await pool.query(
      `SELECT id,direction,counterparty,outstanding_amount,currency,due_date,status
       FROM personal_money_debts WHERE user_id=? AND status<>'SETTLED' ORDER BY due_date IS NULL,due_date`, [userId]
    );
    const [budgets] = await pool.query(
      `SELECT b.id,b.month_start,b.category,b.currency,b.limit_amount,
        COALESCE((SELECT SUM(e.wallet_amount) FROM personal_money_entries e
          JOIN personal_money_wallets w ON w.id=e.wallet_id AND w.user_id=e.user_id
          WHERE e.user_id=b.user_id AND w.currency=b.currency AND e.category=b.category
            AND e.entry_type IN ('EXPENSE','CASH_OUT')
            AND e.occurred_at>=b.month_start AND e.occurred_at<DATE_ADD(b.month_start, INTERVAL 1 MONTH)),0) spent_amount
       FROM personal_money_budgets b
       WHERE b.user_id=? AND b.month_start=DATE_FORMAT(CURRENT_DATE,'%Y-%m-01')
       ORDER BY b.category`, [userId]
    );
    const [walletTotalsRows] = await pool.query(
      `SELECT currency,COALESCE(SUM(balance),0) total_balance FROM personal_money_wallets
       WHERE user_id=? AND active=1 GROUP BY currency`, [userId]
    );

    const today = new Date();
    today.setHours(0,0,0,0);
    const inDays = (value) => {
      if (!value) return null;
      const d = new Date(`${String(value).slice(0,10)}T00:00:00`);
      return Math.ceil((d - today) / 86400000);
    };

    const alerts = [];
    recurring.forEach((row) => {
      const days = inDays(row.next_due_date);
      if (days !== null && days <= Number(row.reminder_days || 3)) {
        alerts.push({
          id:`recurring:${row.id}`, type:'RECURRING', severity:days < 0 ? 'URGENT' : days <= 1 ? 'HIGH' : 'MEDIUM',
          title: days < 0 ? `${row.name} is overdue` : `${row.name} is due soon`,
          explanation: days < 0 ? `Due ${Math.abs(days)} day${Math.abs(days)===1?'':'s'} ago.` : days === 0 ? 'Due today.' : `Due in ${days} day${days===1?'':'s'}.`,
          amount:Number(row.amount), currency:row.currency, due_date:row.next_due_date, action:'Mark completed or update the schedule.'
        });
      }
    });
    debts.forEach((row) => {
      const days = inDays(row.due_date);
      if (days !== null && days <= 14) {
        alerts.push({
          id:`debt:${row.id}`, type:'DEBT', severity:days < 0 ? 'URGENT' : days <= 3 ? 'HIGH' : 'MEDIUM',
          title: `${row.direction==='BORROWED'?'Money you borrowed':'Money owed to you'} ${days < 0 ? 'is overdue' : 'is due soon'}`,
          explanation: `${row.counterparty} · ${days < 0 ? `${Math.abs(days)} days overdue` : days===0 ? 'due today' : `due in ${days} days`}.`,
          amount:Number(row.outstanding_amount), currency:row.currency, due_date:row.due_date, action:'Record a repayment or update the due date.'
        });
      }
    });
    budgets.forEach((row) => {
      const limit = Number(row.limit_amount || 0); const spent = Number(row.spent_amount || 0); const pct = limit > 0 ? spent / limit * 100 : 0;
      if (pct >= 80) alerts.push({
        id:`budget:${row.id}`, type:'BUDGET', severity:pct >= 100 ? 'HIGH' : 'MEDIUM',
        title: pct >= 100 ? `${row.category} budget is over limit` : `${row.category} budget is getting close`,
        explanation:`${Math.round(pct)}% used this month.`, amount:spent, currency:row.currency,
        action:pct >= 100 ? 'Review recent spending and adjust only if the limit was unrealistic.' : 'Keep an eye on new spending in this category.'
      });
    });
    goals.forEach((row) => {
      if (row.status !== 'ACTIVE') return;
      const remaining = Math.max(0, Number(row.target_amount) - Number(row.current_amount));
      const days = inDays(row.target_date);
      if (days !== null && days <= 30 && remaining > 0) alerts.push({
        id:`goal:${row.id}`, type:'GOAL', severity:days < 0 ? 'HIGH' : 'MEDIUM',
        title: days < 0 ? `${row.name} target date has passed` : `${row.name} target date is approaching`,
        explanation:`${remaining.toFixed(2)} ${row.currency} still needed${days < 0 ? '.' : ` within ${days} days.`}`,
        amount:remaining, currency:row.currency, due_date:row.target_date, action:'Add progress or change the target date.'
      });
    });

    const recurringTotals = {};
    recurring.filter((r) => r.item_type !== 'INCOME').forEach((r) => {
      recurringTotals[r.currency] = (recurringTotals[r.currency] || 0) + annualized(r.amount, r.frequency);
    });
    Object.keys(recurringTotals).forEach((code) => { recurringTotals[code] = Math.round(recurringTotals[code] * 100) / 100; });

    const walletTotals = Object.fromEntries(walletTotalsRows.map((r) => [r.currency, Number(r.total_balance || 0)]));
    const due30 = {};
    recurring.filter((r) => r.item_type !== 'INCOME').forEach((r) => {
      const days = inDays(r.next_due_date); if (days !== null && days >= 0 && days <= 30) due30[r.currency] = (due30[r.currency] || 0) + Number(r.amount || 0);
    });
    debts.filter((d) => d.direction === 'BORROWED').forEach((d) => {
      const days = inDays(d.due_date); if (days !== null && days >= 0 && days <= 30) due30[d.currency] = (due30[d.currency] || 0) + Number(d.outstanding_amount || 0);
    });
    const headroom = Object.fromEntries(Object.entries(walletTotals).map(([code,balance]) => [code, Math.round((balance - Number(due30[code] || 0)) * 100) / 100]));

    const enrichedGoals = goals.map((g) => {
      const target = Number(g.target_amount || 0); const current = Number(g.current_amount || 0); const remaining = Math.max(0,target-current);
      const days = inDays(g.target_date);
      const months = days !== null && days > 0 ? Math.max(1, days / 30.4375) : null;
      return { ...g, target_amount:target, current_amount:current, remaining_amount:remaining,
        progress_percent:target>0?Math.min(100,Math.round(current/target*1000)/10):0,
        suggested_monthly_contribution:months?Math.round(remaining/months*100)/100:null };
    });

    const severityRank = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return res.json({
      explanation:'Attention Center shows reminders and planning signals only. It never pays bills, moves money, or posts company accounting entries automatically.',
      alerts: alerts.sort((a,b) => (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99)),
      recurring: recurring.map((r) => ({ ...r, amount:Number(r.amount), annualized_cost:r.item_type==='INCOME'?0:annualized(r.amount,r.frequency) })),
      archived_recurring: archivedRecurring.map((r) => ({ ...r, amount:Number(r.amount) })),
      goals: enrichedGoals,
      current_budgets: budgets.map((b) => ({ ...b, limit_amount:Number(b.limit_amount), spent_amount:Number(b.spent_amount), used_percent:Number(b.limit_amount)>0?Math.round(Number(b.spent_amount)/Number(b.limit_amount)*1000)/10:0 })),
      annual_recurring_cost_by_currency: recurringTotals,
      estimated_30_day_obligations_by_currency: due30,
      wallet_headroom_after_known_30_day_obligations: headroom
    });
  } catch (error) { return respondError(res,error,'Failed to load Smart Money Attention Center.'); }
};

exports.createRecurring = async (req,res) => {
  try {
    const userId=uid(req); const name=clean(req.body.name,160); if(!name) throw Object.assign(new Error('Name is required.'),{statusCode:400});
    const type=String(req.body.item_type||'BILL').toUpperCase(); if(!['BILL','SUBSCRIPTION','INCOME'].includes(type)) throw Object.assign(new Error('Choose Bill, Subscription or Income.'),{statusCode:400});
    const frequency=String(req.body.frequency||'MONTHLY').toUpperCase(); if(!['WEEKLY','FORTNIGHTLY','MONTHLY','QUARTERLY','YEARLY'].includes(frequency)) throw Object.assign(new Error('Choose a supported frequency.'),{statusCode:400});
    const reminder=Math.max(0,Math.min(60,Number(req.body.reminder_days ?? 3)||0)); const id=crypto.randomUUID();
    await pool.query(`INSERT INTO personal_money_recurring_items (id,user_id,name,item_type,amount,currency,frequency,next_due_date,category,counterparty,reminder_days,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,userId,name,type,amount(req.body.amount),currency(req.body.currency),frequency,dateOnly(req.body.next_due_date,true),clean(req.body.category,100),clean(req.body.counterparty,160),reminder,clean(req.body.note,500)]);
    return res.status(201).json({message:'Recurring item saved. Nothing will be paid automatically.',id});
  } catch(error){ return respondError(res,error,'Failed to save recurring item.'); }
};

exports.completeRecurring = async (req,res) => {
  try {
    const userId=uid(req); const [[row]]=await pool.query(`SELECT id,frequency,next_due_date FROM personal_money_recurring_items WHERE id=? AND user_id=? AND active=1 LIMIT 1`,[req.params.id,userId]);
    if(!row) throw Object.assign(new Error('Recurring item not found.'),{statusCode:404});
    const completed=dateOnly(req.body.completed_date)||new Date().toISOString().slice(0,10); const next=nextDate(row.next_due_date,row.frequency);
    await pool.query(`UPDATE personal_money_recurring_items SET last_completed_date=?,next_due_date=? WHERE id=? AND user_id=?`,[completed,next,row.id,userId]);
    return res.json({message:`Marked completed. Next due date moved to ${next}. No payment transaction was created.`,next_due_date:next});
  } catch(error){ return respondError(res,error,'Failed to update recurring item.'); }
};

exports.setRecurringActive = async (req,res) => {
  try {
    const userId=uid(req); const active=Boolean(req.body.active);
    const [result]=await pool.query('UPDATE personal_money_recurring_items SET active=? WHERE id=? AND user_id=?',[active?1:0,req.params.id,userId]);
    if(!result.affectedRows) return res.status(404).json({message:'Recurring item not found.'});
    return res.json({message:active?'Recurring item restored.':'Recurring item archived. No bank payment or transaction was created.'});
  } catch(error){ return respondError(res,error,'Failed to update recurring item.'); }
};

exports.setGoalStatus = async (req,res) => {
  try {
    const userId=uid(req); const status=String(req.body.status||'').trim().toUpperCase();
    if(!['ACTIVE','PAUSED'].includes(status)) return res.status(400).json({message:'Savings goal status can only be Active or Paused here. Completion is driven by recorded progress.'});
    const [[goal]]=await pool.query('SELECT id,status FROM personal_money_savings_goals WHERE id=? AND user_id=? LIMIT 1',[req.params.id,userId]);
    if(!goal) return res.status(404).json({message:'Savings goal not found.'});
    if(goal.status==='COMPLETED') return res.status(409).json({message:'Completed savings goals are not reopened automatically.'});
    await pool.query('UPDATE personal_money_savings_goals SET status=? WHERE id=? AND user_id=?',[status,goal.id,userId]);
    return res.json({message:status==='PAUSED'?'Savings goal paused.':'Savings goal resumed.'});
  } catch(error){ return respondError(res,error,'Failed to update savings goal.'); }
};

exports.createGoal = async (req,res) => {
  try {
    const userId=uid(req); const name=clean(req.body.name,160); if(!name) throw Object.assign(new Error('Goal name is required.'),{statusCode:400});
    const target=amount(req.body.target_amount,'Target amount'); const current=req.body.current_amount?Math.max(0,Number(req.body.current_amount)||0):0;
    if(current>target) throw Object.assign(new Error('Current progress cannot exceed the target amount.'),{statusCode:400});
    const priority=String(req.body.priority||'MEDIUM').toUpperCase(); if(!['LOW','MEDIUM','HIGH'].includes(priority)) throw Object.assign(new Error('Choose Low, Medium or High priority.'),{statusCode:400});
    const id=crypto.randomUUID();
    await pool.query(`INSERT INTO personal_money_savings_goals (id,user_id,name,target_amount,current_amount,currency,target_date,priority,note) VALUES (?,?,?,?,?,?,?,?,?)`,
      [id,userId,name,target,current,currency(req.body.currency),dateOnly(req.body.target_date),priority,clean(req.body.note,500)]);
    return res.status(201).json({message:'Savings goal created. This tracks progress only; no money was moved.',id});
  } catch(error){ return respondError(res,error,'Failed to create savings goal.'); }
};

exports.addGoalContribution = async (req,res) => {
  const db=await pool.getConnection();
  try {
    const userId=uid(req); const contribution=amount(req.body.amount); await db.beginTransaction();
    const [[goal]]=await db.query(`SELECT id,target_amount,current_amount,status FROM personal_money_savings_goals WHERE id=? AND user_id=? LIMIT 1 FOR UPDATE`,[req.params.id,userId]);
    if(!goal) throw Object.assign(new Error('Savings goal not found.'),{statusCode:404});
    if(goal.status!=='ACTIVE') throw Object.assign(new Error('Only active goals can receive progress updates.'),{statusCode:409});
    if(Number(goal.current_amount)+contribution>Number(goal.target_amount)+0.0001) throw Object.assign(new Error('Contribution cannot exceed the remaining goal amount.'),{statusCode:400});
    const newAmount=Math.round((Number(goal.current_amount)+contribution)*10000)/10000; const status=newAmount>=Number(goal.target_amount)-0.0001?'COMPLETED':'ACTIVE';
    await db.query(`INSERT INTO personal_money_goal_contributions (id,user_id,goal_id,amount,contributed_at,note) VALUES (?,?,?,?,?,?)`,[crypto.randomUUID(),userId,goal.id,contribution,dateTime(req.body.contributed_at),clean(req.body.note,500)]);
    await db.query(`UPDATE personal_money_savings_goals SET current_amount=?,status=? WHERE id=? AND user_id=?`,[newAmount,status,goal.id,userId]);
    await db.commit();
    return res.json({message:status==='COMPLETED'?'Goal completed. No wallet balance was changed automatically.':'Goal progress updated. No wallet balance was changed automatically.',current_amount:newAmount,status});
  } catch(error){ await db.rollback().catch(()=>{}); return respondError(res,error,'Failed to update goal progress.'); }
  finally{ db.release(); }
};