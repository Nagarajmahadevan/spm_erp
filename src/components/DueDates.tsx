import { useMemo, useState } from "react";
import { ALERT_SETTINGS, APPROVER, CAL_LAB, ENGINEER, WAREHOUSE, dateIso, dayDifference, money, prettyDate, stamp } from "./erpMasters";
import { COMPANY, JOB_SETTINGS, siteById, totalsFor, vendorMaster } from "./erpMasters";
import { balanceOf, invoiceTotals, nextDueFor, openJobFor, paidSoFar, statutoryDues, updateStore, useErpStore, type Job, type Payment, type PaymentRecord, type StockMove } from "./erpStore";

type DueType = "Service" | "Master" | "Fleet" | "Payment" | "VendorBill" | "Bill" | "Statutory";
type DueTab = "service" | "equipment" | "money";
type DueItem = {
  id: string;
  type: DueType;
  title: string;
  party?: string;
  date: string;
  amount?: number;
  owner: string;
  lead: number;
  recordKind: "instrument" | "master" | "equipment" | "invoice" | "bill" | "vendorbill" | "statutory";
  recordId: string;
  site?: string;
  city?: string;
  job?: Job;
  dependents?: number;
  received?: number;
  balance?: number;
  lastReminder?: string;
  note?: string;
};

const TAB_OF: Record<DueType, DueTab> = { Service: "service", Master: "equipment", Fleet: "equipment", Payment: "money", VendorBill: "money", Bill: "money", Statutory: "money" };
const GROUP_OF: Record<DueType, string> = { Service: "service", Master: "masters", Fleet: "fleet", Payment: "collect", VendorBill: "pay", Bill: "pay", Statutory: "pay" };
const TERM_DAYS: Record<string, number> = { "Net 15": 15, "Net 30": 30, "Net 45": 45, "Due on receipt": 0 };
const addDays = (from: string, days: number) => { const date = new Date(`${from}T12:00`); date.setDate(date.getDate() + days); return dateIso(date); };
const addMonths = (from: string, months: number) => { const date = new Date(`${from}T12:00`); date.setMonth(date.getMonth() + months); return dateIso(date); };

const GROUPS: Record<DueTab, { key: string; title: string; blurb: string; money?: boolean; totalLabel?: string; alwaysShow?: boolean }[]> = {
  service: [{ key: "service", title: "Customer instruments", blurb: "Approaching or past their calibration date.", alwaysShow: true }],
  equipment: [
    { key: "fleet", title: "Our equipment", blurb: "Our own instruments due for calibration or expected back from rent.", alwaysShow: true },
  ],
  money: [
    { key: "collect", title: "To collect", blurb: "Customer invoices with money still outstanding.", money: true, totalLabel: "Still to come in", alwaysShow: true },
    { key: "pay", title: "To pay", blurb: "Vendor bills, company bills and statutory dues, oldest first.", money: true, totalLabel: "Going out", alwaysShow: true },
  ],
};

function whenLabel(date: string) {
  const diff = dayDifference(date);
  if (diff < 0) return { text: `Overdue · ${Math.abs(diff)}d`, tone: "late" as const };
  if (diff === 0) return { text: "Due today", tone: "late" as const };
  if (diff === 1) return { text: "Due tomorrow", tone: "soon" as const };
  if (diff <= 7) return { text: `Due in ${diff}d`, tone: "soon" as const };
  return { text: `Due ${prettyDate(date)}`, tone: "later" as const };
}

function buildDueItems(store: ReturnType<typeof useErpStore>): DueItem[] {
  const items: DueItem[] = [];

  store.instruments.filter((instrument) => instrument.status === "Active").forEach((instrument) => {
    const due = nextDueFor(instrument);
    if (!due) return;
    const site = siteById(instrument.siteId);
    items.push({
      id: `svc-${instrument.id}`, type: "Service", title: `${instrument.name} — ${instrument.customer}`,
      party: instrument.customer, date: due, owner: "Priya Shah", lead: 45,
      recordKind: "instrument", recordId: instrument.id,
      site: site?.name, city: site?.city, job: openJobFor(store.jobs, instrument.id),
    });
  });

  // Reference Standards (Masters) is an optional feature SPM has not confirmed it needs, so
  // it is kept out of the default Due Dates list — see erpStore.ts for the retained data model.

  store.individuals.filter((unit) => unit.calibrationDue && unit.opStatus !== "Retired" && unit.opStatus !== "Sold").forEach((unit) => items.push({
    id: `cal-${unit.id}`, type: "Fleet", title: `Calibration due — ${unit.name}`,
    party: unit.holder !== "Store" ? unit.currentWith : undefined, date: unit.calibrationDue!,
    owner: "Priya Shah", lead: ALERT_SETTINGS.leadDays.Calibration,
    recordKind: "equipment", recordId: unit.id,
  }));

  store.individuals.filter((unit) => unit.holder === "Customer" && unit.opStatus !== "Sold" && unit.rentalReturnDue).forEach((unit) => items.push({
    id: `ret-${unit.id}`, type: "Fleet", title: `Rental return due — ${unit.name}`,
    party: unit.currentWith, date: unit.rentalReturnDue!, owner: "Priya Shah",
    lead: ALERT_SETTINGS.leadDays.Rental, recordKind: "equipment", recordId: unit.id,
  }));

  store.invoices.filter((invoice) => (invoice.status === "Sent" || invoice.status === "Partly paid") && balanceOf(invoice) > 0).forEach((invoice) => items.push({
    id: `pay-${invoice.id}`, type: "Payment", title: `${invoice.number} — ${invoice.customer}`,
    party: invoice.customer, date: invoice.dueDate, amount: invoiceTotals(invoice).grandTotal,
    received: paidSoFar(invoice), balance: balanceOf(invoice), lastReminder: invoice.lastReminder,
    owner: APPROVER, lead: ALERT_SETTINGS.leadDays.Payment, recordKind: "invoice", recordId: invoice.id,
  }));

  // Vendor bills fall out of purchase orders that have been received.
  store.orders.filter((order) => order.status === "Received" && !order.billPaid).forEach((order) => {
    const totals = totalsFor(order.items, order.vendorState === COMPANY.state, 0, order.freightCharges);
    const tds = Math.round(totals.taxable * order.tdsRate / 100);
    items.push({
      id: `vb-${order.id}`, type: "VendorBill", title: `${order.vendor} — ${order.vendorBill ?? order.number}`,
      party: order.vendor, date: addDays(order.orderDate, TERM_DAYS[order.paymentTerms] ?? 30),
      amount: totals.grandTotal - tds, owner: APPROVER, lead: ALERT_SETTINGS.leadDays.VendorBill,
      recordKind: "vendorbill", recordId: order.id, note: order.tdsRate ? `After TDS ${order.tdsRate}%` : undefined,
    });
  });

  store.bills.forEach((bill) => items.push({
    id: `bill-${bill.id}`, type: "Bill", title: `${bill.name} — ${bill.vendor}`,
    party: bill.vendor, date: bill.dueDate, amount: bill.amount, owner: bill.owner,
    lead: ALERT_SETTINGS.leadDays.Bill, recordKind: "bill", recordId: bill.id, note: bill.every,
  }));

  // Statutory dates come from the compliance calendar and carry penalties, so they get room.
  [dateIso().slice(0, 7), addMonths(`${dateIso().slice(0, 7)}-01`, 1).slice(0, 7)].forEach((month) => {
    statutoryDues(month).filter((due) => !store.statutoryPaid[due.id]).forEach((due) => items.push({
      id: `stat-${due.id}`, type: "Statutory", title: `${due.name} — ${due.period}`,
      party: due.kind, date: due.dueDate, owner: due.owner, lead: ALERT_SETTINGS.leadDays.Statutory,
      recordKind: "statutory", recordId: due.id, note: due.note,
    }));
  });

  // Lead times come from Settings → Alerts: nothing appears before its window opens.
  return items.filter((item) => dayDifference(item.date) <= item.lead).sort((a, b) => a.date.localeCompare(b.date));
}

function primaryLabel(item: DueItem) {
  if (item.type === "Service") return item.job ? "Add to existing job" : "Create job";
  if (item.type === "Master") return "Send out for calibration";
  if (item.type === "Fleet") return item.id.startsWith("ret-") ? "Mark returned" : "Calibrate";
  if (item.type === "Payment") return "Record payment";
  return "Mark paid";
}

export default function DueDates({ isEngineer = false }: { isEngineer?: boolean }) {
  const store = useErpStore();
  const [tab, setTab] = useState<DueTab>("service");
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [window_, setWindow] = useState<"all" | "overdue" | "today" | "week" | "month">("all");
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [acting, setActing] = useState<DueItem | null>(null); const [opening, setOpening] = useState<DueItem | null>(null);
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 4000); };

  const today = dateIso();
  const all = buildDueItems(store);
  const awake = all.filter((item) => showSnoozed || !store.snoozed[item.id] || store.snoozed[item.id] <= today);
  // Engineers only ever see their own equipment.
  const scoped = isEngineer ? awake.filter((item) => TAB_OF[item.type] === "equipment" && item.owner === ENGINEER) : awake;
  const activeTab: DueTab = isEngineer ? "equipment" : tab;
  const isService = activeTab === "service";
  const snoozedCount = all.filter((item) => store.snoozed[item.id] > today).length;

  // The four cards count across both tabs, so the total never depends on which tab is open.
  const count = (test: (diff: number) => boolean) => scoped.filter((item) => test(dayDifference(item.date))).length;
  const cards = [
    ["Overdue", count((diff) => diff < 0), "Deal with these first", "overdue", "overdue"],
    ["Due today", count((diff) => diff === 0), "Before you go home", "today", "today"],
    ["Due this week", count((diff) => diff >= 0 && diff <= 7), "Next seven days", "week", "week"],
    ["Due this month", count((diff) => diff >= 0 && diff <= 30), "Next thirty days", "month", "month"],
  ] as const;

  const inWindow = (item: DueItem) => {
    const diff = dayDifference(item.date);
    if (window_ === "overdue") return diff < 0;
    if (window_ === "today") return diff === 0;
    if (window_ === "week") return diff >= 0 && diff <= 7;
    if (window_ === "month") return diff >= 0 && diff <= 30;
    return true;
  };
  const rows = useMemo(() => scoped.filter((item) => TAB_OF[item.type] === activeTab
    && `${item.title} ${item.party ?? ""} ${item.owner}`.toLowerCase().includes(search.toLowerCase())
    && inWindow(item)), [scoped, activeTab, search, window_]);

  const snooze = (item: DueItem, days: number) => {
    updateStore((current) => ({ snoozed: { ...current.snoozed, [item.id]: addDays(today, days) } }));
    setSnoozeFor(null);
    flash(`Hidden until ${prettyDate(addDays(today, days))}.`);
  };
  // One trip, one engineer, several instruments — travel is the real cost.
  const clusterJob = (chosen: DueItem[]) => {
    const instruments = store.instruments.filter((entry) => chosen.some((item) => item.recordId === entry.id));
    const first = instruments[0];
    if (!first) return;
    updateStore((current) => {
      const number = `JOB-${Math.max(1041, ...current.jobs.map((job) => Number(job.number.split("-")[1]) || 0)) + 1}`;
      return { jobs: [{
        id: number, number, type: "Calibration" as const, customer: first.customer, siteId: first.siteId,
        instrumentIds: instruments.map((entry) => entry.id), stockIds: [],
        description: `Calibration of ${instruments.length} instrument${instruments.length === 1 ? "" : "s"}.`,
        doneAt: "Customer site" as const, scheduledDate: dateIso(), slot: JOB_SETTINGS.defaultSlot, hours: instruments.length * 2,
        status: "Unassigned" as const, expectedSpares: [], usedSpares: [], results: [], travelNotes: "", photos: 0,
        activities: [{ title: `Job created from Due Dates for ${instruments.length} instrument${instruments.length === 1 ? "" : "s"}`, meta: stamp(), tone: "system" as const }],
      }, ...current.jobs] };
    });
    setPicked([]);
    flash(`One job created for ${instruments.length} instruments in ${chosen[0].city}. Assign an engineer in Jobs.`);
  };

  const remind = (item: DueItem) => flash(`${ALERT_SETTINGS.template[item.type]} sent to ${item.party} by ${ALERT_SETTINGS.channel[item.type]}.`);

  const renderRow = (item: DueItem) => {
    const when = whenLabel(item.date);
    const snoozedTill = store.snoozed[item.id];
    const master = item.type === "Master" ? store.masters.find((entry) => entry.id === item.recordId) : undefined;
    const late = dayDifference(item.date) < 0;
    return <article key={item.id} className={`due-row due-row--${item.type.toLowerCase()}${snoozedTill > today ? " is-snoozed" : ""}${item.type === "Master" && late ? " is-critical" : ""}`}>
      <div className="due-row-main">
        {isService && <input className="due-tick" type="checkbox" checked={picked.includes(item.id)} onChange={(event) => setPicked((all) => event.target.checked ? [...all, item.id] : all.filter((id) => id !== item.id))} aria-label={`Select ${item.title}`} />}
        <button className="due-row-open" onClick={() => setOpening(item)}>{item.title}</button>
        <button className="erp-action" onClick={() => setActing(item)}>{master?.sentOut ? "Record return" : primaryLabel(item)}</button>
      </div>
      <div className="due-row-meta">
        <span className={`due-when due-when--${when.tone}`}>{when.text}</span>
        <span>{prettyDate(item.date)}</span>
        {item.site && <span className="due-site">{item.site} · {item.city}</span>}
        {item.job ? <span className="due-job-chip">{item.job.number} · {item.job.status.toLowerCase()}{item.job.engineer ? ` · ${item.job.engineer}` : ""}</span> : item.type === "Service" ? <span className="due-nojob">No job yet</span> : null}
        {item.type === "Master" && <span className={`due-depends${late ? " is-critical" : ""}`}>{item.dependents} instrument{item.dependents === 1 ? "" : "s"} depend on it</span>}
        {master?.sentOut && <span className="due-sentout">At {master.sentOut.lab} · back {prettyDate(master.sentOut.expectedReturn)}</span>}
        {item.type === "Payment" ? <>
          <span>{item.party}</span>
          <span className="due-money-cell">Invoice <b>{money(item.amount ?? 0)}</b></span>
          <span className="due-money-cell">Received <b>{money(item.received ?? 0)}</b></span>
          <span className="due-money-cell is-balance">Still due <b>{money(item.balance ?? 0)}</b></span>
          <span className={item.lastReminder ? "due-reminded" : "due-never-reminded"}>{item.lastReminder ? `Reminded ${prettyDate(item.lastReminder)}` : "Never reminded"}</span>
        </> : <>
          {item.party && !item.site && item.type !== "Master" && <span>{item.party}</span>}
          {item.amount ? <b className="due-amount">{money(item.amount)}</b> : null}
        </>}
        {item.note && item.type !== "Payment" && <span className={item.type === "Statutory" ? "due-penalty" : ""}>{item.note}</span>}
        <span className="due-owner">{item.owner}</span>
        {snoozedTill > today && <span className="due-snoozed-chip">Snoozed to {prettyDate(snoozedTill)}</span>}
        <span className="due-row-links">
          <span className="quote-action-anchor">
            <button onClick={() => setSnoozeFor(snoozeFor === item.id ? null : item.id)}>Snooze</button>
            {snoozeFor === item.id && <div className="quote-overflow-menu due-snooze-menu">
              <button onClick={() => snooze(item, 1)}>1 day</button>
              <button onClick={() => snooze(item, 7)}>1 week</button>
              <label><span>Until</span><input type="date" min={today} onChange={(event) => event.target.value && snooze(item, dayDifference(event.target.value))} /></label>
            </div>}
          </span>
          {item.type === "Payment" && <button onClick={() => remind(item)}>Send reminder</button>}
          {item.type === "Service" && item.party && <button onClick={() => remind(item)}>Remind customer</button>}
        </span>
      </div>
    </article>;
  };

  return <section className="leads-page due-page">
    <div className="leads-heading"><div><p className="erp-secondary-text">Operations / Due Dates</p><h1>Due Dates</h1><p className="erp-secondary-text mt-1">Everything that needs doing today, with the one button that does it.</p></div></div>

    <div className="quotations-overview">{cards.map(([label, value, hint, tone, target]) => <button key={label} className={`leads-stat quotations-stat due-stat--${tone} ${window_ === target ? "is-active" : ""}`} onClick={() => setWindow(window_ === target ? "all" : target)}><span>{label}</span><b>{value}</b><small>{hint}</small></button>)}</div>

    {!isEngineer && <div className="stock-tabs due-tabs">
      <button className={isService ? "is-active" : ""} onClick={() => { setTab("service"); setPicked([]); }}>Customer service due <span>{scoped.filter((item) => TAB_OF[item.type] === "service").length}</span></button>
      <button className={activeTab === "equipment" ? "is-active" : ""} onClick={() => { setTab("equipment"); setPicked([]); }}>Our equipment <span>{scoped.filter((item) => TAB_OF[item.type] === "equipment").length}</span></button>
      <button className={activeTab === "money" ? "is-active" : ""} onClick={() => { setTab("money"); setPicked([]); }}>Money <span>{scoped.filter((item) => TAB_OF[item.type] === "money").length}</span></button>
    </div>}

    <div className="due-toolbar"><div className="settings-list-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search what's due" /></div></div>

    {isService && picked.length > 0 && (() => {
      const chosen = rows.filter((item) => picked.includes(item.id));
      const cities = new Set(chosen.map((item) => item.city));
      const sameCity = cities.size === 1;
      return <div className="cluster-bar">
        <span><b>{picked.length} selected</b>{sameCity ? ` · all in ${[...cities][0]} — one trip` : " · pick instruments in one city to make a single trip"}</span>
        <div><button className="settings-outline" onClick={() => setPicked([])}>Clear</button><button className="erp-action" disabled={!sameCity} onClick={() => clusterJob(chosen)}>Create one job</button></div>
      </div>;
    })()}

    {snoozedCount > 0 && <button className="due-snoozed-toggle" onClick={() => setShowSnoozed(!showSnoozed)}>{showSnoozed ? "Hide" : "Show"} {snoozedCount} snoozed item{snoozedCount === 1 ? "" : "s"}</button>}

    {GROUPS[activeTab].map((group) => {
      const groupRows = rows.filter((item) => GROUP_OF[item.type] === group.key);
      if (!groupRows.length && !group.alwaysShow) return null;
      const total = groupRows.reduce((sum, item) => sum + (item.balance ?? item.amount ?? 0), 0);
      return <section key={group.key} className={`due-group due-group--${group.key}`}>
        <div className="due-group-head">
          <div><h3>{group.title}</h3><p>{group.blurb}</p></div>
          {group.money ? <div className="due-group-total"><span>{group.totalLabel}</span><b>{money(total)}</b></div> : <span className="due-group-count">{groupRows.length}</span>}
        </div>
        <div className="due-list">{groupRows.map((item) => renderRow(item))}
          {!groupRows.length && <p className="due-group-empty">Nothing here.</p>}
        </div>
      </section>;
    })}
    {!rows.length && <div className="settings-empty due-empty"><b>Nothing due. Everything is up to date.</b><p>{window_ === "all" && !search ? `New ${isService ? "customer instruments coming up for calibration" : activeTab === "equipment" ? "calibrations for our own kit" : "payments and bills"} appear here on their own.` : "Nothing matches these filters. Clear the search or pick another card."}</p></div>}


    {acting && <ActionSheet item={acting} store={store} close={() => setActing(null)} flash={flash} />}
    {opening && <RecordDrawer item={opening} store={store} close={() => setOpening(null)} />}
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </section>;
}

function ActionSheet({ item, store, close, flash }: { item: DueItem; store: ReturnType<typeof useErpStore>; close: () => void; flash: (message: string) => void }) {
  const today = dateIso();
  const unit = store.individuals.find((entry) => entry.id === item.recordId);
  const instrument = store.instruments.find((entry) => entry.id === item.recordId);
  const invoice = store.invoices.find((entry) => entry.id === item.recordId);
  const bill = store.bills.find((entry) => entry.id === item.recordId);

  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState(String(item.balance ?? item.amount ?? 0));
  const [mode, setMode] = useState<Payment["mode"]>("Bank");
  const [reference, setReference] = useState("");
  const [extend, setExtend] = useState(false);
  const [lab, setLab] = useState(store.masters.find((entry) => entry.id === item.recordId)?.lab ?? vendorMaster[0].name);
  const [expected, setExpected] = useState(addDays(today, 10));
  const [route, setRoute] = useState<"inhouse" | "external">("inhouse");

  const move = (entry: StockMove) => updateStore((current) => ({ moves: [entry, ...current.moves] }));

  const sendToCalibration = () => {
    updateStore((current) => ({
      individuals: current.individuals.map((row) => row.id === unit!.id
        ? { ...row, holder: "Calibration/Repair" as const, currentWith: CAL_LAB, opStatus: "Awaiting calibration" as const, calibrationDue: addMonths(date, 12), last: prettyDate(date) }
        : row),
    }));
    move({ id: `mv-${Date.now()}`, date, at: prettyDate(date), action: "Send for calibration/repair", source: unit!.currentWith, destination: CAL_LAB, equipmentId: unit!.id, who: item.owner, document: `CAL-${Date.now().toString().slice(-4)}`, item: unit!.name });
    close(); flash(`${unit!.name} sent to ${CAL_LAB}. Next calibration ${prettyDate(addMonths(date, 12))}.`);
  };
  const markReturned = () => {
    updateStore((current) => ({
      individuals: current.individuals.map((row) => row.id === unit!.id
        ? { ...row, holder: "Store" as const, currentWith: WAREHOUSE, opStatus: "Available" as const, rentalReturnDue: undefined, last: prettyDate(date) }
        : row),
    }));
    move({ id: `mv-${Date.now()}`, date, at: prettyDate(date), action: "Receive return", source: unit!.currentWith, destination: WAREHOUSE, equipmentId: unit!.id, who: item.owner, document: `RENT-${Date.now().toString().slice(-4)}`, item: unit!.name });
    close(); flash(`${unit!.name} is back in ${WAREHOUSE}.`);
  };
  const extendRental = () => {
    updateStore((current) => ({ individuals: current.individuals.map((row) => row.id === unit!.id ? { ...row, rentalReturnDue: date } : row) }));
    close(); flash(`Rental extended to ${prettyDate(date)}.`);
  };
  const recordPayment = () => {
    const value = Number(amount) || 0;
    if (value <= 0) return;
    updateStore((current) => ({
      invoices: current.invoices.map((row) => {
        if (row.id !== invoice!.id) return row;
        const payments = [{ id: `pay-${Date.now()}`, date, amount: value, mode, reference, tds: 0 }, ...row.payments];
        const settled = invoiceTotals(row).grandTotal - payments.reduce((total, entry) => total + entry.amount + entry.tds, 0) <= 0;
        return { ...row, payments, status: settled ? "Paid" as const : "Partly paid" as const, activities: [{ title: `${settled ? "Payment received in full" : "Part payment received"} ${money(value)}`, meta: stamp(), tone: "paid" as const }, ...row.activities] };
      }),
    }));
    close(); flash(`${money(value)} recorded against ${invoice!.number}.`);
  };
  const markBillPaid = () => {
    updateStore((current) => ({ bills: current.bills.map((row) => row.id === bill!.id ? { ...row, dueDate: addMonths(row.dueDate, 1) } : row) }));
    close(); flash(`${bill!.name} marked paid. Next one due ${prettyDate(addMonths(bill!.dueDate, 1))}.`);
  };

  const createJob = () => {
    updateStore((current) => {
      const number = `JOB-${Math.max(1041, ...current.jobs.map((job) => Number(job.number.split("-")[1]) || 0)) + 1}`;
      return { jobs: [{
        id: number, number, type: "Calibration" as const, customer: instrument!.customer, siteId: instrument!.siteId,
        instrumentIds: [instrument!.id], stockIds: [], description: `Calibration of ${instrument!.name}.`,
        doneAt: "Customer site" as const, scheduledDate: date, slot: JOB_SETTINGS.defaultSlot, hours: 2,
        status: "Unassigned" as const, expectedSpares: [], usedSpares: [], results: [], travelNotes: "", photos: 0,
        activities: [{ title: "Job created from Due Dates", meta: stamp(), tone: "system" as const }],
      }, ...current.jobs] };
    });
    close(); flash(`Job created for ${instrument!.name}. Assign an engineer in Jobs.`);
  };
  const addToJob = () => {
    updateStore((current) => ({ jobs: current.jobs.map((job) => job.id !== item.job!.id ? job : { ...job, instrumentIds: [...job.instrumentIds, instrument!.id], activities: [{ title: `${instrument!.name} added to this job`, meta: stamp(), tone: "system" as const }, ...job.activities] }) }));
    close(); flash(`${instrument!.name} added to ${item.job!.number} — same trip, no extra travel.`);
  };

  const recordMasterReturn = () => {
    const master = store.masters.find((entry) => entry.id === item.recordId)!;
    updateStore((current) => ({ masters: current.masters.map((entry) => entry.id !== item.recordId ? entry : { ...entry, lastCalibrated: date, certificate: reference, sentOut: undefined }) }));
    close(); flash(`${master.name} back in service. Certificate ${reference}, next due ${prettyDate(addMonths(date, master.intervalMonths))}.`);
  };
  const sendMasterOut = () => {
    updateStore((current) => ({ masters: current.masters.map((entry) => entry.id !== item.recordId ? entry : { ...entry, sentOut: { date, expectedReturn: expected, lab } }) }));
    close(); flash(`${store.masters.find((entry) => entry.id === item.recordId)?.name} sent to ${lab}. Expected back ${prettyDate(expected)} — record the certificate when it returns.`);
  };
  const calibrateInHouse = () => {
    updateStore((current) => {
      const number = `JOB-${Math.max(1041, ...current.jobs.map((job) => Number(job.number.split("-")[1]) || 0)) + 1}`;
      return { jobs: [{
        id: number, number, type: "Calibration" as const, customer: "SPM Lab Solutions", siteId: "",
        instrumentIds: [], stockIds: [unit!.id], description: `In-house calibration of ${unit!.name}.`,
        doneAt: "Our lab" as const, scheduledDate: date, slot: JOB_SETTINGS.defaultSlot, hours: 2,
        status: "Unassigned" as const, expectedSpares: [], usedSpares: [], results: [], travelNotes: "", photos: 0,
        activities: [{ title: "Internal calibration job created", meta: stamp(), tone: "system" as const }],
      }, ...current.jobs] };
    });
    close(); flash(`Internal job created for ${unit!.name}. Assign an engineer in Jobs.`);
  };
  const sendFleetOut = () => {
    updateStore((current) => ({ individuals: current.individuals.map((row) => row.id !== unit!.id ? row : { ...row, holder: "Calibration/Repair" as const, currentWith: lab, opStatus: "Awaiting calibration" as const, last: prettyDate(date) }) }));
    move({ id: `mv-${Date.now()}`, date, at: prettyDate(date), action: "Send for calibration/repair", source: unit!.currentWith, destination: lab, equipmentId: unit!.id, who: item.owner, document: `CAL-${Date.now().toString().slice(-4)}`, item: unit!.name });
    close(); flash(`${unit!.name} sent to ${lab}.`);
  };
  const markPaid = () => {
    const record: PaymentRecord = { amount: Number(amount) || 0, date, mode, reference };
    if (record.amount <= 0) return;
    if (item.type === "VendorBill") updateStore((current) => ({ orders: current.orders.map((order) => order.id === item.recordId ? { ...order, billPaid: record } : order) }));
    if (item.type === "Statutory") updateStore((current) => ({ statutoryPaid: { ...current.statutoryPaid, [item.recordId]: record } }));
    if (item.type === "Bill") updateStore((current) => ({ bills: current.bills.map((row) => row.id !== item.recordId ? row : { ...row, dueDate: addMonths(row.dueDate, 1), payments: [record, ...(row.payments ?? [])] }) }));
    close();
    flash(`${money(record.amount)} paid by ${mode}${reference ? ` · ${reference}` : ""}. Sent to Accounts.${item.type === "Bill" ? " Next month's bill is already waiting." : ""}`);
  };

  const body = () => {
    if (item.type === "Service") {
      const site = siteById(instrument?.siteId ?? "");
      if (item.job) return <>
        <p className="po-start-hint">{item.job.number} is already going to {site?.name}, {site?.city} on {prettyDate(item.job.scheduledDate)}{item.job.engineer ? ` with ${item.job.engineer}` : ""}. Adding this instrument costs no extra travel.</p>
        <div className="invoice-payment-footer"><span>{item.job.instrumentIds.length} instrument{item.job.instrumentIds.length === 1 ? "" : "s"} on that job</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={addToJob}>Add to {item.job.number}</button></div></div>
      </>;
      return <>
        <p className="po-start-hint">{instrument?.name} at {site?.name}, {site?.city}. We will raise an unassigned job — pick the engineer on the schedule board.</p>
        <div className="po-receive-grid"><label><span>When should it happen?</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label><span>Where</span><select defaultValue="Customer site"><option>Customer site</option><option>Our lab</option></select></label></div>
        <div className="invoice-payment-footer"><span>Goes to Jobs → Unassigned</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={createJob}>Create job</button></div></div>
      </>;
    }
    if (item.type === "Master") {
      const master = store.masters.find((entry) => entry.id === item.recordId)!;
      if (master.sentOut) return <>
        <p className="po-start-hint">{master.name} has been at {master.sentOut.lab} since {prettyDate(master.sentOut.date)}. Record the certificate to put it back in service.</p>
        <div className="po-receive-grid">
          <label><span>Calibrated on</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label><span>Certificate number</span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="e.g. NABL/2026/1188" /></label>
          <label><span>Certificate PDF</span><input type="file" accept="application/pdf" /></label>
        </div>
        <div className="invoice-payment-footer"><span>Next due {prettyDate(addMonths(date, master.intervalMonths))}</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" disabled={!reference.trim()} onClick={recordMasterReturn}>Back in service</button></div></div>
      </>;
      return <>
        <p className="po-start-hint">SPM cannot calibrate its own masters. {master.name} goes to a higher-tier NABL lab.</p>
        {item.dependents ? <p className="master-blast">{item.dependents} customer instrument{item.dependents === 1 ? " is" : "s are"} calibrated against this master. Every certificate issued with it depends on this being in date.</p> : null}
        <div className="po-receive-grid">
          <label><span>Which lab?</span><select value={lab} onChange={(event) => setLab(event.target.value)}>{vendorMaster.map((vendor) => <option key={vendor.name}>{vendor.name}</option>)}</select></label>
          <label><span>Sending on</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label><span>Expected back</span><input type="date" value={expected} onChange={(event) => setExpected(event.target.value)} /></label>
        </div>
        <div className="invoice-payment-footer"><span>Certificate and next due get recorded when it returns</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={sendMasterOut}>Send out</button></div></div>
      </>;
    }
    if (item.type === "Fleet" && item.id.startsWith("ret-")) return <>
      <p className="po-start-hint">{unit?.name} is with {unit?.currentWith}.</p>
      <div className="due-choice"><button className={!extend ? "is-active" : ""} onClick={() => setExtend(false)}><b>It has come back</b><span>Put it back into {WAREHOUSE}</span></button><button className={extend ? "is-active" : ""} onClick={() => setExtend(true)}><b>They are keeping it longer</b><span>Push the return date out</span></button></div>
      <div className="po-receive-grid"><label><span>{extend ? "New return date" : "Returned on"}</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
      <div className="invoice-payment-footer"><span>{extend ? "Rental extended" : "Back on the shelf"}</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={extend ? extendRental : markReturned}>{extend ? "Extend rental" : "Mark returned"}</button></div></div>
    </>;
    if (item.type === "Fleet") return <>
      <p className="po-start-hint">{unit?.name} is due for calibration. Rental kit can be done either way.</p>
      <div className="due-choice">
        <button className={route === "inhouse" ? "is-active" : ""} onClick={() => setRoute("inhouse")}><b>Calibrate in-house</b><span>Raises an internal job for one of our engineers</span></button>
        <button className={route === "external" ? "is-active" : ""} onClick={() => setRoute("external")}><b>Send out to a lab</b><span>Goes to an external calibration lab</span></button>
      </div>
      <div className="po-receive-grid">
        <label><span>{route === "inhouse" ? "Do it on" : "Sending on"}</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        {route === "external" && <label><span>Which lab?</span><select value={lab} onChange={(event) => setLab(event.target.value)}>{vendorMaster.map((vendor) => <option key={vendor.name}>{vendor.name}</option>)}</select></label>}
      </div>
      <div className="invoice-payment-footer"><span>{route === "inhouse" ? "Goes to Jobs → Unassigned" : "Tracked until the certificate comes back"}</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={route === "inhouse" ? calibrateInHouse : sendFleetOut}>{route === "inhouse" ? "Create job" : "Send out"}</button></div></div>
    </>;
    if (item.type === "Payment") return <>
      <p className="po-start-hint">Money still due on {invoice?.number}: <b>{money(item.balance ?? 0)}</b>. Part payments are fine.</p>
      <div className="po-receive-grid">
        <label><span>Date received</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label><span>Amount received</span><input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label><span>How was it paid?</span><select value={mode} onChange={(event) => setMode(event.target.value as Payment["mode"])}><option>Bank</option><option>UPI</option><option>Cheque</option><option>Cash</option></select></label>
        <label><span>Reference number</span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="UTR, cheque or UPI number" /></label>
      </div>
      <div className="invoice-payment-footer"><span>Recording {money(Number(amount) || 0)}</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" disabled={(Number(amount) || 0) <= 0} onClick={recordPayment}>Save payment</button></div></div>
    </>;
    // Everything on the "to pay" side records the same four things, so Accounts and Tally get it all.
    return <>
      <p className="po-start-hint">{item.title}{item.note ? ` · ${item.note}` : ""}.{item.type === "Bill" ? " Paying it creates next month's automatically." : ""}</p>
      <div className="po-receive-grid">
        <label><span>Amount paid</span><input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label><span>Paid on</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label><span>How did you pay?</span><select value={mode} onChange={(event) => setMode(event.target.value as Payment["mode"])}><option>Bank</option><option>UPI</option><option>Cheque</option><option>Cash</option></select></label>
        <label><span>Reference number</span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="UTR, cheque or challan number" /></label>
      </div>
      <div className="invoice-payment-footer"><span>Goes to Accounts and the Tally export</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" disabled={(Number(amount) || 0) <= 0} onClick={markPaid}>Save payment</button></div></div>
    </>;
  };

  return <div className="stock-modal-backdrop" onClick={close}><section className="stock-move-modal due-action-modal" role="dialog" aria-modal="true" aria-labelledby="due-action-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <h2 id="due-action-title">{primaryLabel(item)}</h2>
    {body()}
  </section></div>;
}

function RecordDrawer({ item, store, close }: { item: DueItem; store: ReturnType<typeof useErpStore>; close: () => void }) {
  const unit = store.individuals.find((entry) => entry.id === item.recordId);
  const instrument = store.instruments.find((entry) => entry.id === item.recordId);
  const invoice = store.invoices.find((entry) => entry.id === item.recordId);
  const bill = store.bills.find((entry) => entry.id === item.recordId);
  const moves = store.moves.filter((entry) => entry.item === unit?.name);
  const site = siteById(instrument?.siteId ?? "");

  return <div className="stock-modal-backdrop" onClick={close}><aside className="stock-detail due-drawer" onClick={(event) => event.stopPropagation()}>
    <div className="settings-drawer-head">
      <div><p>{item.recordKind === "instrument" ? "Customer instrument" : item.recordKind === "equipment" ? "Our equipment" : item.recordKind === "invoice" ? "Invoice" : "Company bill"}</p><h2>{instrument?.name ?? unit?.name ?? invoice?.number ?? bill?.name}</h2></div>
      <button onClick={close} aria-label="Close">×</button>
    </div>
    {instrument && <>
      <dl className="invoice-facts due-facts">
        <div><dt>Customer</dt><dd>{instrument.customer}</dd></div>
        <div><dt>Site</dt><dd>{site?.name} · {site?.city}</dd></div>
        <div><dt>Make and model</dt><dd>{instrument.make} {instrument.model}</dd></div>
        <div><dt>Serial</dt><dd>{instrument.serial}</dd></div>
        <div><dt>Interval</dt><dd>{instrument.intervalMonths} months</dd></div>
        <div><dt>Contact</dt><dd>{site?.contact}</dd></div>
        <div className="invoice-fact-wide"><dt>Job</dt><dd>{item.job ? `${item.job.number} · ${item.job.status.toLowerCase()}${item.job.engineer ? ` · ${item.job.engineer}` : ""}` : "No job raised yet"}</dd></div>
      </dl>
      <section className="stock-detail-section"><h3>Calibration history</h3>{instrument.history.length ? <div className="ci-history">{instrument.history.slice().sort((a, b) => b.date.localeCompare(a.date)).map((entry) => <div key={entry.id}><div><b>{prettyDate(entry.date)}</b><span>{entry.engineer} · {entry.jobNumber}</span></div><span className={`ci-result ci-result--${entry.result === "Fail" ? "fail" : "pass"}`}>{entry.result}</span>{entry.certificate && <button className="ci-cert">{entry.certificate}</button>}</div>)}</div> : <p className="stock-timeline-empty">No calibration recorded yet.</p>}</section>
    </>}
    {unit && <>
      <dl className="invoice-facts due-facts">
        <div><dt>ID</dt><dd>{unit.id}</dd></div>
        <div><dt>Status</dt><dd>{unit.opStatus}</dd></div>
        <div><dt>Currently with</dt><dd>{unit.currentWith}</dd></div>
        <div><dt>Next calibration</dt><dd>{unit.calibrationDue ? prettyDate(unit.calibrationDue) : "—"}</dd></div>
        {unit.rentalReturnDue && <div><dt>Return due</dt><dd>{prettyDate(unit.rentalReturnDue)}</dd></div>}
      </dl>
      <section className="stock-detail-section"><h3>Movement history</h3>{moves.length ? <div className="stock-timeline">{moves.map((entry) => <div key={entry.id}><i /><p><b>{entry.action}</b><span>{entry.at} · {entry.who}</span><small>{entry.source} → {entry.destination} · <em>{entry.document}</em></small></p></div>)}</div> : <p className="stock-timeline-empty">No movements recorded yet.</p>}</section>
    </>}
    {invoice && <>
      <dl className="invoice-facts due-facts">
        <div><dt>Customer</dt><dd>{invoice.customer}</dd></div>
        <div><dt>Invoice date</dt><dd>{prettyDate(invoice.invoiceDate)}</dd></div>
        <div><dt>Payment due by</dt><dd>{prettyDate(invoice.dueDate)}</dd></div>
        <div><dt>Invoice value</dt><dd>{money(invoiceTotals(invoice).grandTotal)}</dd></div>
        <div><dt>Money still due</dt><dd>{money(balanceOf(invoice))}</dd></div>
      </dl>
      <section className="stock-detail-section"><h3>What has happened</h3><div className="lead-timeline quote-activity">{invoice.activities.map((activity, index) => <div key={index}><i /><p><b>{activity.title}</b><span>{activity.meta}</span></p></div>)}</div></section>
    </>}
    {bill && <dl className="invoice-facts due-facts">
      <div><dt>Vendor</dt><dd>{bill.vendor}</dd></div>
      <div><dt>Amount</dt><dd>{money(bill.amount)}</dd></div>
      <div><dt>Due</dt><dd>{prettyDate(bill.dueDate)}</dd></div>
      <div><dt>How often</dt><dd>{bill.every}</dd></div>
      <div><dt>Who looks after it</dt><dd>{bill.owner}</dd></div>
    </dl>}
  </aside></div>;
}

/** Used by the shell for the sidebar badge and the dashboard panel. */
export function dueSummary(store: ReturnType<typeof useErpStore>) {
  const today = dateIso();
  const items = buildDueItems(store).filter((item) => !store.snoozed[item.id] || store.snoozed[item.id] <= today);
  const overdue = items.filter((item) => dayDifference(item.date) < 0);
  const dueToday = items.filter((item) => dayDifference(item.date) === 0);
  return { items, overdue, dueToday, badge: overdue.length + dueToday.length };
}
