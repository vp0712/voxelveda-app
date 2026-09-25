(() => {
  const ROLE_CONFIG = {
    staff: {
      label: 'Staff', title: 'My Work Portal', subtitle: 'Your shifts, assigned work, attendance, forms and company updates in one focused workspace.',
      mission: 'Ready for your workday', status: 'Review your shift, priorities and required records before starting work.',
      focus: 'Complete assigned work safely, accurately and on time.',
      cards: [
        ['Shift','Attendance','Clock in or out and review weekly hours.','timesheetSection','attendance'],
        ['Work','My Tasks','See assigned, due and overdue tasks.','tasksSection','tasks'],
        ['Schedule','Roster','Check upcoming shifts and roster notes.','rosterSection','roster'],
        ['Records','Forms & SOPs','Open controlled forms and company documents.','formsSection','forms']
      ]
    },
    hr: {
      label: 'Human Resources', title: 'People & HR Control Centre', subtitle: 'Workforce attendance, payroll readiness, training, approvals and employee administration.',
      mission: 'People operations overview', status: 'Focus on attendance exceptions, timesheet approvals, training and workforce actions.',
      focus: 'Keep workforce records accurate, compliant and actioned.',
      cards: [
        ['People','Workforce Records','Review staff attendance and workforce records.','timesheetSection','attendance'],
        ['Approvals','HR Approvals','Action employee and workflow approvals.','approvalsSection','approvals'],
        ['Planning','Roster & Availability','Coordinate staffing availability and schedules.','rosterSection','roster'],
        ['Compliance','Training & Forms','Maintain employee training and controlled records.','formsSection','forms']
      ]
    },
    production: {
      label: 'Production', title: 'Production Floor Portal', subtitle: 'Production tasks, materials, stock movements, inspections and shop-floor execution.',
      mission: 'Production shift control', status: 'Check work queue, material availability, quality requirements and shift status.',
      focus: 'Move work through production without sacrificing traceability or quality.',
      cards: [
        ['Execution','Production Tasks','Open assigned production work and priorities.','tasksSection','tasks'],
        ['Material','Stock & Material','Check stock in, stock out and raw material.','rawMaterialSection','stock'],
        ['Quality','Inspection Records','Open controlled quality and production forms.','formsSection','forms'],
        ['Supply','Procurement','Raise or track material procurement activity.','procurementSection','procurement']
      ]
    },
    supervisor: {
      label: 'Supervisor', title: 'Supervisor Control Tower', subtitle: 'Team execution, approvals, attendance, inspections and production coordination.',
      mission: 'Team floor control', status: 'Resolve blockers, review overdue work and keep the team moving safely.',
      focus: 'Coordinate people, work and quality at the point of execution.',
      cards: [
        ['Team','Team Tasks','Review team workload and overdue actions.','tasksSection','tasks'],
        ['Approval','Operational Approvals','Action requests waiting on supervision.','approvalsSection','approvals'],
        ['Quality','Inspections','Open meeting, inspection and quality controls.','meetingsSection','meetings'],
        ['Time','Team Timesheets','Review attendance and team time records.','timesheetSection','attendance']
      ]
    },
    manager: {
      label: 'Manager', title: 'Manager Operations Command', subtitle: 'Cross-functional priorities, approvals, customers, procurement and team performance.',
      mission: 'Operational command view', status: 'Prioritise exceptions, approvals, delivery commitments and cross-team blockers.',
      focus: 'Make fast, evidence-based decisions across customers, people and operations.',
      cards: [
        ['Control','Approvals','Review business and operational approval queues.','approvalsSection','approvals'],
        ['Delivery','Team Work','Open team jobs, workload and delivery actions.','tasksSection','tasks'],
        ['Supply','Procurement','Review requisitions, orders and receiving flow.','procurementSection','procurement'],
        ['Client','Customers','Review customer and delivery context.','staffCustomerSection','customers']
      ]
    },
    sales: {
      label: 'Sales', title: 'Sales & Client Workspace', subtitle: 'RFQs, customers, quotations, meetings and follow-up activity in one commercial workspace.',
      mission: 'Commercial pipeline focus', status: 'Work the newest enquiries, ageing RFQs and customer follow-ups first.',
      focus: 'Convert qualified enquiries into clear, manufacturable opportunities.',
      cards: [
        ['Pipeline','RFQs','Review new enquiries and quotation work.','staffRfqSection','rfqs'],
        ['Client','Customers','Open customer records and follow-up context.','staffCustomerSection','customers'],
        ['Commercial','Invoices','Review invoice and commercial status.','staffInvoiceSection','invoices'],
        ['Follow-up','Meetings','Manage client meetings and inspections.','meetingsSection','meetings']
      ]
    }
  };

  const aliases = { 'human_resources':'hr', 'human resources':'hr', 'production_staff':'production' };

  function readUser(){
    try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
  }

  function normalizedRole(){
    const user = readUser();
    const raw = String(user.role || localStorage.getItem('role') || 'staff').trim().toLowerCase();
    return aliases[raw] || raw;
  }

  function hasVisibleTarget(sectionId){
    const el = document.getElementById(sectionId);
    if (!el) return false;
    const role = normalizedRole();
    if (['admin','super_admin'].includes(role)) return true;
    return true;
  }

  function openSection(sectionId){
    if (typeof window.goStaffSection === 'function') {
      window.goStaffSection(sectionId);
      return;
    }
    document.getElementById(sectionId)?.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function buildRolePanel(config){
    const dashboard = document.getElementById('dashboardSection');
    if (!dashboard || document.getElementById('roleCommandPanel')) return;

    const panel = document.createElement('section');
    panel.id = 'roleCommandPanel';
    panel.className = 'role-command-panel';
    panel.innerHTML = `
      <div class="role-command-head">
        <div>
          <small>${config.label} Workspace</small>
          <h2>${config.title}</h2>
          <p>${config.subtitle}</p>
        </div>
      </div>
      <div class="role-command-grid" id="roleCommandGrid"></div>
      <div class="role-context-bar">
        <div class="role-focus-card"><b>Primary focus</b><span>${config.focus}</span></div>
        <div class="role-access-card"><b>Access model</b><span>Only functions authorised for your account are available.</span></div>
      </div>`;

    const firstExisting = dashboard.querySelector('.staff-mission-hero');
    if (firstExisting) firstExisting.insertAdjacentElement('afterend', panel);
    else dashboard.prepend(panel);

    const grid = panel.querySelector('#roleCommandGrid');
    config.cards.forEach(([kicker,title,desc,sectionId,permissionClass]) => {
      const button = document.createElement('button');
      button.type='button';
      button.className = `role-command-card permission-${permissionClass} hidden-section`;
      button.innerHTML = `<span>${kicker}</span><strong>${title}</strong><small>${desc}</small>`;
      button.addEventListener('click',()=>openSection(sectionId));
      grid.appendChild(button);
    });
  }

  function applyRoleExperience(){
    const role = normalizedRole();

    if (['viewer','view_only','client','customer'].includes(role)) {
      if (window.location.pathname !== '/client') window.location.replace('/client');
      return;
    }

    const config = ROLE_CONFIG[role] || ROLE_CONFIG.staff;
    document.body.classList.add('role-aware-portal');
    document.body.dataset.vvRole = role;

    const topTitle = document.querySelector('.topbar h2');
    const info = document.getElementById('staffInfo');
    if (topTitle) topTitle.textContent = config.title;
    if (info && !String(info.textContent || '').trim().toLowerCase().startsWith('loading')) info.dataset.roleSubtitle=config.subtitle;

    const heroTitle = document.getElementById('staffMissionGreeting');
    const heroStatus = document.getElementById('staffMissionStatus');
    if (heroTitle) heroTitle.textContent = config.mission;
    if (heroStatus) heroStatus.textContent = config.status;

    const sidebarName = document.querySelector('.brand p');
    if (sidebarName) sidebarName.textContent = config.label + ' Portal';

    const profile = document.querySelector('.staff-sidebar-profile');
    if (profile && !profile.querySelector('.role-identity-chip')) {
      const chip=document.createElement('span');
      chip.className='role-identity-chip';
      chip.textContent=config.label;
      profile.insertAdjacentElement('afterend',chip);
    }

    buildRolePanel(config);
    window.setTimeout(() => {
      if (typeof window.applyPermissionUI === 'function') window.applyPermissionUI();
    }, 250);
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyRoleExperience();
    window.setTimeout(applyRoleExperience, 300);
    window.setTimeout(applyRoleExperience, 900);
  });
})();