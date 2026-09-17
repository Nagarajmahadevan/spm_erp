import { useMemo, useState } from "react";
import { COMPANY, STOCK_LOCATIONS, engineers, dateIso, dayDifference, money, prettyDate, stamp } from "./erpMasters";
import {
  amcStatusFor, balanceAt, balanceOf, balanceStatus, engineerBalance, invoicePaymentStatus, invoiceReceiptsApplied, invoiceTdsRecorded,
  invoiceTotals, jobFullyResolved, nextVisit, onOrderFor,
  totalOf, useErpStore, customerAdvance,
  type Individual, type Invoice, type Job, type Quantity,
} from "./erpStore";
import { buildDueItems } from "./DueDates";
import { Pagination, useTablePage } from "./ErpUi";
import "./reports.css";

type Store = ReturnType<typeof useErpStore>;
type ReportId = "customer-outstanding" | "sales-register" | "stock-position" | "due-dates" | "job-summary" | "advance-expense";
type NavCallbacks = { openInvoice?: (invoiceId: string) => void; openJob?: (jobId: string) => void; openStockItem?: (itemId: string) => void; openEngineer?: (name: string) => void };

const REPORT_LIST: { id: ReportId; label: string; group: string; question: string }[] = [
  { id: "customer-outstanding", label: "Customer Outstanding", group: "Sales & Accounts", question: "Who owes us money, and what needs follow-up?" },
  { id: "sales-register", label: "Sales Register", group: "Sales & Accounts", question: "What have we invoiced during a period?" },
  { id: "stock-position", label: "Stock Position", group: "Stock & Service", question: "What stock do we have, where is it, and what is available?" },
  { id: "due-dates", label: "Upcoming Due Dates", group: "Stock & Service", question: "What needs action soon?" },
  { id: "job-summary", label: "Job Summary", group: "Stock & Service", question: "What work is pending, completed or overdue?" },
  { id: "advance-expense", label: "Engineer Advance & Expense", group: "People & Expenses", question: "Who holds an unsettled advance, who needs reimbursement, and which claims are pending?" },
];
const REPORT_GROUPS = ["Sales & Accounts", "Stock & Service", "People & Expenses"];

/* ─── Shared report plumbing ──────────────────────────────────────── */
function monthRange(monthIso: string) {
  const [year, month] = monthIso.split("-").map(Number);
  const from = `${monthIso}-01`;
  const to = `${monthIso}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  return { from, to };
}
const THIS_MONTH = monthRange(dateIso().slice(0, 7));

// Filters persist across a report switch (or a trip to a source record and back) in this
// module-scope cache — the Reports page itself unmounts on every module switch like every
// other module here, so this is the only place that state can survive that.
let lastReportId: ReportId = "customer-outstanding";
const filterCache: Record<string, unknown> = {};
function useReportFilters<T extends object>(key: string, initial: T) {
  const cached = filterCache[key] as T | undefined;
  const [draft, setDraftState] = useState<T>(cached ?? initial);
  const [applied, setApplied] = useState<T>(cached ?? initial);
  const setDraft = (patch: Partial<T>) => setDraftState((current) => ({ ...current, ...patch }));
  const apply = () => { setApplied(draft); filterCache[key] = draft; };
  // For controls that should apply the instant they change (a view toggle, not a filter field) —
  // computed from the latest draft via the updater form, so it can't apply a stale value.
  const applyNow = (patch: Partial<T>) => setDraftState((current) => { const next = { ...current, ...patch }; setApplied(next); filterCache[key] = next; return next; });
  const reset = () => { setDraftState(initial); setApplied(initial); filterCache[key] = initial; };
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  return { draft, applied, setDraft, apply, applyNow, reset, dirty };
}

function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (value: string | number) => { const text = String(value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const csv = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function PrintHeader({ label, scope }: { label: string; scope: string }) {
  return <div className="reports-print-header"><h2>{COMPANY.name}</h2><h3>{label}</h3><p>{scope}</p><p>Generated {stamp()}</p></div>;
}
function ReportToolbar({ resultCount, itemLabel = "results", sort, setSort, sortOptions, onExport }: { resultCount: number; itemLabel?: string; sort?: string; setSort?: (value: string) => void; sortOptions?: [string, string][]; onExport: () => void }) {
  return <div className="erp-filter-summary reports-toolbar"><span>{resultCount} {resultCount === 1 ? itemLabel.replace(/s$/, "") : itemLabel}</span><div className="expense-inline-actions">
    {sort !== undefined && setSort && sortOptions && <label>Sort by <select value={sort} onChange={(event) => setSort(event.target.value)}>{sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
    <button className="settings-outline" onClick={onExport}>Export CSV</button>
    <button className="settings-outline" onClick={() => window.print()}>Print</button>
  </div></div>;
}
function EmptyState({ hasAny, itemLabel = "records" }: { hasAny: boolean; itemLabel?: string }) {
  return <div className="settings-empty"><b>{hasAny ? `No ${itemLabel} match these filters` : `No ${itemLabel} to show`}</b><p>{hasAny ? "Widen or clear the filters above." : "Nothing has been recorded yet."}</p></div>;
}
function FilterActions({ dirty, apply, reset }: { dirty: boolean; apply: () => void; reset: () => void }) {
  return <><button className="erp-action" disabled={!dirty} onClick={apply}>Apply</button><button className="settings-outline" onClick={reset}>Reset</button></>;
}

export default function Reports({ openInvoice, openJob, openStockItem, openEngineer }: NavCallbacks) {
  const store = useErpStore();
  const [reportId, setReportIdState] = useState<ReportId>(lastReportId);
  const setReportId = (id: ReportId) => { lastReportId = id; setReportIdState(id); };
  const active = REPORT_LIST.find((entry) => entry.id === reportId)!;

  return <section className="leads-page reports-page">
    <div className="leads-heading"><div><p className="erp-secondary-text">Finance / Reports</p><h1>Reports</h1><p className="erp-secondary-text mt-1">Read-only views over existing business records — nothing here can be edited.</p></div></div>
    <div className="reports-layout">
      <aside className="reports-nav">{REPORT_GROUPS.map((group) => <div key={group} className="reports-nav-group">
        <p className="reports-nav-label">{group}</p>
        {REPORT_LIST.filter((entry) => entry.group === group).map((entry) => <button key={entry.id} className={reportId === entry.id ? "is-active" : ""} onClick={() => setReportId(entry.id)}>{entry.label}</button>)}
      </div>)}</aside>
      <div className="reports-panel">
        <p className="reports-description">{active.question}</p>
        {reportId === "customer-outstanding" && <CustomerOutstandingReport store={store} openInvoice={openInvoice} />}
        {reportId === "sales-register" && <SalesRegisterReport store={store} openInvoice={openInvoice} />}
        {reportId === "stock-position" && <StockPositionReport store={store} openStockItem={openStockItem} />}
        {reportId === "due-dates" && <UpcomingDueDatesReport store={store} openJob={openJob} />}
        {reportId === "job-summary" && <JobSummaryReport store={store} openJob={openJob} />}
        {reportId === "advance-expense" && <AdvanceExpenseReport store={store} openEngineer={openEngineer} />}
      </div>
    </div>
  </section>;
}

/* ─── A. Customer Outstanding ─────────────────────────────────────── */
const AGEING_BANDS = ["Not Due", "1–30", "31–60", "61–90", "Over 90"] as const;
function ageingBand(daysOverdue: number): (typeof AGEING_BANDS)[number] {
  if (daysOverdue <= 0) return "Not Due";
  if (daysOverdue <= 30) return "1–30";
  if (daysOverdue <= 60) return "31–60";
  if (daysOverdue <= 90) return "61–90";
  return "Over 90";
}
function CustomerOutstandingReport({ store, openInvoice }: { store: Store; openInvoice?: (invoiceId: string) => void }) {
  const customers = useMemo(() => [...new Set(store.invoices.filter((invoice) => invoice.status === "Sent").map((invoice) => invoice.customer))].sort(), [store.invoices]);
  const filters = useReportFilters("customer-outstanding", { customer: "All customers", scope: "All Outstanding" as "All Outstanding" | "Overdue", band: "All" as "All" | (typeof AGEING_BANDS)[number] });
  const [sort, setSort] = useState("overdue");

  const allRows = useMemo(() => store.invoices.filter((invoice) => invoice.status === "Sent").map((invoice) => {
    const applied = invoiceReceiptsApplied(invoice.id, store.customerReceipts);
    const tds = invoiceTdsRecorded(invoice.id, store.customerTds);
    const balance = balanceOf(invoice, store.customerReceipts, store.customerTds);
    const daysOverdue = Math.max(-dayDifference(invoice.dueDate), 0);
    return { invoice, applied, tds, balance, daysOverdue, band: ageingBand(daysOverdue) };
  }).filter((row) => row.balance > 0.005), [store.invoices, store.customerReceipts, store.customerTds]);

  const rows = allRows.filter((row) => (filters.applied.customer === "All customers" || row.invoice.customer === filters.applied.customer) && (filters.applied.scope === "All Outstanding" || row.daysOverdue > 0) && (filters.applied.band === "All" || row.band === filters.applied.band));
  const sorted = [...rows].sort((a, b) => sort === "overdue" ? b.daysOverdue - a.daysOverdue : sort === "balance" ? b.balance - a.balance : a.invoice.customer.localeCompare(b.invoice.customer));
  const { pageRows, page, setPage } = useTablePage(sorted, `${filters.applied.customer}|${filters.applied.scope}|${filters.applied.band}|${sort}`);

  const totals = rows.reduce((sum, row) => ({ outstanding: sum.outstanding + row.balance, overdue: sum.overdue + (row.daysOverdue > 0 ? row.balance : 0) }), { outstanding: 0, overdue: 0 });
  const customersWithBalance = new Set(rows.map((row) => row.invoice.customer)).size;
  const totalAdvance = useMemo(() => customers.reduce((sum, customer) => sum + customerAdvance(customer, store.customerReceipts), 0), [customers, store.customerReceipts]);
  const scope = `${filters.applied.scope}${filters.applied.customer !== "All customers" ? ` · ${filters.applied.customer}` : ""}${filters.applied.band !== "All" ? ` · ${filters.applied.band}` : ""}`;
  const exportRows = () => exportCsv(`customer-outstanding-${dateIso()}.csv`, ["Customer", "Invoice Number", "Invoice Date", "Due Date", "Invoice Amount", "Receipts Applied", "TDS Recorded", "Balance", "Days Overdue", "Ageing Band"],
    rows.map((row) => [row.invoice.customer, row.invoice.number, prettyDate(row.invoice.invoiceDate), prettyDate(row.invoice.dueDate), invoiceTotals(row.invoice).grandTotal, row.applied, row.tds, row.balance, row.daysOverdue, row.band]));

  return <div className="reports-printable">
    <PrintHeader label="Customer Outstanding" scope={scope} />
    <div className="reports-mini-stats"><span>Total Outstanding <b>{money(totals.outstanding)}</b></span><span>Overdue Amount <b className={totals.overdue > 0.005 ? "reports-figure--overdue" : ""}>{money(totals.overdue)}</b></span><span>Customers With Balance <b>{customersWithBalance}</b></span></div>
    {totalAdvance > 0.005 && <p className="reports-note">{money(totalAdvance)} in unapplied customer advances across all customers — not netted against the balances below. See Accounts → Receivables.</p>}
    <div className="erp-filters reports-filters">
      <label><span>Customer</span><select value={filters.draft.customer} onChange={(event) => filters.setDraft({ customer: event.target.value })}><option>All customers</option>{customers.map((customer) => <option key={customer}>{customer}</option>)}</select></label>
      <label><span>Show</span><select value={filters.draft.scope} onChange={(event) => filters.setDraft({ scope: event.target.value as typeof filters.draft.scope })}><option>All Outstanding</option><option>Overdue</option></select></label>
      <label><span>Ageing band</span><select value={filters.draft.band} onChange={(event) => filters.setDraft({ band: event.target.value as typeof filters.draft.band })}><option value="All">All bands</option>{AGEING_BANDS.map((band) => <option key={band}>{band}</option>)}</select></label>
      <FilterActions dirty={filters.dirty} apply={filters.apply} reset={filters.reset} />
    </div>
    <ReportToolbar resultCount={sorted.length} itemLabel="invoices" sort={sort} setSort={setSort} sortOptions={[["overdue", "Days overdue, highest first"], ["balance", "Balance, highest first"], ["customer", "Customer A–Z"]]} onExport={exportRows} />
    <div className="erp-table-shell"><table className="erp-data-table reports-table"><thead><tr><th>Customer</th><th>Invoice No.</th><th>Invoice Date</th><th>Due Date</th><th className="number">Invoice Amount</th><th className="number">Receipts Applied</th><th className="number">TDS Recorded</th><th className="number">Balance</th><th className="number">Days Overdue</th></tr></thead><tbody>{pageRows.map((row) => <tr key={row.invoice.id}>
      <td>{row.invoice.customer}</td>
      <td><button className="erp-record-link" onClick={() => openInvoice?.(row.invoice.id)}>{row.invoice.number}</button></td>
      <td>{prettyDate(row.invoice.invoiceDate)}</td>
      <td>{prettyDate(row.invoice.dueDate)}</td>
      <td className="number">{money(invoiceTotals(row.invoice).grandTotal)}</td>
      <td className="number">{row.applied > 0.005 ? money(row.applied) : <span className="erp-muted">—</span>}</td>
      <td className="number">{row.tds > 0.005 ? money(row.tds) : <span className="erp-muted">—</span>}</td>
      <td className="number"><b>{money(row.balance)}</b></td>
      <td className="number">{row.daysOverdue > 0 ? <span className="reports-figure--overdue">{row.daysOverdue}d</span> : <span className="erp-muted">—</span>}</td>
    </tr>)}</tbody></table>{!sorted.length && <EmptyState hasAny={allRows.length > 0} itemLabel="outstanding invoices" />}</div>
    <Pagination total={sorted.length} page={page} onPage={setPage} />
  </div>;
}

/* ─── B. Sales Register ───────────────────────────────────────────── */
function SalesRegisterReport({ store, openInvoice }: { store: Store; openInvoice?: (invoiceId: string) => void }) {
  const customers = useMemo(() => [...new Set(store.invoices.filter((invoice) => invoice.status === "Sent").map((invoice) => invoice.customer))].sort(), [store.invoices]);
  const filters = useReportFilters("sales-register", { from: THIS_MONTH.from, to: THIS_MONTH.to, customer: "All customers", type: "All" as "All" | Invoice["invoiceType"] });
  const [sort, setSort] = useState("date");

  const issued = store.invoices.filter((invoice) => invoice.status === "Sent");
  const rows = issued.filter((invoice) => invoice.invoiceDate >= filters.applied.from && invoice.invoiceDate <= filters.applied.to && (filters.applied.customer === "All customers" || invoice.customer === filters.applied.customer) && (filters.applied.type === "All" || invoice.invoiceType === filters.applied.type));
  const sorted = [...rows].sort((a, b) => sort === "date" ? b.invoiceDate.localeCompare(a.invoiceDate) : sort === "value" ? invoiceTotals(b).grandTotal - invoiceTotals(a).grandTotal : a.customer.localeCompare(b.customer));
  const { pageRows, page, setPage } = useTablePage(sorted, `${JSON.stringify(filters.applied)}|${sort}`);

  const totals = rows.reduce((sum, invoice) => { const totalsFor = invoiceTotals(invoice); return { taxable: sum.taxable + totalsFor.taxable, gst: sum.gst + totalsFor.gst, total: sum.total + totalsFor.grandTotal }; }, { taxable: 0, gst: 0, total: 0 });
  const scope = `${prettyDate(filters.applied.from)} – ${prettyDate(filters.applied.to)}${filters.applied.customer !== "All customers" ? ` · ${filters.applied.customer}` : ""}${filters.applied.type !== "All" ? ` · ${filters.applied.type}` : ""}`;
  const exportRows = () => exportCsv(`sales-register-${dateIso()}.csv`, ["Invoice Date", "Invoice Number", "Customer", "Type", "Taxable Value", "GST", "Invoice Total", "Payment Status"],
    rows.map((invoice) => { const totalsFor = invoiceTotals(invoice); return [prettyDate(invoice.invoiceDate), invoice.number, invoice.customer, invoice.invoiceType, totalsFor.taxable, totalsFor.gst, totalsFor.grandTotal, invoicePaymentStatus(invoice, store.customerReceipts, store.customerTds)]; }));

  return <div className="reports-printable">
    <PrintHeader label="Sales Register" scope={scope} />
    <div className="reports-mini-stats"><span>Taxable Value <b>{money(totals.taxable)}</b></span><span>GST <b>{money(totals.gst)}</b></span><span>Total Invoiced <b>{money(totals.total)}</b></span></div>
    <p className="reports-note">Invoiced amounts, not money collected — see Customer Outstanding or Receipts &amp; Payments for collections.</p>
    <div className="erp-filters reports-filters">
      <label><span>From</span><input type="date" value={filters.draft.from} onChange={(event) => filters.setDraft({ from: event.target.value })} /></label>
      <label><span>To</span><input type="date" value={filters.draft.to} onChange={(event) => filters.setDraft({ to: event.target.value })} /></label>
      <label><span>Customer</span><select value={filters.draft.customer} onChange={(event) => filters.setDraft({ customer: event.target.value })}><option>All customers</option>{customers.map((customer) => <option key={customer}>{customer}</option>)}</select></label>
      <label><span>Invoice type</span><select value={filters.draft.type} onChange={(event) => filters.setDraft({ type: event.target.value as typeof filters.draft.type })}><option value="All">All types</option><option>Sales</option><option>Service</option><option>Rental</option></select></label>
      <FilterActions dirty={filters.dirty} apply={filters.apply} reset={filters.reset} />
    </div>
    <ReportToolbar resultCount={sorted.length} itemLabel="invoices" sort={sort} setSort={setSort} sortOptions={[["date", "Invoice date, newest first"], ["value", "Total, highest first"], ["customer", "Customer A–Z"]]} onExport={exportRows} />
    <div className="erp-table-shell"><table className="erp-data-table reports-table"><thead><tr><th>Invoice Date</th><th>Invoice No.</th><th>Customer</th><th>Type</th><th className="number">Taxable Value</th><th className="number">GST</th><th className="number">Invoice Total</th><th>Payment Status</th></tr></thead><tbody>{pageRows.map((invoice) => { const totalsFor = invoiceTotals(invoice); const status = invoicePaymentStatus(invoice, store.customerReceipts, store.customerTds); return <tr key={invoice.id}>
      <td>{prettyDate(invoice.invoiceDate)}</td>
      <td><button className="erp-record-link" onClick={() => openInvoice?.(invoice.id)}>{invoice.number}</button></td>
      <td>{invoice.customer}</td>
      <td>{invoice.invoiceType}</td>
      <td className="number">{money(totalsFor.taxable)}</td>
      <td className="number">{money(totalsFor.gst)}</td>
      <td className="number"><b>{money(totalsFor.grandTotal)}</b></td>
      <td><span className={`invoice-status invoice-status--${status.toLowerCase().replace(/ /g, "-")}`}>{status}</span></td>
    </tr>; })}</tbody></table>{!sorted.length && <EmptyState hasAny={issued.length > 0} itemLabel="invoices" />}</div>
    <Pagination total={sorted.length} page={page} onPage={setPage} />
  </div>;
}

/* ─── C. Stock Position ───────────────────────────────────────────── */
const opLabel = (item: Individual) => item.holder === "Customer" && item.opStatus === "In use" ? "On rent" : item.opStatus;
const opSlug = (status: string) => status.toLowerCase().replace(/ /g, "-");
function StockPositionReport({ store, openStockItem }: { store: Store; openStockItem?: (itemId: string) => void }) {
  const filters = useReportFilters("stock-position", { view: "equipment" as "equipment" | "spares", location: "All", status: "All", lowStockOnly: false });
  // Sold equipment has changed owner — it is a customer's asset now, not part of SPM's fleet.
  const equipment = useMemo(() => store.individuals.filter((item) => item.opStatus !== "Sold"), [store.individuals]);
  const locations = useMemo(() => [...new Set(equipment.map((item) => item.currentWith))].sort(), [equipment]);
  const statuses = useMemo(() => [...new Set(equipment.map((item) => opLabel(item)))].sort(), [equipment]);

  const equipmentRows = equipment.filter((item) => (filters.applied.location === "All" || item.currentWith === filters.applied.location) && (filters.applied.status === "All" || opLabel(item) === filters.applied.status));
  const spareRows = store.quantities.filter((item) => !filters.applied.lowStockOnly || totalOf(item) < item.minimum);
  const { pageRows: equipmentPage, page: ePage, setPage: setEPage } = useTablePage(equipmentRows, `equip|${JSON.stringify(filters.applied)}`);
  const { pageRows: sparePage, page: sPage, setPage: setSPage } = useTablePage(spareRows, `spare|${JSON.stringify(filters.applied)}`);

  const scope = filters.applied.view === "equipment"
    ? `Equipment${filters.applied.location !== "All" ? ` · ${filters.applied.location}` : ""}${filters.applied.status !== "All" ? ` · ${filters.applied.status}` : ""}`
    : `Spares & Consumables${filters.applied.lowStockOnly ? " · Low stock only" : ""}`;
  const exportEquipment = () => exportCsv(`stock-position-equipment-${dateIso()}.csv`, ["Internal ID", "Equipment", "Serial", "Operational Status", "Currently With", "Calibration Due", "Rental Return Due"],
    equipmentRows.map((item) => [item.id, item.name, item.serial, opLabel(item), item.currentWith, item.calibrationDue ? prettyDate(item.calibrationDue) : "", item.rentalReturnDue ? prettyDate(item.rentalReturnDue) : ""]));
  const exportSpares = () => exportCsv(`stock-position-spares-${dateIso()}.csv`, ["Stock Code", "Item", "Unit", "Total On Hand", "Available In Store", "With Engineers", "Minimum Level", "Low Stock"],
    spareRows.map((item) => { const total = totalOf(item); const available = balancesInStore(item); return [item.id, item.name, item.unit, total, available, Math.max(total - available, 0), item.minimum, total < item.minimum ? "Yes" : "No"]; }));

  return <div className="reports-printable">
    <PrintHeader label="Stock Position" scope={scope} />
    <div className="reports-view-toggle"><button className={filters.applied.view === "equipment" ? "is-active" : ""} onClick={() => filters.applyNow({ view: "equipment" })}>Equipment</button><button className={filters.applied.view === "spares" ? "is-active" : ""} onClick={() => filters.applyNow({ view: "spares" })}>Spares &amp; Consumables</button></div>
    {filters.applied.view === "equipment" ? <>
      <div className="erp-filters reports-filters">
        <label><span>Location</span><select value={filters.draft.location} onChange={(event) => filters.setDraft({ location: event.target.value })}><option value="All">All locations</option>{locations.map((location) => <option key={location}>{location}</option>)}</select></label>
        <label><span>Status</span><select value={filters.draft.status} onChange={(event) => filters.setDraft({ status: event.target.value })}><option value="All">All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
        <FilterActions dirty={filters.dirty} apply={filters.apply} reset={filters.reset} />
      </div>
      <ReportToolbar resultCount={equipmentRows.length} itemLabel="units" onExport={exportEquipment} />
      <div className="erp-table-shell"><table className="erp-data-table reports-table"><thead><tr><th>Internal ID</th><th>Equipment</th><th>Status</th><th>Currently With</th><th>Calibration Due</th><th>Rental Return</th></tr></thead><tbody>{equipmentPage.map((item) => <tr key={item.id} className="erp-row-clickable" onClick={() => openStockItem?.(item.id)}>
        <td><b>{item.id}</b></td>
        <td>{item.name}<small>{item.model} · {item.serial}</small></td>
        <td><span className={`stock-status ${opSlug(opLabel(item))}`}>{opLabel(item)}</span></td>
        <td>{item.currentWith}</td>
        <td>{item.calibrationDue ? <span className={dayDifference(item.calibrationDue) < 0 ? "reports-figure--overdue" : ""}>{prettyDate(item.calibrationDue)}</span> : <span className="erp-muted">Not recorded</span>}</td>
        <td>{opLabel(item) === "On rent" ? (item.rentalReturnDue ? prettyDate(item.rentalReturnDue) : "Not set") : <span className="erp-muted">—</span>}</td>
      </tr>)}</tbody></table>{!equipmentRows.length && <EmptyState hasAny={equipment.length > 0} itemLabel="equipment" />}</div>
      <Pagination total={equipmentRows.length} page={ePage} onPage={setEPage} />
    </> : <>
      <div className="erp-filters reports-filters">
        <label className="settings-check"><input type="checkbox" checked={filters.draft.lowStockOnly} onChange={(event) => filters.setDraft({ lowStockOnly: event.target.checked })} /><span>Low stock only</span></label>
        <FilterActions dirty={filters.dirty} apply={filters.apply} reset={filters.reset} />
      </div>
      <ReportToolbar resultCount={spareRows.length} itemLabel="items" onExport={exportSpares} />
      <div className="erp-table-shell"><table className="erp-data-table reports-table"><thead><tr><th>Stock Code</th><th>Item</th><th>Unit</th><th className="number">Total On Hand</th><th className="number">Available In Store</th><th className="number">With Engineers</th><th className="number">Minimum</th><th>Alert</th></tr></thead><tbody>{sparePage.map((item) => { const total = totalOf(item); const available = balancesInStore(item); const withEngineers = Math.max(total - available, 0); const low = total < item.minimum; return <tr key={item.id}>
        <td><b>{item.id}</b></td><td>{item.name}</td><td>{item.unit}</td>
        <td className="number">{total}</td><td className="number">{available}</td><td className="number">{withEngineers}</td><td className="number">{item.minimum}</td>
        <td>{low ? <span className="reports-figure--overdue">Low stock</span> : <span className="erp-muted">—</span>}</td>
      </tr>; })}</tbody></table>{!spareRows.length && <EmptyState hasAny={store.quantities.length > 0} itemLabel="items" />}</div>
      <Pagination total={spareRows.length} page={sPage} onPage={setSPage} />
    </>}
  </div>;
}
function balancesInStore(item: Quantity) { return item.balances.filter((entry) => STOCK_LOCATIONS.includes(entry.location)).reduce((sum, entry) => sum + entry.quantity, 0); }

/* ─── F. Upcoming Due Dates ───────────────────────────────────────── */
type UDueType = "Customer Instrument Calibration" | "SPM Equipment Calibration" | "Rental Return" | "AMC Visit";
type URow = { dueType: UDueType; party: string; reference: string; date: string; job?: Job };
function buildUpcomingRows(store: Store): URow[] {
  const rows: URow[] = [];
  buildDueItems(store).forEach((item) => {
    if (item.type === "Service") rows.push({ dueType: "Customer Instrument Calibration", party: item.party ?? "—", reference: item.title, date: item.date, job: item.job });
    else if (item.type === "Fleet") rows.push({ dueType: item.id.startsWith("ret-") ? "Rental Return" : "SPM Equipment Calibration", party: item.party ?? "In store", reference: item.title, date: item.date });
  });
  store.contracts.forEach((contract) => { const visit = nextVisit(contract); if (visit) rows.push({ dueType: "AMC Visit", party: contract.customer, reference: `${contract.number} · ${contract.frequency} visit — ${amcStatusFor(contract)}`, date: visit.due }); });
  return rows;
}
function UpcomingDueDatesReport({ store, openJob }: { store: Store; openJob?: (jobId: string) => void }) {
  const filters = useReportFilters("upcoming-due-dates", { dueType: "All" as "All" | UDueType, party: "", scope: "Next 30 days" as "Overdue" | "Next 7 days" | "Next 30 days" | "Custom", from: dateIso(), to: dateIso() });
  const allRows = useMemo(() => buildUpcomingRows(store), [store]);
  const scoped = allRows.filter((row) => (filters.applied.dueType === "All" || row.dueType === filters.applied.dueType) && (!filters.applied.party.trim() || row.party.toLowerCase().includes(filters.applied.party.trim().toLowerCase())));
  const inScope = (row: URow) => {
    const diff = dayDifference(row.date);
    if (filters.applied.scope === "Overdue") return diff < 0;
    if (filters.applied.scope === "Next 7 days") return diff >= 0 && diff <= 7;
    if (filters.applied.scope === "Next 30 days") return diff >= 0 && diff <= 30;
    return row.date >= filters.applied.from && row.date <= filters.applied.to;
  };
  const rows = scoped.filter(inScope).sort((a, b) => a.date.localeCompare(b.date));
  const { pageRows, page, setPage } = useTablePage(rows, JSON.stringify(filters.applied));
  const counts = { overdue: scoped.filter((row) => dayDifference(row.date) < 0).length, week: scoped.filter((row) => dayDifference(row.date) >= 0 && dayDifference(row.date) <= 7).length, month: scoped.filter((row) => dayDifference(row.date) >= 0 && dayDifference(row.date) <= 30).length };
  const scope = `${filters.applied.scope}${filters.applied.dueType !== "All" ? ` · ${filters.applied.dueType}` : ""}${filters.applied.party ? ` · ${filters.applied.party}` : ""}`;
  const exportRows = () => exportCsv(`upcoming-due-dates-${dateIso()}.csv`, ["Due Type", "Customer / Party", "Instrument / Reference", "Due Date", "Days Remaining"], rows.map((row) => [row.dueType, row.party, row.reference, prettyDate(row.date), dayDifference(row.date)]));

  return <div className="reports-printable">
    <PrintHeader label="Upcoming Due Dates" scope={scope} />
    <div className="reports-mini-stats"><span>Overdue <b className="reports-figure--overdue">{counts.overdue}</b></span><span>Due In 7 Days <b>{counts.week}</b></span><span>Due In 30 Days <b>{counts.month}</b></span></div>
    <div className="erp-filters reports-filters">
      <label><span>Due type</span><select value={filters.draft.dueType} onChange={(event) => filters.setDraft({ dueType: event.target.value as typeof filters.draft.dueType })}><option value="All">All types</option><option>Customer Instrument Calibration</option><option>SPM Equipment Calibration</option><option>Rental Return</option><option>AMC Visit</option></select></label>
      <label><span>Customer</span><input value={filters.draft.party} onChange={(event) => filters.setDraft({ party: event.target.value })} placeholder="Search customer or party" /></label>
      <label><span>Show</span><select value={filters.draft.scope} onChange={(event) => filters.setDraft({ scope: event.target.value as typeof filters.draft.scope })}><option>Overdue</option><option>Next 7 days</option><option>Next 30 days</option><option>Custom</option></select></label>
      {filters.draft.scope === "Custom" && <><label><span>From</span><input type="date" value={filters.draft.from} onChange={(event) => filters.setDraft({ from: event.target.value })} /></label><label><span>To</span><input type="date" value={filters.draft.to} onChange={(event) => filters.setDraft({ to: event.target.value })} /></label></>}
      <FilterActions dirty={filters.dirty} apply={filters.apply} reset={filters.reset} />
    </div>
    <ReportToolbar resultCount={rows.length} itemLabel="items" onExport={exportRows} />
    <div className="erp-table-shell"><table className="erp-data-table reports-table"><thead><tr><th>Due Type</th><th>Customer / Party</th><th>Instrument / Reference</th><th>Due Date</th><th className="number">Days Remaining</th><th>Related Job</th></tr></thead><tbody>{pageRows.map((row, index) => { const diff = dayDifference(row.date); return <tr key={index}>
      <td>{row.dueType}</td><td>{row.party}</td><td>{row.reference}</td><td>{prettyDate(row.date)}</td>
      <td className="number">{diff < 0 ? <span className="reports-figure--overdue">{Math.abs(diff)}d overdue</span> : <span>{diff}d</span>}</td>
      <td>{row.job ? <button className="erp-record-link" onClick={() => openJob?.(row.job!.id)}>{row.job.number} · {row.job.status}</button> : <span className="erp-muted">—</span>}</td>
    </tr>; })}</tbody></table>{!rows.length && <EmptyState hasAny={allRows.length > 0} itemLabel="upcoming items" />}</div>
    <Pagination total={rows.length} page={page} onPage={setPage} />
  </div>;
}

/* ─── G. Job Summary ──────────────────────────────────────────────── */
function followUpFor(job: Job): string {
  if (job.status === "Cancelled") return "—";
  if (job.status === "Completed") return jobFullyResolved(job) ? "—" : "Follow-up needed";
  if (job.status === "On hold") return job.onHoldReason ? `On hold — ${job.onHoldReason}` : "On hold";
  return "—";
}
function JobSummaryReport({ store, openJob }: { store: Store; openJob?: (jobId: string) => void }) {
  const customers = useMemo(() => [...new Set(store.jobs.map((job) => job.customer))].sort(), [store.jobs]);
  const jobEngineers = useMemo(() => [...new Set(store.jobs.map((job) => job.engineer).filter(Boolean) as string[])].sort(), [store.jobs]);
  const statuses = useMemo(() => [...new Set(store.jobs.map((job) => job.status))].sort(), [store.jobs]);
  const filters = useReportFilters("job-summary", { basis: "Scheduled Date" as "Scheduled Date" | "Completed Date", from: THIS_MONTH.from, to: THIS_MONTH.to, status: "All", engineer: "All engineers", customer: "All customers" });

  const inRange = (job: Job) => {
    const date = filters.applied.basis === "Scheduled Date" ? job.scheduledDate : job.completedAt;
    if (!date) return false;
    return date >= filters.applied.from && date <= filters.applied.to;
  };
  const rows = store.jobs.filter((job) => inRange(job) && (filters.applied.status === "All" || job.status === filters.applied.status)
    && (filters.applied.engineer === "All engineers" || job.engineer === filters.applied.engineer)
    && (filters.applied.customer === "All customers" || job.customer === filters.applied.customer))
    .sort((a, b) => (filters.applied.basis === "Scheduled Date" ? b.scheduledDate.localeCompare(a.scheduledDate) : (b.completedAt ?? "").localeCompare(a.completedAt ?? "")));
  const { pageRows, page, setPage } = useTablePage(rows, JSON.stringify(filters.applied));

  const scheduledInRange = store.jobs.filter((job) => job.scheduledDate >= filters.applied.from && job.scheduledDate <= filters.applied.to);
  const summary = {
    scheduled: scheduledInRange.length,
    completed: store.jobs.filter((job) => job.completedAt && job.completedAt >= filters.applied.from && job.completedAt <= filters.applied.to).length,
    stillOpen: scheduledInRange.filter((job) => job.status !== "Completed" && job.status !== "Cancelled").length,
  };
  const scope = `${prettyDate(filters.applied.from)} – ${prettyDate(filters.applied.to)} by ${filters.applied.basis}${filters.applied.status !== "All" ? ` · ${filters.applied.status}` : ""}${filters.applied.engineer !== "All engineers" ? ` · ${filters.applied.engineer}` : ""}${filters.applied.customer !== "All customers" ? ` · ${filters.applied.customer}` : ""}`;
  const exportRows = () => exportCsv(`job-summary-${dateIso()}.csv`, ["Job Number", "Type", "Customer", "Site", "Engineers", "Scheduled Date", "Status", "Completed Date", "Follow-up"],
    rows.map((job) => [job.number, job.type, job.customer, job.siteId, job.engineer || "Unassigned", prettyDate(job.scheduledDate), job.status, job.completedAt ? prettyDate(job.completedAt) : "", followUpFor(job)]));

  return <div className="reports-printable">
    <PrintHeader label="Job Summary" scope={scope} />
    <div className="reports-mini-stats"><span>Scheduled In Range <b>{summary.scheduled}</b></span><span>Completed In Range <b>{summary.completed}</b></span><span>Still Open (Of Those Scheduled) <b>{summary.stillOpen}</b></span></div>
    <div className="erp-filters reports-filters">
      <label><span>Date basis</span><select value={filters.draft.basis} onChange={(event) => filters.setDraft({ basis: event.target.value as typeof filters.draft.basis })}><option>Scheduled Date</option><option>Completed Date</option></select></label>
      <label><span>From</span><input type="date" value={filters.draft.from} onChange={(event) => filters.setDraft({ from: event.target.value })} /></label>
      <label><span>To</span><input type="date" value={filters.draft.to} onChange={(event) => filters.setDraft({ to: event.target.value })} /></label>
      <label><span>Status</span><select value={filters.draft.status} onChange={(event) => filters.setDraft({ status: event.target.value })}><option value="All">All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
      <label><span>Engineer</span><select value={filters.draft.engineer} onChange={(event) => filters.setDraft({ engineer: event.target.value })}><option>All engineers</option>{jobEngineers.map((engineer) => <option key={engineer}>{engineer}</option>)}</select></label>
      <label><span>Customer</span><select value={filters.draft.customer} onChange={(event) => filters.setDraft({ customer: event.target.value })}><option>All customers</option>{customers.map((customer) => <option key={customer}>{customer}</option>)}</select></label>
      <FilterActions dirty={filters.dirty} apply={filters.apply} reset={filters.reset} />
    </div>
    <ReportToolbar resultCount={rows.length} itemLabel="jobs" onExport={exportRows} />
    <div className="erp-table-shell"><table className="erp-data-table reports-table"><thead><tr><th>Job</th><th>Customer / Site</th><th>Engineer(s)</th><th>Scheduled</th><th>Status</th><th>Completed</th><th>Follow-up</th></tr></thead><tbody>{pageRows.map((job) => <tr key={job.id}>
      <td><button className="erp-record-link" onClick={() => openJob?.(job.id)}>{job.number}</button><small>{job.type}</small></td>
      <td>{job.customer}<small>{job.siteId}</small></td>
      <td>{job.engineer || <span className="erp-muted">Unassigned</span>}</td>
      <td>{prettyDate(job.scheduledDate)}</td>
      <td><span className={`job-status job-status--${job.status.toLowerCase().replace(/ /g, "-")}`}>{job.status}</span></td>
      <td>{job.completedAt ? prettyDate(job.completedAt) : <span className="erp-muted">—</span>}</td>
      <td>{followUpFor(job) !== "—" ? <span className="reports-figure--overdue">{followUpFor(job)}</span> : <span className="erp-muted">—</span>}</td>
    </tr>)}</tbody></table>{!rows.length && <EmptyState hasAny={store.jobs.length > 0} itemLabel="jobs" />}</div>
    <Pagination total={rows.length} page={page} onPage={setPage} />
  </div>;
}

/* ─── H. Engineer Advance & Expense ───────────────────────────────── */
const balanceSlug = (label: string) => label.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
function balanceLine(balance: number, pendingClaims: number) {
  const status = balanceStatus(balance, pendingClaims);
  if (status === "With engineer") return `${money(balance)} with engineer`;
  if (status === "To reimburse") return `${money(Math.abs(balance))} to reimburse`;
  return status;
}
function AdvanceExpenseReport({ store, openEngineer }: { store: Store; openEngineer?: (name: string) => void }) {
  const filters = useReportFilters("advance-expense-report", { search: "", status: "All" as "All" | "With Engineer" | "To Reimburse" | "Settled" });
  const allRows = engineers.map((engineer) => ({ engineer: engineer.name, ...engineerBalance(store.expenses, store.advancePayments, engineer.name) }));
  const bucket = (row: (typeof allRows)[number]) => { const status = balanceStatus(row.balance, row.pendingClaims); return status === "With engineer" ? "With Engineer" : status === "To reimburse" ? "To Reimburse" : "Settled"; };
  const rows = allRows.filter((row) => row.engineer.toLowerCase().includes(filters.applied.search.toLowerCase()) && (filters.applied.status === "All" || bucket(row) === filters.applied.status));
  const { pageRows, page, setPage } = useTablePage(rows, JSON.stringify(filters.applied));
  const totals = allRows.reduce((sum, row) => ({ withEngineer: sum.withEngineer + Math.max(0, row.balance), toReimburse: sum.toReimburse + Math.max(0, -row.balance), pending: sum.pending + row.pendingClaims }), { withEngineer: 0, toReimburse: 0, pending: 0 });
  const scope = `As of now${filters.applied.status !== "All" ? ` · ${filters.applied.status}` : ""}${filters.applied.search ? ` · "${filters.applied.search}"` : ""}`;
  const exportRows = () => exportCsv(`engineer-advance-expense-${dateIso()}.csv`, ["Engineer", "Advances Paid", "Reimbursements Paid", "Approved Expenses", "Money Returned", "Current Balance", "Pending Claims", "Status"],
    rows.map((row) => [row.engineer, row.advancesPaid, row.reimbursementsPaid, row.approvedExpenses, row.moneyReturned, row.balance, row.pendingClaims, balanceStatus(row.balance, row.pendingClaims)]));

  return <div className="reports-printable">
    <PrintHeader label="Engineer Advance & Expense" scope={scope} />
    <div className="reports-mini-stats"><span>Total With Engineers <b>{money(totals.withEngineer)}</b></span><span>Total To Reimburse <b>{money(totals.toReimburse)}</b></span><span>Pending Claims <b>{money(totals.pending)}</b></span></div>
    <p className="reports-note">Balances shown as of now — no period filter applies, so earlier advances stay counted. Open an engineer for period-specific transactions in Advance &amp; Expense.</p>
    <div className="erp-filters reports-filters">
      <label className="erp-search-filter"><span>Search engineer</span><input value={filters.draft.search} onChange={(event) => filters.setDraft({ search: event.target.value })} /></label>
      <label><span>Balance</span><select value={filters.draft.status} onChange={(event) => filters.setDraft({ status: event.target.value as typeof filters.draft.status })}><option value="All">All</option><option>With Engineer</option><option>To Reimburse</option><option>Settled</option></select></label>
      <FilterActions dirty={filters.dirty} apply={filters.apply} reset={filters.reset} />
    </div>
    <ReportToolbar resultCount={rows.length} itemLabel="engineers" onExport={exportRows} />
    <div className="erp-table-shell"><table className="erp-data-table reports-table"><thead><tr><th>Engineer</th><th className="number">Advances Paid</th><th className="number">Reimbursements Paid</th><th className="number">Approved Expenses</th><th className="number">Money Returned</th><th>Balance</th><th className="number">Pending Claims</th></tr></thead><tbody>{pageRows.map((row) => <tr key={row.engineer}>
      <td><button className="erp-record-link" onClick={() => openEngineer?.(row.engineer)}>{row.engineer}</button></td>
      <td className="number">{money(row.advancesPaid)}</td>
      <td className="number">{money(row.reimbursementsPaid)}</td>
      <td className="number">{money(row.approvedExpenses)}</td>
      <td className="number">{money(row.moneyReturned)}</td>
      <td><span className={`expense-balance expense-balance--${balanceSlug(balanceStatus(row.balance, row.pendingClaims))}`}>{balanceLine(row.balance, row.pendingClaims)}</span></td>
      <td className="number">{row.pendingClaims > 0.005 ? money(row.pendingClaims) : <span className="erp-muted">—</span>}</td>
    </tr>)}</tbody></table>{!rows.length && <EmptyState hasAny={allRows.length > 0} itemLabel="engineers" />}</div>
    <Pagination total={rows.length} page={page} onPage={setPage} />
  </div>;
}
