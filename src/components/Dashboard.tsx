import { useMemo, useState } from "react";
import spmLogo from "@/imports/SPM_Logo.png";
import Settings from "./Settings";
import Stock from "./Stock";
import Leads from "./Leads";
import Quotations from "./Quotations";
import Invoices from "./Invoices";
import PurchaseOrders from "./PurchaseOrders";
import DueDates, { dueSummary } from "./DueDates";
import CustomerInstruments from "./CustomerInstruments";
import Jobs from "./Jobs";
import Attendance from "./Attendance";
import AdvanceExpense from "./AdvanceExpense";
import { useErpStore } from "./erpStore";
import { money, prettyDate } from "./erpMasters";

type Role = "Admin" | "Engineer";
type IconName = "dashboard" | "attendance" | "expense" | "leads" | "quote" | "purchase" | "invoice" | "stock" | "due" | "accounts" | "reports" | "settings" | "search" | "bell" | "menu" | "chevron" | "more" | "arrow";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<IconName, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    attendance: <><circle cx="12" cy="8" r="3" /><path d="M5 20c.6-3 2.8-5 7-5s6.4 2 7 5" /></>,
    expense: <><path d="M6 3h12v18H6z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
    leads: <><path d="M4 20V7l8-4 8 4v13" /><path d="M9 20v-6h6v6M7 9h.01M12 9h.01M17 9h.01" /></>,
    quote: <><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    purchase: <><path d="M4 6h16l-2 12H6L4 6Z" /><path d="M8 6V4h8v2M9 21h.01M16 21h.01" /></>,
    invoice: <><path d="M7 3h8l3 3v15H7z" /><path d="M15 3v4h4M10 11h5M10 15h5" /></>,
    stock: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>,
    due: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    accounts: <><path d="M4 4h16v16H4z" /><path d="M8 9h8M8 13h3M15 13h1" /></>,
    reports: <><path d="M5 20V10M12 20V4M19 20v-7" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 2-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.8v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2-2 .1-.1A1.7 1.7 0 0 0 7.4 15a1.7 1.7 0 0 0-1.5-1H5.7v-2.8h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L7 8.2l2-2 .1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V4.9h2.8v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2 2-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1Z" /></>,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    more: <><circle cx="5" cy="12" r=".8" fill="currentColor" /><circle cx="12" cy="12" r=".8" fill="currentColor" /><circle cx="19" cy="12" r=".8" fill="currentColor" /></>,
    arrow: <><path d="M5 12h14M13 7l5 5-5 5" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" {...common}>{paths[name]}</svg>;
}

const modules = [
  ["Dashboard", "dashboard", "Overview"],
  ["Stock", "stock", "Operations"],
  ["Customer Instruments", "invoice", "Operations"],
  ["Jobs", "attendance", "Operations"],
  ["Due Dates", "due", "Operations"],
  ["Attendance", "attendance", "People"],
  ["Advance & Expense", "expense", "People"],
  ["Leads", "leads", "Sales"],
  ["Quotations", "quote", "Sales"],
  ["Purchase Orders", "purchase", "Procurement"],
  ["Invoices", "invoice", "Finance"],
  ["Accounts", "accounts", "Finance"],
  ["Reports", "reports", "Finance"],
] as const;

const engineerModules = new Set(["Dashboard", "Attendance", "Advance & Expense", "Stock", "Jobs", "Due Dates"]);

export default function Dashboard() {
  const [collapsed, setCollapsed] = useState(false);
  const [role] = useState<Role>("Admin");
  const [active, setActive] = useState("Dashboard");
  const [search, setSearch] = useState("");
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [jobFocus, setJobFocus] = useState<string | undefined>(undefined);
  const store = useErpStore();
  const due = dueSummary(store);
  const goToJob = (jobId: string) => { setJobFocus(jobId); setActive("Jobs"); };
  const visibleModules = useMemo(() => modules.filter(([name]) => role === "Admin" || engineerModules.has(name)), [role]);
  const groups = [...new Set(visibleModules.map(([, , group]) => group))];

  return <div className="erp-app min-h-screen bg-[#f4f6f8] text-[#2a3442]">
    <aside className={`erp-sidebar ${collapsed ? "erp-sidebar--collapsed" : ""}`}>
      <div className="flex h-16 items-center border-b border-[#e4eaee] px-4">
        <img src={spmLogo} alt="SPM Lab Solutions" className={`h-9 w-auto ${collapsed ? "hidden" : ""}`} />
        <button onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="ml-auto rounded-md p-2 text-[#6b7a8d] hover:bg-[#f1f5f7] hover:text-[#2a3442]"><Icon name="menu" /></button>
      </div>
      <nav className="erp-nav" aria-label="Main navigation">
        {groups.map((group) => <div key={group} className="erp-nav-group">
          {!collapsed && <p className="erp-nav-label">{group}</p>}
          {visibleModules.filter(([, , moduleGroup]) => moduleGroup === group).map(([name, icon]) => <button key={name} onClick={() => setActive(name)} className={`erp-nav-item ${active === name ? "erp-nav-item--active" : ""}`} title={collapsed ? name : undefined}>
            <Icon name={icon as IconName} /><span>{name}</span>{name === "Due Dates" && !collapsed && due.badge > 0 && <b>{due.badge}</b>}
          </button>)}
        </div>)}
      </nav>
      <div className="erp-sidebar-footer">
        <button onClick={() => setActive("Settings")} className={`erp-nav-item w-full ${active === "Settings" ? "erp-nav-item--active" : ""}`} title={collapsed ? "Settings" : undefined}><Icon name="settings" /><span>Settings</span></button>
        <div className="erp-sidebar-user">
          <span className="erp-avatar">AK</span>
          {!collapsed && <span><b>Arun Kumar</b><small>{role}</small></span>}
          <button onClick={() => window.location.assign("/login")} title="Sign out" aria-label="Sign out" className="erp-sidebar-signout"><Icon name="arrow" size={15} /></button>
        </div>
      </div>
    </aside>

    <div className={`erp-main ${collapsed ? "erp-main--wide" : ""}`}>
      <header className="erp-topbar">
        <div className="erp-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search records, invoices, stock…" aria-label="Global search" /><kbd>⌘ K</kbd></div>
        <div className="relative flex items-center gap-2">
          <button onClick={() => setAlertsOpen((value) => !value)} className="erp-icon-button relative" aria-label="Notifications"><Icon name="bell" />{due.badge > 0 && <span className="erp-alert-count">{due.badge}</span>}</button>
          {alertsOpen && <div className="erp-popover right-14"><p className="mb-2 text-xs font-semibold text-[#3d4a5c]">Notifications</p>{due.overdue.slice(0, 3).map((item) => <p key={item.id}>{item.title}</p>)}{!due.overdue.length && <p>Nothing overdue</p>}</div>}
        </div>
      </header>
      <main className="erp-content">
        {active === "Settings" ? <Settings /> : active === "Stock" ? <Stock isEngineer={role === "Engineer"} /> : active === "Leads" ? <Leads /> : active === "Quotations" ? <Quotations /> : active === "Invoices" ? <Invoices /> : active === "Purchase Orders" ? <PurchaseOrders /> : active === "Due Dates" ? <DueDates isEngineer={role === "Engineer"} /> : active === "Customer Instruments" ? <CustomerInstruments openJob={goToJob} /> : active === "Jobs" ? <Jobs isEngineer={role === "Engineer"} focusJob={jobFocus} /> : active === "Attendance" ? <Attendance /> : active === "Advance & Expense" ? <AdvanceExpense /> : <>
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="erp-secondary-text">Tuesday, 15 September</p><h1>Good morning, Arun</h1><p className="erp-secondary-text mt-1">Here’s a quick view of what needs your attention.</p></div><button className="erp-action">Create quotation <Icon name="arrow" size={16} /></button></div>
        <section className="erp-stats" aria-label="Business summary">
          {[ ["Open quotations", "12", "₹ 6.40 L", "quote", "sales", "↑ 18% vs last week"], ["Pending invoices", "08", "₹ 8.20 L", "invoice", "money", "↑ 6% vs last week"], ["Stock alerts", "04", "Items to review", "stock", "stock", "↑ 2 new alerts"], ["Due this week", "03", "Follow up today", "due", "overdue", "↓ 1 from last week"] ].map(([label, value, detail, icon, tone, trend]) => <article key={label} className="erp-stat"><span className={`erp-stat-icon erp-stat-icon--${tone}`}><Icon name={icon as IconName} /></span><div className="erp-stat-label"><p>{label}</p><small>{detail}</small></div><strong>{value}</strong><em className={`erp-trend erp-trend--${tone}`}>{trend}</em></article>)}
        </section>
        <section className="erp-dashboard-grid">
          <article className="erp-panel"><div className="erp-panel-head"><div><h2>Today’s priorities</h2><p>Tasks that need a response today</p></div><button className="erp-text-button" onClick={() => setActive("Due Dates")}>View all</button></div>{[["Create invoice", "QT-2026-0827 · Tera Research", "10:30 AM", "Ready to invoice", "blue"], ["Approve purchase order", "PO-24091", "12:00 PM", "Awaiting approval", "amber"], ["Follow up on payment", "Arka Diagnostics", "3:30 PM", "Overdue", "rose"]].map(([task, company, time, status, tone]) => <div className="erp-task" key={task}><span className="erp-task-check" /><div><b>{task}</b><small>{company}</small></div><span className={`erp-chip erp-chip--${tone}`}>{status}</span><time>{time}</time></div>)}<div className="erp-attendance"><div><b>Who’s in today</b><small>18 of 22 team members present</small></div><div className="erp-avatars"><span>AK</span><span>PS</span><span>NR</span><span>+15</span></div></div></article>
          <article className="erp-panel"><div className="erp-panel-head"><div><h2>Attention needed</h2><p>Exceptions across your business</p></div><button className="erp-icon-button"><Icon name="more" /></button></div>{[...due.overdue, ...due.dueToday].slice(0, 4).map((item) => <div className="erp-alert" key={item.id} onClick={() => setActive("Due Dates")}><div><b>{item.title}</b><small>{[item.party, item.amount ? money(item.amount) : null, prettyDate(item.date)].filter(Boolean).join(" · ")}</small></div><span className={`erp-chip erp-chip--${due.overdue.includes(item) ? "rose" : "amber"}`}>{due.overdue.includes(item) ? "Overdue" : "Due today"}</span><Icon name="chevron" size={16} /></div>)}{![...due.overdue, ...due.dueToday].length && <div className="erp-alert"><div><b>Nothing overdue</b><small>Everything is up to date</small></div></div>}<div className="erp-collections"><div><b>Collections by week</b><small>Amount collected</small></div><strong>₹ 12.4 L</strong><div className="erp-bars" aria-label="Collections mini bar chart"><i /><i /><i /><i /><i /></div><div className="erp-bar-labels"><span>W1</span><span>W2</span><span>W3</span><span>W4</span><span>W5</span></div></div></article>
        </section>
        </>}
      </main>
    </div>
  </div>;
}
