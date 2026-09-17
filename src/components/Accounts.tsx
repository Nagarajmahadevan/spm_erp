import { useState } from "react";
import { COMPANY, vendorMaster, dateIso, dayDifference, money, prettyDate, stamp } from "./erpMasters";
import {
  addPayable, balanceOf, customerAdvance, duplicateBillNumber, duplicateCustomerTds,
  duplicatePaymentReference, duplicateReceiptReference, invoiceReceiptsApplied, invoiceTdsRecorded, invoiceTotals, PAYABLE_CATEGORIES,
  payableBalance, payablePaymentStatus, recordCustomerReceipt, recordSupplierPayment,
  updateStore, useErpStore,
  type CustomerTds, type Invoice, type Payable, type PayableCategory, type PaymentMode, type PurchaseOrder, type SupplierPayment,
} from "./erpStore";
import { Overlay, Pagination, useTablePage } from "./ErpUi";
import "./accounts.css";

type Tab = "Receivables" | "Payables" | "Receipts & Payments";
type Store = ReturnType<typeof useErpStore>;
const RECORDER = "Arun Kumar"; // prototype: one admin/accounts identity, matching the rest of the app

/** Builds the vendor bill (Payable) for a received PO — carries the vendor's TDS rate/section
 *  so it can be pre-filled when the bill is paid, and cites the PO via poRef. */
export function payableFromPurchaseOrder(order: PurchaseOrder, grandTotal: number, billNumber: string | undefined, billDate: string, dueDate: string): Payable {
  return {
    id: `BILL-${Date.now()}`, number: billNumber, payee: order.vendor, category: "Supplier Purchase",
    billDate, dueDate, amount: grandTotal, description: `${order.number} · ${order.items.map((line) => line.item).filter(Boolean).join(", ")}`,
    poRef: order.number, tdsRate: order.tdsRate || undefined, tdsSection: order.tdsRate ? order.tdsSection : undefined,
    createdBy: RECORDER, createdAt: stamp(),
  };
}
const PAYMENT_MODES: PaymentMode[] = ["Bank", "UPI", "Cheque", "Cash"];
const statusSlug = (label: string) => label.toLowerCase().replace(/ /g, "-");
/** Maps a real status word onto one of the three existing job-status colour tones, without
 *  ever changing the visible text — Reversed reads grey, Recorded/Paid reads green, anything
 *  still pending reads amber. */
function statusTone(status: string) {
  if (status === "Reversed" || status === "Cancelled") return "cancelled";
  if (status === "Unpaid" || status === "Partly Paid") return "pending-approval";
  return "completed";
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

export default function Accounts({ openInvoice }: { openInvoice?: (invoiceId: string) => void }) {
  const store = useErpStore();
  const [tab, setTab] = useState<Tab>("Receivables");
  const [toast, setToast] = useState("");
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 4200); };
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [cloning, setCloning] = useState<Payable | null>(null);
  const [payingBill, setPayingBill] = useState<string | null>(null);
  const [exportingTally, setExportingTally] = useState(false);

  return <section className="leads-page accounts-page">
    <div className="leads-heading"><div><p className="erp-secondary-text">Finance / Accounts</p><h1>Accounts</h1><p className="erp-secondary-text mt-1">Customer collections, supplier bills and every receipt or payment in one place.</p></div>
      <div className="leads-actions">
        {tab === "Payables" && <button className="erp-action" onClick={() => setAdding(true)}>+ Add Bill</button>}
        {tab === "Receivables" && <button className="settings-outline" onClick={() => setReceiptFor("")}>Record Receipt</button>}
        <button className="settings-outline" onClick={() => setExportingTally(true)}>Export to Tally</button>
      </div>
    </div>
    <div className="stock-tabs accounts-tabs">{(["Receivables", "Payables", "Receipts & Payments"] as Tab[]).map((entry) => <button key={entry} className={tab === entry ? "is-active" : ""} onClick={() => setTab(entry)}>{entry}</button>)}</div>

    {tab === "Receivables" && <CustomerOutstandingView store={store} openInvoice={openInvoice} openReceipt={setReceiptFor} flash={flash} />}
    {tab === "Payables" && <BillsExpensesView store={store} openPay={setPayingBill} onClone={(bill) => setCloning(bill)} flash={flash} />}
    {tab === "Receipts & Payments" && <ReceiptsPaymentsView store={store} openInvoice={openInvoice} flash={flash} />}

    {(adding || cloning) && <AddBillForm store={store} close={() => { setAdding(false); setCloning(null); }} flash={flash} cloneFrom={cloning ?? undefined} />}
    {payingBill !== null && <RecordBillPayment store={store} billId={payingBill} close={() => setPayingBill(null)} flash={flash} />}
    {receiptFor !== null && <RecordReceipt store={store} customer={receiptFor || undefined} close={() => setReceiptFor(null)} flash={flash} />}
    {exportingTally && <TallyExportModal store={store} close={() => setExportingTally(false)} />}
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </section>;
}

/* ─── Customer Outstanding ────────────────────────────────────────── */
function CustomerOutstandingView({ store, openInvoice, openReceipt, flash }: { store: Store; openInvoice?: (invoiceId: string) => void; openReceipt: (customer: string) => void; flash: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"All Outstanding" | "Overdue">("All Outstanding");
  const [openCustomer, setOpenCustomer] = useState<string | null>(null);

  const byCustomer = new Map<string, Invoice[]>();
  store.invoices.filter((invoice) => invoice.status === "Sent").forEach((invoice) => byCustomer.set(invoice.customer, [...(byCustomer.get(invoice.customer) ?? []), invoice]));
  const allRows = [...byCustomer.entries()].map(([customer, invoices]) => {
    const unpaid = invoices.filter((invoice) => balanceOf(invoice, store.customerReceipts, store.customerTds) > 0.005);
    const outstanding = unpaid.reduce((sum, invoice) => sum + balanceOf(invoice, store.customerReceipts, store.customerTds), 0);
    const overdue = unpaid.filter((invoice) => dayDifference(invoice.dueDate) < 0).reduce((sum, invoice) => sum + balanceOf(invoice, store.customerReceipts, store.customerTds), 0);
    const nextDue = unpaid.map((invoice) => invoice.dueDate).sort()[0];
    return { customer, outstanding, overdue, unpaidCount: unpaid.length, nextDue, advance: customerAdvance(customer, store.customerReceipts) };
  }).filter((row) => row.outstanding > 0.005 || row.advance > 0.005);

  const rows = allRows.filter((row) => row.customer.toLowerCase().includes(query.toLowerCase()) && (filter === "All Outstanding" || row.overdue > 0.005))
    .sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding);
  const { pageRows, page, setPage } = useTablePage(rows, `${query}|${filter}`);
  const totals = allRows.reduce((sum, row) => ({ outstanding: sum.outstanding + row.outstanding, overdue: sum.overdue + row.overdue }), { outstanding: 0, overdue: 0 });
  const clear = () => { setQuery(""); setFilter("All Outstanding"); };
  const active = Boolean(query || filter !== "All Outstanding");
  const exportRows = () => exportCsv("customer-outstanding.csv", ["Customer", "Outstanding Amount", "Overdue Amount", "Unpaid Invoices", "Next Due Date"], rows.map((row) => [row.customer, row.outstanding, row.overdue, row.unpaidCount, row.nextDue ? prettyDate(row.nextDue) : ""]));

  return <>
    <div className="accounts-mini-stats"><span>Total Outstanding <b>{money(totals.outstanding)}</b></span><span>Total Overdue <b className={totals.overdue > 0.005 ? "accounts-figure--overdue" : ""}>{money(totals.overdue)}</b></span></div>
    <div className="erp-filters accounts-filters">
      <label className="erp-search-filter"><span>Search customer</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer name" /></label>
      <label><span>Show</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option>All Outstanding</option><option>Overdue</option></select></label>
      {active && <button className="erp-record-link" onClick={clear}>Clear all</button>}
      <button className="settings-outline" onClick={exportRows}>Export CSV</button>
    </div>
    <div className="erp-table-shell"><table className="erp-data-table accounts-outstanding-table"><colgroup><col style={{ width: "28%" }} /><col style={{ width: "16%" }} /><col style={{ width: "16%" }} /><col style={{ width: "14%" }} /><col style={{ width: "14%" }} /><col style={{ width: "12%" }} /></colgroup><thead><tr><th>Customer</th><th className="number">Outstanding</th><th className="number">Overdue</th><th className="number">Unpaid Invoices</th><th>Next Due Date</th><th>Action</th></tr></thead><tbody>{pageRows.map((row) => <tr key={row.customer} className="erp-row-clickable" onClick={() => setOpenCustomer(row.customer)}>
      <td><b>{row.customer}</b>{row.advance > 0.005 && <span className="accounts-advance-chip">{money(row.advance)} advance</span>}</td>
      <td className="number">{money(row.outstanding)}</td>
      <td className="number">{row.overdue > 0.005 ? <span className="accounts-figure--overdue">{money(row.overdue)}</span> : <span className="erp-muted">—</span>}</td>
      <td className="number">{row.unpaidCount}</td>
      <td>{row.nextDue ? prettyDate(row.nextDue) : "—"}</td>
      <td><button className="settings-link" onClick={(event) => { event.stopPropagation(); openReceipt(row.customer); }}>Record Receipt</button></td>
    </tr>)}</tbody></table>{!rows.length && <div className="settings-empty"><b>No customers match</b><p>Try a different search or clear the filters.</p><button className="settings-outline" onClick={clear}>Clear filters</button></div>}</div>
    <Pagination total={rows.length} page={page} onPage={setPage} />
    {openCustomer && <CustomerDrawer store={store} customer={openCustomer} close={() => setOpenCustomer(null)} openInvoice={openInvoice} openReceipt={openReceipt} flash={flash} />}
  </>;
}

function CustomerDrawer({ store, customer, close, openInvoice, openReceipt, flash }: { store: Store; customer: string; close: () => void; openInvoice?: (invoiceId: string) => void; openReceipt: (customer: string) => void; flash: (message: string) => void }) {
  const [tdsFor, setTdsFor] = useState<Invoice | null>(null);
  const invoices = store.invoices.filter((invoice) => invoice.customer === customer && invoice.status === "Sent").sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
  const advance = customerAdvance(customer, store.customerReceipts);
  return <Overlay onClose={close} label={`${customer} outstanding`} className="stock-modal-backdrop accounts-overlay"><aside className="settings-drawer accounts-drawer">
    <div className="settings-drawer-head"><div><p>Receivables</p><h2>{customer}</h2></div><button onClick={close} aria-label="Close">×</button></div>
    <div className="accounts-drawer-actions"><button className="erp-action" onClick={() => { close(); openReceipt(customer); }}>Record Receipt</button></div>
    <div className="accounts-drawer-body">
      {advance > 0.005 && <section className="erp-form-section"><h3>Customer advance</h3>
        <p className="accounts-advance-note">{money(advance)} received but not yet applied to any invoice. Apply it the next time you record a receipt for this customer.</p>
      </section>}
      <section className="erp-form-section"><h3>Invoices</h3>
        <div className="erp-table-shell"><table className="erp-data-table accounts-invoice-table"><thead><tr><th>Invoice No.</th><th>Invoice Date</th><th>Due Date</th><th className="number">Invoice Amount</th><th className="number">Receipts Applied</th><th className="number">TDS Recorded</th><th className="number">Balance</th></tr></thead><tbody>{invoices.map((invoice) => {
          const applied = invoiceReceiptsApplied(invoice.id, store.customerReceipts);
          const tds = invoiceTdsRecorded(invoice.id, store.customerTds);
          const balance = balanceOf(invoice, store.customerReceipts, store.customerTds);
          return <tr key={invoice.id}>
            <td><button className="erp-record-link" onClick={() => openInvoice?.(invoice.id)}>{invoice.number}</button></td>
            <td>{prettyDate(invoice.invoiceDate)}</td>
            <td>{prettyDate(invoice.dueDate)}</td>
            <td className="number">{money(invoiceTotals(invoice).grandTotal)}</td>
            <td className="number">{applied ? money(applied) : <span className="erp-muted">—</span>}</td>
            <td className="number">{tds ? <button className="erp-record-link" onClick={() => setTdsFor(invoice)}>{money(tds)}</button> : <span className="erp-muted">—</span>}</td>
            <td className="number">{balance > 0.005 ? <b>{money(balance)}</b> : <span className="erp-muted">Nothing due</span>}</td>
          </tr>; })}</tbody></table>{!invoices.length && <p className="erp-muted">No issued invoices for this customer.</p>}</div>
      </section>
    </div>
    {tdsFor && <TdsDrawer store={store} invoice={tdsFor} close={() => setTdsFor(null)} />}
  </aside></Overlay>;
}

function TdsDrawer({ store, invoice, close }: { store: Store; invoice: Invoice; close: () => void }) {
  const entries = store.customerTds.filter((entry) => entry.invoiceId === invoice.id).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  return <Overlay onClose={close} label={`TDS on ${invoice.number}`} className="stock-modal-backdrop accounts-overlay"><aside className="settings-drawer expense-drawer">
    <div className="settings-drawer-head"><div><p>Customer TDS</p><h2>{invoice.number}</h2></div><button onClick={close} aria-label="Close">×</button></div>
    <div className="expense-drawer-body">{entries.map((entry: CustomerTds) => <section key={entry.id} className="erp-form-section accounts-tds-entry">
      <dl className="invoice-facts due-facts">
        <div><dt>Amount</dt><dd>{money(entry.amount)}</dd></div><div><dt>Date</dt><dd>{prettyDate(entry.date)}</dd></div>
        <div><dt>Reference</dt><dd>{entry.reference || "—"}</dd></div>
        <div className="invoice-fact-wide"><dt>Recorded by</dt><dd>{entry.recordedBy} · {entry.recordedAt}</dd></div>
      </dl>
    </section>)}{!entries.length && <p className="erp-muted">No TDS recorded against this invoice.</p>}</div>
  </aside></Overlay>;
}

/* ─── Record Customer Receipt — shared by Accounts and the Invoices page ─── */
export function RecordReceipt({ store, customer, presetInvoiceId, close, flash }: { store: Store; customer?: string; presetInvoiceId?: string; close: () => void; flash: (message: string) => void }) {
  const lockCustomer = Boolean(customer);
  const [selected, setSelected] = useState(customer ?? "");
  const [date, setDate] = useState(dateIso());
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("Bank");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [presetTouched, setPresetTouched] = useState(false);
  const [wantsTds, setWantsTds] = useState(false);
  const [tdsAmounts, setTdsAmounts] = useState<Record<string, string>>({});
  const [tdsReference, setTdsReference] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const unpaidInvoices = store.invoices.filter((invoice) => invoice.customer === selected && invoice.status === "Sent" && balanceOf(invoice, store.customerReceipts, store.customerTds) > 0.005)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const maxFor = (invoice: Invoice) => balanceOf(invoice, store.customerReceipts, store.customerTds);
  const value = Number(amount) || 0;
  const allocatedTotal = Object.values(allocations).reduce((sum, text) => sum + (Number(text) || 0), 0);
  const unallocated = Math.max(value - allocatedTotal, 0);
  const dupeRef = duplicateReceiptReference(store.customerReceipts, reference);

  const setAllocation = (invoiceId: string, text: string) => { setAllocations((all) => ({ ...all, [invoiceId]: text })); if (invoiceId === presetInvoiceId) setPresetTouched(true); };
  const changeAmount = (text: string) => {
    setAmount(text);
    if (presetInvoiceId && !presetTouched) {
      const invoice = store.invoices.find((entry) => entry.id === presetInvoiceId);
      if (invoice) setAllocations((all) => ({ ...all, [presetInvoiceId]: String(Math.min(Number(text) || 0, balanceOf(invoice, store.customerReceipts, store.customerTds))) }));
    }
  };
  const changeCustomer = (name: string) => { setSelected(name); setAllocations({}); setPresetTouched(false); };

  const submit = () => {
    if (submitting) return;
    if (!selected.trim()) { setError("Choose a customer."); return; }
    if (!(value > 0)) { setError("Enter an amount greater than zero."); return; }
    if (allocatedTotal > value + 0.005) { setError("Allocated amount cannot exceed the amount received."); return; }
    for (const invoice of unpaidInvoices) {
      const allocated = Number(allocations[invoice.id]) || 0;
      if (allocated > maxFor(invoice) + 0.005) { setError(`${invoice.number}'s allocation exceeds its outstanding balance (${money(maxFor(invoice))}).`); return; }
    }
    const tdsEntries: CustomerTds[] = [];
    if (wantsTds) {
      for (const invoice of unpaidInvoices) {
        const tdsValue = Number(tdsAmounts[invoice.id]) || 0;
        if (tdsValue <= 0) continue;
        const allocated = Number(allocations[invoice.id]) || 0;
        if (tdsValue + allocated > maxFor(invoice) + 0.005) { setError(`${invoice.number}'s TDS plus allocation exceeds its outstanding balance.`); return; }
        tdsEntries.push({ id: `TDS-${Date.now()}-${invoice.id}`, invoiceId: invoice.id, customer: selected, amount: tdsValue, date, reference: tdsReference.trim() || undefined, recordedBy: RECORDER, recordedAt: stamp() });
      }
    }
    setSubmitting(true);
    const receipt = { id: `RCP-${Date.now()}`, customer: selected, date, amount: value, mode, reference: reference.trim() || undefined, notes: notes.trim() || undefined, allocations: unpaidInvoices.map((invoice) => ({ invoiceId: invoice.id, amount: Number(allocations[invoice.id]) || 0 })).filter((entry) => entry.amount > 0), recordedBy: RECORDER, recordedAt: stamp() };
    updateStore((current) => ({ ...recordCustomerReceipt(current, receipt), customerTds: [...tdsEntries, ...current.customerTds] }));
    close();
    const tdsTotal = tdsEntries.reduce((sum, entry) => sum + entry.amount, 0);
    flash(`${money(value)} received from ${selected}.${allocatedTotal > 0.005 ? ` ${money(allocatedTotal)} applied.` : ""}${unallocated > 0.005 ? ` ${money(unallocated)} kept as advance.` : ""}${tdsTotal > 0.005 ? ` ${money(tdsTotal)} TDS recorded.` : ""}`);
  };

  return <Overlay label="Record Receipt" onClose={close}><section className="stock-move-modal accounts-form-modal"><header className="jobs-form-header"><div><h2>Record Receipt</h2><p>Records money already received — this does not move money.</p></div><button className="settings-outline" aria-label="Close" onClick={close}>×</button></header><div className="jobs-form-body">
    <div className="quote-header-grid ci-form-grid">
      <label><span>Customer <b className="lead-required">Required</b></span>{lockCustomer ? <input value={selected} disabled /> : <><input list="accounts-customers" value={selected} onChange={(event) => changeCustomer(event.target.value)} placeholder="Type a customer name" /><datalist id="accounts-customers">{store.customers.map((entry) => <option key={entry.id} value={entry.name} />)}</datalist></>}</label>
      <label><span>Receipt date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label><span>Amount received (₹)</span><input type="number" min="0" step="0.01" value={amount} onChange={(event) => changeAmount(event.target.value)} /></label>
      <label><span>Mode</span><select value={mode} onChange={(event) => setMode(event.target.value as PaymentMode)}>{PAYMENT_MODES.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
      <label><span>Transaction reference <em className="lead-optional">(optional)</em></span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="UTR, cheque or UPI number" /></label>
      <label className="quote-grid-wide"><span>Notes <em className="lead-optional">(optional)</em></span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    </div>
    {dupeRef.length > 0 && <p className="expense-warning">This reference has been used before. Check this isn't a duplicate entry.</p>}
    {!selected.trim() ? <p className="erp-muted">Choose a customer to see their unpaid invoices.</p> : !unpaidInvoices.length ? <p className="erp-muted">{selected} has no unpaid invoices — the full amount will be kept as an advance.</p> : <>
      <label className="settings-check accounts-tds-toggle"><input type="checkbox" checked={wantsTds} onChange={(event) => setWantsTds(event.target.checked)} /><span>Customer deducted TDS</span></label>
      <div className="erp-table-shell"><table className="erp-data-table accounts-allocation-table"><thead><tr><th>Invoice</th><th>Due</th><th className="number">Balance</th><th className="number">Allocate</th>{wantsTds && <th className="number">TDS</th>}</tr></thead><tbody>{unpaidInvoices.map((invoice) => { const balance = maxFor(invoice); const tdsValue = Number(tdsAmounts[invoice.id]) || 0; const dupes = wantsTds && tdsValue > 0 ? duplicateCustomerTds(store.customerTds, invoice.id, tdsValue) : []; return <tr key={invoice.id}>
        <td><b>{invoice.number}</b></td>
        <td>{prettyDate(invoice.dueDate)}</td>
        <td className="number">{money(balance)}</td>
        <td className="number"><input type="number" min="0" max={balance} step="0.01" value={allocations[invoice.id] ?? ""} onChange={(event) => setAllocation(invoice.id, event.target.value)} /></td>
        {wantsTds && <td className="number"><input type="number" min="0" step="0.01" value={tdsAmounts[invoice.id] ?? ""} onChange={(event) => setTdsAmounts((all) => ({ ...all, [invoice.id]: event.target.value }))} />{dupes.length > 0 && <small className="job-late">Already recorded</small>}</td>}
      </tr>; })}</tbody></table></div>
      {wantsTds && <label className="quote-grid-wide accounts-tds-reference"><span>TDS reference / certificate number <em className="lead-optional">(optional)</em></span><input value={tdsReference} onChange={(event) => setTdsReference(event.target.value)} placeholder="Form 16A or certificate number" /></label>}
    </>}
    <div className="expense-balance-preview accounts-receipt-preview"><div><span>Receipt amount</span><b>{money(value)}</b></div><div><span>Amount allocated</span><b>{money(allocatedTotal)}</b></div><div><span>Unallocated (kept as advance)</span><b className={unallocated > 0.005 ? "accounts-figure--advance" : ""}>{money(unallocated)}</b></div></div>
    {error && <p className="jobs-form-error" role="alert">{error}</p>}
  </div><footer className="jobs-form-footer"><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" disabled={submitting} onClick={submit}>Record Receipt</button></footer></section></Overlay>;
}

/* ─── Bills & Expenses ────────────────────────────────────────────── */
function BillsExpensesView({ store, openPay, onClone, flash }: { store: Store; openPay: (billId: string) => void; onClone: (bill: Payable) => void; flash: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Unpaid" | "Partly Paid" | "Paid">("All");
  const [dueFilter, setDueFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"All" | PayableCategory>("All");
  const [moreOpen, setMoreOpen] = useState(false);
  const [sort, setSort] = useState("due");
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = store.payables.filter((bill) => {
    const status = payablePaymentStatus(bill, store.supplierPayments);
    return (statusFilter === "All" || status === statusFilter) && (categoryFilter === "All" || bill.category === categoryFilter) && (!dueFilter || bill.dueDate <= dueFilter)
      && `${bill.payee} ${bill.number ?? ""} ${bill.description}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => sort === "amount" ? b.amount - a.amount : sort === "payee" ? a.payee.localeCompare(b.payee) : a.dueDate.localeCompare(b.dueDate));
  const { pageRows, page, setPage } = useTablePage(rows, `${query}|${statusFilter}|${dueFilter}|${categoryFilter}|${sort}`);
  const selected = store.payables.find((bill) => bill.id === openId);
  const clear = () => { setQuery(""); setStatusFilter("All"); setDueFilter(""); setCategoryFilter("All"); };
  const active = Boolean(query || statusFilter !== "All" || dueFilter || categoryFilter !== "All");
  const exportRows = () => exportCsv("bills-and-expenses.csv", ["Payee", "Bill Number", "Category", "Bill Date", "Due Date", "Amount", "Balance", "Status", "PO Reference"], rows.map((bill) => [bill.payee, bill.number ?? "", bill.category, prettyDate(bill.billDate), prettyDate(bill.dueDate), bill.amount, payableBalance(bill, store.supplierPayments), payablePaymentStatus(bill, store.supplierPayments), bill.poRef ?? ""]));

  return <>
    <div className="erp-filters accounts-filters">
      <label className="erp-search-filter"><span>Search bills</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Payee, bill number or description" /></label>
      <label><span>Payment status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="All">All statuses</option><option>Unpaid</option><option>Partly Paid</option><option>Paid</option></select></label>
      <label><span>Due on or before</span><input type="date" value={dueFilter} onChange={(event) => setDueFilter(event.target.value)} /></label>
      <button className="settings-outline" onClick={() => setMoreOpen(!moreOpen)}>{moreOpen ? "Fewer filters" : "More filters"}</button>
      {active && <button className="erp-record-link" onClick={clear}>Clear all</button>}
      <button className="settings-outline" onClick={exportRows}>Export CSV</button>
    </div>
    {moreOpen && <div className="erp-filters accounts-filters"><label><span>Category</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}><option value="All">All categories</option>{PAYABLE_CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}</select></label><label>Sort by <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="due">Due date, earliest first</option><option value="amount">Amount, highest first</option><option value="payee">Payee A–Z</option></select></label></div>}
    <div className="erp-table-shell"><table className="erp-data-table accounts-bills-table"><colgroup><col style={{ width: "16%" }} /><col style={{ width: "20%" }} /><col style={{ width: "12%" }} /><col style={{ width: "10%" }} /><col style={{ width: "10%" }} /><col style={{ width: "10%" }} /><col style={{ width: "9%" }} /><col style={{ width: "8%" }} /><col style={{ width: "5%" }} /></colgroup><thead><tr><th>Supplier / Payee</th><th>Bill No. / Description</th><th>Category</th><th>Bill Date</th><th>Due Date</th><th className="number">Amount</th><th className="number">Balance</th><th>Status</th><th>Action</th></tr></thead><tbody>{pageRows.map((bill) => {
      const status = payablePaymentStatus(bill, store.supplierPayments);
      const balance = payableBalance(bill, store.supplierPayments);
      const overdue = balance > 0.005 && dayDifference(bill.dueDate) < 0;
      return <tr key={bill.id} className="erp-row-clickable" onClick={() => setOpenId(bill.id)}>
        <td><b>{bill.payee}</b></td>
        <td>{bill.number || <span className="erp-muted">No bill number</span>}<small>{bill.description}</small></td>
        <td><span className="accounts-category-pill">{bill.category}</span></td>
        <td>{prettyDate(bill.billDate)}</td>
        <td className={overdue ? "invoice-overdue" : ""}>{prettyDate(bill.dueDate)}{overdue && <small className="job-late">Overdue</small>}</td>
        <td className="number">{money(bill.amount)}</td>
        <td className="number">{balance > 0.005 ? <b>{money(balance)}</b> : <span className="erp-muted">—</span>}</td>
        <td><span className={`invoice-status invoice-status--${statusSlug(status)}`}>{status}</span></td>
        <td>{status !== "Paid" ? <button className="settings-link" onClick={(event) => { event.stopPropagation(); openPay(bill.id); }}>Record Payment</button> : <span className="erp-muted">—</span>}</td>
      </tr>; })}</tbody></table>{!rows.length && <div className="settings-empty"><b>No bills match these filters</b><p>Try another status, category or search.</p><button className="settings-outline" onClick={clear}>Clear filters</button></div>}</div>
    <Pagination total={rows.length} page={page} onPage={setPage} />
    {selected && <BillDrawer store={store} bill={selected} close={() => setOpenId(null)} openPay={openPay} onClone={onClone} flash={flash} />}
  </>;
}

function BillDrawer({ store, bill, close, openPay, onClone }: { store: Store; bill: Payable; close: () => void; openPay: (billId: string) => void; onClone: (bill: Payable) => void; flash: (message: string) => void }) {
  const payments = store.supplierPayments.filter((payment) => payment.billId === bill.id).sort((a, b) => b.date.localeCompare(a.date));
  const status = payablePaymentStatus(bill, store.supplierPayments);
  const balance = payableBalance(bill, store.supplierPayments);
  const po = bill.poRef ? store.orders.find((order) => order.number === bill.poRef) : undefined;
  return <Overlay onClose={close} label={`${bill.payee} bill`} className="stock-modal-backdrop accounts-overlay"><aside className="settings-drawer accounts-drawer">
    <div className="settings-drawer-head"><div><p>{bill.category}{bill.number ? ` · ${bill.number}` : ""}</p><h2>{bill.payee}</h2></div><button onClick={close} aria-label="Close">×</button></div>
    <div className="accounts-drawer-actions expense-inline-actions">
      {status !== "Paid" && <button className="erp-action" onClick={() => { close(); openPay(bill.id); }}>Record Payment</button>}
      <button className="settings-outline" onClick={() => { close(); onClone(bill); }}>Copy as New</button>
    </div>
    <div className="accounts-drawer-body">
      <section className="erp-form-section"><h3>Bill details</h3><dl className="invoice-facts due-facts">
        <div><dt>Bill date</dt><dd>{prettyDate(bill.billDate)}</dd></div><div><dt>Due date</dt><dd>{prettyDate(bill.dueDate)}</dd></div>
        <div><dt>Amount</dt><dd>{money(bill.amount)}</dd></div><div><dt>Balance</dt><dd>{money(balance)}</dd></div>
        <div><dt>Status</dt><dd><span className={`invoice-status invoice-status--${statusSlug(status)}`}>{status}</span></dd></div>
        {po && <div><dt>Purchase order</dt><dd>{po.number}</dd></div>}
        {bill.tdsRate ? <div><dt>TDS</dt><dd>{bill.tdsRate}% · section {bill.tdsSection}</dd></div> : null}
        <div className="invoice-fact-wide"><dt>Description</dt><dd>{bill.description}</dd></div>
        {bill.attachment && <div className="invoice-fact-wide"><dt>Attachment</dt><dd>{bill.attachment}</dd></div>}
      </dl></section>
      <section className="erp-form-section"><h3>Payments</h3>{payments.length ? <div className="lead-timeline quote-activity">{payments.map((payment) => <div key={payment.id} className="job-timeline--done"><i /><p><b>{money(payment.amount)}{payment.tds ? ` + ${money(payment.tds)} TDS` : ""}</b><span>{prettyDate(payment.date)} · {payment.mode}{payment.reference ? ` · ${payment.reference}` : ""}</span>{payment.notes && <small>{payment.notes}</small>}</p></div>)}</div> : <p className="erp-muted">No payments recorded.</p>}</section>
    </div>
  </aside></Overlay>;
}

function AddBillForm({ store, close, flash, cloneFrom }: { store: Store; close: () => void; flash: (message: string) => void; cloneFrom?: Payable }) {
  const [payee, setPayee] = useState(cloneFrom?.payee ?? "");
  const [category, setCategory] = useState<PayableCategory>(cloneFrom?.category ?? "Supplier Purchase");
  const [number, setNumber] = useState("");
  const [description, setDescription] = useState(cloneFrom?.description ?? "");
  const [billDate, setBillDate] = useState(dateIso());
  const [dueDate, setDueDate] = useState(() => { const date = new Date(`${dateIso()}T12:00`); date.setDate(date.getDate() + 30); return dateIso(date); });
  const [amount, setAmount] = useState(cloneFrom ? String(cloneFrom.amount) : "");
  const [attachment, setAttachment] = useState<string | undefined>(undefined);
  const [poRef, setPoRef] = useState("");
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [paidDate, setPaidDate] = useState(dateIso());
  const [paidMode, setPaidMode] = useState<PaymentMode>("Bank");
  const [paidReference, setPaidReference] = useState("");
  const [error, setError] = useState("");
  const dupes = duplicateBillNumber(store.payables, payee, number);
  const openPoOptions = store.orders.filter((order) => order.status === "Received" && !store.payables.some((bill) => bill.poRef === order.number));

  const submit = () => {
    const value = Number(amount);
    if (!payee.trim()) { setError("Enter the supplier or payee name."); return; }
    if (!description.trim()) { setError("Enter a short description."); return; }
    if (!Number.isFinite(value) || value <= 0) { setError("Enter an amount greater than zero."); return; }
    const id = `BILL-${Date.now()}`;
    const bill: Payable = { id, number: number.trim() || undefined, payee: payee.trim(), category, billDate, dueDate, amount: value, description: description.trim(), attachment, poRef: poRef || undefined, clonedFrom: cloneFrom?.id, createdBy: RECORDER, createdAt: stamp() };
    const payment: SupplierPayment | undefined = alreadyPaid ? { id: `SP-${Date.now()}`, billId: id, date: paidDate, amount: value, mode: paidMode, reference: paidReference.trim() || undefined, recordedBy: RECORDER, recordedAt: stamp(), notes: "Recorded via \"Already paid\" at bill entry." } : undefined;
    updateStore((current) => addPayable(current, bill, payment));
    close();
    flash(alreadyPaid ? `${payee} bill added and marked paid.` : `${payee} bill added — ${money(value)} unpaid.`);
  };
  return <Overlay label={cloneFrom ? "Copy as New" : "Add Bill"} onClose={close}><section className="stock-move-modal accounts-form-modal"><header className="jobs-form-header"><div><h2>{cloneFrom ? "Copy as New" : "Add Bill"}</h2><p>{cloneFrom ? `New occurrence of ${cloneFrom.payee}'s bill, with cleared dates.` : "Supplier bill or company expense"}</p></div><button className="settings-outline" aria-label="Close" onClick={close}>×</button></header><div className="jobs-form-body">
    {cloneFrom && <p className="accounts-clone-hint">Bill number is left blank for you to fill in — this does not mark it paid.</p>}
    <div className="quote-header-grid ci-form-grid">
      <label><span>Supplier / payee <b className="lead-required">Required</b></span><input list="accounts-payees" value={payee} onChange={(event) => setPayee(event.target.value)} /><datalist id="accounts-payees">{vendorMaster.map((vendor) => <option key={vendor.name} value={vendor.name} />)}</datalist></label>
      <label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value as PayableCategory)}>{PAYABLE_CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
      <label><span>Bill number <em className="lead-optional">(optional)</em></span><input value={number} onChange={(event) => setNumber(event.target.value)} /></label>
      <label><span>Bill date</span><input type="date" value={billDate} onChange={(event) => setBillDate(event.target.value)} /></label>
      <label><span>Due date</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
      <label><span>Total bill amount (₹) <b className="lead-required">Required</b></span><input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label className="quote-grid-wide"><span>Description <b className="lead-required">Required</b></span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is this bill for?" /></label>
      <label><span>Linked purchase order <em className="lead-optional">(optional)</em></span><select value={poRef} onChange={(event) => setPoRef(event.target.value)}><option value="">Not linked</option>{openPoOptions.map((order) => <option key={order.id} value={order.number}>{order.number} · {order.vendor}</option>)}</select></label>
      <label><span>Attachment <em className="lead-optional">(optional)</em></span><input type="file" accept="image/*,application/pdf" onChange={(event) => setAttachment(event.target.files?.[0]?.name)} />{attachment && <small>{attachment}</small>}</label>
    </div>
    {dupes.length > 0 && <p className="expense-warning">{payee} already has a bill numbered {number} on file. Check this isn't the same bill entered twice.</p>}
    <label className="settings-check"><input type="checkbox" checked={alreadyPaid} onChange={(event) => setAlreadyPaid(event.target.checked)} /><span>Already paid</span></label>
    {alreadyPaid && <div className="quote-header-grid ci-form-grid">
      <label><span>Paid on</span><input type="date" value={paidDate} onChange={(event) => setPaidDate(event.target.value)} /></label>
      <label><span>Paid by</span><select value={paidMode} onChange={(event) => setPaidMode(event.target.value as PaymentMode)}>{PAYMENT_MODES.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
      <label><span>Reference <em className="lead-optional">(optional)</em></span><input value={paidReference} onChange={(event) => setPaidReference(event.target.value)} /></label>
    </div>}
    {error && <p className="jobs-form-error" role="alert">{error}</p>}
  </div><footer className="jobs-form-footer"><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={submit}>{cloneFrom ? "Create Bill" : "Add Bill"}</button></footer></section></Overlay>;
}

function RecordBillPayment({ store, billId, close, flash }: { store: Store; billId: string; close: () => void; flash: (message: string) => void }) {
  const bill = store.payables.find((entry) => entry.id === billId);
  const before = bill ? payableBalance(bill, store.supplierPayments) : 0;
  const [date, setDate] = useState(dateIso());
  const [amount, setAmount] = useState(String(before));
  const [mode, setMode] = useState<PaymentMode>("Bank");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [hasTds, setHasTds] = useState(Boolean(bill?.tdsRate));
  const [tds, setTds] = useState(bill?.tdsRate ? String(Math.round(before * bill.tdsRate / 100)) : "");
  const [error, setError] = useState("");
  if (!bill) return null;
  const value = Number(amount) || 0; const tdsValue = hasTds ? Number(tds) || 0 : 0;
  const after = Math.max(before - value - tdsValue, 0);
  const dupeRef = duplicatePaymentReference(store.supplierPayments, reference);
  const submit = () => {
    if (!(value + tdsValue > 0)) { setError("Enter an amount greater than zero."); return; }
    if (value + tdsValue > before + 0.005) { setError(`This exceeds the remaining balance (${money(before)}).`); return; }
    const payment: SupplierPayment = { id: `SP-${Date.now()}`, billId, date, amount: value, mode, reference: reference.trim() || undefined, notes: notes.trim() || undefined, tds: tdsValue || undefined, recordedBy: RECORDER, recordedAt: stamp() };
    updateStore((current) => recordSupplierPayment(current, payment));
    close(); flash(`${money(value + tdsValue)} recorded against ${bill.payee}'s bill. ${after > 0.005 ? `${money(after)} still due.` : "Nothing more is due."}`);
  };
  return <Overlay label="Record Payment" onClose={close}><section className="stock-move-modal accounts-form-modal"><header className="jobs-form-header"><div><h2>Record Payment</h2><p>{bill.payee} · {bill.number || bill.description}</p></div><button className="settings-outline" aria-label="Close" onClick={close}>×</button></header><div className="jobs-form-body">
    <p className="invoice-start-hint">Balance before this payment: <b>{money(before)}</b>.</p>
    <div className="quote-header-grid ci-form-grid">
      <label><span>Payment date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label><span>Amount paid (₹)</span><input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label><span>Payment mode</span><select value={mode} onChange={(event) => setMode(event.target.value as PaymentMode)}>{PAYMENT_MODES.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
      <label><span>Reference <em className="lead-optional">(optional)</em></span><input value={reference} onChange={(event) => setReference(event.target.value)} /></label>
      <label className="quote-grid-wide"><span>Notes <em className="lead-optional">(optional)</em></span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    </div>
    {dupeRef.length > 0 && <p className="expense-warning">This reference has been used before. Check this isn't a duplicate entry.</p>}
    <label className="settings-check"><input type="checkbox" checked={hasTds} onChange={(event) => setHasTds(event.target.checked)} /><span>TDS deducted from this payment{bill.tdsRate ? ` — vendor is ${bill.tdsRate}% under section ${bill.tdsSection}` : ""}</span></label>
    {hasTds && <label className="due-notes"><span>TDS amount</span><input type="number" min="0" step="0.01" value={tds} onChange={(event) => setTds(event.target.value)} /></label>}
    <p className="erp-muted">Recording TDS here is for audit review only — it does not confirm the deduction has been deposited or that the statutory filing is complete.</p>
    <div className="expense-balance-preview"><div><span>Balance before</span><b>{money(before)}</b></div><div><span>Balance after</span><b>{money(after)}</b></div></div>
    {error && <p className="jobs-form-error" role="alert">{error}</p>}
  </div><footer className="jobs-form-footer"><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={submit}>Record Payment</button></footer></section></Overlay>;
}

/* ─── Receipts & Payments ─────────────────────────────────────────── */
export type TxnRow = { id: string; date: string; party: string; type: string; linked: string; moneyIn: number; moneyOut: number; mode: string; reference: string; status: string; kind: "receipt" | "supplierPayment" | "advance" };
export function buildTransactions(store: Store): TxnRow[] {
  const rows: TxnRow[] = [];
  store.customerReceipts.forEach((receipt) => rows.push({
    id: receipt.id, date: receipt.date, party: receipt.customer, type: "Customer Receipt",
    linked: receipt.allocations.length ? receipt.allocations.map((allocation) => store.invoices.find((invoice) => invoice.id === allocation.invoiceId)?.number ?? allocation.invoiceId).join(", ") : receipt.orderRef ? `Advance · ${receipt.orderRef}` : "Advance",
    moneyIn: receipt.amount, moneyOut: 0, mode: receipt.mode, reference: receipt.reference ?? "", status: "Recorded", kind: "receipt",
  }));
  store.supplierPayments.forEach((payment) => { const bill = store.payables.find((entry) => entry.id === payment.billId); rows.push({
    id: payment.id, date: payment.date, party: bill?.payee ?? "—", type: "Supplier Payment", linked: bill?.number || bill?.description || payment.billId,
    moneyIn: 0, moneyOut: payment.amount, mode: payment.mode, reference: payment.reference ?? "", status: "Recorded", kind: "supplierPayment",
  }); });
  store.advancePayments.forEach((payment) => rows.push({
    id: payment.id, date: payment.date, party: payment.engineer, type: `Engineer ${payment.type}`, linked: payment.jobId ?? "—",
    moneyIn: payment.type === "Money Returned" ? payment.amount : 0, moneyOut: payment.type === "Money Returned" ? 0 : payment.amount,
    mode: payment.mode, reference: payment.reference ?? "", status: "Recorded", kind: "advance",
  }));
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

function ReceiptsPaymentsView({ store, openInvoice, flash }: { store: Store; openInvoice?: (invoiceId: string) => void; flash: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"All" | "Receipt" | "Payment">("All");
  const [party, setParty] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [mode, setMode] = useState("All");
  const [moreOpen, setMoreOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const all = buildTransactions(store);
  const rows = all.filter((row) => {
    if (type === "Receipt" && row.moneyIn <= 0) return false;
    if (type === "Payment" && row.moneyOut <= 0) return false;
    if (from && row.date < from) return false;
    if (to && row.date > to) return false;
    if (mode !== "All" && row.mode !== mode) return false;
    if (party && !row.party.toLowerCase().includes(party.toLowerCase())) return false;
    return `${row.party} ${row.type} ${row.linked} ${row.reference}`.toLowerCase().includes(query.toLowerCase());
  });
  const { pageRows, page, setPage } = useTablePage(rows, `${query}|${type}|${party}|${from}|${to}|${mode}`);
  const selected = all.find((row) => `${row.kind}-${row.id}` === openId);
  const totals = rows.reduce((sum, row) => ({ in: sum.in + row.moneyIn, out: sum.out + row.moneyOut }), { in: 0, out: 0 });
  const clear = () => { setQuery(""); setType("All"); setParty(""); setFrom(""); setTo(""); setMode("All"); };
  const active = Boolean(query || type !== "All" || party || from || to || mode !== "All");
  const exportRows = () => exportCsv("receipts-and-payments.csv", ["Date", "Party", "Type", "Linked", "Money In", "Money Out", "Mode", "Reference", "Status"], rows.map((row) => [prettyDate(row.date), row.party, row.type, row.linked, row.moneyIn, row.moneyOut, row.mode, row.reference, row.status]));

  return <>
    <div className="accounts-mini-stats"><span>Money In (filtered) <b className="accounts-figure--advance">{money(totals.in)}</b></span><span>Money Out (filtered) <b className="accounts-figure--overdue">{money(totals.out)}</b></span></div>
    <div className="erp-filters accounts-filters">
      <label className="erp-search-filter"><span>Search</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Party, type or reference" /></label>
      <label><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label><span>Type</span><select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="All">Receipts &amp; payments</option><option value="Receipt">Money in only</option><option value="Payment">Money out only</option></select></label>
      <button className="settings-outline" onClick={() => setMoreOpen(!moreOpen)}>{moreOpen ? "Fewer filters" : "More filters"}</button>
      {active && <button className="erp-record-link" onClick={clear}>Clear all</button>}
      <button className="settings-outline" onClick={exportRows}>Export CSV</button>
    </div>
    {moreOpen && <div className="erp-filters accounts-filters"><label><span>Party</span><input value={party} onChange={(event) => setParty(event.target.value)} placeholder="Customer, supplier or engineer" /></label><label><span>Mode</span><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="All">All modes</option><option>Bank</option><option>UPI</option><option>Cheque</option><option>Cash</option><option>Bank Transfer</option></select></label></div>}
    <div className="erp-table-shell"><table className="erp-data-table accounts-txn-table"><colgroup><col style={{ width: "10%" }} /><col style={{ width: "16%" }} /><col style={{ width: "15%" }} /><col style={{ width: "14%" }} /><col style={{ width: "10%" }} /><col style={{ width: "10%" }} /><col style={{ width: "9%" }} /><col style={{ width: "10%" }} /><col style={{ width: "6%" }} /></colgroup><thead><tr><th>Date</th><th>Party</th><th>Type</th><th>Linked</th><th className="number">Money In</th><th className="number">Money Out</th><th>Mode</th><th>Reference</th><th>Status</th></tr></thead><tbody>{pageRows.map((row) => <tr key={`${row.kind}-${row.id}`} className="erp-row-clickable" onClick={() => setOpenId(`${row.kind}-${row.id}`)}>
      <td>{prettyDate(row.date)}</td><td><b>{row.party}</b></td><td>{row.type}</td><td>{row.linked}{row.kind === "advance" && <small className="accounts-txn-linked-note">From Advance &amp; Expense</small>}</td>
      <td className="number">{row.moneyIn ? <span className="accounts-txn-in">{money(row.moneyIn)}</span> : <span className="erp-muted">—</span>}</td>
      <td className="number">{row.moneyOut ? <span className="accounts-txn-out">{money(row.moneyOut)}</span> : <span className="erp-muted">—</span>}</td>
      <td>{row.mode}</td><td>{row.reference || <span className="erp-muted">—</span>}</td>
      <td><span className={`job-status job-status--${statusTone(row.status)}`}>{row.status}</span></td>
    </tr>)}</tbody></table>{!rows.length && <div className="settings-empty"><b>No transactions match these filters</b><p>Try a wider date range or clear the filters.</p><button className="settings-outline" onClick={clear}>Clear filters</button></div>}</div>
    <Pagination total={rows.length} page={page} onPage={setPage} />
    {selected && <TransactionDrawer store={store} row={selected} close={() => setOpenId(null)} openInvoice={openInvoice} flash={flash} />}
  </>;
}

function TransactionDrawer({ store, row, close, openInvoice }: { store: Store; row: TxnRow; close: () => void; openInvoice?: (invoiceId: string) => void; flash: (message: string) => void }) {
  const receipt = row.kind === "receipt" ? store.customerReceipts.find((entry) => entry.id === row.id) : undefined;
  const payment = row.kind === "supplierPayment" ? store.supplierPayments.find((entry) => entry.id === row.id) : undefined;
  const bill = payment ? store.payables.find((entry) => entry.id === payment.billId) : undefined;
  return <Overlay onClose={close} label={`${row.type} · ${row.party}`} className="stock-modal-backdrop accounts-overlay"><aside className="settings-drawer expense-drawer">
    <div className="settings-drawer-head"><div><p>{row.type}</p><h2>{row.party}</h2></div><button onClick={close} aria-label="Close">×</button></div>
    <div className="expense-drawer-body">
      <section className="erp-form-section"><h3>Details</h3><dl className="invoice-facts due-facts">
        <div><dt>Date</dt><dd>{prettyDate(row.date)}</dd></div>
        <div><dt>{row.moneyIn ? "Amount received" : "Amount paid"}</dt><dd>{money(row.moneyIn || row.moneyOut)}</dd></div>
        <div><dt>Mode</dt><dd>{row.mode}</dd></div><div><dt>Reference</dt><dd>{row.reference || "—"}</dd></div>
        <div><dt>Status</dt><dd>{row.status}</dd></div>
        {receipt?.notes && <div className="invoice-fact-wide"><dt>Notes</dt><dd>{receipt.notes}</dd></div>}
        {payment?.notes && <div className="invoice-fact-wide"><dt>Notes</dt><dd>{payment.notes}</dd></div>}
        {payment?.tds ? <div><dt>TDS deducted</dt><dd>{money(payment.tds)}</dd></div> : null}
      </dl></section>
      {receipt && <section className="erp-form-section"><h3>Allocations</h3>{receipt.allocations.length ? <div className="expense-mini-list">{receipt.allocations.map((allocation) => { const invoice = store.invoices.find((entry) => entry.id === allocation.invoiceId); return <div key={allocation.invoiceId}><b>{invoice ? <button className="erp-record-link" onClick={() => openInvoice?.(allocation.invoiceId)}>{invoice.number}</button> : allocation.invoiceId}</b><span>{money(allocation.amount)}</span></div>; })}</div> : <p className="erp-muted">Fully unallocated — kept as a customer advance.</p>}</section>}
      {payment && bill && <section className="erp-form-section"><h3>Bill</h3><p>{bill.number || bill.description} · {bill.payee}</p></section>}
      {row.kind === "advance" && <section className="erp-form-section"><p className="erp-muted">Recorded in Advance &amp; Expense — open that module to review it.</p></section>}
    </div>
  </aside></Overlay>;
}

/* ─── Export to Tally ─────────────────────────────────────────────── */
// Standard Tally ledger names — matches the defaults shown in Settings → Tally. The ledger
// mapping form there is for reference/customisation; this export uses the same defaults so a
// month's vouchers land on the right ledgers without anyone having to configure anything first.
const TALLY_LEDGER = {
  sales: "Sales", service: "Service Income", rental: "Rental Income", purchase: "Purchase",
  cgstOut: "Output CGST", sgstOut: "Output SGST", igstOut: "Output IGST",
  tdsPayable: "TDS Payable", bank: "Bank Accounts", cash: "Cash-in-Hand",
};
const xmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tallyDate = (iso: string) => iso.replace(/-/g, "");
const bankOrCash = (mode: string) => mode === "Cash" ? TALLY_LEDGER.cash : TALLY_LEDGER.bank;
type TallyLedgerLine = { ledger: string; positive: boolean; amount: number };
function tallyVoucher(type: string, date: string, number: string, party: string, entries: TallyLedgerLine[]) {
  const lines = entries.map((entry) => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEscape(entry.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${entry.positive ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${entry.amount.toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>`).join("");
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${type}" ACTION="Create"><DATE>${tallyDate(date)}</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${xmlEscape(number)}</VOUCHERNUMBER><PARTYLEDGERNAME>${xmlEscape(party)}</PARTYLEDGERNAME>${lines}</VOUCHER></TALLYMESSAGE>`;
}
/** Builds one Tally-import XML envelope covering a single month's activity: sales vouchers for
 *  invoices issued, receipt vouchers for money collected, purchase vouchers for vendor bills
 *  booked, and payment vouchers for vendor bills paid — each using the standard ledger names. */
export function buildTallyXml(store: Store, month: string): { xml: string; count: number } {
  const messages: string[] = [];

  store.invoices.filter((invoice) => invoice.status !== "Draft" && invoice.status !== "Cancelled" && invoice.invoiceDate.startsWith(month)).forEach((invoice) => {
    const totals = invoiceTotals(invoice);
    const salesLedger = invoice.invoiceType === "Service" ? TALLY_LEDGER.service : invoice.invoiceType === "Rental" ? TALLY_LEDGER.rental : TALLY_LEDGER.sales;
    const local = invoice.customerState === COMPANY.state;
    messages.push(tallyVoucher("Sales", invoice.invoiceDate, invoice.number, invoice.customer, [
      { ledger: salesLedger, positive: false, amount: totals.taxable },
      ...(local ? [{ ledger: TALLY_LEDGER.cgstOut, positive: false, amount: totals.cgst }, { ledger: TALLY_LEDGER.sgstOut, positive: false, amount: totals.sgst }] : [{ ledger: TALLY_LEDGER.igstOut, positive: false, amount: totals.igst }]),
      { ledger: invoice.customer, positive: true, amount: -totals.grandTotal },
    ]));
  });

  store.customerReceipts.filter((receipt) => receipt.date.startsWith(month)).forEach((receipt) => {
    messages.push(tallyVoucher("Receipt", receipt.date, receipt.id, receipt.customer, [
      { ledger: bankOrCash(receipt.mode), positive: false, amount: receipt.amount },
      { ledger: receipt.customer, positive: true, amount: -receipt.amount },
    ]));
  });

  store.payables.filter((bill) => bill.billDate.startsWith(month)).forEach((bill) => {
    messages.push(tallyVoucher("Purchase", bill.billDate, bill.number || bill.id, bill.payee, [
      { ledger: TALLY_LEDGER.purchase, positive: false, amount: bill.amount },
      { ledger: bill.payee, positive: true, amount: -bill.amount },
    ]));
  });

  store.supplierPayments.filter((payment) => payment.date.startsWith(month)).forEach((payment) => {
    const bill = store.payables.find((entry) => entry.id === payment.billId);
    if (!bill) return;
    const tds = payment.tds ?? 0;
    messages.push(tallyVoucher("Payment", payment.date, payment.id, bill.payee, [
      { ledger: bill.payee, positive: false, amount: payment.amount + tds },
      { ledger: bankOrCash(payment.mode), positive: true, amount: -payment.amount },
      ...(tds > 0 ? [{ ledger: TALLY_LEDGER.tdsPayable, positive: true, amount: -tds }] : []),
    ]));
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n  <BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>${messages.join("")}</REQUESTDATA></IMPORTDATA></BODY>\n</ENVELOPE>`;
  return { xml, count: messages.length };
}
function downloadXml(filename: string, xml: string) {
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
function TallyExportModal({ store, close }: { store: Store; close: () => void }) {
  const [month, setMonth] = useState(dateIso().slice(0, 7));
  const { count } = buildTallyXml(store, month);
  const download = () => { const { xml } = buildTallyXml(store, month); downloadXml(`spm-tally-${month}.xml`, xml); close(); };
  return <Overlay label="Export to Tally" onClose={close}><section className="stock-move-modal accounts-form-modal"><header className="jobs-form-header"><div><h2>Export to Tally</h2><p>Sales, receipts, vendor bills and payments for one month, as a Tally-import XML file.</p></div><button className="settings-outline" aria-label="Close" onClick={close}>×</button></header><div className="jobs-form-body">
    <label><span>Month</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
    <p className="invoice-start-hint">{count} voucher{count === 1 ? "" : "s"} will be included. Ledger names follow the mapping in Settings → Tally.</p>
  </div><footer className="jobs-form-footer"><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" disabled={!count} onClick={download}>Download</button></footer></section></Overlay>;
}
