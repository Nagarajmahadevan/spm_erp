import { useMemo, useState } from "react";
import { COMPANY, customerSites, dateIso, money, prettyDate, stamp, totalsFor } from "./erpMasters";
import { dispatchSaleOrder, invoicePaymentStatus, updateStore, useErpStore, type CustomerOrderStatus, type Job } from "./erpStore";
import { invoiceFromOrder, nextNumber as nextInvoiceNumber } from "./Invoices";

export default function Orders({ focusOrder, openJob, openInvoice, newJob, openRentals }: { focusOrder?: string; openJob?: (jobId: string) => void; openInvoice?: (invoiceId: string) => void; newJob?: (prefill: Partial<Job>) => void; openRentals?: () => void } = {}) {
  const store = useErpStore();
  const { customerOrders } = store;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All statuses");
  const [editorId, setEditorId] = useState<string | null>(focusOrder ?? null);
  const [toast, setToast] = useState("");
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2800); };

  const editor = customerOrders.find((order) => order.id === editorId) ?? null;
  const filtered = useMemo(() => customerOrders.filter((order) => `${order.number} ${order.customer}`.toLowerCase().includes(search.toLowerCase()) && (status === "All statuses" || order.status === status)), [customerOrders, search, status]);
  const cards = [
    ["Open orders", customerOrders.filter((order) => order.status === "Open").length, "sent"],
    ["Fulfilled this month", customerOrders.filter((order) => order.status === "Fulfilled" && order.orderDate.startsWith(new Date().toISOString().slice(0, 7))).length, "accepted"],
    ["Rentals out", customerOrders.filter((order) => order.orderType === "Rental" && order.status === "Open").length, "draft"],
  ] as const;

  const setOrderStatus = (order: typeof customerOrders[number], next: CustomerOrderStatus) => {
    updateStore((current) => ({ customerOrders: current.customerOrders.map((item) => item.id === order.id ? { ...item, status: next, activities: [{ title: `Order marked ${next.toLowerCase()}`, meta: "Just now · Arun Kumar", tone: "system" as const }, ...item.activities] } : item) }));
    flash(`Order marked ${next.toLowerCase()}`);
  };

  if (editor) return <OrderDetail order={editor} store={store} close={() => setEditorId(null)} setOrderStatus={setOrderStatus} openJob={openJob} openInvoice={openInvoice} newJob={newJob} openRentals={openRentals} />;

  return <section className="leads-page">
    <div className="leads-heading"><div><p className="erp-secondary-text">Sales / Orders</p><h1>Orders</h1><p className="erp-secondary-text mt-1">Confirmed customer orders, created when a quotation is accepted.</p></div></div>
    <div className="quotations-overview">{cards.map(([label, value, tone]) => <button key={label} className={`leads-stat quotations-stat quotations-stat--${tone}`}><span>{label}</span><b>{value}</b></button>)}</div>
    <div className="leads-toolbar"><div className="settings-list-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search orders" /></div><select value={status} onChange={(event) => setStatus(event.target.value)}><option>All statuses</option><option>Open</option><option>Fulfilled</option><option>Cancelled</option></select></div>
    <div className="leads-table-wrap"><table className="leads-table"><thead><tr><th>Order no.</th><th>Customer</th><th>Type</th><th>Value</th><th>Status</th><th>Order date</th></tr></thead><tbody>{filtered.map((order) => { const total = totalsFor(order.items, order.customerState === COMPANY.state); return <tr key={order.id} onClick={() => setEditorId(order.id)}><td><b>{order.number}</b><small>From {order.fromQuote}</small></td><td>{order.customer}</td><td>{order.orderType}</td><td className="quote-value">{money(total.grandTotal)}</td><td><span className={`quote-status quote-status--${order.status.toLowerCase()}`}>{order.status}</span></td><td>{prettyDate(order.orderDate)}</td></tr>; })}</tbody></table>{!filtered.length && <div className="settings-empty"><b>{customerOrders.length ? "No orders match these filters" : "No orders yet"}</b><p>{customerOrders.length ? "Clear the search box or pick a different status." : "Orders are created automatically when a quotation is accepted."}</p></div>}</div>
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </section>;
}

function OrderDetail({ order, store, close, setOrderStatus, openJob, openInvoice, newJob, openRentals }: { order: ReturnType<typeof useErpStore>["customerOrders"][number]; store: ReturnType<typeof useErpStore>; close: () => void; setOrderStatus: (order: ReturnType<typeof useErpStore>["customerOrders"][number], next: CustomerOrderStatus) => void; openJob?: (jobId: string) => void; openInvoice?: (invoiceId: string) => void; newJob?: (prefill: Partial<Job>) => void; openRentals?: () => void }) {
  const { individuals, jobs, invoices, deliveryChallans, customerReceipts, customerTds, rentals: allRentals } = store;
  const localTax = order.customerState === COMPANY.state;
  const totals = totalsFor(order.items, localTax);
  const dispatches = individuals.filter((item) => item.saleRef === order.number);
  const rentals = allRentals.filter((rental) => rental.orderRef === order.number);
  const linkedJobs = jobs.filter((job) => job.orderRef === order.number);
  const linkedInvoices = invoices.filter((invoice) => invoice.orderRef === order.number);
  const [dispatching, setDispatching] = useState(false);
  const [toast, setToast] = useState("");
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2800); };

  const isSale = order.orderType === "Sale";
  const isRental = order.orderType === "Rental";
  const dispatched = Boolean(order.dispatchedAt);
  const dispatchDc = deliveryChallans.find((dc) => dc.reference === order.number && dc.reason === "Sale");
  const invoiced = linkedInvoices.length > 0;
  const paid = invoiced && linkedInvoices.every((invoice) => invoicePaymentStatus(invoice, customerReceipts, customerTds) === "Paid");
  const installJob = linkedJobs.find((job) => job.type === "Install");
  const statusTone = (done: boolean) => done ? "accepted" : "draft";

  const createInvoice = () => {
    if (linkedInvoices.length) { flash(`Already invoiced as ${linkedInvoices[0].number}`); return; }
    const invoice = invoiceFromOrder(order, nextInvoiceNumber(store.invoices));
    updateStore((current) => ({
      invoices: [invoice, ...current.invoices],
      customerOrders: current.customerOrders.map((entry) => entry.id === order.id ? { ...entry, activities: [{ title: `Invoice ${invoice.number} created`, meta: stamp(), tone: "system" as const }, ...entry.activities] } : entry),
    }));
    flash(`Invoice ${invoice.number} created with an e-way bill field ready to fill in.`);
  };
  const createInstallJob = () => { newJob?.({ customer: order.customer, type: "Install", orderRef: order.number, description: `Installation for order ${order.number}` }); };

  return <section className="leads-page">
    <div className="leads-heading"><div><button className="quote-back" onClick={close}>← Orders</button><p className="erp-secondary-text">Sales / Orders</p><h1>{order.number}</h1><span className={`quote-status quote-status--${order.status.toLowerCase()}`}>{order.status}</span><p className="erp-secondary-text mt-1">{order.customer} · {order.orderType} · From {order.fromQuote}</p>
        {isSale && <div className="leads-actions mt-1"><span className={`quote-status quote-status--${statusTone(dispatched)}`}>{dispatched ? `Dispatched ${prettyDate(order.dispatchedAt!)}${dispatchDc ? ` · ${dispatchDc.number}` : ""}` : "Not dispatched"}</span><span className={`quote-status quote-status--${statusTone(invoiced)}`}>{invoiced ? `Invoiced · ${linkedInvoices[0].number}` : "Not invoiced"}</span><span className={`quote-status quote-status--${statusTone(paid)}`}>{paid ? "Paid" : "Not paid"}</span></div>}
      </div>
      <div className="leads-actions">
        {isSale && order.status !== "Cancelled" && !dispatched && <button className="settings-outline" onClick={() => setDispatching(true)}>Dispatch</button>}
        {isSale && order.status !== "Cancelled" && !invoiced && <button className="settings-outline" onClick={createInvoice}>Create invoice</button>}
        {isSale && order.status !== "Cancelled" && order.installationNeeded && !installJob && newJob && <button className="settings-outline" onClick={createInstallJob}>Create install job</button>}
        {isRental && order.status !== "Cancelled" && openRentals && <button className="settings-outline" onClick={openRentals}>Manage in Rentals</button>}
        {order.status === "Open" && <button className="settings-outline" onClick={() => setOrderStatus(order, "Cancelled")}>Cancel order</button>}
        {order.status === "Open" && <button className="erp-action" onClick={() => setOrderStatus(order, "Fulfilled")}>Mark fulfilled</button>}
      </div>
    </div>

    <section className="settings-subsection">
      <h3>Order details</h3>
      <dl className="invoice-facts due-facts">
        <div><dt>Order date</dt><dd>{prettyDate(order.orderDate)}</dd></div>
        <div><dt>Order type</dt><dd>{order.orderType}</dd></div>
        <div><dt>Customer PO number</dt><dd>{order.poNumber || "Not recorded"}</dd></div>
        <div><dt>PO date</dt><dd>{order.poDate ? prettyDate(order.poDate) : "Not recorded"}</dd></div>
        <div><dt>PO attachment</dt><dd>{order.poAttachment || "Not attached"}</dd></div>
        <div><dt>Advance received</dt><dd>{order.advanceAmount ? money(order.advanceAmount) : "None"}</dd></div>
        {isSale && <div><dt>Installation needed</dt><dd>{order.installationNeeded ? "Yes" : "No"}</dd></div>}
        <div className="invoice-fact-wide"><dt>Billing address</dt><dd>{order.billingAddress || "Not recorded"}</dd></div>
        <div className="invoice-fact-wide"><dt>Shipping address</dt><dd>{order.shippingAddress || "Same as billing"}</dd></div>
      </dl>
      <div className="erp-table-shell"><table className="erp-data-table"><thead><tr><th>Item</th><th>HSN/SAC</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{order.items.map((line) => <tr key={line.id}><td>{line.item || line.description}</td><td>{line.hsn}</td><td>{line.quantity} {line.unit}</td><td>{money(line.rate)}</td><td>{money(line.quantity * line.rate * (1 - (line.discount ?? 0) / 100))}</td></tr>)}</tbody></table></div>
      <p className="quote-words">Grand total {money(totals.grandTotal)}</p>
    </section>

    <section className="settings-subsection">
      <h3>Dispatches</h3>
      {dispatches.length > 0 ? <div className="erp-table-shell"><table className="erp-data-table"><thead><tr><th>Item</th><th>Serial</th><th>Status</th></tr></thead><tbody>{dispatches.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.serial}</td><td>{item.opStatus}</td></tr>)}</tbody></table></div> : <p className="settings-notice">{isSale ? "Nothing dispatched against this order yet — use the Dispatch button above." : "Nothing dispatched against this order yet — record a sale in Stock with this order number as the reference."}</p>}
    </section>

    <section className="settings-subsection">
      <h3>Rentals</h3>
      {rentals.length > 0 ? <div className="erp-table-shell"><table className="erp-data-table"><thead><tr><th>Rental</th><th>Item</th><th>Monthly rent</th><th>Return due</th><th>Status</th></tr></thead><tbody>{rentals.map((rental) => { const item = individuals.find((entry) => entry.id === rental.equipmentId); return <tr key={rental.id}><td>{rental.number}</td><td>{item?.name ?? rental.equipmentId}<small>{item?.serial}</small></td><td>{money(rental.monthlyRate)}</td><td>{prettyDate(rental.expectedReturnDate)}</td><td>{rental.status}</td></tr>; })}</tbody></table></div> : <p className="settings-notice">{isRental ? "Nothing issued on this order yet — use Manage in Rentals above to issue equipment." : "Nothing issued on rent against this order."}</p>}
    </section>

    <section className="settings-subsection">
      <h3>Jobs</h3>
      {linkedJobs.length > 0 ? <div className="erp-table-shell"><table className="erp-data-table"><thead><tr><th>Job</th><th>Type</th><th>Status</th></tr></thead><tbody>{linkedJobs.map((job) => <tr key={job.id}><td>{openJob ? <button className="erp-record-link" onClick={() => openJob(job.id)}>{job.number}</button> : job.number}</td><td>{job.type}</td><td>{job.status}</td></tr>)}</tbody></table></div> : <p className="settings-notice">{isSale ? order.installationNeeded ? "No jobs created from this order yet — use Create install job above." : "This sale does not need installation, so no job is created for it." : "No jobs created from this order yet — link a job to this order number when creating it in Jobs."}</p>}
    </section>

    <section className="settings-subsection">
      <h3>Invoices</h3>
      {linkedInvoices.length > 0 ? <div className="erp-table-shell"><table className="erp-data-table"><thead><tr><th>Invoice</th><th>Date</th><th>Status</th></tr></thead><tbody>{linkedInvoices.map((invoice) => <tr key={invoice.id}><td>{openInvoice ? <button className="erp-record-link" onClick={() => openInvoice(invoice.id)}>{invoice.number}</button> : invoice.number}</td><td>{prettyDate(invoice.invoiceDate)}</td><td>{invoice.status}</td></tr>)}</tbody></table></div> : <p className="settings-notice">{isSale ? "No invoices raised from this order yet — use Create invoice above." : "No invoices raised from this order yet — convert the originating quotation to invoice, or raise one referencing this order."}</p>}
    </section>

    {dispatching && <DispatchModal order={order} store={store} close={() => setDispatching(false)} flash={flash} />}
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </section>;
}

function DispatchModal({ order, store, close, flash }: { order: ReturnType<typeof useErpStore>["customerOrders"][number]; store: ReturnType<typeof useErpStore>; close: () => void; flash: (message: string) => void }) {
  const sites = customerSites.filter((site) => site.customer === order.customer);
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [date, setDate] = useState(dateIso());
  const [error, setError] = useState("");
  const dispatchable = order.items.filter((line) => line.inStock);

  const submit = () => {
    if (!siteId) { setError("Pick the customer's site."); return; }
    let result: ReturnType<typeof dispatchSaleOrder> = {};
    updateStore((current) => { result = dispatchSaleOrder(current, order, siteId, date); return result; });
    close();
    flash(result.deliveryChallans ? `Dispatched. ${result.deliveryChallans[0].number} created.` : "Nothing in this order is currently available in stock to dispatch.");
  };

  return <div className="stock-modal-backdrop" onClick={close}><section className="stock-move-modal" role="dialog" aria-modal="true" aria-labelledby="dispatch-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <p>Sales / Orders</p><h2 id="dispatch-title">Dispatch {order.number}</h2>
    <p className="po-start-hint">{dispatchable.length ? `${dispatchable.length} of ${order.items.length} line${order.items.length === 1 ? "" : "s"} were in stock when this order was created — whatever is actually available now will be issued.` : "None of this order's lines were in stock — nothing will be dispatched."}</p>
    <label className="settings-field"><span>Site <b className="lead-required">Required</b></span><select value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">{sites.length ? "Pick a site" : "No sites on file for this customer"}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}</select></label>
    <label className="settings-field"><span>Dispatch date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
    {error && <p className="stock-count-error">{error}</p>}
    <div className="stock-move-footer"><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" disabled={!dispatchable.length} onClick={submit}>Dispatch</button></div>
  </section></div>;
}
