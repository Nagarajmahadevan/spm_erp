import { useMemo, useState } from "react";
import { INDIAN_STATES, customerSites, dayDifference, money, prettyDate, type Customer } from "./erpMasters";
import { balanceOf, customerOutstanding, invoiceStatusFor, updateStore, useErpStore } from "./erpStore";
import CustomerInstrumentsPanel from "./CustomerInstruments";

const nextCustomerId = (all: Customer[]) => `CUS-${String(Math.max(0, ...all.map((item) => Number(item.id.split("-").at(-1)) || 0)) + 1).padStart(4, "0")}`;
const blankCustomer = (id: string): Customer => ({ id, name: "", contact: "", gstin: "", state: "Karnataka", city: "", billing: "", shipping: "", paymentTerms: "Net 30" });

export default function Customers({ focusCustomer, openJob, openInvoice }: { focusCustomer?: string; openJob?: (jobId: string) => void; openInvoice?: (invoiceId: string) => void }) {
  const store = useErpStore();
  const { customers, instruments, quotes, jobs, invoices, customerReceipts, customerTds } = store;
  const [search, setSearch] = useState("");
  const [editorId, setEditorId] = useState<string | null>(focusCustomer ?? null);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [toast, setToast] = useState("");
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2800); };

  const editor = customers.find((item) => item.id === editorId) ?? null;

  const rows = useMemo(() => customers.map((customer) => ({
    customer,
    instrumentCount: instruments.filter((item) => item.customer === customer.name).length,
    outstanding: customerOutstanding(customer.name, invoices, customerReceipts, customerTds),
  })).filter((row) => `${row.customer.name} ${row.customer.city}`.toLowerCase().includes(search.trim().toLowerCase())), [customers, instruments, invoices, customerReceipts, customerTds, search]);

  const saveCustomer = (next: Customer) => {
    updateStore((current) => ({ customers: current.customers.some((item) => item.id === next.id) ? current.customers.map((item) => item.id === next.id ? next : item) : [next, ...current.customers] }));
    setEditing(null);
    flash(`${next.name} saved.`);
  };

  if (editor) return <CustomerDetail customer={editor} store={store} close={() => setEditorId(null)} edit={() => setEditing(editor)} openJob={openJob} openInvoice={openInvoice} />;

  return <section className="leads-page">
    <div className="leads-heading"><div><p className="erp-secondary-text">Customers</p><h1>Customers</h1><p className="erp-secondary-text mt-1">Every customer, what they owe, and what they have with us.</p></div><div className="leads-actions"><button className="erp-action" onClick={() => setEditing(blankCustomer(nextCustomerId(customers)))}>+ Add customer</button></div></div>
    <div className="leads-toolbar"><div className="settings-list-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers" /></div></div>
    <div className="leads-table-wrap"><table className="leads-table"><thead><tr><th>Customer</th><th>City</th><th>Outstanding</th><th>Instruments</th></tr></thead><tbody>{rows.map(({ customer, instrumentCount, outstanding }) => <tr key={customer.id} onClick={() => setEditorId(customer.id)}>
      <td><b>{customer.name}</b><small>{customer.gstin}</small></td>
      <td>{customer.city || "—"}</td>
      <td className={outstanding > 0.005 ? "invoice-balance" : "invoice-balance-clear"}>{outstanding > 0.005 ? money(outstanding) : "Nothing due"}</td>
      <td>{instrumentCount}</td>
    </tr>)}</tbody></table>{!rows.length && <div className="settings-empty"><b>No customers match this search</b><p>Clear the search box or add a new customer.</p><button className="erp-action" onClick={() => setEditing(blankCustomer(nextCustomerId(customers)))}>+ Add customer</button></div>}</div>
    {editing && <CustomerForm customer={editing} all={customers} close={() => setEditing(null)} save={saveCustomer} />}
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </section>;
}

function CustomerForm({ customer, all, close, save }: { customer: Customer; all: Customer[]; close: () => void; save: (next: Customer) => void }) {
  const [doc, setDoc] = useState(customer);
  const [error, setError] = useState("");
  const isExisting = all.some((item) => item.id === customer.id);
  const change = <K extends keyof Customer>(key: K, value: Customer[K]) => setDoc({ ...doc, [key]: value });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!doc.name.trim()) { setError("Enter a customer name."); return; }
    if (all.some((item) => item.id !== doc.id && item.name.toLowerCase() === doc.name.trim().toLowerCase())) { setError("A customer with this name already exists."); return; }
    save({ ...doc, name: doc.name.trim() });
  };
  return <div className="stock-modal-backdrop"><section className="stock-move-modal lead-new-modal" role="dialog" aria-modal="true" aria-labelledby="customer-form-title">
    <button className="stock-modal-close" onClick={close}>×</button>
    <p>Customers</p><h2 id="customer-form-title">{isExisting ? "Edit customer" : "Add customer"}</h2>
    <form className="settings-form" onSubmit={submit}>
      <label><span>Customer name <b className="lead-required">Required</b></span><input value={doc.name} onChange={(event) => change("name", event.target.value)} autoFocus required /></label>
      <label><span>Contact person</span><input value={doc.contact} onChange={(event) => change("contact", event.target.value)} /></label>
      <label><span>GSTIN</span><input value={doc.gstin} onChange={(event) => change("gstin", event.target.value)} /></label>
      <label><span>City</span><input value={doc.city} onChange={(event) => change("city", event.target.value)} /></label>
      <label><span>State</span><select value={doc.state} onChange={(event) => change("state", event.target.value)}>{INDIAN_STATES.map((state) => <option key={state}>{state}</option>)}</select></label>
      <label><span>Payment terms</span><select value={doc.paymentTerms} onChange={(event) => change("paymentTerms", event.target.value)}><option>Net 15</option><option>Net 30</option><option>Net 45</option><option>Due on receipt</option></select></label>
      <label className="lead-form-wide"><span>Billing address</span><textarea value={doc.billing} onChange={(event) => change("billing", event.target.value)} /></label>
      <label className="lead-form-wide"><span>Shipping address</span><textarea value={doc.shipping} onChange={(event) => change("shipping", event.target.value)} /></label>
      {error && <p className="stock-count-error" role="alert">{error}</p>}
      <button className="erp-action" type="submit">Save customer</button>
    </form>
  </section></div>;
}

function CustomerDetail({ customer, store, close, edit, openJob, openInvoice }: { customer: Customer; store: ReturnType<typeof useErpStore>; close: () => void; edit: () => void; openJob?: (jobId: string) => void; openInvoice?: (invoiceId: string) => void }) {
  const { quotes, jobs, invoices, customerReceipts, customerTds } = store;
  const sites = customerSites.filter((site) => site.customer === customer.name);
  const customerQuotes = quotes.filter((quote) => quote.customer === customer.name).sort((a, b) => b.quoteDate.localeCompare(a.quoteDate));
  const customerJobs = jobs.filter((job) => job.customer === customer.name).sort((a, b) => (b.scheduledDate || "").localeCompare(a.scheduledDate || ""));
  const customerInvoices = invoices.filter((invoice) => invoice.customer === customer.name).sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
  const outstandingInvoices = customerInvoices.filter((invoice) => invoice.status === "Sent" && balanceOf(invoice, customerReceipts, customerTds) > 0.005);
  const totalOutstanding = outstandingInvoices.reduce((sum, invoice) => sum + balanceOf(invoice, customerReceipts, customerTds), 0);

  return <section className="leads-page">
    <div className="leads-heading"><div><button className="quote-back" onClick={close}>← Customers</button><p className="erp-secondary-text">Customers</p><h1>{customer.name}</h1><p className="erp-secondary-text mt-1">{customer.city}{customer.gstin ? ` · GSTIN ${customer.gstin}` : ""}</p></div><div className="leads-actions"><button className="settings-outline" onClick={edit}>Edit customer</button></div></div>

    <section className="settings-subsection">
      <h3>Contacts and sites</h3>
      <dl className="invoice-facts due-facts">
        <div><dt>Primary contact</dt><dd>{customer.contact || "Not recorded"}</dd></div>
        <div><dt>Payment terms</dt><dd>{customer.paymentTerms}</dd></div>
        <div className="invoice-fact-wide"><dt>Billing address</dt><dd>{customer.billing || "Not recorded"}</dd></div>
        <div className="invoice-fact-wide"><dt>Shipping address</dt><dd>{customer.shipping || "Same as billing"}</dd></div>
      </dl>
      {sites.length > 0 ? <div className="erp-table-shell"><table className="erp-data-table"><thead><tr><th>Site</th><th>City</th><th>Contact</th><th>Phone</th></tr></thead><tbody>{sites.map((site) => <tr key={site.id}><td>{site.name}</td><td>{site.city}</td><td>{site.contact}</td><td>{site.phone}</td></tr>)}</tbody></table></div> : <p className="settings-notice">No sites recorded for this customer yet.</p>}
    </section>

    <section className="settings-subsection">
      <CustomerInstrumentsPanel customer={customer.name} openJob={openJob} />
    </section>

    <section className="settings-subsection">
      <h3>Quotations</h3>
      {customerQuotes.length > 0 ? <div className="erp-table-shell"><table className="erp-data-table"><thead><tr><th>Quotation</th><th>Subject</th><th>Status</th><th>Date</th></tr></thead><tbody>{customerQuotes.map((quote) => <tr key={quote.id}><td>{quote.number} R{quote.revision}</td><td>{quote.subject}</td><td>{quote.status}</td><td>{prettyDate(quote.quoteDate)}</td></tr>)}</tbody></table></div> : <p className="settings-notice">No quotations for this customer yet.</p>}
    </section>

    <section className="settings-subsection">
      <h3>Orders</h3>
      <p className="settings-notice">Orders isn't built yet — confirmed customer orders will show here once it is.</p>
    </section>

    <section className="settings-subsection">
      <h3>Jobs</h3>
      {customerJobs.length > 0 ? <div className="erp-table-shell"><table className="erp-data-table"><thead><tr><th>Job</th><th>Type</th><th>Status</th><th>Scheduled</th></tr></thead><tbody>{customerJobs.map((job) => <tr key={job.id}><td>{openJob ? <button className="erp-record-link" onClick={() => openJob(job.id)}>{job.number}</button> : job.number}</td><td>{job.type}</td><td>{job.status}</td><td>{job.scheduledDate ? prettyDate(job.scheduledDate) : "Not scheduled"}</td></tr>)}</tbody></table></div> : <p className="settings-notice">No jobs for this customer yet.</p>}
    </section>

    <section className="settings-subsection">
      <h3>Invoices</h3>
      {customerInvoices.length > 0 ? <div className="erp-table-shell"><table className="erp-data-table"><thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th>Balance</th></tr></thead><tbody>{customerInvoices.map((invoice) => { const balance = balanceOf(invoice, customerReceipts, customerTds); const docStatus = invoiceStatusFor(invoice, customerReceipts, customerTds); return <tr key={invoice.id}><td>{openInvoice ? <button className="erp-record-link" onClick={() => openInvoice(invoice.id)}>{invoice.number}</button> : invoice.number}</td><td>{prettyDate(invoice.invoiceDate)}</td><td>{docStatus}</td><td>{invoice.status === "Cancelled" ? "—" : balance > 0.005 ? money(balance) : "Nothing due"}</td></tr>; })}</tbody></table></div> : <p className="settings-notice">No invoices for this customer yet.</p>}
    </section>

    <section className="settings-subsection">
      <h3>Outstanding</h3>
      <div className="erp-summary-strip">
        <button><span>Total outstanding</span><b>{money(totalOutstanding)}</b></button>
        <button><span>Overdue invoices</span><b>{outstandingInvoices.filter((invoice) => dayDifference(invoice.dueDate) < 0).length}</b></button>
      </div>
      {outstandingInvoices.length > 0 ? <div className="erp-table-shell"><table className="erp-data-table"><thead><tr><th>Invoice</th><th>Due date</th><th>Balance</th></tr></thead><tbody>{outstandingInvoices.map((invoice) => <tr key={invoice.id}><td>{openInvoice ? <button className="erp-record-link" onClick={() => openInvoice(invoice.id)}>{invoice.number}</button> : invoice.number}</td><td className={dayDifference(invoice.dueDate) < 0 ? "invoice-overdue" : ""}>{prettyDate(invoice.dueDate)}</td><td>{money(balanceOf(invoice, customerReceipts, customerTds))}</td></tr>)}</tbody></table></div> : <p className="settings-notice">Nothing outstanding for this customer.</p>}
    </section>
  </section>;
}
