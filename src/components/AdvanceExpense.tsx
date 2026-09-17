import { useState } from "react";
import { dateIso, engineers, money, prettyDate, stamp } from "./erpMasters";
import { EXPENSE_CATEGORIES, duplicateExpenses, duplicateReference, engineerBalance, balanceStatus, resubmitExpense, reverseExpenseApproval, reversePayment, reviewExpense, submitExpense, updateStore, useErpStore, type Expense, type ExpenseCategory, type ExpensePayment, type ExpenseStatus, type PaymentKind, type SettlementMode } from "./erpStore";
import { Overlay, Pagination, useTablePage } from "./ErpUi";
import "./advanceExpense.css";

type Tab = "Overview" | "Expenses" | "Payments";
type Store = ReturnType<typeof useErpStore>;
const RECORDER = "Arun Kumar"; // prototype: one admin/accounts identity, matching the rest of the app
const statusClass = (status: string) => status.toLowerCase().replace(/ /g, "-");
const cls = (label: string) => label.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
const PAYMENT_TYPES: PaymentKind[] = ["Advance Paid", "Reimbursement Paid", "Money Returned"];
const PAYMENT_MODES: SettlementMode[] = ["Cash", "UPI", "Bank Transfer"];
const STATUSES: ExpenseStatus[] = ["Draft", "Pending Approval", "Changes Requested", "Approved", "Rejected"];
const submitLabel = (type: PaymentKind) => type === "Advance Paid" ? "Record Advance" : type === "Reimbursement Paid" ? "Record Reimbursement" : "Record Return";

function balanceLine(balance: number, pendingClaims: number) {
  const status = balanceStatus(balance, pendingClaims);
  if (status === "With engineer") return `${money(balance)} with engineer`;
  if (status === "To reimburse") return `${money(Math.abs(balance))} to reimburse`;
  return status;
}
function billSummary(expense: Pick<Expense, "billFiles" | "billMissingReason">) {
  if (expense.billFiles.length) return `${expense.billFiles.length} file${expense.billFiles.length === 1 ? "" : "s"}`;
  if (expense.billMissingReason) return "Missing — reason on file";
  return "—";
}

export default function AdvanceExpense({ focusEngineer }: { focusEngineer?: string } = {}) {
  const store = useErpStore();
  const [tab, setTab] = useState<Tab>("Overview");
  const [toast, setToast] = useState("");
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 4000); };
  const [payFor, setPayFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  return <section className="leads-page expense-page">
    <div className="leads-heading"><div><p className="erp-secondary-text">People / Advance &amp; Expense</p><h1>Advance &amp; Expense</h1><p className="erp-secondary-text mt-1">Engineer advances, expense claims and settlement payments.</p></div>
      <div className="leads-actions">{tab === "Expenses" && <button className="erp-action" onClick={() => setAdding(true)}>+ Add Expense</button>}<button className="settings-outline" onClick={() => setPayFor("")}>Record Payment</button></div>
    </div>
    <div className="stock-tabs job-tabs">{(["Overview", "Expenses", "Payments"] as Tab[]).map((entry) => <button key={entry} className={tab === entry ? "is-active" : ""} onClick={() => setTab(entry)}>{entry}</button>)}</div>
    {tab === "Overview" && <OverviewView store={store} openPay={setPayFor} initialEngineer={focusEngineer} />}
    {tab === "Expenses" && <ExpensesView store={store} flash={flash} />}
    {tab === "Payments" && <PaymentsView store={store} flash={flash} />}
    {adding && <NewExpenseForm store={store} close={() => setAdding(false)} flash={flash} />}
    {payFor !== null && <RecordPaymentForm store={store} initialEngineer={payFor} close={() => setPayFor(null)} flash={flash} />}
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </section>;
}

/* ─── Overview ────────────────────────────────────────────────────── */
function OverviewView({ store, openPay, initialEngineer }: { store: Store; openPay: (engineer: string) => void; initialEngineer?: string }) {
  const [query, setQuery] = useState("");
  const [balanceFilter, setBalanceFilter] = useState("All");
  const [sort, setSort] = useState("attention");
  const [openEngineer, setOpenEngineer] = useState<string | null>(initialEngineer ?? null);
  const allRows = engineers.map((engineer) => ({ engineer: engineer.name, ...engineerBalance(store.expenses, store.advancePayments, engineer.name) }));
  const bucket = (row: (typeof allRows)[number]) => { const status = balanceStatus(row.balance, row.pendingClaims); return status === "With engineer" ? "With Engineer" : status === "To reimburse" ? "To Reimburse" : "Settled"; };
  const rows = allRows.filter((row) => row.engineer.toLowerCase().includes(query.toLowerCase()) && (balanceFilter === "All" || bucket(row) === balanceFilter))
    .sort((a, b) => sort === "name" ? a.engineer.localeCompare(b.engineer) : sort === "balance" ? Math.abs(b.balance) - Math.abs(a.balance) : (Math.abs(b.balance) + b.pendingClaims > 0 ? 1 : 0) - (Math.abs(a.balance) + a.pendingClaims > 0 ? 1 : 0) || Math.abs(b.balance) - Math.abs(a.balance));
  const { pageRows, page, setPage } = useTablePage(rows, `${query}|${balanceFilter}|${sort}`);
  const clear = () => { setQuery(""); setBalanceFilter("All"); };
  const active = Boolean(query || balanceFilter !== "All");
  const totals = allRows.reduce((sum, row) => ({ withEngineer: sum.withEngineer + Math.max(0, row.balance), toReimburse: sum.toReimburse + Math.max(0, -row.balance), pending: sum.pending + row.pendingClaims }), { withEngineer: 0, toReimburse: 0, pending: 0 });
  return <>
    <div className="erp-summary-strip expense-summary"><div><span>Total with engineers</span><b>{money(totals.withEngineer)}</b></div><div><span>Total to reimburse</span><b>{money(totals.toReimburse)}</b></div><div><span>Pending claims</span><b>{money(totals.pending)}</b></div></div>
    <div className="erp-filters expense-filters"><label className="expense-search"><span>Search engineer</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name" /></label><label><span>Balance</span><select value={balanceFilter} onChange={(event) => setBalanceFilter(event.target.value)}><option>All</option><option>With Engineer</option><option>To Reimburse</option><option>Settled</option></select></label></div>
    <div className="erp-filter-summary"><span>{rows.length} of {engineers.length} engineers{active && ` · ${[query && `Name: ${query}`, balanceFilter !== "All" && balanceFilter].filter(Boolean).join(" · ")}`}</span><div className="expense-inline-actions">{active && <button className="settings-link" onClick={clear}>Clear all</button>}<label>Sort by <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="attention">Attention first</option><option value="balance">Largest balance</option><option value="name">Engineer A–Z</option></select></label></div></div>
    <div className="erp-table-shell"><table className="erp-data-table expense-overview-table"><colgroup><col style={{ width: "20%" }} /><col style={{ width: "14%" }} /><col style={{ width: "14%" }} /><col style={{ width: "14%" }} /><col style={{ width: "20%" }} /><col style={{ width: "18%" }} /></colgroup><thead><tr><th>Engineer</th><th className="number">Advances Paid</th><th className="number">Approved Expenses</th><th className="number">Pending Claims</th><th>Balance</th><th>Action</th></tr></thead><tbody>{pageRows.map((row) => <tr key={row.engineer} className="erp-row-clickable" onClick={() => setOpenEngineer(row.engineer)}>
      <td><b>{row.engineer}</b></td>
      <td className="number">{money(row.advancesPaid)}</td>
      <td className="number">{money(row.approvedExpenses)}</td>
      <td className="number">{row.pendingClaims ? money(row.pendingClaims) : <span className="erp-muted">—</span>}</td>
      <td><span className={`expense-balance expense-balance--${cls(balanceStatus(row.balance, row.pendingClaims))}`}>{balanceLine(row.balance, row.pendingClaims)}</span></td>
      <td><button className="settings-link" onClick={(event) => { event.stopPropagation(); openPay(row.engineer); }}>Record Payment</button></td>
    </tr>)}</tbody></table>{!rows.length && <div className="settings-empty"><b>No engineers match</b><p>Try a different search or clear the filters.</p><button className="settings-outline" onClick={clear}>Clear filters</button></div>}</div>
    <Pagination total={rows.length} page={page} onPage={setPage} />
    {openEngineer && <EngineerDrawer store={store} engineer={openEngineer} close={() => setOpenEngineer(null)} openPay={openPay} />}
  </>;
}

function EngineerDrawer({ store, engineer, close, openPay }: { store: Store; engineer: string; close: () => void; openPay: (engineer: string) => void }) {
  const stats = engineerBalance(store.expenses, store.advancePayments, engineer);
  const status = balanceStatus(stats.balance, stats.pendingClaims);
  const mine = store.expenses.filter((e) => e.engineer === engineer).sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
  const pending = mine.filter((e) => e.status === "Pending Approval" || e.status === "Changes Requested");
  const payments = store.advancePayments.filter((p) => p.engineer === engineer).sort((a, b) => b.date.localeCompare(a.date));
  return <Overlay onClose={close} label={`${engineer} advance & expense summary`} className="stock-modal-backdrop expense-overlay"><aside className="settings-drawer expense-drawer">
    <div className="settings-drawer-head"><div><p>Advance &amp; Expense</p><h2>{engineer}</h2></div><button onClick={close} aria-label="Close engineer summary">×</button></div>
    <div className="expense-drawer-actions"><button className="erp-action" onClick={() => { close(); openPay(engineer); }}>Record Payment</button></div>
    <div className="expense-drawer-body">
      <section className="erp-form-section"><h3>Balance</h3><span className={`expense-balance expense-balance--${cls(status)}`}>{balanceLine(stats.balance, stats.pendingClaims)}</span>
        <dl className="expense-breakdown"><div><dt>Advances paid</dt><dd>{money(stats.advancesPaid)}</dd></div><div><dt>Reimbursements paid</dt><dd>{money(stats.reimbursementsPaid)}</dd></div><div><dt>Money returned</dt><dd>−{money(stats.moneyReturned)}</dd></div><div><dt>Approved expenses</dt><dd>−{money(stats.approvedExpenses)}</dd></div></dl>
      </section>
      <section className="erp-form-section"><h3>Pending claims{pending.length > 0 && <span className="expense-count"> · {money(stats.pendingClaims)}</span>}</h3>
        {pending.length ? <div className="expense-mini-list">{pending.map((e) => <div key={e.id}><b>{prettyDate(e.expenseDate)} · {e.category}</b><span>{money(e.amount)} · {e.status}</span><small>{e.description}</small></div>)}</div> : <p className="erp-muted">Nothing pending.</p>}
      </section>
      <section className="erp-form-section"><h3>Expense history</h3>{mine.length ? <div className="lead-timeline quote-activity">{mine.map((e) => <div key={e.id} className={e.status === "Approved" ? "job-timeline--done" : e.status === "Rejected" ? "lead-timeline--lost" : undefined}><i /><p><b>{prettyDate(e.expenseDate)} · {e.category} · {money(e.amount)}</b><span>{e.status}{e.jobId ? ` · ${e.jobId}` : ""}</span><small>{e.description}</small></p></div>)}</div> : <p className="erp-muted">No expenses recorded.</p>}</section>
      <section className="erp-form-section"><h3>Payment history</h3>{payments.length ? <div className="lead-timeline quote-activity">{payments.map((p) => <div key={p.id} className={p.status === "Reversed" ? "lead-timeline--lost" : "job-timeline--done"}><i /><p><b>{prettyDate(p.date)} · {p.type} · {money(p.amount)}</b><span>{p.mode}{p.reference ? ` · ${p.reference}` : ""} · {p.status}</span><small>Recorded by {p.recordedBy}{p.status === "Reversed" && p.reversedReason ? ` · Reversed: ${p.reversedReason}` : ""}</small></p></div>)}</div> : <p className="erp-muted">No payments recorded.</p>}</section>
    </div>
  </aside></Overlay>;
}

/* ─── Expenses ────────────────────────────────────────────────────── */
function ExpensesView({ store, flash }: { store: Store; flash: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ExpenseStatus | "All">("Pending Approval");
  const [engineerFilter, setEngineerFilter] = useState("All engineers");
  const [dateFilter, setDateFilter] = useState("");
  const [sort, setSort] = useState("date");
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = store.expenses.filter((e) => (status === "All" || e.status === status) && (engineerFilter === "All engineers" || e.engineer === engineerFilter) && (!dateFilter || e.expenseDate === dateFilter) && `${e.engineer} ${e.category} ${e.description}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === "amount" ? b.amount - a.amount : sort === "engineer" ? a.engineer.localeCompare(b.engineer) : b.expenseDate.localeCompare(a.expenseDate));
  const { pageRows, page, setPage } = useTablePage(rows, `${query}|${status}|${engineerFilter}|${dateFilter}|${sort}`);
  const selected = store.expenses.find((e) => e.id === openId);
  const clear = () => { setQuery(""); setStatus("Pending Approval"); setEngineerFilter("All engineers"); setDateFilter(""); };
  const active = Boolean(query || status !== "Pending Approval" || engineerFilter !== "All engineers" || dateFilter);
  return <>
    <div className="erp-filters expense-filters"><label className="expense-search"><span>Search expenses</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Engineer, category or description" /></label><label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="All">All statuses</option>{STATUSES.map((entry) => <option key={entry}>{entry}</option>)}</select></label><label><span>Engineer</span><select value={engineerFilter} onChange={(event) => setEngineerFilter(event.target.value)}><option>All engineers</option>{engineers.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label><label><span>Expense date</span><input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label></div>
    <div className="erp-filter-summary"><span>{rows.length} expense{rows.length === 1 ? "" : "s"}{active && ` · ${[query && `Search: ${query}`, status !== "Pending Approval" && (status === "All" ? "All statuses" : status), engineerFilter !== "All engineers" && engineerFilter, dateFilter && prettyDate(dateFilter)].filter(Boolean).join(" · ")}`}</span><div className="expense-inline-actions">{active && <button className="settings-link" onClick={clear}>Clear all</button>}<label>Sort by <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="date">Expense date, newest first</option><option value="amount">Amount, highest first</option><option value="engineer">Engineer A–Z</option></select></label></div></div>
    <div className="erp-table-shell"><table className="erp-data-table expense-table"><colgroup><col style={{ width: "11%" }} /><col style={{ width: "14%" }} /><col style={{ width: "27%" }} /><col style={{ width: "11%" }} /><col style={{ width: "12%" }} /><col style={{ width: "13%" }} /><col style={{ width: "12%" }} /></colgroup><thead><tr><th>Expense Date</th><th>Engineer</th><th>Category / Description</th><th className="number">Amount</th><th>Bill</th><th>Status</th><th>Review</th></tr></thead><tbody>{pageRows.map((e) => { const dupes = duplicateExpenses(store.expenses, e); return <tr key={e.id} className={openId === e.id ? "is-selected" : ""}>
      <td>{prettyDate(e.expenseDate)}</td>
      <td><button className="erp-record-link" onClick={() => setOpenId(e.id)}>{e.engineer}</button></td>
      <td><b>{e.category}</b><small>{e.description}</small>{dupes.length > 0 && <small className="job-late">Possible duplicate</small>}</td>
      <td className="number">{money(e.amount)}</td>
      <td>{billSummary(e)}</td>
      <td><span className={`job-status job-status--${statusClass(e.status)}`}>{e.status}</span></td>
      <td><button className="settings-outline expense-review-button" onClick={() => setOpenId(e.id)}>{e.status === "Pending Approval" ? "Review" : "View"}</button></td>
    </tr>; })}</tbody></table>{!rows.length && <div className="settings-empty"><b>No expenses match these filters</b><p>Try another status, engineer or date.</p><button className="settings-outline" onClick={clear}>Clear filters</button></div>}</div>
    <Pagination total={rows.length} page={page} onPage={setPage} />
    {selected && <ExpenseDrawer store={store} expense={selected} close={() => setOpenId(null)} flash={flash} />}
  </>;
}

function NewExpenseForm({ store, close, flash }: { store: Store; close: () => void; flash: (message: string) => void }) {
  const [engineer, setEngineer] = useState(engineers[0].name);
  const [expenseDate, setExpenseDate] = useState(dateIso());
  const [category, setCategory] = useState<ExpenseCategory>("Travel");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [billFiles, setBillFiles] = useState<string[]>([]);
  const [billMissing, setBillMissing] = useState(false);
  const [billMissingReason, setBillMissingReason] = useState("");
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState("");
  const jobOptions = store.jobs.filter((job) => job.engineer === engineer);
  const chooseFiles = (event: React.ChangeEvent<HTMLInputElement>) => setBillFiles(Array.from(event.target.files ?? []).map((file) => file.name));
  const validate = (forDraft: boolean) => {
    if (!engineer) return "Select an engineer.";
    if (!expenseDate) return "Enter the expense date.";
    const value = Number(amount);
    if (!forDraft && (!Number.isFinite(value) || value <= 0)) return "Enter an amount greater than zero.";
    if (!forDraft && !description.trim()) return "Enter a short description.";
    if (!forDraft && !billFiles.length && !(billMissing && billMissingReason.trim())) return "Attach a bill, or mark the bill unavailable with a reason.";
    if (billMissing && !billMissingReason.trim()) return "Enter a reason the bill is unavailable.";
    return "";
  };
  const submit = (asDraft: boolean) => {
    const problem = validate(asDraft);
    if (problem) { setError(problem); return; }
    const id = `EXP-${Date.now()}`;
    const expense: Expense = { id, engineer, submittedBy: RECORDER, expenseDate, category, amount: Number(amount) || 0, description: description.trim(), billFiles, billMissingReason: billMissing ? billMissingReason.trim() : undefined, jobId: jobId || undefined, status: asDraft ? "Draft" : "Pending Approval", submittedAt: stamp(), history: [{ action: asDraft ? "Saved as draft" : "Submitted", at: stamp(), by: RECORDER }] };
    updateStore((current) => submitExpense(current, expense));
    close(); flash(asDraft ? `${id} saved as a draft.` : `${id} submitted for approval.`);
  };
  return <Overlay label="Add Expense" onClose={close}><section className="stock-move-modal expense-form-modal"><header className="jobs-form-header"><div><h2>Add Expense</h2><p>On behalf of an engineer</p></div><button className="settings-outline" aria-label="Close" onClick={close}>×</button></header><div className="jobs-form-body">
    <div className="quote-header-grid ci-form-grid">
      <label><span>Engineer <b className="lead-required">Required</b></span><select value={engineer} onChange={(event) => { setEngineer(event.target.value); setJobId(""); }}>{engineers.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label>
      <label><span>Expense date <b className="lead-required">Required</b></span><input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></label>
      <label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value as ExpenseCategory)}>{EXPENSE_CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
      <label><span>Amount (₹)</span><input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label><span>Job / customer (optional)</span><select value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="">Not linked</option>{jobOptions.map((job) => <option key={job.id} value={job.id}>{job.number} · {job.customer}</option>)}</select></label>
      <label className="quote-grid-wide"><span>Short description</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What was this for?" /></label>
    </div>
    <label className="expense-file-field"><span>Bill attachment(s)</span><input type="file" accept="image/*,application/pdf" multiple onChange={chooseFiles} />{billFiles.length > 0 && <small>{billFiles.join(", ")}</small>}</label>
    <label className="settings-check"><input type="checkbox" checked={billMissing} onChange={(event) => setBillMissing(event.target.checked)} /><span>Bill unavailable</span></label>
    {billMissing && <label className="due-notes"><span>Reason <b className="lead-required">Required</b></span><textarea value={billMissingReason} onChange={(event) => setBillMissingReason(event.target.value)} placeholder="Why there is no bill for this expense" /></label>}
    {error && <p className="jobs-form-error" role="alert">{error}</p>}
  </div><footer className="jobs-form-footer"><button className="settings-outline" onClick={close}>Cancel</button><div className="expense-inline-actions"><button className="settings-outline" onClick={() => submit(true)}>Save as Draft</button><button className="erp-action" onClick={() => submit(false)}>Submit for Approval</button></div></footer></section></Overlay>;
}

function ExpenseDrawer({ store, expense, close, flash }: { store: Store; expense: Expense; close: () => void; flash: (message: string) => void }) {
  const [decision, setDecision] = useState<"Send Back" | "Reject" | "Reverse" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const dupes = duplicateExpenses(store.expenses, expense);
  const job = expense.jobId ? store.jobs.find((entry) => entry.id === expense.jobId) : undefined;
  const approve = () => { updateStore((current) => reviewExpense(current, expense.id, "Approved", RECORDER)); flash(`${expense.id} approved. Balance updated.`); };
  const confirmDecision = () => {
    if (!reason.trim()) { setError("Enter a reason."); return; }
    if (decision === "Send Back") updateStore((current) => reviewExpense(current, expense.id, "Changes Requested", RECORDER, reason.trim()));
    else if (decision === "Reject") updateStore((current) => reviewExpense(current, expense.id, "Rejected", RECORDER, reason.trim()));
    else if (decision === "Reverse") updateStore((current) => reverseExpenseApproval(current, expense.id, RECORDER, reason.trim()));
    flash(decision === "Reverse" ? `${expense.id} approval reversed — back in Changes Requested.` : `${expense.id} ${decision === "Send Back" ? "sent back" : "rejected"}.`);
    setDecision(null); setReason(""); setError("");
  };
  return <Overlay onClose={close} label={`Review ${expense.id}`} className="stock-modal-backdrop expense-overlay"><aside className="settings-drawer expense-drawer expense-review-drawer">
    <div className="settings-drawer-head"><div><p>{expense.id} · {expense.status}</p><h2>{expense.engineer}</h2></div><button onClick={close} aria-label="Close expense review">×</button></div>
    <div className="expense-drawer-body expense-review-layout">
      <section className="expense-bill-pane"><h3>Bill</h3>
        {expense.billFiles.length ? <div className="expense-bill-files">{expense.billFiles.map((file, index) => file.startsWith("blob:") ? <a key={index} href={file} target="_blank" rel="noreferrer"><img src={file} alt={`Bill ${index + 1}`} /></a> : <div key={index} className="expense-bill-mock"><span>📎</span><small>{file}</small><em>Mock attachment — not stored in this prototype</em></div>)}</div>
          : <p className="expense-warning">Bill unavailable{expense.billMissingReason ? `: ${expense.billMissingReason}` : "."}</p>}
      </section>
      <section className="expense-detail-pane">
        <section className="erp-form-section"><h3>Expense details</h3><dl className="invoice-facts due-facts">
          <div><dt>Submitted by</dt><dd>{expense.submittedBy}</dd></div><div><dt>Submitted</dt><dd>{expense.submittedAt ?? "—"}</dd></div>
          <div><dt>Expense date</dt><dd>{prettyDate(expense.expenseDate)}</dd></div><div><dt>Category</dt><dd>{expense.category}</dd></div>
          <div><dt>Amount</dt><dd>{money(expense.amount)}</dd></div><div><dt>Job / customer</dt><dd>{job ? `${job.number} · ${job.customer}` : "Not linked"}</dd></div>
          <div className="invoice-fact-wide"><dt>Description</dt><dd>{expense.description}</dd></div>
        </dl></section>
        {dupes.length > 0 && <section className="erp-form-section"><p className="expense-warning">Possible duplicate: {expense.engineer} already has {dupes.length} other expense{dupes.length === 1 ? "" : "s"} for {money(expense.amount)} on {prettyDate(expense.expenseDate)}. Review before approving.</p></section>}
        <section className="erp-form-section"><h3>Review history</h3><div className="lead-timeline quote-activity">{expense.history.map((entry, index) => <div key={index}><i /><p><b>{entry.action}</b><span>{entry.at} · {entry.by}</span>{entry.reason && <small>{entry.reason}</small>}</p></div>)}</div></section>
        {editing && <ResubmitFields store={store} expense={expense} close={() => setEditing(false)} flash={flash} closeDrawer={close} />}
        {decision && <section className="erp-form-section"><label className="due-notes"><span>Reason <b className="lead-required">Required</b></span><textarea value={reason} onChange={(event) => setReason(event.target.value)} autoFocus /></label>{error && <p className="jobs-form-error" role="alert">{error}</p>}<div className="expense-inline-actions"><button className="settings-outline" onClick={() => { setDecision(null); setReason(""); setError(""); }}>Cancel</button><button className="erp-action" onClick={confirmDecision}>Confirm {decision}</button></div></section>}
      </section>
    </div>
    {!decision && !editing && <footer className="attendance-drawer-footer">
      {expense.status === "Pending Approval" && <><button className="settings-outline" onClick={() => setDecision("Send Back")}>Send Back</button><button className="settings-outline" onClick={() => setDecision("Reject")}>Reject</button><button className="erp-action" onClick={approve}>Approve</button></>}
      {expense.status === "Changes Requested" && <button className="erp-action" onClick={() => setEditing(true)}>Edit &amp; Resubmit</button>}
      {expense.status === "Approved" && <button className="settings-outline" onClick={() => setDecision("Reverse")}>Reverse Approval</button>}
      {(expense.status === "Rejected" || expense.status === "Draft") && <button className="settings-outline" onClick={close}>Close</button>}
    </footer>}
  </aside></Overlay>;
}

function ResubmitFields({ store, expense, close, flash, closeDrawer }: { store: Store; expense: Expense; close: () => void; flash: (message: string) => void; closeDrawer: () => void }) {
  const [category, setCategory] = useState(expense.category);
  const [amount, setAmount] = useState(String(expense.amount));
  const [description, setDescription] = useState(expense.description);
  const [billFiles, setBillFiles] = useState(expense.billFiles);
  const [jobId, setJobId] = useState(expense.jobId ?? "");
  const [error, setError] = useState("");
  const jobOptions = store.jobs.filter((job) => job.engineer === expense.engineer);
  const submit = () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) { setError("Enter an amount greater than zero."); return; }
    if (!description.trim()) { setError("Enter a short description."); return; }
    if (!billFiles.length && !expense.billMissingReason) { setError("Attach a bill, or note why it is unavailable."); return; }
    updateStore((current) => resubmitExpense(current, expense.id, { category, amount: value, description: description.trim(), billFiles, billMissingReason: expense.billMissingReason, jobId: jobId || undefined }));
    close(); closeDrawer(); flash(`${expense.id} corrected and resubmitted for approval.`);
  };
  return <section className="erp-form-section expense-resubmit"><h3>Correct and resubmit</h3><div className="quote-header-grid ci-form-grid">
    <label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value as ExpenseCategory)}>{EXPENSE_CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
    <label><span>Amount (₹)</span><input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
    <label><span>Job / customer</span><select value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="">Not linked</option>{jobOptions.map((job) => <option key={job.id} value={job.id}>{job.number} · {job.customer}</option>)}</select></label>
    <label className="quote-grid-wide"><span>Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <label className="expense-file-field quote-grid-wide"><span>Replace bill attachment(s)</span><input type="file" accept="image/*,application/pdf" multiple onChange={(event) => setBillFiles(Array.from(event.target.files ?? []).map((file) => file.name))} />{billFiles.length > 0 && <small>{billFiles.join(", ")}</small>}</label>
  </div>{error && <p className="jobs-form-error" role="alert">{error}</p>}<div className="expense-inline-actions"><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={submit}>Resubmit</button></div></section>;
}

/* ─── Payments ────────────────────────────────────────────────────── */
function PaymentsView({ store, flash }: { store: Store; flash: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<PaymentKind | "All">("All");
  const [engineerFilter, setEngineerFilter] = useState("All engineers");
  const [sort, setSort] = useState("date");
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = store.advancePayments.filter((p) => (type === "All" || p.type === type) && (engineerFilter === "All engineers" || p.engineer === engineerFilter) && `${p.engineer} ${p.reference ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === "amount" ? b.amount - a.amount : sort === "engineer" ? a.engineer.localeCompare(b.engineer) : b.date.localeCompare(a.date));
  const { pageRows, page, setPage } = useTablePage(rows, `${query}|${type}|${engineerFilter}|${sort}`);
  const selected = store.advancePayments.find((p) => p.id === openId);
  const clear = () => { setQuery(""); setType("All"); setEngineerFilter("All engineers"); };
  const active = Boolean(query || type !== "All" || engineerFilter !== "All engineers");
  return <>
    <div className="erp-filters expense-filters"><label className="expense-search"><span>Search payments</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Engineer or reference" /></label><label><span>Payment type</span><select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="All">All types</option>{PAYMENT_TYPES.map((entry) => <option key={entry}>{entry}</option>)}</select></label><label><span>Engineer</span><select value={engineerFilter} onChange={(event) => setEngineerFilter(event.target.value)}><option>All engineers</option>{engineers.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label></div>
    <div className="erp-filter-summary"><span>{rows.length} of {store.advancePayments.length} payments{active && ` · ${[query && `Search: ${query}`, type !== "All" && type, engineerFilter !== "All engineers" && engineerFilter].filter(Boolean).join(" · ")}`}</span><div className="expense-inline-actions">{active && <button className="settings-link" onClick={clear}>Clear all</button>}<label>Sort by <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="date">Latest first</option><option value="amount">Amount, highest first</option><option value="engineer">Engineer A–Z</option></select></label></div></div>
    <div className="erp-table-shell"><table className="erp-data-table expense-payments-table"><colgroup><col style={{ width: "11%" }} /><col style={{ width: "14%" }} /><col style={{ width: "15%" }} /><col style={{ width: "11%" }} /><col style={{ width: "10%" }} /><col style={{ width: "14%" }} /><col style={{ width: "13%" }} /><col style={{ width: "12%" }} /></colgroup><thead><tr><th>Date</th><th>Engineer</th><th>Payment Type</th><th className="number">Amount</th><th>Mode</th><th>Reference</th><th>Recorded By</th><th>Status</th></tr></thead><tbody>{pageRows.map((p) => { const dupeRef = duplicateReference(store.advancePayments, p.reference ?? "", p.id); return <tr key={p.id} className="erp-row-clickable" onClick={() => setOpenId(p.id)}>
      <td>{prettyDate(p.date)}</td><td><b>{p.engineer}</b></td><td>{p.type}</td><td className="number">{money(p.amount)}</td><td>{p.mode}</td>
      <td>{p.reference || <span className="erp-muted">—</span>}{dupeRef.length > 0 && p.status !== "Reversed" && <small className="job-late">Repeated reference</small>}</td>
      <td>{p.recordedBy}</td><td><span className={`job-status job-status--${p.status === "Reversed" ? "cancelled" : "completed"}`}>{p.status}</span></td>
    </tr>; })}</tbody></table>{!rows.length && <div className="settings-empty"><b>No payments match these filters</b><p>Try another type, engineer or search.</p><button className="settings-outline" onClick={clear}>Clear filters</button></div>}</div>
    <Pagination total={rows.length} page={page} onPage={setPage} />
    {selected && <PaymentDrawer store={store} payment={selected} close={() => setOpenId(null)} flash={flash} />}
  </>;
}

function PaymentDrawer({ store, payment, close, flash }: { store: Store; payment: ExpensePayment; close: () => void; flash: (message: string) => void }) {
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const job = payment.jobId ? store.jobs.find((entry) => entry.id === payment.jobId) : undefined;
  const confirmReverse = () => {
    if (!reason.trim()) { setError("Enter a reason for the reversal."); return; }
    updateStore((current) => reversePayment(current, payment.id, RECORDER, reason.trim()));
    flash(`${payment.id} marked as reversed. This does not reverse an actual bank/UPI transfer.`); close();
  };
  return <Overlay onClose={close} label={`Payment ${payment.id}`} className="stock-modal-backdrop expense-overlay"><aside className="settings-drawer expense-drawer">
    <div className="settings-drawer-head"><div><p>{payment.id} · {payment.status}</p><h2>{payment.type} · {payment.engineer}</h2></div><button onClick={close} aria-label="Close payment details">×</button></div>
    <div className="expense-drawer-body">
      <section className="erp-form-section"><h3>Payment details</h3><dl className="invoice-facts due-facts">
        <div><dt>Amount</dt><dd>{money(payment.amount)}</dd></div><div><dt>Date</dt><dd>{prettyDate(payment.date)}</dd></div>
        <div><dt>Mode</dt><dd>{payment.mode}</dd></div><div><dt>Reference</dt><dd>{payment.reference || "Not recorded"}</dd></div>
        <div><dt>Job / customer</dt><dd>{job ? `${job.number} · ${job.customer}` : "Not linked"}</dd></div><div><dt>Recorded by</dt><dd>{payment.recordedBy} · {payment.recordedAt}</dd></div>
        {payment.notes && <div className="invoice-fact-wide"><dt>Notes</dt><dd>{payment.notes}</dd></div>}
        {payment.overrideReason && <div className="invoice-fact-wide"><dt>Override reason</dt><dd>{payment.overrideReason}</dd></div>}
      </dl></section>
      {payment.status === "Reversed" && <section className="erp-form-section"><p className="expense-warning">Reversed by {payment.reversedBy} · {payment.reversedAt}<br />{payment.reversedReason}</p><p className="erp-muted">This marks the record as reversed for balance purposes only — it does not undo an actual bank or UPI transfer.</p></section>}
      {reversing && <section className="erp-form-section"><label className="due-notes"><span>Reason <b className="lead-required">Required</b></span><textarea value={reason} onChange={(event) => setReason(event.target.value)} autoFocus /></label>{error && <p className="jobs-form-error" role="alert">{error}</p>}<div className="expense-inline-actions"><button className="settings-outline" onClick={() => { setReversing(false); setReason(""); setError(""); }}>Cancel</button><button className="erp-action" onClick={confirmReverse}>Confirm reversal</button></div></section>}
    </div>
    {!reversing && payment.status === "Posted" && <footer className="attendance-drawer-footer"><button className="settings-outline" onClick={() => setReversing(true)}>Reverse Payment</button></footer>}
  </aside></Overlay>;
}

function RecordPaymentForm({ store, initialEngineer, close, flash }: { store: Store; initialEngineer: string; close: () => void; flash: (message: string) => void }) {
  const [engineer, setEngineer] = useState(initialEngineer || engineers[0].name);
  const [type, setType] = useState<PaymentKind>("Advance Paid");
  const stats = engineerBalance(store.expenses, store.advancePayments, engineer);
  const suggested = type === "Reimbursement Paid" ? Math.max(0, -stats.balance) : type === "Money Returned" ? Math.max(0, stats.balance) : 0;
  const [amount, setAmount] = useState(suggested ? String(suggested) : "");
  const [date, setDate] = useState(dateIso());
  const [mode, setMode] = useState<SettlementMode>("Cash");
  const [reference, setReference] = useState("");
  const [jobId, setJobId] = useState("");
  const [notes, setNotes] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const changeType = (next: PaymentKind) => { setType(next); const value = next === "Reimbursement Paid" ? Math.max(0, -stats.balance) : next === "Money Returned" ? Math.max(0, stats.balance) : 0; setAmount(value ? String(value) : ""); setOverrideReason(""); };
  const changeEngineer = (name: string) => { setEngineer(name); const next = engineerBalance(store.expenses, store.advancePayments, name); const value = type === "Reimbursement Paid" ? Math.max(0, -next.balance) : type === "Money Returned" ? Math.max(0, next.balance) : 0; setAmount(value ? String(value) : ""); };
  const value = Number(amount) || 0;
  const projected = type === "Advance Paid" ? stats.balance + value : type === "Reimbursement Paid" ? stats.balance + value : stats.balance - value;
  const outstanding = type === "Reimbursement Paid" ? Math.max(0, -stats.balance) : type === "Money Returned" ? Math.max(0, stats.balance) : undefined;
  const exceeds = outstanding !== undefined && value > outstanding + 0.005;
  const jobOptions = store.jobs.filter((job) => job.engineer === engineer);
  const dupeRef = duplicateReference(store.advancePayments, reference);
  const submit = () => {
    if (submitting) return;
    if (!Number.isFinite(value) || value <= 0) { setError("Enter an amount greater than zero."); return; }
    if (!date) { setError("Enter the actual payment date."); return; }
    if (exceeds && !overrideReason.trim()) { setError(`This exceeds the ${type === "Money Returned" ? "amount currently with the engineer" : "outstanding reimbursement"} (${money(outstanding ?? 0)}). Enter a reason to record it anyway, or record the extra separately as a new Advance Paid.`); return; }
    setSubmitting(true);
    const id = `PAY-${Date.now()}`;
    const payment: ExpensePayment = { id, engineer, type, amount: value, date, mode, reference: reference.trim() || undefined, jobId: jobId || undefined, notes: notes.trim() || undefined, overrideReason: exceeds ? overrideReason.trim() : undefined, recordedBy: RECORDER, recordedAt: stamp(), status: "Posted" };
    updateStore((current) => ({ advancePayments: [payment, ...current.advancePayments] }));
    close(); flash(`${id} recorded — ${type} of ${money(value)} for ${engineer}.`);
  };
  return <Overlay label="Record Payment" onClose={close}><section className="stock-move-modal expense-form-modal"><header className="jobs-form-header"><div><h2>Record Payment</h2><p>Records money already paid or returned — this does not move money.</p></div><button className="settings-outline" aria-label="Close" onClick={close}>×</button></header><div className="jobs-form-body">
    <div className="expense-type-toggle">{PAYMENT_TYPES.map((entry) => <button key={entry} className={type === entry ? "is-active" : ""} onClick={() => changeType(entry)}>{entry}</button>)}</div>
    <div className="quote-header-grid ci-form-grid">
      <label><span>Engineer <b className="lead-required">Required</b></span><select value={engineer} onChange={(event) => changeEngineer(event.target.value)}>{engineers.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label>
      <label><span>Amount (₹)</span><input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label><span>Actual payment date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label><span>Payment mode</span><select value={mode} onChange={(event) => setMode(event.target.value as SettlementMode)}>{PAYMENT_MODES.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
      <label><span>Transaction reference (optional)</span><input value={reference} onChange={(event) => setReference(event.target.value)} /></label>
      <label><span>Job / customer (optional)</span><select value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="">Not linked</option>{jobOptions.map((job) => <option key={job.id} value={job.id}>{job.number} · {job.customer}</option>)}</select></label>
      <label className="quote-grid-wide"><span>Notes (optional)</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    </div>
    {dupeRef.length > 0 && <p className="expense-warning">This reference has been used before ({dupeRef.length} other payment{dupeRef.length === 1 ? "" : "s"}). References aren't guaranteed unique — check it isn't a duplicate entry.</p>}
    <div className="expense-balance-preview"><div><span>Current balance</span><b className={`expense-balance expense-balance--${cls(balanceStatus(stats.balance, stats.pendingClaims))}`}>{balanceLine(stats.balance, stats.pendingClaims)}</b></div><div><span>Projected after this payment</span><b className={`expense-balance expense-balance--${cls(balanceStatus(projected, stats.pendingClaims))}`}>{balanceLine(projected, stats.pendingClaims)}</b></div></div>
    {exceeds && <label className="due-notes expense-override"><span>This exceeds the {type === "Money Returned" ? "amount currently with the engineer" : "outstanding reimbursement"} ({money(outstanding ?? 0)}). Reason to record anyway <b className="lead-required">Required</b></span><textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Or cancel and record the extra as a new Advance Paid" /></label>}
    {error && <p className="jobs-form-error" role="alert">{error}</p>}
  </div><footer className="jobs-form-footer"><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" disabled={submitting} onClick={submit}>{submitLabel(type)}</button></footer></section></Overlay>;
}
