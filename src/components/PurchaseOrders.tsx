import { useMemo, useState } from "react";
import spmLogo from "@/imports/SPM_Logo.png";
import { APPROVAL_LIMIT, APPROVER, COMPANY, STOCK_LOCATIONS, WAREHOUSE, initialQuotes, money, prettyDate, dateIso, dayDifference, lineValue, numberWords, stamp, stockCatalog, totalsFor, vendorMaster, type Quote } from "./erpMasters";
import { applyReceiptToStock, nextEquipmentIds, onOrderFor, orderAfterReceipt, totalOf, updateStore, useErpStore, type Individual, type POActivity, type POLine, type POStatus, type PurchaseOrder, type Quantity, type Receipt } from "./erpStore";

type DisplayStatus = POStatus | "Overdue";
const filters: POStatus[] = ["Draft", "Awaiting approval", "Sent", "Partly received", "Received", "Cancelled"];
const TERMS = ["Net 15", "Net 30", "Net 45", "Due on receipt"];

const newLine = (): POLine => ({ id: `line-${Date.now()}-${Math.random().toString(16).slice(2)}`, item: "", description: "", hsn: "", quantity: 1, rate: 0, gst: 18, received: 0, serials: [] });
const pendingOf = (line: POLine) => Math.max(line.quantity - line.received, 0);
const isOpen = (order: PurchaseOrder) => order.status === "Sent" || order.status === "Partly received";

function poTotals(order: PurchaseOrder) { return totalsFor(order.items, order.vendorState === COMPANY.state, 0, order.freightCharges); }
function statusFor(order: PurchaseOrder): DisplayStatus {
  return isOpen(order) && dayDifference(order.expectedDate) < 0 ? "Overdue" : order.status;
}
function statusClass(status: DisplayStatus) { return `po-status po-status--${status.toLowerCase().replace(/ /g, "-")}`; }
function nextNumber(orders: PurchaseOrder[]) {
  const highest = Math.max(24095, ...orders.map((order) => Number(order.number.split("-").at(-1)) || 0));
  return `PO-${highest + 1}`;
}
function blockers(order: PurchaseOrder) {
  const list: string[] = [];
  if (!order.vendor.trim()) list.push("Choose a vendor at the top of the page.");
  if (order.vendor.trim() && !order.vendorGstin.trim()) list.push("This vendor has no GSTIN. Click Edit next to the vendor name and add it.");
  if (!order.items.some((line) => line.item.trim() && line.rate > 0)) list.push("Add at least one item with a price.");
  const noHsn = order.items.filter((line) => line.item.trim() && !line.hsn.trim()).map((line) => line.item);
  if (noHsn.length) list.push(`Add the HSN code for ${noHsn.join(", ")}.`);
  return list;
}
function blankOrder(number: string, items: POLine[], linkedQuote = ""): PurchaseOrder {
  return {
    id: number, number, vendor: "", contact: "", vendorGstin: "", vendorState: COMPANY.state, vendorAddress: "",
    paymentTerms: "Net 30", tdsSection: "—", tdsRate: 0, orderDate: dateIso(), expectedDate: "", status: "Draft",
    owner: APPROVER, deliveryAddress: WAREHOUSE, freightCharges: 0, notes: "", linkedQuote,
    items: items.length ? items : [newLine()], receipts: [],
    activities: [{ title: linkedQuote ? `Started from quotation ${linkedQuote}` : "Draft created", meta: stamp(), tone: "system" }],
  };
}

export default function PurchaseOrders() {
  const { orders, quantities, individuals } = useErpStore();
  const setOrders = (change: (all: PurchaseOrder[]) => PurchaseOrder[]) => updateStore((current) => ({ orders: change(current.orders) }));
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("All POs");
  const [editorId, setEditorId] = useState<string | null>(null); const [choosing, setChoosing] = useState(false); const [toast, setToast] = useState("");
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 4200); };
  const editor = orders.find((order) => order.id === editorId) ?? null;

  const persist = (order: PurchaseOrder, message?: string) => {
    setOrders((all) => all.some((item) => item.id === order.id) ? all.map((item) => item.id === order.id ? order : item) : [order, ...all]);
    setEditorId(order.id); if (message) flash(message);
  };
  const create = (items: POLine[], linkedQuote?: string) => {
    const order = blankOrder(nextNumber(orders), items, linkedQuote);
    setOrders((all) => [order, ...all]); setEditorId(order.id); setChoosing(false);
  };
  const duplicate = (order: PurchaseOrder) => {
    const number = nextNumber(orders);
    const copy: PurchaseOrder = { ...order, id: number, number, status: "Draft", sentAt: undefined, receipts: [], vendorBill: undefined, approvedBy: undefined, orderDate: dateIso(), items: order.items.map((line) => ({ ...line, received: 0, serials: [] })), activities: [{ title: `Copied from ${order.number}`, meta: stamp(), tone: "system" }] };
    setOrders((all) => [copy, ...all]); setEditorId(copy.id); flash("Copy created as a draft");
  };

  const awaiting = orders.filter((order) => order.status === "Awaiting approval");
  const sent = orders.filter((order) => order.status === "Sent");
  const pending = orders.filter(isOpen);
  const thisMonth = dateIso().slice(0, 7);
  const receivedThisMonth = orders.filter((order) => order.receipts.some((receipt) => receipt.date.startsWith(thisMonth)));
  const cards = [
    ["Awaiting approval", String(awaiting.length), "Someone must approve", "await", "Awaiting approval"],
    ["Sent to vendor", String(sent.length), "Vendor has the order", "sent", "Sent"],
    ["Pending delivery", String(pending.length), "Still to come", "pending", "Sent"],
    ["Received this month", String(receivedThisMonth.length), "Goods on the shelf", "received", "Received"],
  ] as const;

  const filtered = useMemo(() => orders.filter((order) =>
    `${order.number} ${order.vendor} ${order.items.map((line) => line.item).join(" ")}`.toLowerCase().includes(search.toLowerCase())
    && (status === "All POs" || statusFor(order) === status)), [orders, search, status]);

  if (editor) return <>
    <POEditor key={editor.id} order={editor} close={() => setEditorId(null)} persist={persist} duplicate={duplicate} flash={flash} quantities={quantities} individuals={individuals} />
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </>;

  return <section className="leads-page purchase-page">
    <div className="leads-heading"><div><p className="erp-secondary-text">Procurement / Purchase Orders</p><h1>Purchase Orders</h1><p className="erp-secondary-text mt-1">Order what you are running out of, then receive it into stock in one step.</p></div><div className="leads-actions"><button className="erp-action" onClick={() => setChoosing(true)}>+ New PO</button></div></div>

    <div className="quotations-overview">{cards.map(([label, value, hint, tone, target]) => <button key={label} className={`leads-stat quotations-stat po-stat--${tone}`} onClick={() => setStatus(target)}><span>{label}</span><b>{value}</b><small>{hint}</small></button>)}</div>

    <div className="leads-toolbar quotation-toolbar"><div className="settings-list-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by PO number, vendor or item" /></div><select value={status} onChange={(event) => setStatus(event.target.value)}><option>All POs</option>{filters.map((item) => <option key={item}>{item}</option>)}</select></div>

    <div className="leads-table-wrap"><table className="leads-table purchase-table"><thead><tr><th>PO no.</th><th>Vendor</th><th>Items</th><th>Value</th><th>Status</th><th>Expected</th><th>Owner</th></tr></thead><tbody>{filtered.map((order) => {
      const docStatus = statusFor(order); const late = docStatus === "Overdue";
      return <tr key={order.id} onClick={() => setEditorId(order.id)}>
        <td><b>{order.number}</b><small>{prettyDate(order.orderDate)}</small></td>
        <td><b>{order.vendor || "No vendor yet"}</b><small>{order.contact || "—"}</small></td>
        <td className="quote-subject"><b>{order.items[0]?.item || "No items"}</b>{order.items.length > 1 && <small>and {order.items.length - 1} more</small>}</td>
        <td className="quote-value">{money(poTotals(order).grandTotal)}</td>
        <td><span className={statusClass(docStatus)}>{docStatus}</span></td>
        <td className={late ? "invoice-overdue" : ""}>{order.expectedDate ? `${prettyDate(order.expectedDate)}${late ? ` · ${Math.abs(dayDifference(order.expectedDate))}d late` : ""}` : "Not set"}</td>
        <td>{order.owner}</td>
      </tr>; })}</tbody></table>
      {!filtered.length && <div className="settings-empty"><b>{orders.length ? "No purchase orders match what you typed" : "No purchase orders yet"}</b><p>{orders.length ? "Clear the search box or pick a different status." : "Start with the items that are running low — we will pre-tick them for you."}</p><button className="erp-action" onClick={() => setChoosing(true)}>+ New PO</button></div>}
    </div>

    {choosing && <StartPO close={() => setChoosing(false)} quantities={quantities} orders={orders} create={create} />}
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </section>;
}

function StartPO({ close, quantities, orders, create }: { close: () => void; quantities: Quantity[]; orders: PurchaseOrder[]; create: (items: POLine[], linkedQuote?: string) => void }) {
  const [step, setStep] = useState<"choose" | "low" | "quote">("choose");
  const low = quantities.filter((item) => totalOf(item) < item.minimum);
  const [ticked, setTicked] = useState<string[]>(low.map((item) => item.id));
  const [amounts, setAmounts] = useState<Record<string, number>>(Object.fromEntries(low.map((item) => [item.id, Math.max(item.minimum * 2 - totalOf(item), item.minimum)])));
  const accepted = initialQuotes.filter((quote) => quote.status === "Accepted");

  const fromLow = () => {
    const items = low.filter((item) => ticked.includes(item.id)).map((item) => {
      const catalog = stockCatalog.find((stock) => stock.name === item.name);
      return { id: `line-${item.id}`, item: item.name, description: catalog?.description ?? item.name, hsn: catalog?.hsn ?? "", quantity: amounts[item.id] ?? item.minimum, rate: catalog?.rate ?? 0, gst: catalog?.gst ?? 18, stockId: item.id, received: 0, serials: [] };
    });
    create(items);
  };
  const fromQuote = (quote: Quote) => {
    const items = quote.items.filter((line) => !line.inStock).map((line) => ({ id: `line-${line.id}`, item: line.item, description: line.description, hsn: line.hsn, quantity: line.quantity, rate: Math.round(line.rate * 0.72), gst: line.gst, tracked: true, received: 0, serials: [] }));
    create(items.length ? items : [newLine()], `${quote.number} R${quote.revision}`);
  };

  return <div className="stock-modal-backdrop" onClick={close}><section className="stock-move-modal po-start-modal" role="dialog" aria-modal="true" aria-labelledby="start-po-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <h2 id="start-po-title">What are you ordering?</h2>

    {step === "choose" && <>
      <p className="po-start-hint">Pick where the items should come from. You can change anything afterwards.</p>
      <div className="po-start-choices">
        <button onClick={() => setStep("low")}><b>Items running low</b><span>{low.length ? `${low.length} item${low.length === 1 ? "" : "s"} below the minimum level — we tick them for you` : "Nothing is below its minimum right now"}</span></button>
        <button onClick={() => setStep("quote")}><b>Items for an accepted quotation</b><span>Pulls the items you promised a customer but don't have in stock</span></button>
        <button onClick={() => create([])}><b>Something else</b><span>Start with an empty order and type the items yourself</span></button>
      </div>
    </>}

    {step === "low" && <>
      <p className="po-start-hint">These are below their minimum level. Untick anything you don't want, and change the quantity if you need to.</p>
      <div className="po-low-list">{low.map((item) => {
        const already = onOrderFor(item.id, orders);
        return <label key={item.id} className={ticked.includes(item.id) ? "is-ticked" : ""}>
          <input type="checkbox" checked={ticked.includes(item.id)} onChange={(event) => setTicked((all) => event.target.checked ? [...all, item.id] : all.filter((id) => id !== item.id))} />
          <div><b>{item.name}</b><span>{totalOf(item)} in stock · minimum {item.minimum}{already > 0 ? ` · ${already} already on order` : ""}</span></div>
          <div className="po-low-qty"><span>Order</span><input type="number" min="1" value={amounts[item.id] ?? item.minimum} onChange={(event) => setAmounts((all) => ({ ...all, [item.id]: Number(event.target.value) }))} /></div>
        </label>; })}
        {!low.length && <p className="po-empty-note">Nothing is below its minimum level. Try one of the other two options.</p>}
      </div>
      <div className="po-start-footer"><button className="settings-outline" onClick={() => setStep("choose")}>← Back</button><button className="erp-action" disabled={!ticked.length} onClick={fromLow}>Add {ticked.length} item{ticked.length === 1 ? "" : "s"}</button></div>
    </>}

    {step === "quote" && <>
      <p className="po-start-hint">Pick the customer order you are buying for. We take the items you don't have in stock.</p>
      <div className="invoice-start-list">{accepted.map((quote) => {
        const needed = quote.items.filter((line) => !line.inStock);
        return <button key={quote.id} onClick={() => fromQuote(quote)}>
          <div><b>{quote.customer}</b><span>{quote.subject}</span><small>{quote.number} R{quote.revision} · {needed.length ? `${needed.length} item${needed.length === 1 ? "" : "s"} to buy` : "everything is already in stock"}</small></div>
          <div className="invoice-start-value"><b>{needed.length}</b><em>Use this →</em></div>
        </button>; })}</div>
      <div className="po-start-footer"><button className="settings-outline" onClick={() => setStep("choose")}>← Back</button></div>
    </>}
  </section></div>;
}

function POEditor({ order, close, persist, duplicate, flash, quantities, individuals }: { order: PurchaseOrder; close: () => void; persist: (order: PurchaseOrder, message?: string) => void; duplicate: (order: PurchaseOrder) => void; flash: (message: string) => void; quantities: Quantity[]; individuals: Individual[] }) {
  const [doc, setDoc] = useState(order);
  const [editVendor, setEditVendor] = useState(false); const [confirming, setConfirming] = useState(false); const [receiving, setReceiving] = useState(false);
  const [overflow, setOverflow] = useState(false); const [preview, setPreview] = useState(false); const [problems, setProblems] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState(false); const [comment, setComment] = useState("");

  const docStatus = statusFor(doc); const locked = doc.status !== "Draft";
  const localTax = doc.vendorState === COMPANY.state; const totals = poTotals(doc);
  const needsApproval = totals.grandTotal > APPROVAL_LIMIT;
  const tdsAmount = Math.round(totals.taxable * doc.tdsRate / 100);
  const stillToCome = doc.items.reduce((total, line) => total + pendingOf(line), 0);
  const collecting = doc.status === "Sent" || doc.status === "Partly received";

  const change = <K extends keyof PurchaseOrder>(key: K, value: PurchaseOrder[K]) => setDoc({ ...doc, [key]: value });
  const chooseVendor = (name: string) => {
    const vendor = vendorMaster.find((item) => item.name === name);
    if (!vendor) { change("vendor", name); return; }
    setDoc({ ...doc, vendor: vendor.name, contact: vendor.contact, vendorGstin: vendor.gstin, vendorState: vendor.state, vendorAddress: vendor.address, paymentTerms: vendor.paymentTerms, tdsSection: vendor.tdsSection, tdsRate: vendor.tdsRate });
  };
  const updateLine = (index: number, patch: Partial<POLine>) => setDoc({ ...doc, items: doc.items.map((line, itemIndex) => itemIndex === index ? { ...line, ...patch } : line) });
  const pickStock = (index: number, item: string) => {
    const catalog = stockCatalog.find((stock) => stock.name === item);
    const quantity = quantities.find((stock) => stock.name === item);
    updateLine(index, catalog ? { item, description: catalog.description, hsn: catalog.hsn, rate: catalog.rate, gst: catalog.gst, stockId: quantity?.id, tracked: !quantity } : { item, stockId: quantity?.id });
  };
  const removeLine = (index: number) => { if (doc.items.length === 1) return; setDoc({ ...doc, items: doc.items.filter((_, itemIndex) => itemIndex !== index) }); };
  const log = (title: string, tone?: POActivity["tone"]) => [{ title, meta: stamp(), tone }, ...doc.activities];

  const saveDraft = () => { const next = { ...doc, activities: log("Draft saved", "system") }; setDoc(next); persist(next, "Draft saved"); };
  const trySend = () => { const found = blockers(doc); setProblems(found); if (found.length) { setConfirming(false); return; } setConfirming(true); };
  const send = () => {
    const next: PurchaseOrder = needsApproval
      ? { ...doc, status: "Awaiting approval", activities: log(`Sent to ${APPROVER} for approval — above ${money(APPROVAL_LIMIT)}`, "system") }
      : { ...doc, status: "Sent", sentAt: prettyDate(dateIso()), activities: log(`Sent to ${doc.vendor}`, "sent") };
    setDoc(next); setConfirming(false);
    persist(next, needsApproval ? `Sent to ${APPROVER} for approval. They will see it on their dashboard and in Alerts.` : `PO sent to ${doc.vendor}.`);
  };
  const approve = () => {
    const next: PurchaseOrder = { ...doc, status: "Sent", approvedBy: APPROVER, approvalComment: comment, sentAt: prettyDate(dateIso()), activities: log(`Approved by ${APPROVER}${comment ? ` — ${comment}` : ""}`, "approved") };
    setDoc(next); setComment(""); persist(next, `Approved and sent to ${doc.vendor}.`);
  };
  const reject = () => {
    if (!comment.trim()) return;
    const next: PurchaseOrder = { ...doc, status: "Draft", rejectedBy: APPROVER, activities: log(`Rejected by ${APPROVER} — ${comment}`, "rejected") };
    setDoc(next); setRejecting(false); setComment(""); persist(next, "Sent back to the buyer as a draft.");
  };
  const cancel = () => { const next: PurchaseOrder = { ...doc, status: "Cancelled", activities: log("PO cancelled", "system") }; setDoc(next); setOverflow(false); persist(next, "PO cancelled"); };

  const applyReceipt = (receipt: Receipt, summary: string) => {
    const next = orderAfterReceipt(doc, receipt);
    setDoc(next); setReceiving(false);
    // Put the goods on the shelf and write each item's movement history — the same helper
    // Stock's "Receive stock → Purchase Receipt" path uses, so a delivery is only ever posted once.
    updateStore((current) => applyReceiptToStock(current, doc, receipt));
    persist(next, summary);
  };

  return <section className={`quote-editor-page invoice-editor-page${collecting ? " invoice-has-bar" : ""}`}>
    <header className="quote-editor-head"><div>
      <button className="quote-back" onClick={close}>← Purchase Orders</button>
      <p>Procurement / Purchase Orders</p>
      <h1>{doc.number}</h1>
      <span className={statusClass(docStatus)}>{docStatus}</span>
      {collecting && stillToCome > 0 && <span className="invoice-due-chip">{stillToCome} still to come</span>}
      {doc.linkedQuote && <span className="invoice-source-chip">For {doc.linkedQuote}</span>}
    </div><div className="quote-editor-actions">
      {docStatus === "Draft" && <>
        <div className="quote-action-anchor"><button className="erp-action" onClick={trySend}>Send to vendor</button>
          {confirming && <div className="quote-action-popover invoice-confirm"><b>Once sent, this PO can't be edited.{needsApproval ? ` It is above ${money(APPROVAL_LIMIT)}, so ${APPROVER} has to approve it first.` : ""} Send?</b><div><button className="erp-action" onClick={send}>{needsApproval ? "Send for approval" : "Yes, send it"}</button><button className="settings-outline" onClick={() => setConfirming(false)}>Keep editing</button></div></div>}
        </div>
        <button className="settings-outline" onClick={() => setPreview(true)}>Preview PDF</button>
        <button className="settings-outline" onClick={saveDraft}>Save draft</button>
        <div className="quote-action-anchor"><button className="settings-outline quote-overflow-button" onClick={() => setOverflow(!overflow)} aria-label="More actions">⋯</button>
          {overflow && <div className="quote-overflow-menu"><button className="is-danger" onClick={cancel}>Delete</button></div>}
        </div>
      </>}
      {docStatus === "Awaiting approval" && <>
        <button className="erp-action" onClick={approve}>Approve</button>
        <div className="quote-action-anchor"><button className="quote-reject" onClick={() => setRejecting(!rejecting)}>Reject</button>
          {rejecting && <div className="quote-action-popover"><b>Send back to the buyer</b><label><span>Why? <b className="lead-required">Required</b></span><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Tell them what to change" /></label><button className="erp-action" disabled={!comment.trim()} onClick={reject}>Send it back</button></div>}
        </div>
        <button className="settings-outline" onClick={() => setPreview(true)}>Preview</button>
      </>}
      {collecting && <>
        <button className="erp-action" onClick={() => setReceiving(true)}>Receive items</button>
        <button className="settings-outline" onClick={() => flash(`Reminder sent to ${doc.contact || doc.vendor}`)}>Send reminder</button>
        <button className="settings-outline" onClick={() => setPreview(true)}>Preview</button>
        <div className="quote-action-anchor"><button className="settings-outline quote-overflow-button" onClick={() => setOverflow(!overflow)} aria-label="More actions">⋯</button>
          {overflow && <div className="quote-overflow-menu"><button onClick={() => { setOverflow(false); flash("WhatsApp message ready to share"); }}>Share on WhatsApp</button><button className="is-danger" onClick={cancel}>Cancel</button></div>}
        </div>
      </>}
      {docStatus === "Received" && <><button className="settings-outline" onClick={() => setPreview(true)}>Preview</button><button className="settings-outline" onClick={() => duplicate(doc)}>Duplicate</button></>}
      {docStatus === "Cancelled" && <button className="settings-outline" onClick={() => setPreview(true)}>Preview</button>}
    </div></header>

    <main className="invoice-editor-layout">
      {problems.length > 0 && <div className="invoice-problems" role="alert"><b>Fix this before sending</b><ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></div>}
      {doc.status === "Awaiting approval" && <div className="po-approval-banner"><b>Waiting for {APPROVER} to approve</b><span>This order is {money(totals.grandTotal)}, above the {money(APPROVAL_LIMIT)} approval limit set in Settings.</span></div>}
      {doc.rejectedBy && doc.status === "Draft" && <div className="invoice-problems"><b>{APPROVER} sent this back</b><ul><li>{doc.activities.find((activity) => activity.tone === "rejected")?.title.split(" — ").slice(1).join(" — ") || "See the history below."}</li></ul></div>}

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>1 · Vendor</h2><span>Everything below fills in from the vendor master.</span></div>{!locked && <button className="invoice-edit-link" onClick={() => setEditVendor(!editVendor)}>{editVendor ? "Done" : "Edit"}</button>}</div>
        {locked ? <p className="invoice-customer-name">{doc.vendor}</p> : <label className="invoice-customer-picker"><span>Vendor</span><input list="po-vendors" value={doc.vendor} onChange={(event) => chooseVendor(event.target.value)} placeholder="Type a vendor name" /><datalist id="po-vendors">{vendorMaster.map((vendor) => <option key={vendor.name} value={vendor.name}>{vendor.state}</option>)}</datalist></label>}
        {editVendor && !locked
          ? <div className="quote-header-grid invoice-edit-grid">
              <label><span>Contact person</span><input value={doc.contact} onChange={(event) => change("contact", event.target.value)} /></label>
              <label><span>GSTIN</span><input value={doc.vendorGstin} onChange={(event) => change("vendorGstin", event.target.value)} /></label>
              <label><span>Payment terms</span><select value={doc.paymentTerms} onChange={(event) => change("paymentTerms", event.target.value)}>{TERMS.map((term) => <option key={term}>{term}</option>)}</select></label>
              <label><span>TDS rate %</span><input type="number" min="0" step="0.1" value={doc.tdsRate || ""} onChange={(event) => change("tdsRate", Number(event.target.value))} placeholder="0" /></label>
              <label className="quote-grid-wide"><span>Vendor address</span><textarea value={doc.vendorAddress} onChange={(event) => change("vendorAddress", event.target.value)} /></label>
            </div>
          : <dl className="invoice-facts">
              <div><dt>Contact</dt><dd>{doc.contact || "—"}</dd></div>
              <div><dt>GSTIN</dt><dd>{doc.vendorGstin || <em>Missing</em>}</dd></div>
              <div><dt>State</dt><dd>{doc.vendorState}</dd></div>
              <div><dt>Payment terms</dt><dd>{doc.paymentTerms}</dd></div>
              <div><dt>TDS</dt><dd>{doc.tdsRate ? `${doc.tdsRate}% · section ${doc.tdsSection}` : "Not applicable"}</dd></div>
              <div><dt>Order date</dt><dd>{prettyDate(doc.orderDate)}</dd></div>
              <div className="invoice-fact-wide"><dt>Vendor address</dt><dd>{doc.vendorAddress || <em>Missing</em>}</dd></div>
            </dl>}
      </section>

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>2 · Items</h2><span>{locked ? "Sent orders can't be changed." : "Start typing an item name to pull its description, HSN code and last purchase price."}</span></div>{!locked && <button className="settings-outline" onClick={() => setDoc({ ...doc, items: [...doc.items, newLine()] })}>+ Add row</button>}</div>
        <datalist id="po-stock-items">{stockCatalog.map((item) => <option key={item.name} value={item.name}>{item.hsn} · {money(item.rate)}</option>)}</datalist>
        <div className="invoice-lines-wrap"><table className="invoice-lines-table po-lines-table">
          <thead><tr><th>Item</th><th>Description</th><th>HSN</th><th>Qty</th><th>Rate</th><th>GST %</th><th>Total</th><th /></tr></thead>
          <tbody>{doc.items.map((line, index) => {
            const stock = quantities.find((item) => item.id === line.stockId);
            return <tr key={line.id}>
              <td data-label="Item">
                {locked ? <b>{line.item}</b> : <input list="po-stock-items" value={line.item} onChange={(event) => pickStock(index, event.target.value)} placeholder="Type an item name" />}
                {stock && <small className={totalOf(stock) < stock.minimum ? "po-stock-hint is-low" : "po-stock-hint"}>{totalOf(stock)} in stock · min {stock.minimum}</small>}
                {line.received > 0 && <small className="po-received-hint">{line.received} of {line.quantity} received</small>}
              </td>
              <td data-label="Description">{locked ? <span>{line.description}</span> : <textarea rows={1} value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} />}</td>
              <td data-label="HSN">{locked ? <span>{line.hsn}</span> : <input value={line.hsn} onChange={(event) => updateLine(index, { hsn: event.target.value })} />}</td>
              <td data-label="Qty">{locked ? <span>{line.quantity}</span> : <input type="number" min="0" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} />}</td>
              <td data-label="Rate">{locked ? <span>{money(line.rate)}</span> : <input type="number" min="0" value={line.rate || ""} onChange={(event) => updateLine(index, { rate: Number(event.target.value) })} />}</td>
              <td data-label="GST %">{locked ? <span>{line.gst}%</span> : <select value={line.gst} onChange={(event) => updateLine(index, { gst: Number(event.target.value) })}><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="28">28%</option></select>}</td>
              <td className="invoice-line-total" data-label="Total"><b>{money(lineValue(line))}</b></td>
              <td className="invoice-line-delete">{!locked && <button className="quote-delete-line" onClick={() => removeLine(index)} disabled={doc.items.length === 1} aria-label={`Remove ${line.item || "row"}`}>×</button>}</td>
            </tr>; })}</tbody>
          <tfoot><tr><td className="invoice-foot-head" colSpan={3}>Totals · {doc.items.length} {doc.items.length === 1 ? "item" : "items"}</td><td className="invoice-foot-qty" data-label="Total qty">{doc.items.reduce((total, line) => total + line.quantity, 0)}</td><td className="invoice-foot-spacer" colSpan={2} /><td className="invoice-line-total" data-label="Items total"><b>{money(totals.lineSubtotal)}</b></td><td className="invoice-foot-spacer" /></tr></tfoot>
        </table></div>
      </section>

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>3 · Totals</h2><span>Tax is worked out from the vendor's state.</span></div></div>
        <p className="invoice-tax-note">{doc.vendor ? (localTax ? `${doc.vendorState} vendor — CGST + SGST applies.` : `${doc.vendorState} vendor — IGST applies.`) : "Choose a vendor and we will work out the right tax."}</p>
        <div className="invoice-totals">
          <div><span>Taxable value</span><b>{money(totals.taxable)}</b></div>
          {localTax ? <><div><span>CGST</span><b>{money(totals.cgst)}</b></div><div><span>SGST</span><b>{money(totals.sgst)}</b></div></> : <div><span>IGST</span><b>{money(totals.igst)}</b></div>}
          {doc.freightCharges > 0 && <div><span>Freight</span><b>{money(doc.freightCharges)}</b></div>}
          <div><span>Round off</span><b>{totals.roundOff >= 0 ? "+" : "−"}{money(Math.abs(totals.roundOff))}</b></div>
          <div className="invoice-grand"><span>Grand total</span><b>{money(totals.grandTotal)}</b></div>
        </div>
        <p className="quote-words">{numberWords(totals.grandTotal)}</p>
        {needsApproval && doc.status === "Draft" && <p className="po-limit-note">Above the {money(APPROVAL_LIMIT)} approval limit — {APPROVER} will have to approve this before it goes out.</p>}
      </section>

      <details className="invoice-more">
        <summary><b>Add more details</b><span>Delivery date and address, freight, payment terms, notes — most orders don't need these.</span></summary>
        <div className="quote-header-grid invoice-more-grid">
          <label><span>Expected delivery date</span><input type="date" value={doc.expectedDate} disabled={locked} onChange={(event) => change("expectedDate", event.target.value)} /></label>
          <label><span>Deliver to</span><select value={doc.deliveryAddress} disabled={locked} onChange={(event) => change("deliveryAddress", event.target.value)}>{STOCK_LOCATIONS.map((location) => <option key={location}>{location}</option>)}</select></label>
          <label><span>Freight</span><input type="number" min="0" value={doc.freightCharges || ""} disabled={locked} onChange={(event) => change("freightCharges", Number(event.target.value))} placeholder="0" /></label>
          <label><span>Payment terms for this order</span><select value={doc.paymentTerms} disabled={locked} onChange={(event) => change("paymentTerms", event.target.value)}>{TERMS.map((term) => <option key={term}>{term}</option>)}</select></label>
          <label><span>Linked quotation</span><input value={doc.linkedQuote} disabled={locked} onChange={(event) => change("linkedQuote", event.target.value)} placeholder="e.g. QT-2026-0827 R1" /></label>
          <label className="quote-grid-wide"><span>Notes to the vendor</span><textarea value={doc.notes} disabled={locked} onChange={(event) => change("notes", event.target.value)} placeholder="Anything the vendor needs to know" /></label>
        </div>
      </details>

      {doc.receipts.length > 0 && <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>What has arrived</h2><span>Every delivery recorded against this order.</span></div></div>
        <div className="po-receipt-list">{doc.receipts.map((receipt) => <div key={receipt.id}>
          <div><b>{prettyDate(receipt.date)}</b><span>Into {receipt.location}{receipt.challan ? ` · challan ${receipt.challan}` : ""}</span>{receipt.note && <em>{receipt.note}</em>}</div>
          <ul>{receipt.lines.map((entry) => { const line = doc.items.find((item) => item.id === entry.lineId); return <li key={entry.lineId}>{entry.quantity} × {line?.item}{entry.serials.length ? ` · ${entry.serials.join(", ")}` : ""}</li>; })}</ul>
        </div>)}</div>
      </section>}

      {doc.status === "Received" && <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>Vendor payable</h2><span>Sent to Accounts when the goods were received.</span></div></div>
        <div className="invoice-totals">
          <div><span>Invoice value</span><b>{money(totals.grandTotal)}</b></div>
          {doc.tdsRate > 0 && <div><span>Less TDS {doc.tdsRate}% · section {doc.tdsSection}</span><b>−{money(tdsAmount)}</b></div>}
          <div className="invoice-grand"><span>Pay the vendor</span><b>{money(totals.grandTotal - tdsAmount)}</b></div>
        </div>
        <p className="po-bill-line">{doc.vendorBill ? <>Vendor bill <b>{doc.vendorBill}</b> · <button className="invoice-edit-link" onClick={() => flash(`Opening ${doc.vendorBill} in Accounts`)}>Open bill</button></> : "No vendor bill recorded against this order yet."}</p>
      </section>}

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>History</h2><span>What has happened to this order.</span></div></div>
        <div className="lead-timeline quote-activity">{doc.activities.map((activity, index) => <div key={`${activity.title}-${index}`} className={activity.tone ? `po-timeline--${activity.tone}` : ""}><i /><p><b>{activity.title}</b><span>{activity.meta}</span></p></div>)}</div>
      </section>
    </main>

    {collecting && <div className="invoice-mobile-bar po-mobile-bar"><button className="erp-action" onClick={() => setReceiving(true)}>Receive items</button><button className="settings-outline" onClick={() => flash("WhatsApp message ready to share")}>Share on WhatsApp</button></div>}

    {receiving && <ReceiveItems order={doc} individuals={individuals} close={() => setReceiving(false)} save={applyReceipt} />}
    {preview && <POPreview order={doc} totals={totals} localTax={localTax} close={() => setPreview(false)} />}
  </section>;
}

function ReceiveItems({ order, individuals, close, save }: { order: PurchaseOrder; individuals: Individual[]; close: () => void; save: (receipt: Receipt, summary: string) => void }) {
  const [date, setDate] = useState(dateIso());
  const [location, setLocation] = useState(order.deliveryAddress || WAREHOUSE);
  const [challan, setChallan] = useState(""); const [note, setNote] = useState("");
  const [amounts, setAmounts] = useState<Record<string, number>>(Object.fromEntries(order.items.map((line) => [line.id, pendingOf(line)])));
  const [serials, setSerials] = useState<Record<string, string[]>>({});

  const over = order.items.filter((line) => (amounts[line.id] ?? 0) > pendingOf(line));
  const total = order.items.reduce((sum, line) => sum + (amounts[line.id] ?? 0), 0);
  const blocked = total <= 0 || (over.length > 0 && !note.trim());

  const generate = (line: POLine) => {
    const count = amounts[line.id] ?? 0;
    const taken = Object.values(serials).flat();
    setSerials((all) => ({ ...all, [line.id]: nextEquipmentIds([...individuals, ...taken.map((id) => ({ id } as Individual))], count) }));
  };
  const submit = () => {
    const lines = order.items.map((line) => ({ lineId: line.id, quantity: amounts[line.id] ?? 0, serials: (serials[line.id] ?? []).filter(Boolean) })).filter((entry) => entry.quantity > 0);
    const named = lines.map((entry) => { const line = order.items.find((item) => item.id === entry.lineId); return `${entry.quantity} × ${line?.item}`; });
    save({ id: `rc-${Date.now()}`, date, location, challan, note, lines }, `Added to ${location}: ${named.join(", ")}.`);
  };

  return <div className="stock-modal-backdrop" onClick={close}><section className="stock-move-modal po-receive-modal" role="dialog" aria-modal="true" aria-labelledby="receive-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <h2 id="receive-title">Receive items</h2>
    <p className="po-start-hint">Check what actually turned up. We put it into stock for you.</p>

    <div className="po-receive-list">{order.items.map((line) => {
      const pending = pendingOf(line);
      const entered = amounts[line.id] ?? 0;
      return <div key={line.id} className="po-receive-row">
        <div className="po-receive-head"><b>{line.item}</b><span>Ordered {line.quantity} · received {line.received} · still to come {pending}</span></div>
        <label className="po-receive-qty"><span>Received now</span><input type="number" min="0" value={entered} onChange={(event) => setAmounts((all) => ({ ...all, [line.id]: Number(event.target.value) }))} /></label>
        {entered > pending && <p className="po-over-note">That is {entered - pending} more than you ordered.</p>}
        {line.tracked && entered > 0 && <div className="po-serials">
          <div className="po-serials-head"><span>Scan or generate {entered} ID{entered === 1 ? "" : "s"}</span><button className="invoice-edit-link" onClick={() => generate(line)}>Generate</button></div>
          {Array.from({ length: entered }, (_, index) => <input key={index} value={serials[line.id]?.[index] ?? ""} placeholder={`Scan ID ${index + 1}`} onChange={(event) => setSerials((all) => { const next = [...(all[line.id] ?? [])]; next[index] = event.target.value; return { ...all, [line.id]: next }; })} />)}
        </div>}
      </div>; })}</div>

    <div className="po-receive-grid">
      <label><span>Date received</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label><span>Put it where?</span><select value={location} onChange={(event) => setLocation(event.target.value)}>{STOCK_LOCATIONS.map((place) => <option key={place}>{place}</option>)}</select></label>
      <label><span>Vendor challan or bill no.</span><input value={challan} onChange={(event) => setChallan(event.target.value)} placeholder="Optional" /></label>
      <label><span>Photo of the challan</span><input type="file" accept="image/*,application/pdf" /></label>
    </div>

    {over.length > 0 && <label className="po-over-confirm"><span>You are receiving more than you ordered. Say why <b className="lead-required">Required</b></span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. vendor sent 2 extra free of cost" /></label>}

    <div className="invoice-payment-footer"><span>Adding {total} item{total === 1 ? "" : "s"} to {location}</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" disabled={blocked} onClick={submit}>Add to stock</button></div></div>
  </section></div>;
}

function POPreview({ order, totals, localTax, close }: { order: PurchaseOrder; totals: ReturnType<typeof totalsFor>; localTax: boolean; close: () => void }) {
  return <div className="stock-modal-backdrop quote-preview-backdrop"><section className="quote-preview" role="dialog" aria-modal="true" aria-labelledby="po-preview-title">
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <div className="quote-preview-actions"><button className="settings-outline" onClick={() => window.print()}>Print / Save PDF</button><button className="erp-action" onClick={close}>Done</button></div>
    <article>
      <header><img src={spmLogo} alt="SPM Lab Solutions" /><div><h2 id="po-preview-title">PURCHASE ORDER</h2><span>{order.number}</span></div></header>
      <div className="quote-preview-company">
        <div><b>{COMPANY.name}</b><span>{COMPANY.address}</span><span>GSTIN: {COMPANY.gstin}</span></div>
        <div><b>Vendor</b><span>{order.vendor || "Vendor"}</span><span>{order.vendorAddress || "Vendor address"}</span><span>GSTIN: {order.vendorGstin || "—"}</span></div>
      </div>
      <p className="quote-preview-subject"><b>Order date:</b> {prettyDate(order.orderDate)}{order.expectedDate ? <> · <b>Wanted by:</b> {prettyDate(order.expectedDate)}</> : null} · <b>Deliver to:</b> {order.deliveryAddress}</p>
      <table><thead><tr><th>Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{order.items.map((line) => <tr key={line.id}><td>{line.item || line.description}</td><td>{line.hsn}</td><td>{line.quantity}</td><td>{money(line.rate)}</td><td>{money(lineValue(line))}</td></tr>)}</tbody></table>
      <div className="quote-preview-total"><span>Taxable value {money(totals.taxable)}</span><span>{localTax ? `CGST ${money(totals.cgst)} + SGST ${money(totals.sgst)}` : `IGST ${money(totals.igst)}`}</span><b>Grand total {money(totals.grandTotal)}</b></div>
      <p className="quote-preview-words">{numberWords(totals.grandTotal)}</p>
      <section><b>Terms</b><p>Payment: {order.paymentTerms}. {order.notes}</p><span>Please quote our PO number on your invoice and delivery challan.</span></section>
      <footer><div><b>Deliver to</b><span>{order.deliveryAddress}</span></div><div><i>Authorised signatory</i><b>For {COMPANY.name}</b></div></footer>
    </article>
  </section></div>;
}
