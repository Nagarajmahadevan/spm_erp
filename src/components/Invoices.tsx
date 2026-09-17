import { useMemo, useState } from "react";
import spmLogo from "@/imports/SPM_Logo.png";
import { COMPANY, INDIAN_STATES, addMonths, siteById, stockCatalog, money, stamp, dateIso, dayDifference, prettyDate, lineValue, totalsFor, numberWords, type Customer, type Quote } from "./erpMasters";
import { balanceOf, billingStatusOf, invoicePaymentStatus, invoiceReceiptsApplied, invoiceStatusFor as statusFor, invoiceTdsRecorded, invoiceTotals, rentalNextInvoiceDate, updateStore, useErpStore, type CustomerInstrument, type CustomerOrder, type Individual, type Invoice, type InvoiceDisplayStatus as DisplayStatus, type InvoiceLine, type InvoiceActivity, type Job, type Rental } from "./erpStore";
import { RecordReceipt } from "./Accounts";

const INVOICE_SERIES = { prefix: "INV-2026-", next: 119 };
const TERM_DAYS: Record<string, number> = { "Net 15": 15, "Net 30": 30, "Net 45": 45, "Due on receipt": 0 };
// Document Status filter values only — "Issued" is how a "Sent" invoice is displayed.
const filters: ("Draft" | "Issued" | "Overdue" | "Paid" | "Cancelled")[] = ["Draft", "Issued", "Overdue", "Paid", "Cancelled"];
function docLabel(status: DisplayStatus) { return status === "Sent" ? "Issued" : status; }

const newLine = (): InvoiceLine => ({ id: `line-${Date.now()}-${Math.random().toString(16).slice(2)}`, item: "", description: "", hsn: "", quantity: 1, rate: 0, gst: 18 });
const isoFrom = (text?: string) => { if (!text) return ""; const parsed = new Date(text); return Number.isNaN(parsed.getTime()) ? "" : dateIso(parsed); };
const shiftDays = (from: string, days: number) => { const date = new Date(`${from}T12:00`); date.setDate(date.getDate() + days); return dateIso(date); };
const dueDateFor = (invoiceDate: string, terms: string) => shiftDays(invoiceDate, TERM_DAYS[terms] ?? 30);

function statusClass(status: string) { return `invoice-status invoice-status--${status.toLowerCase().replace(/ /g, "-")}`; }
function dueLabel(invoice: Invoice, paid: boolean) {
  const diff = dayDifference(invoice.dueDate);
  if (paid || invoice.status === "Cancelled" || invoice.status === "Draft") return prettyDate(invoice.dueDate);
  if (diff < 0) return `${prettyDate(invoice.dueDate)} · ${Math.abs(diff)}d late`;
  if (diff === 0) return `${prettyDate(invoice.dueDate)} · today`;
  return prettyDate(invoice.dueDate);
}
export function nextNumber(invoices: Invoice[]) {
  const highest = Math.max(INVOICE_SERIES.next - 1, ...invoices.map((invoice) => Number(invoice.number.split("-").at(-1)) || 0));
  return `${INVOICE_SERIES.prefix}${String(highest + 1).padStart(4, "0")}`;
}
function stockCodeFor(item: string) { return stockCatalog.find((stock) => stock.name === item && stock.inStock)?.code; }

// Plain-English blockers. Each one names the field the user has to fix.
function blockers(invoice: Invoice) {
  const list: string[] = [];
  if (!invoice.customer.trim()) list.push("Choose a customer at the top of the page.");
  if (invoice.customer.trim() && !invoice.customerGstin.trim()) list.push("This customer has no GSTIN. Click Edit next to the customer name and add it.");
  if (invoice.customer.trim() && !invoice.billingAddress.trim()) list.push("This customer has no billing address. Click Edit next to the customer name and add it.");
  if (!invoice.items.some((line) => line.item.trim() && line.rate > 0)) list.push("Add at least one item with a price.");
  const noHsn = invoice.items.filter((line) => line.item.trim() && !line.hsn.trim()).map((line) => line.item);
  if (noHsn.length) list.push(`Add the HSN code for ${noHsn.join(", ")}.`);
  return list;
}

export function invoiceFromQuote(quote: Quote, number: string): Invoice {
  const invoiceDate = dateIso();
  return {
    id: number, number, customer: quote.customer, contact: quote.contact, customerGstin: quote.customerGstin, customerState: quote.customerState,
    billingAddress: quote.billingAddress, shippingAddress: quote.shippingAddress, paymentTerms: quote.paymentTerms,
    invoiceDate, dueDate: dueDateFor(invoiceDate, quote.paymentTerms), status: "Draft", invoiceType: "Sales",
    poNumber: quote.acceptedPo ?? "", poDate: isoFrom(quote.acceptedDate), deliveryNote: "", vehicleNumber: "",
    placeOfSupply: quote.customerState, irn: "", ewayBill: "", freightCharges: quote.freightCharges ?? 0, overallDiscount: quote.overallDiscount ?? 0,
    items: quote.items.map((line) => ({ id: `${number}-${line.id}`, item: line.item, description: line.description, hsn: line.hsn, quantity: line.quantity, rate: line.rate, gst: line.gst, stockCode: stockCodeFor(line.item) })),
    fromQuote: `${quote.number} R${quote.revision}`,
    orderRef: quote.orderRef,
    activities: [{ title: `Started from quotation ${quote.number} R${quote.revision}`, meta: stamp(), tone: "system" }],
  };
}

export function invoiceFromOrder(order: CustomerOrder, number: string): Invoice {
  const invoiceDate = dateIso();
  return {
    id: number, number, customer: order.customer, contact: order.contact, customerGstin: order.customerGstin, customerState: order.customerState,
    billingAddress: order.billingAddress, shippingAddress: order.shippingAddress, paymentTerms: "Net 30",
    invoiceDate, dueDate: dueDateFor(invoiceDate, "Net 30"), status: "Draft", invoiceType: order.orderType === "Sale" ? "Sales" : order.orderType,
    poNumber: order.poNumber ?? "", poDate: order.poDate ?? "", deliveryNote: "", vehicleNumber: "",
    placeOfSupply: order.customerState, irn: "", ewayBill: "", freightCharges: 0, overallDiscount: 0,
    items: order.items.map((line) => ({ id: `${number}-${line.id}`, item: line.item, description: line.description, hsn: line.hsn, quantity: line.quantity, rate: line.rate, gst: line.gst, stockCode: stockCodeFor(line.item) })),
    orderRef: order.number,
    activities: [{ title: `Started from order ${order.number}`, meta: stamp(), tone: "system" }],
  };
}

/** A service invoice from a completed job. Jobs carry no price list, so the line starts at
 *  rate 0 — staff price it in the editor before sending, same as any hand-typed line. */
export function invoiceFromJob(job: Job, instruments: CustomerInstrument[], customers: Customer[], number: string): Invoice {
  const customer = customers.find((entry) => entry.name === job.customer);
  const site = siteById(job.siteId);
  const covered = instruments.filter((item) => job.instrumentIds.includes(item.id));
  const invoiceDate = dateIso();
  const description = [job.description, covered.length ? `Instruments: ${covered.map((item) => item.name).join(", ")}` : ""].filter(Boolean).join(" — ");
  return {
    id: number, number, customer: job.customer, contact: customer?.contact ?? "", customerGstin: customer?.gstin ?? "", customerState: customer?.state ?? COMPANY.state,
    billingAddress: customer?.billing ?? "", shippingAddress: customer?.shipping ?? (site ? `${site.name}, ${site.city}` : ""), paymentTerms: customer?.paymentTerms ?? "Net 30",
    invoiceDate, dueDate: dueDateFor(invoiceDate, customer?.paymentTerms ?? "Net 30"), status: "Draft", invoiceType: "Service",
    poNumber: "", poDate: "", deliveryNote: "", vehicleNumber: "",
    placeOfSupply: customer?.state ?? COMPANY.state, irn: "", ewayBill: "", freightCharges: 0, overallDiscount: 0,
    items: [{ id: `${number}-1`, item: job.type, description, hsn: "9987", quantity: 1, rate: 0, gst: 18 }],
    orderRef: job.orderRef,
    activities: [{ title: `Started from job ${job.number}`, meta: stamp(), tone: "system" }],
  };
}

/** One month's rent for a Rental — the customer/address details come from the customer master,
 *  same as any other invoice; only the item line is rental-specific. */
export function invoiceFromRental(rental: Rental, unit: Individual, customers: Customer[], number: string, periodLabel: string): Invoice {
  const customer = customers.find((entry) => entry.name === rental.customer);
  const invoiceDate = dateIso();
  return {
    id: number, number, customer: rental.customer, contact: customer?.contact ?? "", customerGstin: customer?.gstin ?? "", customerState: customer?.state ?? COMPANY.state,
    billingAddress: customer?.billing ?? "", shippingAddress: customer?.shipping ?? "", paymentTerms: customer?.paymentTerms ?? "Net 30",
    invoiceDate, dueDate: dueDateFor(invoiceDate, customer?.paymentTerms ?? "Net 30"), status: "Draft", invoiceType: "Rental",
    poNumber: "", poDate: "", deliveryNote: "", vehicleNumber: "",
    placeOfSupply: customer?.state ?? COMPANY.state, irn: "", ewayBill: "", freightCharges: 0, overallDiscount: 0,
    items: [{ id: `${number}-1`, item: unit.name, description: `Rental — ${periodLabel} · ${unit.id} · ${rental.number}`, hsn: "9973", quantity: 1, rate: rental.monthlyRate, gst: 18 }],
    orderRef: rental.orderRef || undefined,
    activities: [{ title: `Rental invoice for ${periodLabel}`, meta: stamp(), tone: "system" }],
  };
}

function blankInvoice(number: string): Invoice {
  const invoiceDate = dateIso();
  return {
    id: number, number, customer: "", contact: "", customerGstin: "", customerState: COMPANY.state,
    billingAddress: "", shippingAddress: "", paymentTerms: "Net 30", invoiceDate, dueDate: dueDateFor(invoiceDate, "Net 30"),
    status: "Draft", invoiceType: "Sales", poNumber: "", poDate: "", deliveryNote: "", vehicleNumber: "",
    placeOfSupply: COMPANY.state, irn: "", ewayBill: "", freightCharges: 0, overallDiscount: 0,
    items: [newLine()], activities: [{ title: "Blank invoice started", meta: stamp(), tone: "system" }],
  };
}


export default function Invoices({ focusInvoice }: { focusInvoice?: string } = {}) {
  const store = useErpStore();
  const { invoices, customerReceipts, customerTds, customerOrders, jobs, rentals, individuals, customers, instruments } = store;
  const setInvoices = (change: (all: Invoice[]) => Invoice[]) => updateStore((current) => ({ invoices: change(current.invoices) }));
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("All invoices");
  const [editorId, setEditorId] = useState<string | null>(focusInvoice ?? null); const [choosing, setChoosing] = useState(false); const [toast, setToast] = useState("");
  const editor = invoices.find((invoice) => invoice.id === editorId) ?? null;
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3600); };
  const persist = (invoice: Invoice, message?: string) => {
    setInvoices((all) => all.some((item) => item.id === invoice.id) ? all.map((item) => item.id === invoice.id ? invoice : item) : [invoice, ...all]);
    setEditorId(invoice.id); if (message) flash(message);
  };
  const startFromOrder = (order: CustomerOrder) => { const invoice = invoiceFromOrder(order, nextNumber(invoices)); setInvoices((all) => [invoice, ...all]); setEditorId(invoice.id); setChoosing(false); flash(`Ready from ${order.number}. Check it and send.`); };
  const startFromJob = (job: Job) => {
    const invoice = invoiceFromJob(job, instruments, customers, nextNumber(invoices));
    updateStore((current) => ({
      invoices: [invoice, ...current.invoices],
      jobs: current.jobs.map((entry) => entry.id !== job.id ? entry : { ...entry, invoiceNumber: invoice.number, activities: [{ title: `Invoice ${invoice.number} created`, meta: stamp(), tone: "system" as const }, ...entry.activities] }),
    }));
    setEditorId(invoice.id); setChoosing(false); flash(`Ready from ${job.number}. Check it and send.`);
  };
  const startFromRental = (rental: Rental) => {
    const unit = individuals.find((entry) => entry.id === rental.equipmentId);
    if (!unit) return;
    const periodStart = rentalNextInvoiceDate(rental);
    const periodEnd = addMonths(periodStart, 1);
    const invoice = invoiceFromRental(rental, unit, customers, nextNumber(invoices), `${prettyDate(periodStart)} – ${prettyDate(periodEnd)}`);
    updateStore((current) => ({
      invoices: [invoice, ...current.invoices],
      rentals: current.rentals.map((entry) => entry.id !== rental.id ? entry : { ...entry, lastInvoicedThrough: periodEnd, activities: [{ title: `Rental invoice ${invoice.number} created`, meta: stamp(), tone: "system" as const }, ...entry.activities] }),
    }));
    setEditorId(invoice.id); setChoosing(false); flash(`Ready from ${rental.number}. Check it and send.`);
  };
  const startBlank = () => { const invoice = blankInvoice(nextNumber(invoices)); setInvoices((all) => [invoice, ...all]); setEditorId(invoice.id); setChoosing(false); };
  const duplicate = (invoice: Invoice) => { const number = nextNumber(invoices); const copy: Invoice = { ...invoice, id: number, number, status: "Draft", sentAt: undefined, invoiceDate: dateIso(), dueDate: dueDateFor(dateIso(), invoice.paymentTerms), irn: "", ewayBill: "", activities: [{ title: `Copied from ${invoice.number}`, meta: stamp(), tone: "system" }] }; setInvoices((all) => [copy, ...all]); setEditorId(copy.id); flash("Copy created as a draft"); };

  const invoiceableOrders = customerOrders.filter((order) => order.status === "Open" && order.orderType !== "Rental" && !invoices.some((invoice) => invoice.orderRef === order.number));
  const invoiceableJobs = jobs.filter((job) => billingStatusOf(job) === "To invoice");
  const invoiceableRentals = rentals.filter((rental) => rental.status === "Active");

  const unpaid = invoices.filter((invoice) => invoice.status === "Sent" && invoicePaymentStatus(invoice, customerReceipts, customerTds) !== "Paid");
  const overdue = invoices.filter((invoice) => statusFor(invoice, customerReceipts, customerTds) === "Overdue");
  const dueThisWeek = unpaid.filter((invoice) => dayDifference(invoice.dueDate) >= 0 && dayDifference(invoice.dueDate) <= 7);
  const thisMonth = dateIso().slice(0, 7);
  const collected = customerReceipts.filter((receipt) => receipt.date.startsWith(thisMonth)).reduce((sum, receipt) => sum + receipt.amount, 0);
  const cards = [
    ["Unpaid", String(unpaid.length), "Money still due", "unpaid", "Issued"],
    ["Overdue", String(overdue.length), "Past the due date", "overdue", "Overdue"],
    ["Due this week", String(dueThisWeek.length), "Chase these first", "due", "Issued"],
    ["Collected this month", money(collected), "Received so far", "collected", "Paid"],
  ] as const;

  const matchesFilter = (invoice: Invoice, filter: string) => {
    const doc = statusFor(invoice, customerReceipts, customerTds);
    if (filter === "Issued") return doc === "Sent";
    if (filter === "Paid") return invoicePaymentStatus(invoice, customerReceipts, customerTds) === "Paid";
    return doc === filter;
  };
  const filtered = useMemo(() => invoices.filter((invoice) =>
    `${invoice.number} ${invoice.customer} ${invoice.contact}`.toLowerCase().includes(search.toLowerCase())
    && (status === "All invoices" || matchesFilter(invoice, status))), [invoices, search, status, customerReceipts, customerTds]);

  if (editor) return <>
    <InvoiceEditor key={editor.id} invoice={editor} store={store} close={() => setEditorId(null)} persist={persist} duplicate={duplicate} flash={flash} />
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </>;

  return <section className="leads-page invoices-page">
    <div className="leads-heading"><div><p className="erp-secondary-text">Finance / Invoices</p><h1>Invoices</h1><p className="erp-secondary-text mt-1">Raise a bill, send it, and record the money when it arrives.</p></div><div className="leads-actions"><button className="erp-action" onClick={() => setChoosing(true)}>+ New invoice</button></div></div>

    <div className="quotations-overview">{cards.map(([label, value, hint, tone, target]) => <button key={label} className={`leads-stat quotations-stat invoice-stat--${tone}`} onClick={() => setStatus(target)}><span>{label}</span><b>{value}</b><small>{hint}</small></button>)}</div>

    <div className="leads-toolbar quotation-toolbar"><div className="settings-list-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by invoice number or customer" /></div><select value={status} onChange={(event) => setStatus(event.target.value)}><option>All invoices</option>{filters.map((item) => <option key={item}>{item}</option>)}</select></div>

    <div className="leads-table-wrap"><table className="leads-table invoices-table"><thead><tr><th>Invoice no.</th><th>Customer</th><th>Date</th><th>Due date</th><th>Amount</th><th>Balance</th><th>Status</th><th>Payment</th></tr></thead><tbody>{filtered.map((invoice) => {
      const docStatus = statusFor(invoice, customerReceipts, customerTds); const total = invoiceTotals(invoice).grandTotal; const balance = balanceOf(invoice, customerReceipts, customerTds);
      const payStatus = invoicePaymentStatus(invoice, customerReceipts, customerTds); const paid = payStatus === "Paid";
      return <tr key={invoice.id} onClick={() => setEditorId(invoice.id)}>
        <td><b>{invoice.number}</b><small>{invoice.fromQuote ? `From ${invoice.fromQuote}` : invoice.invoiceType}</small></td>
        <td><b>{invoice.customer}</b><small>{invoice.contact}</small></td>
        <td>{prettyDate(invoice.invoiceDate)}</td>
        <td className={docStatus === "Overdue" ? "invoice-overdue" : ""}>{dueLabel(invoice, paid)}</td>
        <td className="quote-value">{money(total)}</td>
        <td className={balance > 0.005 && invoice.status !== "Draft" ? "invoice-balance" : "invoice-balance-clear"}>{invoice.status === "Cancelled" ? "—" : balance > 0.005 ? money(balance) : "Nothing due"}</td>
        <td><span className={statusClass(docStatus)}>{docLabel(docStatus)}</span></td>
        <td>{invoice.status === "Sent" ? <span className={statusClass(payStatus)}>{payStatus}</span> : <span className="erp-muted">—</span>}</td>
      </tr>; })}</tbody></table>
      {!filtered.length && <div className="settings-empty"><b>{invoices.length ? "No invoices match what you typed" : "No invoices yet"}</b><p>{invoices.length ? "Clear the search box or pick a different status." : "Most invoices start from an order, a job or a rental — we will fill in the customer, items and taxes for you."}</p><button className="erp-action" onClick={() => setChoosing(true)}>+ New invoice</button></div>}
    </div>

    {choosing && <StartInvoice close={() => setChoosing(false)} fromOrder={startFromOrder} fromJob={startFromJob} fromRental={startFromRental} blank={startBlank} orders={invoiceableOrders} jobs={invoiceableJobs} rentals={invoiceableRentals} individuals={individuals} />}
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </section>;
}

function StartInvoice({ close, fromOrder, fromJob, fromRental, blank, orders, jobs, rentals, individuals }: { close: () => void; fromOrder: (order: CustomerOrder) => void; fromJob: (job: Job) => void; fromRental: (rental: Rental) => void; blank: () => void; orders: CustomerOrder[]; jobs: Job[]; rentals: Rental[]; individuals: Individual[] }) {
  const [step, setStep] = useState<"choose" | "order" | "job" | "rental">("choose");
  return <div className="stock-modal-backdrop" onClick={close}><section className="stock-move-modal invoice-start-modal" role="dialog" aria-modal="true" aria-labelledby="start-invoice-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <h2 id="start-invoice-title">What are you invoicing?</h2>

    {step === "choose" && <>
      <p className="invoice-start-hint">Pick where this invoice comes from. You can change anything afterwards.</p>
      <div className="po-start-choices">
        <button onClick={() => setStep("order")}><b>From an order</b><span>{orders.length ? `${orders.length} order${orders.length === 1 ? "" : "s"} not yet invoiced` : "No open orders waiting to be invoiced"}</span></button>
        <button onClick={() => setStep("job")}><b>From a job</b><span>{jobs.length ? `${jobs.length} completed job${jobs.length === 1 ? "" : "s"} ready to invoice` : "No completed jobs waiting to be invoiced"}</span></button>
        <button onClick={() => setStep("rental")}><b>From a rental</b><span>{rentals.length ? `${rentals.length} active rental${rentals.length === 1 ? "" : "s"}` : "No active rentals"}</span></button>
      </div>
      <div className="invoice-start-footer"><span>Not from any of these?</span><button className="settings-outline" onClick={blank}>Start blank</button></div>
    </>}

    {step === "order" && <>
      <p className="invoice-start-hint">Pick the order to invoice. We take the customer, items and taxes from it.</p>
      <div className="invoice-start-list">{orders.map((order) => <button key={order.id} onClick={() => fromOrder(order)}>
        <div><b>{order.customer}</b><span>{order.orderType}</span><small>{order.number} · {order.items.length} item{order.items.length === 1 ? "" : "s"}</small></div>
        <div className="invoice-start-value"><em>Use this →</em></div>
      </button>)}
        {!orders.length && <p className="po-empty-note">No open order is currently waiting to be invoiced.</p>}
      </div>
      <div className="po-start-footer"><button className="settings-outline" onClick={() => setStep("choose")}>← Back</button></div>
    </>}

    {step === "job" && <>
      <p className="invoice-start-hint">Pick the completed job to invoice. We take the customer and description from it.</p>
      <div className="invoice-start-list">{jobs.map((job) => <button key={job.id} onClick={() => fromJob(job)}>
        <div><b>{job.customer}</b><span>{job.type}</span><small>{job.number} · completed {job.scheduledDate ? prettyDate(job.scheduledDate) : ""}</small></div>
        <div className="invoice-start-value"><em>Use this →</em></div>
      </button>)}
        {!jobs.length && <p className="po-empty-note">No completed job is currently waiting to be invoiced.</p>}
      </div>
      <div className="po-start-footer"><button className="settings-outline" onClick={() => setStep("choose")}>← Back</button></div>
    </>}

    {step === "rental" && <>
      <p className="invoice-start-hint">Pick the active rental to invoice — a month's rent for that equipment.</p>
      <div className="invoice-start-list">{rentals.map((rental) => { const unit = individuals.find((entry) => entry.id === rental.equipmentId); return <button key={rental.id} onClick={() => fromRental(rental)}>
        <div><b>{rental.customer}</b><span>{unit?.name ?? rental.equipmentId}</span><small>{rental.number} · {money(rental.monthlyRate)}/mo</small></div>
        <div className="invoice-start-value"><em>Use this →</em></div>
      </button>; })}
        {!rentals.length && <p className="po-empty-note">No rental is currently active.</p>}
      </div>
      <div className="po-start-footer"><button className="settings-outline" onClick={() => setStep("choose")}>← Back</button></div>
    </>}
  </section></div>;
}

function InvoiceEditor({ invoice, store, close, persist, duplicate, flash }: { invoice: Invoice; store: ReturnType<typeof useErpStore>; close: () => void; persist: (invoice: Invoice, message?: string) => void; duplicate: (invoice: Invoice) => void; flash: (message: string) => void }) {
  const { customerReceipts, customerTds } = store;
  const [doc, setDoc] = useState(invoice);
  const [editCustomer, setEditCustomer] = useState(false); const [confirming, setConfirming] = useState(false); const [paying, setPaying] = useState(false);
  const [overflow, setOverflow] = useState(false); const [preview, setPreview] = useState(false); const [problems, setProblems] = useState<string[]>([]);
  const docStatus = statusFor(doc, customerReceipts, customerTds); const locked = doc.status !== "Draft";
  const payStatus = invoicePaymentStatus(doc, customerReceipts, customerTds);
  const collecting = doc.status === "Sent" && payStatus !== "Paid";
  const localTax = doc.customerState === COMPANY.state; const totals = invoiceTotals(doc); const balance = balanceOf(doc, customerReceipts, customerTds);
  const received = invoiceReceiptsApplied(doc.id, customerReceipts); const tdsRecorded = invoiceTdsRecorded(doc.id, customerTds);

  const change = <K extends keyof Invoice>(key: K, value: Invoice[K]) => setDoc({ ...doc, [key]: value });
  const chooseCustomer = (name: string) => {
    const customer = store.customers.find((item) => item.name === name);
    if (!customer) { change("customer", name); return; }
    setDoc({ ...doc, customer: customer.name, contact: customer.contact, customerGstin: customer.gstin, customerState: customer.state, billingAddress: customer.billing, shippingAddress: customer.shipping, paymentTerms: customer.paymentTerms, placeOfSupply: customer.state, dueDate: dueDateFor(doc.invoiceDate, customer.paymentTerms) });
  };
  const setTerms = (terms: string) => setDoc({ ...doc, paymentTerms: terms, dueDate: dueDateFor(doc.invoiceDate, terms) });
  const setInvoiceDate = (date: string) => setDoc({ ...doc, invoiceDate: date, dueDate: dueDateFor(date, doc.paymentTerms) });
  const updateLine = (index: number, patch: Partial<InvoiceLine>) => setDoc({ ...doc, items: doc.items.map((line, itemIndex) => itemIndex === index ? { ...line, ...patch } : line) });
  const pickStock = (index: number, item: string) => { const match = stockCatalog.find((stock) => stock.name === item); updateLine(index, match ? { item, description: match.description, hsn: match.hsn, rate: match.rate, gst: match.gst, stockCode: match.inStock ? match.code : undefined } : { item, stockCode: undefined }); };
  const removeLine = (index: number) => { if (doc.items.length === 1) return; setDoc({ ...doc, items: doc.items.filter((_, itemIndex) => itemIndex !== index) }); };
  const log = (title: string, tone?: InvoiceActivity["tone"]) => [{ title, meta: stamp(), tone }, ...doc.activities];

  const saveDraft = () => { const next = { ...doc, activities: log("Draft saved", "system") }; setDoc(next); persist(next, "Draft saved"); };
  const trySend = () => { const found = blockers(doc); setProblems(found); if (found.length) { setConfirming(false); return; } setConfirming(true); };
  const send = () => {
    const sold = doc.invoiceType === "Sales" ? doc.items.map((line) => line.stockCode).filter(Boolean) as string[] : [];
    const next: Invoice = { ...doc, status: "Sent", sentAt: prettyDate(dateIso()), activities: log(`Invoice sent to ${doc.contact || doc.customer}`, "sent") };
    setDoc(next); setConfirming(false);
    persist(next, sold.length ? `Invoice sent. ${sold.join(", ")} marked sold.` : "Invoice sent to the customer.");
  };
  const cancel = () => { const next: Invoice = { ...doc, status: "Cancelled", activities: log("Invoice cancelled", "system") }; setDoc(next); setOverflow(false); persist(next, "Invoice cancelled"); };

  const taxNote = doc.customer ? (localTax ? `${doc.customerState} customer — CGST + SGST applies.` : `${doc.customerState || "Out-of-state"} customer — IGST applies.`) : "Choose a customer and we will work out the right tax.";

  return <section className={`quote-editor-page invoice-editor-page${collecting ? " invoice-has-bar" : ""}`}>
    <header className="quote-editor-head"><div>
      <button className="quote-back" onClick={close}>← Invoices</button>
      <p>Finance / Invoices</p>
      <h1>{doc.number}</h1>
      <span className={statusClass(docStatus)}>{docStatus}</span>
      {doc.status !== "Draft" && doc.status !== "Cancelled" && <span className={`invoice-due-chip${docStatus === "Overdue" ? " is-late" : ""}`}>{balance > 0 ? `${money(balance)} still due` : "Nothing due"}</span>}
      {doc.fromQuote && <span className="invoice-source-chip">From {doc.fromQuote}</span>}
      {doc.orderRef && <span className="invoice-source-chip">Order {doc.orderRef}</span>}
    </div><div className="quote-editor-actions">
      {docStatus === "Draft" && <>
        <div className="quote-action-anchor"><button className="erp-action" onClick={trySend}>Send to customer</button>
          {confirming && <div className="quote-action-popover invoice-confirm"><b>Once sent, this invoice can't be edited — corrections need a credit note. Send?</b><div><button className="erp-action" onClick={send}>Yes, send it</button><button className="settings-outline" onClick={() => setConfirming(false)}>Keep editing</button></div></div>}
        </div>
        <button className="settings-outline" onClick={() => setPreview(true)}>Preview</button>
        <button className="settings-outline" onClick={saveDraft}>Save draft</button>
      </>}
      {collecting && <>
        <button className="erp-action" onClick={() => setPaying(true)}>Record Receipt</button>
        <button className="settings-outline" onClick={() => flash(`Reminder sent to ${doc.contact || doc.customer}`)}>Send reminder</button>
        <button className="settings-outline" onClick={() => setPreview(true)}>Preview</button>
        <div className="quote-action-anchor"><button className="settings-outline quote-overflow-button" onClick={() => setOverflow(!overflow)} aria-label="More actions">⋯</button>
          {overflow && <div className="quote-overflow-menu"><button onClick={() => { setOverflow(false); flash("WhatsApp message ready to share"); }}>Share on WhatsApp</button><button onClick={() => { setOverflow(false); flash("Credit note draft created"); }}>Credit note</button><button className="is-danger" onClick={cancel}>Cancel</button></div>}
        </div>
      </>}
      {doc.status === "Sent" && payStatus === "Paid" && <><button className="settings-outline" onClick={() => setPreview(true)}>Preview</button><button className="settings-outline" onClick={() => duplicate(doc)}>Duplicate</button></>}
      {docStatus === "Cancelled" && <button className="settings-outline" onClick={() => setPreview(true)}>Preview</button>}
    </div></header>

    <main className="invoice-editor-layout">
      {problems.length > 0 && <div className="invoice-problems" role="alert"><b>Fix this before sending</b><ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></div>}

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>1 · Customer</h2><span>Everything below fills in from the customer master.</span></div>{!locked && <button className="invoice-edit-link" onClick={() => setEditCustomer(!editCustomer)}>{editCustomer ? "Done" : "Edit"}</button>}</div>
        {locked ? <p className="invoice-customer-name">{doc.customer}</p> : <label className="invoice-customer-picker"><span>Customer</span><input list="invoice-customers" value={doc.customer} onChange={(event) => chooseCustomer(event.target.value)} placeholder="Type a customer name" /><datalist id="invoice-customers">{store.customers.map((customer) => <option key={customer.id} value={customer.name}>{customer.gstin}</option>)}</datalist></label>}
        {editCustomer && !locked
          ? <div className="quote-header-grid invoice-edit-grid">
              <label><span>Contact person</span><input value={doc.contact} onChange={(event) => change("contact", event.target.value)} /></label>
              <label><span>GSTIN</span><input value={doc.customerGstin} onChange={(event) => change("customerGstin", event.target.value)} placeholder="29AABCN4106D1Z7" /></label>
              <label><span>State</span><select value={doc.customerState} onChange={(event) => change("customerState", event.target.value)}>{INDIAN_STATES.map((state) => <option key={state}>{state}</option>)}</select></label>
              <label><span>Payment terms</span><select value={doc.paymentTerms} onChange={(event) => setTerms(event.target.value)}>{Object.keys(TERM_DAYS).map((term) => <option key={term}>{term}</option>)}</select></label>
              <label><span>Invoice date</span><input type="date" value={doc.invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></label>
              <label><span>Due date</span><input type="date" value={doc.dueDate} onChange={(event) => change("dueDate", event.target.value)} /></label>
              <label className="quote-grid-wide"><span>Billing address</span><textarea value={doc.billingAddress} onChange={(event) => change("billingAddress", event.target.value)} /></label>
              <label className="quote-grid-wide"><span>Delivery address</span><textarea value={doc.shippingAddress} onChange={(event) => change("shippingAddress", event.target.value)} /></label>
            </div>
          : <dl className="invoice-facts">
              <div><dt>Contact</dt><dd>{doc.contact || "—"}</dd></div>
              <div><dt>GSTIN</dt><dd>{doc.customerGstin || <em>Missing</em>}</dd></div>
              <div><dt>State</dt><dd>{doc.customerState}</dd></div>
              <div><dt>Payment terms</dt><dd>{doc.paymentTerms}</dd></div>
              <div><dt>Invoice date</dt><dd>{prettyDate(doc.invoiceDate)}</dd></div>
              <div><dt>Payment due by</dt><dd>{prettyDate(doc.dueDate)}</dd></div>
              <div className="invoice-fact-wide"><dt>Billing address</dt><dd>{doc.billingAddress || <em>Missing</em>}</dd></div>
              <div className="invoice-fact-wide"><dt>Delivery address</dt><dd>{doc.shippingAddress || "Same as billing"}</dd></div>
            </dl>}
      </section>

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>2 · Items</h2><span>{locked ? "Sent invoices can't be changed." : "Start typing an item name to pull its description, HSN code and price."}</span></div>{!locked && <button className="settings-outline" onClick={() => setDoc({ ...doc, items: [...doc.items, newLine()] })}>+ Add row</button>}</div>
        <datalist id="invoice-stock-items">{stockCatalog.map((item) => <option key={item.name} value={item.name}>{item.hsn} · {money(item.rate)}</option>)}</datalist>
        <div className="invoice-lines-wrap"><table className="invoice-lines-table">
          <thead><tr><th>Item</th><th>Description</th><th>HSN</th><th>Qty</th><th>Rate</th><th>GST %</th><th>Total</th><th /></tr></thead>
          <tbody>{doc.items.map((line, index) => <tr key={line.id}>
            <td data-label="Item">{locked ? <b>{line.item}</b> : <input list="invoice-stock-items" value={line.item} onChange={(event) => pickStock(index, event.target.value)} placeholder="Type an item name" />}</td>
            <td data-label="Description">{locked ? <span>{line.description}</span> : <textarea rows={1} value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} />}</td>
            <td data-label="HSN">{locked ? <span>{line.hsn}</span> : <input value={line.hsn} onChange={(event) => updateLine(index, { hsn: event.target.value })} />}</td>
            <td data-label="Qty">{locked ? <span>{line.quantity}</span> : <input type="number" min="0" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} />}</td>
            <td data-label="Rate">{locked ? <span>{money(line.rate)}</span> : <input type="number" min="0" value={line.rate || ""} onChange={(event) => updateLine(index, { rate: Number(event.target.value) })} />}</td>
            <td data-label="GST %">{locked ? <span>{line.gst}%</span> : <select value={line.gst} onChange={(event) => updateLine(index, { gst: Number(event.target.value) })}><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="28">28%</option></select>}</td>
            <td className="invoice-line-total" data-label="Total"><b>{money(lineValue(line))}</b></td>
            <td className="invoice-line-delete">{!locked && <button className="quote-delete-line" onClick={() => removeLine(index)} disabled={doc.items.length === 1} aria-label={`Remove ${line.item || "row"}`}>×</button>}</td>
          </tr>)}</tbody>
          <tfoot><tr><td className="invoice-foot-head" colSpan={3}>Totals · {doc.items.length} {doc.items.length === 1 ? "item" : "items"}</td><td className="invoice-foot-qty" data-label="Total qty">{doc.items.reduce((total, line) => total + line.quantity, 0)}</td><td className="invoice-foot-spacer" colSpan={2} /><td className="invoice-line-total" data-label="Items total"><b>{money(totals.lineSubtotal)}</b></td><td className="invoice-foot-spacer" /></tr></tfoot>
        </table></div>
      </section>

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>3 · Totals</h2><span>Tax is worked out from the customer's state.</span></div></div>
        <p className="invoice-tax-note">{taxNote}</p>
        <div className="invoice-totals">
          <div><span>Taxable value</span><b>{money(totals.taxable)}</b></div>
          {doc.overallDiscount > 0 && <div><span>Discount {doc.overallDiscount}%</span><b>−{money(totals.discountAmount)}</b></div>}
          {localTax ? <><div><span>CGST</span><b>{money(totals.cgst)}</b></div><div><span>SGST</span><b>{money(totals.sgst)}</b></div></> : <div><span>IGST</span><b>{money(totals.igst)}</b></div>}
          {doc.freightCharges > 0 && <div><span>Freight / other charges</span><b>{money(doc.freightCharges)}</b></div>}
          <div><span>Round off</span><b>{totals.roundOff >= 0 ? "+" : "−"}{money(Math.abs(totals.roundOff))}</b></div>
          <div className="invoice-grand"><span>Grand total</span><b>{money(totals.grandTotal)}</b></div>
          {received > 0.005 && <div><span>Receipts applied</span><b>−{money(received)}</b></div>}
          {tdsRecorded > 0.005 && <div><span>TDS recorded</span><b>−{money(tdsRecorded)}</b></div>}
          {(received > 0.005 || tdsRecorded > 0.005) && (balance > 0.005 ? <div className="invoice-balance-row"><span>Money still due</span><b>{money(balance)}</b></div> : <div className="invoice-settled-row"><span>Nothing more is due</span><b>Paid in full</b></div>)}
        </div>
        <p className="quote-words">{numberWords(totals.grandTotal)}</p>
      </section>

      <details className="invoice-more">
        <summary><b>Add more details</b><span>PO number, delivery note, e-invoice, freight, discount — most invoices don't need these.</span></summary>
        <div className="quote-header-grid invoice-more-grid">
          <label><span>Invoice type</span><select value={doc.invoiceType} disabled={locked} onChange={(event) => change("invoiceType", event.target.value as Invoice["invoiceType"])}><option>Sales</option><option>Service</option><option>Rental</option></select></label>
          <label><span>Customer PO number</span><input value={doc.poNumber} disabled={locked} onChange={(event) => change("poNumber", event.target.value)} /></label>
          <label><span>Customer PO date</span><input type="date" value={doc.poDate} disabled={locked} onChange={(event) => change("poDate", event.target.value)} /></label>
          <label><span>Delivery note no.</span><input value={doc.deliveryNote} disabled={locked} onChange={(event) => change("deliveryNote", event.target.value)} /></label>
          <label><span>Vehicle number</span><input value={doc.vehicleNumber} disabled={locked} onChange={(event) => change("vehicleNumber", event.target.value)} /></label>
          <label><span>Place of supply</span><select value={doc.placeOfSupply} disabled={locked} onChange={(event) => change("placeOfSupply", event.target.value)}>{INDIAN_STATES.map((state) => <option key={state}>{state}</option>)}</select></label>
          <label><span>e-Invoice IRN</span><input value={doc.irn} disabled={locked} onChange={(event) => change("irn", event.target.value)} placeholder="Generated on sending" /></label>
          <label><span>e-Way bill number</span><input value={doc.ewayBill} disabled={locked} onChange={(event) => change("ewayBill", event.target.value)} /></label>
          <label><span>Freight / other charges</span><input type="number" min="0" value={doc.freightCharges || ""} disabled={locked} onChange={(event) => change("freightCharges", Number(event.target.value))} placeholder="0" /></label>
          <label><span>Discount on the whole invoice %</span><input type="number" min="0" max="100" value={doc.overallDiscount || ""} disabled={locked} onChange={(event) => change("overallDiscount", Number(event.target.value))} placeholder="0" /></label>
        </div>
      </details>

      {(() => { const applied = customerReceipts.filter((receipt) => receipt.allocations.some((allocation) => allocation.invoiceId === doc.id));
        const tdsEntries = customerTds.filter((entry) => entry.invoiceId === doc.id);
        if (!applied.length && !tdsEntries.length) return null;
        return <section className="quote-document-section invoice-block">
          <div className="quote-section-title"><div><h2>Money received</h2><span>Every receipt and TDS entry recorded against this invoice.</span></div></div>
          <div className="invoice-payments">{applied.map((receipt) => { const allocation = receipt.allocations.find((entry) => entry.invoiceId === doc.id)!; return <div key={receipt.id}><b>{money(allocation.amount)}</b><span>{prettyDate(receipt.date)} · {receipt.mode}{receipt.reference ? ` · ${receipt.reference}` : ""}</span></div>; })}
          {tdsEntries.map((entry) => <div key={entry.id}><b>TDS {money(entry.amount)}</b><span>{prettyDate(entry.date)}{entry.reference ? ` · ${entry.reference}` : ""}</span></div>)}</div>
        </section>; })()}

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>History</h2><span>What has happened to this invoice.</span></div></div>
        <div className="lead-timeline quote-activity">{doc.activities.map((activity, index) => <div key={`${activity.title}-${index}`} className={activity.tone ? `quote-timeline--${activity.tone}` : ""}><i /><p><b>{activity.title}</b><span>{activity.meta}</span></p></div>)}</div>
      </section>
    </main>

    {collecting && <div className="invoice-mobile-bar"><button className="erp-action" onClick={() => setPaying(true)}>Record Receipt</button><button className="settings-outline" onClick={() => flash("WhatsApp message ready to share")}>Share on WhatsApp</button></div>}

    {paying && <RecordReceipt store={store} customer={doc.customer} presetInvoiceId={doc.id} close={() => setPaying(false)} flash={flash} />}
    {preview && <InvoicePreview invoice={doc} totals={totals} localTax={localTax} close={() => setPreview(false)} />}
  </section>;
}


function InvoicePreview({ invoice, totals, localTax, close }: { invoice: Invoice; totals: ReturnType<typeof totalsFor>; localTax: boolean; close: () => void }) {
  return <div className="stock-modal-backdrop quote-preview-backdrop"><section className="quote-preview" role="dialog" aria-modal="true" aria-labelledby="invoice-preview-title">
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <div className="quote-preview-actions"><button className="settings-outline" onClick={() => window.print()}>Print / Save PDF</button><button className="erp-action" onClick={close}>Done</button></div>
    <article>
      <header><img src={spmLogo} alt="SPM Lab Solutions" /><div><h2 id="invoice-preview-title">TAX INVOICE</h2><span>{invoice.number}</span></div></header>
      <div className="quote-preview-company">
        <div><b>{COMPANY.name}</b><span>{COMPANY.address}</span><span>GSTIN: {COMPANY.gstin}</span></div>
        <div><b>Bill to</b><span>{invoice.customer || "Customer"}</span><span>{invoice.billingAddress || "Billing address"}</span><span>GSTIN: {invoice.customerGstin || "—"}</span></div>
      </div>
      <p className="quote-preview-subject"><b>Invoice date:</b> {prettyDate(invoice.invoiceDate)} · <b>Payment due by:</b> {prettyDate(invoice.dueDate)}{invoice.poNumber ? ` · PO ${invoice.poNumber}` : ""}</p>
      <table><thead><tr><th>Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{invoice.items.map((line) => <tr key={line.id}><td>{line.item || line.description}</td><td>{line.hsn}</td><td>{line.quantity}</td><td>{money(line.rate)}</td><td>{money(lineValue(line))}</td></tr>)}</tbody></table>
      <div className="quote-preview-total"><span>Taxable value {money(totals.taxable)}</span><span>{localTax ? `CGST ${money(totals.cgst)} + SGST ${money(totals.sgst)}` : `IGST ${money(totals.igst)}`}</span><b>Grand total {money(totals.grandTotal)}</b></div>
      <p className="quote-preview-words">{numberWords(totals.grandTotal)}</p>
      <section><b>How to pay</b><p>{COMPANY.bank}</p><span>Place of supply: {invoice.placeOfSupply}{invoice.deliveryNote ? ` · Delivery note ${invoice.deliveryNote}` : ""}</span></section>
      <footer><div><b>Bank details</b><span>{COMPANY.bank}</span></div><div><i>Authorised signatory</i><b>For {COMPANY.name}</b></div></footer>
    </article>
  </section></div>;
}
