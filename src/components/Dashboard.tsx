import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import spmLogo from "@/imports/SPM_Logo.png";
import Settings from "./Settings";
import Stock from "./Stock";
import Leads from "./Leads";
import Quotations from "./Quotations";
import Orders from "./Orders";
import Invoices from "./Invoices";
import PurchaseOrders from "./PurchaseOrders";
import Rentals from "./Rentals";
import DueDates, { dueSummary, buildDueItems, whenLabel, type DueItem } from "./DueDates";
import Customers from "./Customers";
import Jobs from "./Jobs";
import Attendance from "./Attendance";
import AdvanceExpense from "./AdvanceExpense";
import Accounts from "./Accounts";
import Reports from "./Reports";
import { statusFor as quoteStatusFor } from "./Quotations";
import { attendanceStatusFor, balanceOf, invoiceTotals, totalOf, useErpStore, type Job } from "./erpStore";
import { dateIso, dayDifference, engineers, ENGINEER, money, prettyDate, totalsFor, weekStart, addDaysIso, initials } from "./erpMasters";

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
  ["Leads", "leads", "Sales"],
  ["Quotations", "quote", "Sales"],
  ["Orders", "purchase", "Sales"],
  ["Jobs", "attendance", "Operations"],
  ["Stock", "stock", "Operations"],
  ["Rentals", "stock", "Operations"],
  ["Purchases", "purchase", "Operations"],
  ["Customers", "invoice", "Customers"],
  ["Invoices", "invoice", "Money"],
  ["Accounts", "accounts", "Money"],
  ["Attendance", "attendance", "Team"],
  ["Expenses", "expense", "Team"],
  ["Reports", "reports", "Reports"],
] as const;

const engineerModules = new Set(["Jobs", "Expenses"]);

export default function Dashboard() {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [role, setRole] = useState<Role>("Admin");
  const [active, setActive] = useState("Dashboard");
  const [search, setSearch] = useState("");
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [jobFocus, setJobFocus] = useState<string | undefined>(undefined);
  const [invoiceFocus, setInvoiceFocus] = useState<string | undefined>(undefined);
  const [stockFocus, setStockFocus] = useState<string | undefined>(undefined);
  const [engineerFocus, setEngineerFocus] = useState<string | undefined>(undefined);
  const [quoteFocus, setQuoteFocus] = useState<string | undefined>(undefined);
  const [rentalFocus, setRentalFocus] = useState<string | undefined>(undefined);
  const [customerFocus, setCustomerFocus] = useState<string | undefined>(undefined);
  const [orderFocus, setOrderFocus] = useState<string | undefined>(undefined);
  const [dueItemFocus, setDueItemFocus] = useState<string | undefined>(undefined);
  const [poAutoStartLow, setPoAutoStartLow] = useState(false);
  const [jobPrefill, setJobPrefill] = useState<Partial<Job> | undefined>(undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const store = useErpStore();
  const due = dueSummary(store);
  const goToJob = (jobId: string) => { setJobFocus(jobId); setActive("Jobs"); };
  const goToInvoice = (invoiceId: string) => { setInvoiceFocus(invoiceId); setActive("Invoices"); };
  const goToStockItem = (itemId: string) => { setStockFocus(itemId); setActive("Stock"); };
  const goToEngineer = (name: string) => { setEngineerFocus(name); setActive("Expenses"); };
  const goToQuote = (quoteId: string) => { setQuoteFocus(quoteId); setActive("Quotations"); };
  const goToLowStockPO = () => { setPoAutoStartLow(true); setActive("Purchases"); };
  const goToRentals = (ref?: string) => { setRentalFocus(ref); setActive("Rentals"); };
  const goToNewJob = (prefill: Partial<Job>) => { setJobPrefill(prefill); setActive("Jobs"); };
  const goToCustomer = (customerId: string) => { setCustomerFocus(customerId); setActive("Customers"); };
  const goToOrder = (orderId: string) => { setOrderFocus(orderId); setActive("Orders"); };
  const goToDueItem = (item: DueItem) => { setDueItemFocus(item.id); setActive("Due Dates"); };
  const visibleModules = useMemo(() => modules.filter(([name]) => role === "Admin" || engineerModules.has(name)), [role]);
  const groups = [...new Set(visibleModules.map(([, , group]) => group))];
  const toggleRole = () => { const next = role === "Admin" ? "Engineer" : "Admin"; setRole(next); setActive(next === "Engineer" ? "Jobs" : "Dashboard"); };
  const displayName = role === "Engineer" ? ENGINEER : "Arun Kumar";
  const displayInitials = initials(displayName);

  // Real dashboard figures — computed from the store, not hardcoded.
  const openQuotes = store.quotes.filter((quote) => quoteStatusFor(quote) === "Draft" || quoteStatusFor(quote) === "Sent");
  const openQuotesValue = openQuotes.reduce((sum, quote) => sum + totalsFor(quote.items, quote.customerState === "Karnataka", quote.overallDiscount ?? 0, quote.freightCharges ?? 0).grandTotal, 0);
  const pendingInvoices = store.invoices.filter((invoice) => invoice.status === "Sent" && balanceOf(invoice, store.customerReceipts, store.customerTds) > 0);
  const pendingInvoicesValue = pendingInvoices.reduce((sum, invoice) => sum + balanceOf(invoice, store.customerReceipts, store.customerTds), 0);
  const lowStockItems = store.quantities.filter((item) => totalOf(item) < item.minimum);
  const allDueItems = buildDueItems(store);
  const dueThisWeek = allDueItems.filter((item) => dayDifference(item.date) >= 0 && dayDifference(item.date) <= 7);

  type DashboardAlert = { id: string; title: string; detail: string; tone: "rose" | "amber"; onOpen: () => void };
  const dueAlert = (item: DueItem): DashboardAlert => { const when = whenLabel(item.date); return {
    id: item.id, title: item.title, detail: [item.party, item.amount ? money(item.amount) : null, when.text].filter(Boolean).join(" · "),
    tone: when.tone === "late" ? "rose" : "amber", onOpen: () => goToDueItem(item),
  }; };
  const overdueAlerts = due.overdue.map(dueAlert);
  const dueTodayAlerts = due.dueToday.map(dueAlert);
  const lowStockAlerts: DashboardAlert[] = lowStockItems.map((item) => ({
    id: `low-${item.id}`, title: `${item.name} — low stock`, detail: `${totalOf(item)} of ${item.minimum} minimum · ${item.category}`,
    tone: "amber", onOpen: () => goToStockItem(item.id),
  }));
  const allAlerts = [...overdueAlerts, ...dueTodayAlerts, ...lowStockAlerts];
  const todaysPriorities = allAlerts.slice(0, 3);
  const attentionAlerts = allAlerts.slice(0, 4);

  // Collections by week — last five weeks of real customer receipts.
  const thisWeekStart = weekStart(dateIso());
  const weekBuckets = Array.from({ length: 5 }, (_, index) => addDaysIso(thisWeekStart, -7 * (4 - index)));
  const weeklyCollections = weekBuckets.map((start) => store.customerReceipts.filter((receipt) => weekStart(receipt.date) === start).reduce((sum, receipt) => sum + receipt.amount, 0));
  const collectionsTotal = weeklyCollections.reduce((sum, value) => sum + value, 0);
  const maxWeekly = Math.max(1, ...weeklyCollections);

  // Who's in today — real attendance status per engineer.
  const presentToday = engineers.filter((engineer) => attendanceStatusFor(store.attendance, store.leaves, store.holidays, engineer.name, dateIso()) === "Present");

  // Global search — customers, orders, invoices, jobs and stock, matched by name/number/id.
  type SearchHit = { group: string; label: string; sublabel: string; onOpen: () => void };
  const searchHits: SearchHit[] = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    const hits: SearchHit[] = [];
    store.customers.filter((customer) => customer.name.toLowerCase().includes(query)).slice(0, 5).forEach((customer) => hits.push({ group: "Customers", label: customer.name, sublabel: customer.city, onOpen: () => goToCustomer(customer.id) }));
    store.customerOrders.filter((order) => `${order.number} ${order.customer}`.toLowerCase().includes(query)).slice(0, 5).forEach((order) => hits.push({ group: "Orders", label: order.number, sublabel: order.customer, onOpen: () => goToOrder(order.id) }));
    store.invoices.filter((invoice) => `${invoice.number} ${invoice.customer}`.toLowerCase().includes(query)).slice(0, 5).forEach((invoice) => hits.push({ group: "Invoices", label: invoice.number, sublabel: `${invoice.customer} · ${money(invoiceTotals(invoice).grandTotal)}`, onOpen: () => goToInvoice(invoice.id) }));
    store.jobs.filter((job) => `${job.number} ${job.customer}`.toLowerCase().includes(query)).slice(0, 5).forEach((job) => hits.push({ group: "Jobs", label: job.number, sublabel: `${job.customer} · ${job.status}`, onOpen: () => goToJob(job.id) }));
    store.individuals.filter((item) => `${item.id} ${item.name}`.toLowerCase().includes(query)).slice(0, 5).forEach((item) => hits.push({ group: "Stock", label: item.id, sublabel: item.name, onOpen: () => goToStockItem(item.id) }));
    store.quantities.filter((item) => `${item.id} ${item.name}`.toLowerCase().includes(query)).slice(0, 5).forEach((item) => hits.push({ group: "Stock", label: item.id, sublabel: item.name, onOpen: () => goToStockItem(item.id) }));
    return hits;
  }, [search, store]);
  const openSearchHit = (hit: SearchHit) => { hit.onOpen(); setSearch(""); setSearchOpen(false); };

  return <div className="erp-app min-h-screen bg-[#f4f6f8] text-[#2a3442]">
    <aside className={`erp-sidebar ${collapsed ? "erp-sidebar--collapsed" : ""}`}>
      <div className="flex h-16 items-center border-b border-[#e4eaee] px-4">
        <img src={spmLogo} alt="SPM Lab Solutions" className={`h-9 w-auto ${collapsed ? "hidden" : ""}`} />
        <button onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="ml-auto rounded-md p-2 text-[#6b7a8d] hover:bg-[#f1f5f7] hover:text-[#2a3442]"><Icon name="menu" /></button>
      </div>
      <nav className="erp-nav" aria-label="Main navigation">
        {groups.map((group) => { const items = visibleModules.filter(([, , moduleGroup]) => moduleGroup === group); return <div key={group} className="erp-nav-group">
          {!collapsed && items.length > 1 && <p className="erp-nav-label">{group}</p>}
          {items.map(([name, icon]) => <button key={name} onClick={() => { setActive(name); setPoAutoStartLow(false); setJobPrefill(undefined); }} className={`erp-nav-item ${active === name ? "erp-nav-item--active" : ""}`} title={collapsed ? name : undefined}>
            <Icon name={icon as IconName} /><span>{name}</span>
          </button>)}
        </div>; })}
      </nav>
      <div className="erp-sidebar-footer">
        {role === "Admin" && <button onClick={() => setActive("Settings")} className={`erp-nav-item w-full ${active === "Settings" ? "erp-nav-item--active" : ""}`} title={collapsed ? "Settings" : undefined}><Icon name="settings" /><span>Settings</span></button>}
        <div className="erp-sidebar-user">
          <button onClick={toggleRole} title="Switch role (demo)" className="erp-avatar" style={{ cursor: "pointer" }}>{displayInitials}</button>
          {!collapsed && <button onClick={toggleRole} title="Switch role (demo)" className="text-left"><b>{displayName}</b><small>{role}</small></button>}
          <button onClick={() => navigate("/login")} title="Sign out" aria-label="Sign out" className="erp-sidebar-signout"><Icon name="arrow" size={15} /></button>
        </div>
      </div>
    </aside>

    <div className={`erp-main ${collapsed ? "erp-main--wide" : ""} ${role === "Engineer" ? "erp-main--engineer" : ""}`}>
      <header className="erp-topbar">
        {role === "Engineer" ? <div className="erp-topbar-engineer"><img src={spmLogo} alt="SPM Lab Solutions" className="h-7 w-auto" /><span>{displayName}</span></div> : <div className="relative">
          <div className="erp-search"><Icon name="search" /><input value={search} onChange={(event) => { setSearch(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)} onKeyDown={(event) => { if (event.key === "Escape") { setSearch(""); setSearchOpen(false); } }} placeholder="Search customers, orders, invoices, jobs, stock…" aria-label="Global search" /><kbd>⌘ K</kbd></div>
          {searchOpen && search.trim() && <div className="erp-popover">
            <p className="mb-2 text-xs font-semibold text-[#3d4a5c]">Search results</p>
            {searchHits.length ? searchHits.map((hit) => <button key={`${hit.group}-${hit.label}`} className="erp-alert" style={{ cursor: "pointer", width: "100%", textAlign: "left" }} onMouseDown={(event) => { event.preventDefault(); openSearchHit(hit); }}><div><b>{hit.label}</b><small>{hit.group} · {hit.sublabel}</small></div></button>) : <p>No matches</p>}
          </div>}
        </div>}
        <div className="relative flex items-center gap-2">
          <button onClick={() => setAlertsOpen((value) => !value)} className="erp-icon-button relative" aria-label="Notifications"><Icon name="bell" />{due.badge > 0 && <span className="erp-alert-count">{due.badge}</span>}</button>
          {alertsOpen && <div className="erp-popover right-14"><p className="mb-2 text-xs font-semibold text-[#3d4a5c]">Notifications</p>{due.overdue.slice(0, 3).map((item) => <p key={item.id}>{item.title}</p>)}{!due.overdue.length && <p>Nothing overdue</p>}</div>}
        </div>
      </header>
      <main className="erp-content">
        {active === "Settings" ? <Settings /> : active === "Stock" ? <Stock isEngineer={role === "Engineer"} focusItem={stockFocus} onCreatePO={goToLowStockPO} onOpenRental={goToRentals} /> : active === "Leads" ? <Leads openQuote={goToQuote} /> : active === "Quotations" ? <Quotations focusQuote={quoteFocus} /> : active === "Orders" ? <Orders focusOrder={orderFocus} openJob={goToJob} openInvoice={goToInvoice} newJob={goToNewJob} openRentals={goToRentals} /> : active === "Invoices" ? <Invoices focusInvoice={invoiceFocus} /> : active === "Purchases" ? <PurchaseOrders autoStartLow={poAutoStartLow} /> : active === "Rentals" ? <Rentals focus={rentalFocus} /> : active === "Due Dates" ? <DueDates isEngineer={role === "Engineer"} focusItem={dueItemFocus} openInvoice={goToInvoice} openJob={goToJob} /> : active === "Customers" ? <Customers focusCustomer={customerFocus} openJob={goToJob} openInvoice={goToInvoice} /> : active === "Jobs" ? <Jobs isEngineer={role === "Engineer"} focusJob={jobFocus} newJobPrefill={jobPrefill} openInvoice={goToInvoice} /> : active === "Attendance" ? <Attendance /> : active === "Expenses" ? <AdvanceExpense isEngineer={role === "Engineer"} focusEngineer={engineerFocus} /> : active === "Accounts" ? <Accounts openInvoice={goToInvoice} /> : active === "Reports" ? <Reports openInvoice={goToInvoice} openJob={goToJob} openStockItem={goToStockItem} openEngineer={goToEngineer} /> : <>
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="erp-secondary-text">{new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p><h1>Good morning, Arun</h1><p className="erp-secondary-text mt-1">Here’s a quick view of what needs your attention.</p></div></div>
        <section className="erp-stats" aria-label="Business summary">
          {[
            { label: "Open quotations", value: String(openQuotes.length).padStart(2, "0"), detail: money(openQuotesValue), icon: "quote" as const, tone: "sales", onClick: () => setActive("Quotations") },
            { label: "Pending invoices", value: String(pendingInvoices.length).padStart(2, "0"), detail: money(pendingInvoicesValue), icon: "invoice" as const, tone: "money", onClick: () => setActive("Invoices") },
            { label: "Stock alerts", value: String(lowStockItems.length).padStart(2, "0"), detail: "Items to review", icon: "stock" as const, tone: "stock", onClick: () => setActive("Stock") },
            { label: "Due this week", value: String(dueThisWeek.length).padStart(2, "0"), detail: "Follow up this week", icon: "due" as const, tone: "overdue", onClick: () => setActive("Due Dates") },
          ].map((stat) => <article key={stat.label} className="erp-stat" onClick={stat.onClick} style={{ cursor: "pointer" }}><span className={`erp-stat-icon erp-stat-icon--${stat.tone}`}><Icon name={stat.icon} /></span><div className="erp-stat-label"><p>{stat.label}</p><small>{stat.detail}</small></div><strong>{stat.value}</strong></article>)}
        </section>
        <section className="erp-dashboard-grid">
          <article className="erp-panel"><div className="erp-panel-head"><div><h2>Today’s priorities</h2><p>Tasks that need a response today</p></div><button className="erp-text-button" onClick={() => setActive("Due Dates")}>View all</button></div>{todaysPriorities.map((alert) => <div className="erp-task" key={alert.id} onClick={alert.onOpen} style={{ cursor: "pointer" }}><span className="erp-task-check" /><div><b>{alert.title}</b><small>{alert.detail}</small></div><span className={`erp-chip erp-chip--${alert.tone}`}>{alert.tone === "rose" ? "Overdue" : "Due"}</span></div>)}{!todaysPriorities.length && <div className="erp-task"><div><b>Nothing needs attention today</b><small>Everything is up to date</small></div></div>}<div className="erp-attendance"><div><b>Who’s in today</b><small>{presentToday.length} of {engineers.length} team members present</small></div><div className="erp-avatars">{presentToday.slice(0, 3).map((engineer) => <span key={engineer.name}>{initials(engineer.name)}</span>)}{presentToday.length > 3 && <span>+{presentToday.length - 3}</span>}</div></div></article>
          <article className="erp-panel"><div className="erp-panel-head"><div><h2>Attention needed</h2><p>Exceptions across your business</p></div><button className="erp-icon-button"><Icon name="more" /></button></div>{attentionAlerts.map((alert) => <div className="erp-alert" key={alert.id} onClick={alert.onOpen} style={{ cursor: "pointer" }}><div><b>{alert.title}</b><small>{alert.detail}</small></div><span className={`erp-chip erp-chip--${alert.tone}`}>{alert.tone === "rose" ? "Overdue" : "Due soon"}</span><Icon name="chevron" size={16} /></div>)}{!attentionAlerts.length && <div className="erp-alert"><div><b>Nothing overdue</b><small>Everything is up to date</small></div></div>}<div className="erp-collections"><div><b>Collections by week</b><small>Amount collected</small></div><strong>{money(collectionsTotal)}</strong><div className="erp-bars" aria-label="Collections mini bar chart">{weeklyCollections.map((value, index) => <i key={index} style={{ height: `${Math.max(6, Math.round(value / maxWeekly * 100))}%` }} />)}</div><div className="erp-bar-labels"><span>W1</span><span>W2</span><span>W3</span><span>W4</span><span>W5</span></div></div></article>
        </section>
        </>}
      </main>
      {role === "Engineer" && <nav className="erp-mobile-tabbar" aria-label="Engineer navigation">
        {visibleModules.map(([name, icon]) => <button key={name} className={active === name ? "is-active" : ""} onClick={() => { setActive(name); setMobileMenuOpen(false); }}><Icon name={icon as IconName} /><span>{name}</span></button>)}
        <button className={mobileMenuOpen ? "is-active" : ""} onClick={() => setMobileMenuOpen((value) => !value)} aria-expanded={mobileMenuOpen}><span className="erp-mobile-tabbar-avatar">{displayInitials}</span><span>Account</span></button>
      </nav>}
      {mobileMenuOpen && <div className="erp-mobile-menu-backdrop" onClick={() => setMobileMenuOpen(false)}><div className="erp-mobile-menu" onClick={(event) => event.stopPropagation()}>
        <div className="erp-mobile-menu-head"><span className="erp-avatar">{displayInitials}</span><div><b>{displayName}</b><small>{role}</small></div></div>
        <button onClick={() => { setMobileMenuOpen(false); toggleRole(); }}>Switch to Admin</button>
        <button onClick={() => { setMobileMenuOpen(false); navigate("/login"); }}>Sign out</button>
      </div></div>}
    </div>
  </div>;
}
