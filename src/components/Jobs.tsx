import { useMemo, useState } from "react";
import { ATTENDANCE_SETTINGS, ENGINEER, JOB_TYPES, addDaysIso, customerSites, dateIso, dayDifference, engineers, istStamp, istTime, label12h, metersBetween, nowIso, prettyDate, siteById, stamp } from "./erpMasters";
import spmLogo from "@/imports/SPM_Logo.png";
import { COMPANY } from "./erpMasters";
import { invoiceFromJob, nextNumber as nextInvoiceNumber } from "./Invoices";
import {
  adjustBalance, applyVisitStamp, balanceAt, billingStatusOf, blockedOn, computeVisitStatus, jobFullyResolved, masterExpired, masterNextDue, openJobFor, receiveInLabJob, returnInLabJob, updateStore, useErpStore, visitWindow, visitsOn,
  type GeoPoint, type Job, type JobResult, type JobStatus, type JobType, type LocationCheck, type StockMove, type VisitOutcome, type VisitRow, type VisitStamp,
} from "./erpStore";
import { Overlay, Pagination, useTablePage } from "./ErpUi";
import "./jobs.css";

const STATUS_TABS: (JobStatus | "All Jobs")[] = ["All Jobs", "Unassigned", "Scheduled", "In progress", "On hold", "Completed", "Cancelled"];
const statusClass = (status: JobStatus) => `job-status job-status--${status.toLowerCase().replace(/ /g, "-")}`;
const isLate = (job: Job) => Boolean(job.scheduledDate) && job.status !== "Completed" && job.status !== "Cancelled" && dayDifference(job.scheduledDate) < 0;
const nextJobNumber = (jobs: Job[]) => `JOB-${Math.max(1041, ...jobs.map((job) => Number(job.number.split("-")[1]) || 0)) + 1}`;
const sameCity = (a?: string, b?: string) => a?.toLowerCase() === b?.toLowerCase();
const scheduledLabel = (job: Job) => job.scheduledDate ? prettyDate(job.scheduledDate) : "Not scheduled";
const needsCertificate = (type: JobType) => type === "Calibration" || type === "Validation/Testing";

function blankJob(number: string, overrides?: Partial<Job>): Job {
  return { id: number, number, type: "Calibration", customer: "", siteId: "", instrumentIds: [], stockIds: [], description: "", doneAt: "Site visit", scheduledDate: "", hours: 2, status: "Unassigned", expectedSpares: [], usedSpares: [], results: [], travelNotes: "", photos: 0, activities: [{ title: "Job created", meta: stamp(), tone: "system" }], ...overrides };
}

export default function Jobs({ isEngineer = false, focusJob, newJobPrefill, openInvoice }: { isEngineer?: boolean; focusJob?: string; newJobPrefill?: Partial<Job>; openInvoice?: (invoiceId: string) => void }) {
  const store = useErpStore();
  const [section, setSection] = useState<"list" | "today">("list");
  const [tab, setTab] = useState<JobStatus | "All Jobs">("All Jobs");
  const [billing, setBilling] = useState("All billing statuses");
  const [openId, setOpenId] = useState<string | null>(focusJob ?? null);
  const [assignId, setAssignId] = useState<string | null>(null);
  const [creating, setCreating] = useState(() => Boolean(newJobPrefill));
  const [toast, setToast] = useState("");
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 4200); };
  const [query, setQuery] = useState("");
  const [filterEngineer, setFilterEngineer] = useState("All engineers");
  const [filterDate, setFilterDate] = useState("");
  const [sort, setSort] = useState("date");
  const [more, setMore] = useState(false);
  const mine = useMemo(() => isEngineer ? store.jobs.filter((job) => job.engineer === ENGINEER) : store.jobs, [isEngineer, store.jobs]);
  const open = store.jobs.find((job) => job.id === openId);
  const assignJob = store.jobs.find((job) => job.id === assignId);
  const countFor = (status: JobStatus | "All Jobs") => status === "All Jobs" ? mine.length : mine.filter((job) => job.status === status).length;
  const rows = useMemo(() => mine.filter((job) => tab === "All Jobs" || job.status === tab)
    .filter((job) => billing === "All billing statuses" || billingStatusOf(job) === billing)
    .filter((job) => !query || `${job.number} ${job.customer} ${job.type} ${job.engineer ?? ""} ${siteById(job.siteId)?.name ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .filter((job) => filterEngineer === "All engineers" || (filterEngineer === "Unassigned" ? !job.engineer : job.engineer === filterEngineer))
    .filter((job) => !filterDate || job.scheduledDate === filterDate || job.requiredDate === filterDate)
    .sort((a, b) => sort === "customer" ? a.customer.localeCompare(b.customer) : sort === "newest" ? b.number.localeCompare(a.number) : (a.scheduledDate || a.requiredDate || "9999").localeCompare(b.scheduledDate || b.requiredDate || "9999")), [mine, tab, billing, query, filterEngineer, filterDate, sort]);
  const { pageRows, page, setPage } = useTablePage(rows, `${tab}|${billing}|${query}|${filterEngineer}|${filterDate}|${sort}`);
  const active = [tab !== "All Jobs" && tab, query && `Search: ${query}`, filterEngineer !== "All engineers" && filterEngineer, filterDate && prettyDate(filterDate), billing !== "All billing statuses" && billing].filter(Boolean);
  const clear = () => { setTab("All Jobs"); setQuery(""); setFilterEngineer("All engineers"); setFilterDate(""); setBilling("All billing statuses"); };
  const todaysJobs = useMemo(() => mine.filter((job) => job.scheduledDate === dateIso()), [mine]);
  if (isEngineer) return <section className="leads-page jobs-page">
    <div className="leads-heading"><div><p className="erp-secondary-text">Operations / Jobs</p><h1>Today's Jobs</h1></div></div>
    <EngineerToday jobs={todaysJobs} openJob={setOpenId} />
    {open && <Overlay label={`${open.number} details`} onClose={() => setOpenId(null)} className="stock-modal-backdrop jobs-drawer-backdrop"><div className="jobs-detail-drawer"><JobRecord job={open} store={store} isEngineer close={() => setOpenId(null)} flash={flash} /></div></Overlay>}
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </section>;
  return <section className="leads-page jobs-page">
    <div className="leads-heading"><div><p className="erp-secondary-text">Operations / Jobs</p><h1>Jobs</h1></div><button className="erp-action" onClick={() => setCreating(true)}>+ New Job</button></div>
    <div className="stock-tabs jobs-view-tabs">{(["list", "today"] as const).map((view) => <button key={view} className={section === view ? "is-active" : ""} onClick={() => setSection(view)}>{view === "list" ? "Jobs List" : "Today"}</button>)}</div>
    {section === "today" ? <JobsToday store={store} openJob={setOpenId} /> : <>
      <div className="stock-tabs job-tabs">{STATUS_TABS.map((status) => <button key={status} className={tab === status ? "is-active" : ""} onClick={() => setTab(status)}>{status} <span>{countFor(status)}</span></button>)}</div>
      <div className="erp-filters jobs-filters">
        <label className="jobs-search"><span>Search</span><input placeholder="Job, customer or site" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {!isEngineer && <label><span>Engineer</span><select value={filterEngineer} onChange={(event) => setFilterEngineer(event.target.value)}><option>All engineers</option><option>Unassigned</option>{engineers.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label>}
        <label><span>Required / scheduled date</span><input type="date" value={filterDate} onChange={(event) => setFilterDate(event.target.value)} /></label>
        <button className="settings-outline" aria-expanded={more} onClick={() => setMore(!more)}>More filters{billing !== "All billing statuses" ? " (1)" : ""}</button>
      </div>
      {more && <div className="erp-filters jobs-extra-filters"><label><span>Billing status</span><select value={billing} onChange={(event) => setBilling(event.target.value)}>{["All billing statuses", "To invoice", "Invoiced", "Not applicable"].map((value) => <option key={value}>{value}</option>)}</select></label></div>}
      <div className="erp-filter-summary"><span>{rows.length} job{rows.length === 1 ? "" : "s"}{active.length ? ` · ${active.join(" · ")}` : ""}</span><div className="jobs-inline-actions">{active.length > 0 && <button className="erp-record-link" onClick={clear}>Clear all</button>}<label className="jobs-sort">Sort <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="date">Date, earliest first</option><option value="newest">Job number, newest first</option><option value="customer">Customer A–Z</option></select></label></div></div>
      <div className="erp-table-shell"><table className="erp-data-table jobs-register leads-style-table"><colgroup><col style={{ width: "15%" }} /><col style={{ width: "23%" }} /><col style={{ width: "20%" }} /><col style={{ width: "8%" }} /><col style={{ width: "12%" }} /><col style={{ width: "13%" }} /><col style={{ width: "9%" }} /></colgroup><thead><tr><th>Job / Type</th><th>Customer & Site</th><th>Required / Scheduled</th><th>Est. duration</th><th>Engineer</th><th>Work status</th><th /></tr></thead><tbody>{pageRows.map((job) => <tr key={job.id} className="jobs-row-clickable" onClick={() => setOpenId(job.id)}>
        <td><b>{job.number}</b><small>{job.type}</small></td>
        <td><b>{job.customer}</b><small>{siteById(job.siteId)?.name} · {siteById(job.siteId)?.city}</small></td>
        <td>{job.requiredDate && <small className="jobs-date">Required: {prettyDate(job.requiredDate)}</small>}<span className="jobs-date">{job.scheduledDate ? `Scheduled: ${prettyDate(job.scheduledDate)}` : "Not scheduled"}</span>{job.scheduledDate && <small className="jobs-date">{label12h(visitWindow(job).start)}–{label12h(visitWindow(job).end)}</small>}</td>
        <td>{job.hours}h</td><td>{job.engineer ?? <span className="erp-muted">Unassigned</span>}</td><td><span className={statusClass(job.status)}>{job.status}</span>{billingStatusOf(job) !== "Not applicable" && <small>Billing: {billingStatusOf(job)}</small>}</td>
        <td>{job.status === "Unassigned" && !isEngineer && <button className="erp-record-link" onClick={(event) => { event.stopPropagation(); setAssignId(job.id); }}>Assign</button>}</td>
      </tr>)}</tbody></table>{!rows.length && <div className="settings-empty"><b>No jobs match these filters</b><p>Try another customer, engineer or date.</p><button className="erp-record-link" onClick={clear}>Clear filters</button></div>}</div>
      <Pagination total={rows.length} page={page} onPage={setPage} />
    </>}
    {open && <Overlay label={`${open.number} details`} onClose={() => setOpenId(null)} className="stock-modal-backdrop jobs-drawer-backdrop"><div className="jobs-detail-drawer"><JobRecord job={open} store={store} isEngineer={isEngineer} close={() => setOpenId(null)} flash={flash} openInvoice={openInvoice} /></div></Overlay>}
    {assignJob && <AssignEngineer job={assignJob} close={() => setAssignId(null)} flash={flash} />}
    {creating && <NewJob store={store} initial={newJobPrefill} close={() => setCreating(false)} done={(job) => { setCreating(false); flash(`${job.number} created${job.engineer ? " and scheduled" : " · unassigned"}.`); }} />}
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </section>;
}

function visitAttention(row: VisitRow, store: ReturnType<typeof useErpStore>) {
  if (row.visitStatus === "Cancelled") return [];
  const issues: string[] = [];
  if (row.visitStatus === "Check-in not received") issues.push("Check-in overdue");
  if (row.visitStatus === "On site" && new Date(`${row.plannedDate}T${row.plannedEnd}:00+05:30`).getTime() < new Date(nowIso()).getTime()) issues.push("Visit running late");
  if (row.checkIn && row.checkIn.locationCheck !== "Within site area") issues.push(row.checkIn.locationCheck);
  if (row.outcome === "Follow-up required" || row.outcome === "Partially completed") issues.push(row.outcome);
  const blocked = blockedOn(store.leaves, store.holidays, row.engineer, row.plannedDate);
  if (blocked) issues.push(`${blocked.reason} conflict`);
  const base = engineers.find((engineer) => engineer.name === row.engineer)?.base;
  if (base && !sameCity(base, siteById(row.siteId)?.city)) issues.push("Travel review");
  return issues;
}

function JobsToday({ store, openJob }: { store: ReturnType<typeof useErpStore>; openJob: (id: string) => void }) {
  const [date, setDate] = useState(dateIso());
  const [engineer, setEngineer] = useState("All engineers");
  const [status, setStatus] = useState("All visit statuses");
  const [attention, setAttention] = useState("All visits");
  const [sort, setSort] = useState("attention");
  const [updated, setUpdated] = useState(nowIso());
  const [selected, setSelected] = useState<string | null>(null);
  const all = visitsOn(store.jobs, date).filter((row) => row.visitStatus !== "Cancelled");
  const awaits = (row: VisitRow) => !row.checkIn && new Date(`${row.plannedDate}T${row.plannedStart}:00+05:30`).getTime() <= new Date(nowIso()).getTime();
  const keyOf = (row: VisitRow) => `${row.jobId}-${row.engineer}`;
  const rows = all.filter((row) => engineer === "All engineers" || row.engineer === engineer)
    .filter((row) => status === "All visit statuses" || (status === "Awaiting check-in" ? awaits(row) : status === "Work completed" ? row.outcome === "Work completed" : row.visitStatus === status))
    .filter((row) => attention === "All visits" || visitAttention(row, store).length > 0)
    .sort((a, b) => sort === "engineer" ? a.engineer.localeCompare(b.engineer) : sort === "attention" ? visitAttention(b, store).length - visitAttention(a, store).length || a.plannedStart.localeCompare(b.plannedStart) : a.plannedStart.localeCompare(b.plannedStart));
  const { pageRows, page, setPage } = useTablePage(rows, `${date}|${engineer}|${status}|${attention}|${sort}`);
  const detail = all.find((row) => keyOf(row) === selected);
  const clear = () => { setEngineer("All engineers"); setStatus("All visit statuses"); setAttention("All visits"); };
  const summaries = [{ label: "Planned Visits", count: all.length, action: clear }, { label: "On Site", count: all.filter((row) => row.visitStatus === "On site").length, action: () => { clear(); setStatus("On site"); } }, { label: "Awaiting Check-in", count: all.filter(awaits).length, action: () => { clear(); setStatus("Awaiting check-in"); } }, { label: "Work Completed", count: all.filter((row) => row.outcome === "Work completed").length, action: () => { clear(); setStatus("Work completed"); } }, { label: "Needs Attention", count: all.filter((row) => visitAttention(row, store).length > 0).length, action: () => { clear(); setAttention("Needs attention"); } }];
  return <>
    <div className="erp-summary-strip jobs-summary">{summaries.map((summary) => <button key={summary.label} onClick={summary.action}><span>{summary.label}</span><strong>{summary.count}</strong></button>)}</div>
    <div className="erp-filters jobs-filters"><label><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label><span>Engineer</span><select value={engineer} onChange={(event) => setEngineer(event.target.value)}><option>All engineers</option>{engineers.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label><label><span>Visit status</span><select value={status} onChange={(event) => setStatus(event.target.value)}>{["All visit statuses", "Scheduled", "Awaiting check-in", "Check-in not received", "On site", "Checked out", "Work completed"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Attention</span><select value={attention} onChange={(event) => setAttention(event.target.value)}><option>All visits</option><option>Needs attention</option></select></label></div>
    <div className="erp-filter-summary"><span>{rows.length} visits · Last refreshed {istTime(updated)} IST</span><div className="jobs-inline-actions"><button className="erp-record-link" onClick={() => setUpdated(nowIso())}>Refresh</button><button className="erp-record-link" onClick={clear}>Clear all</button><label className="jobs-sort">Sort <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="attention">Attention first</option><option value="time">Planned time</option><option value="engineer">Engineer A–Z</option></select></label></div></div>
    <div className="erp-table-shell"><table className="erp-data-table jobs-today-table"><colgroup>{[12, 22, 12, 14, 13, 12, 15].map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}</colgroup><thead><tr><th>Engineer</th><th>Job / Customer & Site</th><th>Planned time</th><th>Actual in / out</th><th>Visit status</th><th>Work status</th><th>Attention / Action</th></tr></thead><tbody>{pageRows.map((row) => { const issues = visitAttention(row, store); return <tr key={keyOf(row)}><td>{row.engineer}</td><td><button className="erp-record-link" onClick={() => openJob(row.jobId)}>{row.jobNumber}</button><div>{row.customer}</div><small>{siteById(row.siteId)?.name}</small></td><td><span className="jobs-date">{label12h(row.plannedStart)}</span><small className="jobs-date">to {label12h(row.plannedEnd)}</small></td><td><span className="jobs-date">In: {row.checkIn ? istTime(row.checkIn.at) : "—"}</span><small className="jobs-date">Out: {row.checkOut ? istTime(row.checkOut.at) : "—"}</small></td><td><span className="jobs-visit-status">{row.visitStatus}</span></td><td>{row.outcome ?? row.jobStatus}</td><td>{issues.slice(0, 2).map((issue) => <small key={issue} className="job-late">{issue}</small>)}{issues.length > 2 && <small>+{issues.length - 2} more</small>}<button className="erp-record-link" onClick={() => setSelected(keyOf(row))}>Visit details</button></td></tr>; })}</tbody></table>{!rows.length && <div className="settings-empty"><b>No visits match</b><p>Choose another date or clear the filters.</p><button className="erp-record-link" onClick={clear}>Clear filters</button></div>}</div>
    <Pagination total={rows.length} page={page} onPage={setPage} />
    <p className="erp-muted jobs-refresh-note">Recorded visit events only. Location is recorded at check-in and checkout.</p>
    {detail && <Overlay label={`Visit details ${detail.jobNumber}`} onClose={() => setSelected(null)} className="stock-modal-backdrop jobs-drawer-backdrop"><section className="jobs-visit-drawer"><header><div><h2>Visit details</h2><p>{detail.jobNumber} · {detail.engineer}</p></div><button className="settings-outline" aria-label="Close visit details" onClick={() => setSelected(null)}>×</button></header><div className="jobs-drawer-body"><section className="erp-form-section"><h3>Customer & Site</h3><p>{detail.customer} · {siteById(detail.siteId)?.name}</p><p>{prettyDate(detail.plannedDate)} · {label12h(detail.plannedStart)}–{label12h(detail.plannedEnd)}</p><p>{detail.visitStatus} · {detail.outcome ?? detail.jobStatus}</p></section>{visitAttention(detail, store).length > 0 && <section className="erp-form-section"><h3>Needs review</h3>{visitAttention(detail, store).map((issue) => <p className="job-late" key={issue}>{issue}</p>)}</section>}<section className="erp-form-section"><h3>Recorded events</h3>{([["Check-in", detail.checkIn], ["Checkout", detail.checkOut]] as const).map(([label, event]) => <div className="jobs-visit-event" key={label}><b>{label}</b>{event ? <><p>{istStamp(event.at)} · {event.source}</p><p>Synced {istStamp(event.syncedAt)}</p><p>{event.locationCheck}</p>{event.location && <p>Coordinates {event.location.lat}, {event.location.lng} · Accuracy {event.location.accuracyM}m{event.siteDistanceM !== undefined ? ` · ${event.siteDistanceM}m from site` : ""}</p>}</> : <p className="erp-muted">{label === "Checkout" && detail.visitStatus === "On site" ? "Visit is ongoing." : "No event recorded."}</p>}</div>)}</section></div><footer><button className="erp-action" onClick={() => { setSelected(null); openJob(detail.jobId); }}>Open {detail.jobNumber}</button></footer></section></Overlay>}
  </>;
}

function EngineerToday({ jobs, openJob }: { jobs: Job[]; openJob: (id: string) => void }) {
  const rows = [...jobs].sort((a, b) => (a.plannedStart ?? "").localeCompare(b.plannedStart ?? ""));
  return <>
    <div className="erp-filter-summary"><span>{rows.length} job{rows.length === 1 ? "" : "s"} scheduled today</span></div>
    <div className="erp-table-shell"><table className="erp-data-table jobs-register leads-style-table"><colgroup><col style={{ width: "18%" }} /><col style={{ width: "32%" }} /><col style={{ width: "20%" }} /><col style={{ width: "15%" }} /><col style={{ width: "15%" }} /></colgroup><thead><tr><th>Job / Type</th><th>Customer & Site</th><th>Planned time</th><th>Work status</th><th /></tr></thead><tbody>{rows.map((job) => <tr key={job.id} className="jobs-row-clickable" onClick={() => openJob(job.id)}>
      <td><b>{job.number}</b><small>{job.type}</small></td>
      <td><b>{job.customer}</b><small>{siteById(job.siteId)?.name} · {siteById(job.siteId)?.city}</small></td>
      <td>{job.plannedStart ? <span className="jobs-date">{label12h(visitWindow(job).start)}–{label12h(visitWindow(job).end)}</span> : <span className="erp-muted">Time not set</span>}</td>
      <td><span className={statusClass(job.status)}>{job.status}</span></td>
      <td><button className="erp-record-link" onClick={(event) => { event.stopPropagation(); openJob(job.id); }}>Open</button></td>
    </tr>)}</tbody></table>{!rows.length && <div className="settings-empty"><b>No jobs scheduled for today</b><p>Check back once you're assigned a job.</p></div>}</div>
  </>;
}

/* ─── Reason prompt (hold / cancel) ──────────────────────────────── */
function ReasonPrompt({ title, submitLabel, close, submit }: { title: string; submitLabel: string; close: () => void; submit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return <div className="stock-modal-backdrop" onClick={close}><section className="stock-move-modal" role="dialog" aria-modal="true" aria-labelledby="reason-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <h2 id="reason-title">{title}</h2>
    <label className="due-notes"><span>Reason</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} autoFocus /></label>
    <div className="invoice-payment-footer"><span /><div><button className="settings-outline" onClick={close}>Back</button><button className="erp-action" disabled={!reason.trim()} onClick={() => submit(reason)}>{submitLabel}</button></div></div>
  </section></div>;
}

/* ─── Assign engineer — the one simple form: engineer, date, time ──── */
function AssignEngineer({ job, close, flash }: { job: Job; close: () => void; flash: (message: string) => void }) {
  const [date, setDate] = useState(job.scheduledDate || dateIso());
  const [engineer, setEngineer] = useState(job.engineer ?? "");
  const [time, setTime] = useState(job.plannedStart ?? "09:30");
  const [error, setError] = useState("");
  const assign = () => {
    if (!date || !engineer || !time) { setError("Choose a date, engineer and time."); return; }
    updateStore((current) => ({ jobs: current.jobs.map((entry) => entry.id !== job.id ? entry : { ...entry, engineer, scheduledDate: date, plannedStart: time, status: entry.status === "In progress" ? "In progress" as const : "Scheduled" as const, activities: [{ title: `Assigned to ${engineer} for ${prettyDate(date)}, ${label12h(time)}`, meta: stamp(), tone: "assigned" as const }, ...entry.activities] }) }));
    close(); flash(`${job.number} scheduled with ${engineer}.`);
  };
  return <Overlay label="Assign engineer" onClose={close}><section className="stock-move-modal jobs-form-modal"><header className="jobs-form-header"><div><h2>Assign engineer</h2><p>{job.number} · {job.customer} · {siteById(job.siteId)?.name}</p></div><button className="settings-outline" aria-label="Close assignment" onClick={close}>×</button></header><div className="jobs-form-body">
    <div className="quote-header-grid ci-form-grid">
      <label><span>Engineer</span><select value={engineer} onChange={(event) => { setEngineer(event.target.value); setError(""); }}><option value="">Select engineer</option>{engineers.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} · {entry.base}</option>)}</select></label>
      <label><span>Date</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setError(""); }} /></label>
      <label><span>Time</span><input type="time" value={time} onChange={(event) => { setTime(event.target.value); setError(""); }} /></label>
    </div>
    {job.checkIn && <p className="erp-muted">Recorded check-in will be preserved.</p>}
    {error && <p className="jobs-form-error" role="alert">{error}</p>}
  </div><footer className="jobs-form-footer"><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={assign}>Confirm assignment</button></footer></section></Overlay>;
}

/* ─── Receive an in-lab instrument, with its condition on arrival ──── */
function ReceiveInstrumentForm({ job, close, flash }: { job: Job; close: () => void; flash: (message: string) => void }) {
  const [condition, setCondition] = useState("Good — no visible damage");
  const [date, setDate] = useState(dateIso());
  const submit = () => {
    if (!condition.trim()) return;
    updateStore((current) => receiveInLabJob(current, job.id, condition.trim(), date));
    close(); flash(`Instrument received — condition: ${condition.trim()}.`);
  };
  return <div className="stock-modal-backdrop" onClick={close}><section className="stock-move-modal" role="dialog" aria-modal="true" aria-labelledby="receive-instrument-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <h2 id="receive-instrument-title">Receive instrument</h2>
    <p className="po-start-hint">{job.customer} · {job.number}</p>
    <label className="settings-field"><span>Condition on receipt <b className="lead-required">Required</b></span><input value={condition} onChange={(event) => setCondition(event.target.value)} placeholder="e.g. Good — no visible damage" /></label>
    <label className="settings-field"><span>Date received</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
    <div className="invoice-payment-footer"><span /><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" disabled={!condition.trim()} onClick={submit}>Receive</button></div></div>
  </section></div>;
}

/* ─── Job record ─────────────────────────────────────────────────── */
function JobRecord({ job, store, isEngineer, close, flash, openInvoice }: { job: Job; store: ReturnType<typeof useErpStore>; isEngineer: boolean; close: () => void; flash: (message: string) => void; openInvoice?: (invoiceId: string) => void }) {
  const [assigning, setAssigning] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [holding, setHolding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const site = siteById(job.siteId);
  const instruments = store.instruments.filter((item) => job.instrumentIds.includes(item.id));
  const stock = store.individuals.filter((item) => job.stockIds.includes(item.id));
  const billing = billingStatusOf(job);
  const isInLab = job.doneAt === "In-lab";
  const isSiteVisit = job.doneAt === "Site visit";

  const start = () => {
    updateStore((current) => ({ jobs: current.jobs.map((entry) => entry.id !== job.id ? entry : { ...entry, status: "In progress" as const, startedAt: dateIso(), activities: [{ title: "Started", meta: stamp(), tone: "system" as const }, ...entry.activities] }) }));
    flash("Job started. Fill in each instrument as you go.");
  };
  const createInvoice = () => {
    const customer = store.customers.find((entry) => entry.name === job.customer);
    const invoice = invoiceFromJob(job, store.instruments, store.customers, nextInvoiceNumber(store.invoices));
    updateStore((current) => ({
      invoices: [invoice, ...current.invoices],
      jobs: current.jobs.map((entry) => entry.id !== job.id ? entry : { ...entry, invoiceNumber: invoice.number, activities: [{ title: `Invoice ${invoice.number} created`, meta: stamp(), tone: "system" as const }, ...entry.activities] }),
    }));
    flash(customer ? `Invoice ${invoice.number} created. Open it in Invoices to price and send.` : `Invoice ${invoice.number} created — ${job.customer} has no customer record yet, so GSTIN and address need filling in.`);
    close(); openInvoice?.(invoice.id);
  };
  const putOnHold = (reason: string) => {
    updateStore((current) => ({ jobs: current.jobs.map((entry) => entry.id !== job.id ? entry : { ...entry, status: "On hold" as const, onHoldReason: reason, activities: [{ title: `Put on hold — ${reason}`, meta: stamp(), tone: "system" as const }, ...entry.activities] }) }));
    setHolding(false); flash("Job put on hold.");
  };
  const resume = () => {
    const next: JobStatus = job.engineer ? "Scheduled" : "Unassigned";
    updateStore((current) => ({ jobs: current.jobs.map((entry) => entry.id !== job.id ? entry : { ...entry, status: next, activities: [{ title: `Resumed — back to ${next}`, meta: stamp(), tone: "system" as const }, ...entry.activities] }) }));
    flash("Job resumed.");
  };
  const cancelJob = (reason: string) => {
    updateStore((current) => ({ jobs: current.jobs.map((entry) => entry.id !== job.id ? entry : { ...entry, status: "Cancelled" as const, cancelReason: reason, activities: [{ title: `Cancelled — ${reason}`, meta: stamp(), tone: "system" as const }, ...entry.activities] }) }));
    setCancelling(false); flash("Job cancelled."); close();
  };
  const returnWithDc = () => {
    let result: ReturnType<typeof returnInLabJob> = {};
    updateStore((current) => { result = returnInLabJob(current, job.id, dateIso()); return result; });
    flash(result.deliveryChallans ? `Returned to ${job.customer}. ${result.deliveryChallans[0].number} created.` : "Nothing to return — this job has no instruments on it.");
  };
  const gpsAction = (kind: "checkIn" | "checkOut") => {
    const write = (value: VisitStamp) => { updateStore((current) => applyVisitStamp(current, job.id, kind, value)); flash(`${kind === "checkIn" ? "Checked in" : "Checked out"} · ${value.locationCheck}.`); };
    if (!navigator.geolocation) { const now = nowIso(); write({ at: now, syncedAt: now, source: "Mobile", locationCheck: "Location unavailable" }); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location: GeoPoint = { lat: position.coords.latitude, lng: position.coords.longitude, accuracyM: Math.round(position.coords.accuracy) };
        const now = nowIso();
        let locationCheck: LocationCheck = "Location unavailable"; let siteDistanceM: number | undefined;
        if (site?.lat !== undefined && site?.lng !== undefined) {
          siteDistanceM = Math.round(metersBetween(location, { lat: site.lat, lng: site.lng }));
          locationCheck = siteDistanceM <= ATTENDANCE_SETTINGS.siteRadiusMetersDemo ? "Within site area" : "Outside site area";
        }
        write({ at: now, syncedAt: now, source: "Mobile", location, siteDistanceM, locationCheck });
      },
      () => { const now = nowIso(); write({ at: now, syncedAt: now, source: "Mobile", locationCheck: "Location unavailable" }); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return <section className="quote-editor-page invoice-editor-page job-record-page">
    <header className="quote-editor-head"><div>
      <button className="quote-back" aria-label="Close job details" onClick={close}>× Close</button>
      <p>Operations / Jobs</p>
      <h1>{job.number}</h1>
      <span className={statusClass(job.status)}>{job.status}</span>
      {billing !== "Not applicable" && <span className={billing === "To invoice" ? "due-nojob" : "due-job-chip"}>{billing}</span>}
      {isLate(job) && <span className="invoice-due-chip is-late">Overdue · {Math.abs(dayDifference(job.scheduledDate))}d</span>}
    </div><div className="quote-editor-actions">
      {job.status === "Unassigned" && !isEngineer && <button className="erp-action" onClick={() => setAssigning(true)}>Assign engineer</button>}
      {job.status === "Scheduled" && <><button className="erp-action" onClick={start}>Start job</button>{!isEngineer && <button className="settings-outline" onClick={() => setAssigning(true)}>Reassign</button>}{!isEngineer && <button className="settings-outline" onClick={() => setHolding(true)}>Put on hold</button>}</>}
      {job.status === "In progress" && <><button className="erp-action" onClick={() => setCompleting(true)}>Log visit outcome</button>{!isEngineer && <button className="settings-outline" onClick={() => setHolding(true)}>Put on hold</button>}</>}
      {job.status === "On hold" && <button className="erp-action" onClick={resume}>Resume</button>}
      {job.status === "Completed" && billing === "To invoice" && !isEngineer && <button className="erp-action" onClick={createInvoice}>Create invoice</button>}
      {job.status === "Completed" && billing === "Invoiced" && !isEngineer && <button className="settings-outline" onClick={() => { close(); openInvoice?.(store.invoices.find((invoice) => invoice.number === job.invoiceNumber)?.id ?? ""); }}>Open {job.invoiceNumber}</button>}
      {isInLab && !job.receivedAt && <button className="settings-outline" onClick={() => setReceiving(true)}>Receive instrument</button>}
      {isInLab && job.receivedAt && !job.returnedAt && <button className="settings-outline" onClick={returnWithDc}>Return with DC</button>}
      {isSiteVisit && isEngineer && (job.status === "Scheduled" || job.status === "In progress") && !job.checkIn && <button className="settings-outline" onClick={() => gpsAction("checkIn")}>Check in</button>}
      {isSiteVisit && isEngineer && (job.status === "Scheduled" || job.status === "In progress") && job.checkIn && !job.checkOut && <button className="settings-outline" onClick={() => gpsAction("checkOut")}>Check out</button>}
      {!isEngineer && job.status !== "Completed" && job.status !== "Cancelled" && <button className="settings-outline" onClick={() => setCancelling(true)}>Cancel job</button>}
    </div></header>

    <main className="invoice-editor-layout">
      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>Work Details</h2><span>{job.type} · {job.doneAt}</span></div></div>
        <p className="job-description">{job.description || "No description."}</p>
        <div className="job-instrument-list">{instruments.map((item) => <div key={item.id}><b>{item.name}</b><span>{item.make} {item.model} · {item.serial}</span><small>{item.intervalMonths ? `Every ${item.intervalMonths} months` : "Calibration interval unknown"}</small></div>)}
          {stock.map((item) => <div key={item.id}><b>{item.name}</b><span>Our equipment · {item.id}</span><small>{item.opStatus}</small></div>)}
          {!instruments.length && !stock.length && <p className="stock-timeline-empty">No instruments on this job yet.</p>}
        </div>
      </section>

      {isInLab && <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>In-lab custody</h2><span>Receive, work on it, then return it with a Delivery Challan.</span></div></div>
        <dl className="invoice-facts due-facts">
          <div><dt>Received</dt><dd>{job.receivedAt ? `${prettyDate(job.receivedAt)} · ${job.receivedCondition}` : "Not yet received"}</dd></div>
          <div><dt>Returned</dt><dd>{job.returnedAt ? `${prettyDate(job.returnedAt)} · ${job.returnDc}` : "Not yet returned"}</dd></div>
        </dl>
      </section>}

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>Customer & Site</h2><span>{isInLab ? "At SPM" : "Site visit"}</span></div></div>
        <dl className="invoice-facts due-facts">
          <div><dt>Customer</dt><dd>{job.customer}</dd></div>
          <div><dt>Site</dt><dd>{site?.name ?? "—"}</dd></div>
          <div className="invoice-fact-wide"><dt>Address</dt><dd>{site ? `${site.address}, ${site.city}` : "—"}</dd></div>
          <div><dt>Contact</dt><dd>{site?.contact ?? "—"}</dd></div>
          <div><dt>Phone</dt><dd>{site?.phone ? <a className="job-call" href={`tel:${site.phone.replace(/\s/g, "")}`}>{site.phone}</a> : "—"}</dd></div>
        </dl>
      </section>

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>Visit</h2><span>{job.scheduledDate && job.engineer ? "1 planned" : "Not scheduled"}</span></div></div>
        <div className="job-instrument-list">
          <div>
            <b>{job.engineer ?? "Nobody assigned"}</b>
            <span>{job.scheduledDate ? `${prettyDate(job.scheduledDate)} · ${label12h(visitWindow(job).start)}–${label12h(visitWindow(job).end)} · ${computeVisitStatus({ plannedDate: job.scheduledDate, plannedStart: visitWindow(job).start, checkIn: job.checkIn, checkOut: job.checkOut, cancelled: job.status === "Cancelled" }, nowIso())}` : "Not scheduled"}</span>
            <small>Check-in {job.checkIn ? istStamp(job.checkIn.at) : "—"}{job.checkIn?.locationCheck ? ` · ${job.checkIn.locationCheck}` : ""} · Check-out {job.checkOut ? istStamp(job.checkOut.at) : "—"}{job.outcome ? ` · ${job.outcome}` : ""}</small>
          </div>
        </div>
        {job.remainingWork && <p className="po-start-hint">Remaining work: {job.remainingWork}</p>}
      </section>

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>When and who</h2><span>{job.hours} hours estimated</span></div></div>
        <dl className="invoice-facts due-facts">
          <div><dt>Required</dt><dd>{job.requiredDate ? prettyDate(job.requiredDate) : "Not specified"}</dd></div><div><dt>Scheduled</dt><dd>{scheduledLabel(job)}</dd></div>
          <div><dt>Planned time</dt><dd>{job.scheduledDate ? `${label12h(visitWindow(job).start)}–${label12h(visitWindow(job).end)}` : "Not scheduled"}</dd></div>
          <div><dt>Engineer</dt><dd>{job.engineer ?? <em>Nobody assigned</em>}</dd></div>
        </dl>
      </section>

      {(job.expectedSpares.length > 0 || job.usedSpares.length > 0) && <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>Spares</h2><span>Used spares come out of the van count automatically.</span></div></div>
        <div className="job-spare-cols">
          <div><span>Expected</span>{job.expectedSpares.length ? job.expectedSpares.map((spare) => <b key={spare.item}>{spare.quantity} × {spare.item}</b>) : <p>None</p>}</div>
          <div><span>Actually used</span>{job.usedSpares.length ? job.usedSpares.map((spare) => <b key={spare.item}>{spare.quantity} × {spare.item}</b>) : <p>None yet</p>}</div>
        </div>
      </section>}

      {job.results.length > 0 && <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>What was found</h2><span>Recorded on site by {job.engineer}.</span></div></div>
        <div className="job-result-list">{job.results.map((result) => { const item = store.instruments.find((entry) => entry.id === result.instrumentId); return <div key={result.instrumentId}>
          <div className="job-result-head"><b>{item?.name}</b><span className={`ci-result ci-result--${result.outcome === "Fail" ? "fail" : "pass"}`}>{result.outcome}</span></div>
          <dl><div><dt>As found</dt><dd>{result.asFound}</dd></div><div><dt>As left</dt><dd>{result.asLeft}</dd></div></dl>
          {result.readings && <p className="job-readings">{result.readings}</p>}
          {result.remarks && <p className="job-remarks">{result.remarks}</p>}
        </div>; })}</div>
        {job.travelNotes && <p className="job-travel">Travel: {job.travelNotes}</p>}
        {job.signature && <p className="job-signed">Signed by the customer · {job.photos} photo{job.photos === 1 ? "" : "s"} attached</p>}
      </section>}

      {(job.certificateNumber || (job.mastersUsed?.length ?? 0) > 0) && <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>Certificate</h2><span>Closes out a calibration or validation job.</span></div></div>
        <dl className="invoice-facts due-facts">
          <div><dt>Certificate</dt><dd>{job.certificateNumber ?? "Not recorded"}{job.certificateGeneratedAt ? ` · ${prettyDate(job.certificateGeneratedAt)}` : ""}</dd></div>
          <div><dt>File</dt><dd>{job.certificateFile || "Generated by SPM"}</dd></div>
          <div className="invoice-fact-wide"><dt>Reference standards used</dt><dd>{job.mastersUsed?.length ? store.masters.filter((master) => job.mastersUsed!.includes(master.id)).map((master) => master.name).join(", ") : "None recorded"}</dd></div>
        </dl>
      </section>}

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>History</h2><span>What has happened to this job.</span></div></div>
        <div className="lead-timeline quote-activity">{job.activities.map((activity, index) => <div key={index} className={activity.tone ? `job-timeline--${activity.tone}` : ""}><i /><p><b>{activity.title}</b><span>{activity.meta}</span></p></div>)}</div>
      </section>
    </main>

    {job.status === "In progress" && <div className="invoice-mobile-bar"><button className="erp-action" onClick={() => setCompleting(true)}>Log visit outcome</button>{site?.phone && <a className="settings-outline" href={`tel:${site.phone.replace(/\s/g, "")}`}>Call site</a>}</div>}
    {job.status === "Scheduled" && <div className="invoice-mobile-bar"><button className="erp-action" onClick={start}>Start job</button>{site?.phone && <a className="settings-outline" href={`tel:${site.phone.replace(/\s/g, "")}`}>Call site</a>}</div>}

    {assigning && <AssignEngineer job={job} close={() => setAssigning(false)} flash={flash} />}
    {completing && <CompleteVisit job={job} store={store} close={() => setCompleting(false)} flash={flash} />}
    {holding && <ReasonPrompt title="Put this job on hold" submitLabel="Put on hold" close={() => setHolding(false)} submit={putOnHold} />}
    {cancelling && <ReasonPrompt title="Cancel this job" submitLabel="Cancel job" close={() => setCancelling(false)} submit={cancelJob} />}
    {receiving && <ReceiveInstrumentForm job={job} close={() => setReceiving(false)} flash={flash} />}
  </section>;
}

/* ─── Certificate print view ─────────────────────────────────────── */
function CertificatePreview({ job, store, mastersUsed, results, certNumber, close }: { job: Job; store: ReturnType<typeof useErpStore>; mastersUsed: string[]; results: JobResult[]; certNumber: string; close: () => void }) {
  const instruments = store.instruments.filter((item) => job.instrumentIds.includes(item.id));
  const masters = store.masters.filter((master) => mastersUsed.includes(master.id));
  const site = siteById(job.siteId);
  return <div className="stock-modal-backdrop quote-preview-backdrop"><section className="quote-preview" role="dialog" aria-modal="true" aria-labelledby="cert-preview-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <div className="quote-preview-actions"><button className="settings-outline" onClick={() => window.print()}>Print / Save PDF</button><button className="erp-action" onClick={close}>Done</button></div>
    <article>
      <header><img src={spmLogo} alt="SPM Lab Solutions" /><div><h2 id="cert-preview-title">CALIBRATION CERTIFICATE</h2><span>{certNumber}</span></div></header>
      <div className="quote-preview-company">
        <div><b>{COMPANY.name}</b><span>{COMPANY.address}</span><span>GSTIN: {COMPANY.gstin}</span></div>
        <div><b>Issued to</b><span>{job.customer}</span><span>{site ? `${site.name}, ${site.city}` : ""}</span></div>
      </div>
      <p className="quote-preview-subject"><b>Job:</b> {job.number} · {job.type} · <b>Date:</b> {prettyDate(dateIso())}</p>
      <table><thead><tr><th>Instrument</th><th>As found</th><th>As left</th><th>Result</th></tr></thead><tbody>{instruments.map((item) => { const result = results.find((entry) => entry.instrumentId === item.id); return <tr key={item.id}><td>{item.name} · {item.serial}</td><td>{result?.asFound || "—"}</td><td>{result?.asLeft || "—"}</td><td>{result?.outcome ?? "—"}</td></tr>; })}</tbody></table>
      <section><b>Reference standards used</b><p>{masters.length ? masters.map((master) => `${master.name} (${master.serial})`).join(", ") : "None recorded"}</p></section>
      <footer><div><b>Calibrated by</b><span>{job.engineer ?? ENGINEER}</span></div><div><i>Authorised signatory</i><b>For {COMPANY.name}</b></div></footer>
    </article>
  </section></div>;
}

/* ─── Visit outcome (engineer completion), mobile first ──────────── */
function CompleteVisit({ job, store, close, flash }: { job: Job; store: ReturnType<typeof useErpStore>; close: () => void; flash: (message: string) => void }) {
  const instruments = store.instruments.filter((item) => job.instrumentIds.includes(item.id));
  const [step, setStep] = useState(0);
  const [results, setResults] = useState<JobResult[]>(instruments.map((item) => ({ instrumentId: item.id, asFound: "", asLeft: "", outcome: "Pass", readings: "", remarks: "" })));
  const [spare, setSpare] = useState(""); const [spareQty, setSpareQty] = useState("1");
  const [used, setUsed] = useState<{ item: string; quantity: number }[]>([]);
  const [travel, setTravel] = useState(""); const [photos, setPhotos] = useState(0); const [signed, setSigned] = useState(false);
  const [outcome, setOutcome] = useState<VisitOutcome | "">("");
  const [outcomeNote, setOutcomeNote] = useState("");
  const [remainingWork, setRemainingWork] = useState("");
  const [mastersUsed, setMastersUsed] = useState<string[]>(job.mastersUsed ?? []);
  const [certNumber, setCertNumber] = useState(job.certificateNumber ?? "");
  const [certFile, setCertFile] = useState(job.certificateFile ?? "");
  const [certPreview, setCertPreview] = useState(false);
  const needsCert = needsCertificate(job.type);
  const engineerName = job.engineer ?? ENGINEER;

  const total = instruments.length + 1;
  const setResult = (index: number, patch: Partial<JobResult>) => setResults((all) => all.map((entry, position) => position === index ? { ...entry, ...patch } : entry));
  const [spareError, setSpareError] = useState("");
  const addSpare = () => {
    if (!spare) return;
    const stockItem = store.quantities.find((row) => row.name === spare);
    const already = used.filter((entry) => entry.item === spare).reduce((sum, entry) => sum + entry.quantity, 0);
    const available = stockItem ? balanceAt(stockItem, engineerName) - already : 0;
    if (Number(spareQty) > available) { setSpareError(`Only ${available} left in ${engineerName}'s van.`); return; }
    setSpareError(""); setUsed((all) => [...all, { item: spare, quantity: Number(spareQty) || 1 }]); setSpare(""); setSpareQty("1");
  };

  const needsRemaining = outcome === "Partially completed" || outcome === "Follow-up required";
  const willResolve = outcome === "Work completed" || outcome === "Customer unavailable";
  const needsCertification = needsCert && willResolve;

  const finish = () => {
    if (!outcome) return;
    const today = dateIso();
    updateStore((current) => {
      const instrumentsNext = current.instruments.map((item) => {
        const result = results.find((entry) => entry.instrumentId === item.id);
        if (!result || !needsCert || !certNumber.trim()) return item;
        return { ...item, history: [...item.history, { id: `cr-${Date.now()}-${item.id}`, date: today, engineer: engineerName, result: result.outcome, certificate: certNumber.trim(), jobNumber: job.number }], certificateNumber: certNumber.trim(), certificateFile: certFile || undefined, nextDueDate: undefined, nextDueOverrideReason: undefined };
      });
      let quantities = current.quantities;
      const moves: StockMove[] = [];
      used.forEach((entry) => {
        const stockItem = current.quantities.find((row) => row.name === entry.item);
        if (!stockItem) return;
        const before = balanceAt(stockItem, engineerName);
        quantities = quantities.map((row) => row.id === stockItem.id ? { ...row, balances: adjustBalance(row.balances, engineerName, -entry.quantity) } : row);
        moves.push({ id: `mv-job-${Date.now()}-${stockItem.id}`, date: today, at: prettyDate(today), action: "Usage on job", source: engineerName, destination: job.customer, quantity: entry.quantity, who: engineerName, document: job.number, item: entry.item, beforeBalance: before, afterBalance: Math.max(0, before - entry.quantity) });
      });
      const resolvesJob = willResolve && jobFullyResolved({ ...job, outcome: outcome || undefined });
      const jobs = current.jobs.map((entry) => entry.id !== job.id ? entry : {
        ...entry, status: resolvesJob ? "Completed" as const : entry.status, completedAt: resolvesJob ? today : entry.completedAt,
        results, usedSpares: used, travelNotes: travel, photos, signature: signed ? "signed" : undefined,
        outcome: outcome || undefined, outcomeNote: outcomeNote || undefined, remainingWork: needsRemaining ? remainingWork || undefined : undefined,
        mastersUsed: mastersUsed.length ? mastersUsed : entry.mastersUsed,
        certificateNumber: certNumber.trim() || entry.certificateNumber,
        certificateFile: certFile || entry.certificateFile,
        certificateGeneratedAt: certNumber.trim() ? today : entry.certificateGeneratedAt,
        activities: [{ title: `Visit outcome: ${outcome}${certNumber.trim() ? ` — certificate ${certNumber.trim()}` : ""}${resolvesJob ? " — job completed" : ""}`, meta: stamp(), tone: resolvesJob ? "done" as const : "system" as const }, ...entry.activities],
      });
      return { instruments: instrumentsNext, quantities, moves: [...moves, ...current.moves], jobs };
    });
    close();
    const dueList = needsCert ? instruments.map((item) => item.intervalMonths ? `${item.name} → ${prettyDate(addDaysIso(today, item.intervalMonths * 30))}` : `${item.name} → interval unknown, due date not set`) : [];
    flash(willResolve ? `${job.number} — outcome recorded.${dueList.length ? ` Next due set: ${dueList.join(", ")}.` : !needsCert ? " Calibration schedules are unchanged for a non-calibration job." : ""}${jobFullyResolved({ ...job, outcome: outcome || undefined }) ? " Ready to invoice." : ""}` : `${job.number} — outcome recorded. Job stays open until the visit is resolved.`);
  };

  const onInstrument = step < instruments.length;
  const current = onInstrument ? results[step] : null;
  const item = onInstrument ? instruments[step] : null;
  const canNext = !onInstrument || Boolean(current?.asFound.trim() && current?.asLeft.trim());
  const canFinish = Boolean(outcome && outcomeNote.trim() && (!needsCertification || (mastersUsed.length > 0 && certNumber.trim())));

  return <div className="stock-modal-backdrop" onClick={close}><section className="stock-move-modal complete-modal" role="dialog" aria-modal="true" aria-labelledby="complete-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <h2 id="complete-title">{onInstrument ? item?.name : "Visit outcome"}</h2>
    {!needsCert && <p className="po-start-hint">This is a {job.type.toLowerCase()} job — no certificate is generated and calibration due dates will not change.</p>}
    <div className="complete-progress"><span>Step {step + 1} of {total}</span><div><i style={{ width: `${((step + 1) / total) * 100}%` }} /></div></div>

    {onInstrument && current && item && <div className="complete-body">
      <p className="po-start-hint">{item.make} {item.model} · {item.serial}</p>
      <label className="due-notes"><span>As found</span><textarea value={current.asFound} onChange={(event) => setResult(step, { asFound: event.target.value })} placeholder="How was it when you arrived?" /></label>
      <label className="due-notes"><span>As left</span><textarea value={current.asLeft} onChange={(event) => setResult(step, { asLeft: event.target.value })} placeholder="How did you leave it?" /></label>
      <div className="complete-outcome">{(["Pass", "Pass after adjustment", "Fail"] as const).map((entry) => <button key={entry} className={current.outcome === entry ? "is-active" : ""} onClick={() => setResult(step, { outcome: entry })}>{entry}</button>)}</div>
      <label className="due-notes"><span>Readings or observations</span><textarea value={current.readings} onChange={(event) => setResult(step, { readings: event.target.value })} placeholder="e.g. 10 V: 10.02 · 100 V: 99.8" /></label>
      <label className="due-notes"><span>Remarks</span><textarea value={current.remarks} onChange={(event) => setResult(step, { remarks: event.target.value })} /></label>
    </div>}

    {!onInstrument && <div className="complete-body">
      <div className="due-spares">
        <span className="due-spares-label">Spares used — these come out of your van</span>
        <div className="due-spare-add">
          <select value={spare} onChange={(event) => { setSpare(event.target.value); setSpareError(""); }}><option value="">Pick a spare</option>{store.quantities.map((row) => <option key={row.id} value={row.name}>{row.name} · {balanceAt(row, engineerName)} in van</option>)}</select>
          <input type="number" min="1" value={spareQty} onChange={(event) => setSpareQty(event.target.value)} />
          <button className="settings-outline" onClick={addSpare} disabled={!spare}>Add</button>
        </div>
        {spareError && <p className="stock-count-error">{spareError}</p>}
        {used.length > 0 && <ul className="due-spare-list">{used.map((entry, index) => <li key={index}>{entry.quantity} × {entry.item}<button onClick={() => setUsed((all) => all.filter((_, position) => position !== index))} aria-label="Remove">×</button></li>)}</ul>}
      </div>
      <label className="due-notes"><span>Travel notes</span><textarea value={travel} onChange={(event) => setTravel(event.target.value)} placeholder="Anything the next person should know" /></label>
      <label className="complete-file"><span>Photos</span><input type="file" accept="image/*" multiple onChange={(event) => setPhotos(event.target.files?.length ?? 0)} /></label>
      <button className={`complete-sign${signed ? " is-signed" : ""}`} onClick={() => setSigned(!signed)}>{signed ? "✓ Customer signed" : "Get customer signature"}</button>

      {needsCert && <>
        <span className="due-spares-label">Reference standards used</span>
        <div className="job-pick-list">{store.masters.map((master) => { const expired = masterExpired(master); return <label key={master.id} className={mastersUsed.includes(master.id) ? "is-ticked" : ""}>
          <input type="checkbox" disabled={expired} checked={mastersUsed.includes(master.id)} onChange={(event) => setMastersUsed((all) => event.target.checked ? [...all, master.id] : all.filter((id) => id !== master.id))} />
          <div><b>{master.name}</b><span>{master.serial} · next due {prettyDate(masterNextDue(master))}</span>{expired && <span className="job-late">Out of calibration — cannot be used</span>}</div>
        </label>; })}</div>

        <span className="due-spares-label">Certificate</span>
        <label className="due-notes"><span>Certificate number</span><input value={certNumber} onChange={(event) => setCertNumber(event.target.value)} placeholder="e.g. CERT-2026-0301" /></label>
        <div className="invoice-payment-footer"><span>Generate a printable certificate from the readings above</span><div><button className="settings-outline" onClick={() => { if (!certNumber.trim()) setCertNumber(`CERT-2026-${String(Date.now()).slice(-4)}`); setCertPreview(true); }}>Generate &amp; print</button></div></div>
        <label className="complete-file"><span>Or upload the lab's own certificate file</span><input type="file" accept="application/pdf" onChange={(event) => setCertFile(event.target.files?.[0]?.name ?? "")} />{certFile && <small>{certFile}</small>}</label>
      </>}

      <span className="due-spares-label">Visit outcome</span>
      <div className="complete-outcome complete-outcome--visit">{(["Work completed", "Partially completed", "Customer unavailable", "Follow-up required"] as VisitOutcome[]).map((entry) => <button key={entry} className={outcome === entry ? "is-active" : ""} onClick={() => setOutcome(entry)}>{entry}</button>)}</div>
      <label className="due-notes"><span>Outcome note</span><textarea value={outcomeNote} onChange={(event) => setOutcomeNote(event.target.value)} placeholder="Short note — required to mark the visit outcome" /></label>
      {needsRemaining && <label className="due-notes"><span>What remains</span><textarea value={remainingWork} onChange={(event) => setRemainingWork(event.target.value)} placeholder="What still needs doing — reassign this job for the follow-up visit" /></label>}
      {needsCertification && !(mastersUsed.length > 0 && certNumber.trim()) && <p className="stock-review-note">A calibration/validation job needs at least one reference standard and a certificate number before it can be marked complete.</p>}
    </div>}

    <div className="invoice-payment-footer complete-footer">
      <span>{onInstrument ? `${instruments.length - step - 1} more instrument${instruments.length - step - 1 === 1 ? "" : "s"}` : willResolve ? "Job will be marked Completed" : "Job stays open"}</span>
      <div>
        <button className="settings-outline" onClick={() => step === 0 ? close() : setStep(step - 1)}>{step === 0 ? "Cancel" : "Back"}</button>
        {onInstrument ? <button className="erp-action" disabled={!canNext} onClick={() => setStep(step + 1)}>Next</button> : <button className="erp-action" disabled={!canFinish} onClick={finish}>Save outcome</button>}
      </div>
    </div>
    {certPreview && <CertificatePreview job={job} store={store} mastersUsed={mastersUsed} results={results} certNumber={certNumber || `CERT-2026-${String(Date.now()).slice(-4)}`} close={() => setCertPreview(false)} />}
  </section></div>;
}

/* ─── New job ────────────────────────────────────────────────────── */
function NewJob({ store, close, done, initial }: { store: ReturnType<typeof useErpStore>; close: () => void; done: (job: Job) => void; initial?: Partial<Job> }) {
  const [doc, setDoc] = useState(blankJob(nextJobNumber(store.jobs), initial));
  const [schedule, setSchedule] = useState(false);
  const [error, setError] = useState("");
  const change = <K extends keyof Job>(key: K, value: Job[K]) => setDoc({ ...doc, [key]: value });
  const sites = customerSites.filter((site) => site.customer === doc.customer);
  const pickable = store.instruments.filter((item) => item.siteId === doc.siteId && item.status === "Active");
  const selectedCount = doc.instrumentIds.length;
  const create = () => {
    if (!doc.customer || !doc.siteId) { setError("Select a customer and site."); return; }
    if (!doc.description.trim() && !selectedCount) { setError("Enter a work description or select at least one instrument."); return; }
    if (!Number.isFinite(doc.hours) || doc.hours <= 0) { setError("Estimated duration must be greater than zero."); return; }
    if (doc.instrumentIds.some((id) => openJobFor(store.jobs, id))) { setError("One or more selected instruments already have an active job. Review the linked job before creating another."); return; }
    if (schedule && (!doc.engineer || !doc.scheduledDate || !doc.plannedStart)) { setError("To schedule this job, choose an engineer, date and time. Otherwise turn off Schedule now."); return; }
    const created: Job = schedule ? { ...doc, status: "Scheduled", activities: [{ title: `Job created and scheduled with ${doc.engineer}`, meta: stamp(), tone: "assigned" }] } : { ...doc, scheduledDate: "", engineer: undefined, plannedStart: undefined };
    updateStore((current) => ({ jobs: [created, ...current.jobs] })); done(created);
  };
  return <Overlay label="New Job" onClose={close}><section className="stock-move-modal job-new-modal jobs-form-modal"><header className="jobs-form-header"><div><h2>New Job</h2><p>{doc.number}</p></div><button className="settings-outline" aria-label="Close New Job" onClick={close}>×</button></header><div className="jobs-form-body">
    <section className="erp-form-section"><h3>Customer & Site</h3><div className="quote-header-grid ci-form-grid"><label><span>Customer <b className="lead-required">Required</b></span><select value={doc.customer} onChange={(event) => setDoc({ ...doc, customer: event.target.value, siteId: "", instrumentIds: [] })}><option value="">Select customer</option>{store.customers.map((entry) => <option key={entry.id}>{entry.name}</option>)}</select></label><label><span>Site <b className="lead-required">Required</b></span><select value={doc.siteId} disabled={!doc.customer} onChange={(event) => setDoc({ ...doc, siteId: event.target.value, instrumentIds: [] })}><option value="">Select site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}</select></label><label><span>Linked order <em className="lead-optional">Optional</em></span><input value={doc.orderRef ?? ""} onChange={(event) => change("orderRef", event.target.value || undefined)} placeholder="e.g. ORD-2026-0501" /></label></div></section>
    <section className="erp-form-section"><h3>Work Details</h3><div className="quote-header-grid ci-form-grid"><label><span>Job Type</span><select value={doc.type} onChange={(event) => setDoc({ ...doc, type: event.target.value as JobType })}>{JOB_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label><label><span>Work Location</span><select value={doc.doneAt} onChange={(event) => change("doneAt", event.target.value as Job["doneAt"])}><option>Site visit</option><option value="In-lab">In-lab</option></select></label><label><span>Estimated Duration (hours)</span><input type="number" min="0.25" step="0.25" value={doc.hours} onChange={(event) => change("hours", Number(event.target.value))} /></label><label className="quote-grid-wide"><span>Work Description</span><textarea value={doc.description} onChange={(event) => change("description", event.target.value)} /></label></div></section>
    <section className="erp-form-section"><h3>Instruments <small>{selectedCount} selected</small></h3><div className="job-pick-list">{!doc.siteId && <p className="erp-muted">Select a customer and site to see instruments.</p>}{doc.siteId && !pickable.length && <p className="erp-muted">No active instruments at this site. You can save a job with a work description.</p>}{pickable.map((item) => { const conflict = openJobFor(store.jobs, item.id); return <label key={item.id} className={doc.instrumentIds.includes(item.id) ? "is-ticked" : ""}><input type="checkbox" disabled={Boolean(conflict)} checked={doc.instrumentIds.includes(item.id)} onChange={(event) => change("instrumentIds", event.target.checked ? [...doc.instrumentIds, item.id] : doc.instrumentIds.filter((id) => id !== item.id))} /><div><b>{item.name}</b><span>{item.make} {item.model} · {item.serial || `Asset ID: ${item.id}`}</span>{conflict && <span className="job-late">Already assigned: {conflict.number} · {conflict.status}</span>}</div></label>; })}</div></section>
    <section className="erp-form-section"><h3>Scheduling</h3><div className="quote-header-grid ci-form-grid"><label><span>Required Date (optional)</span><input type="date" value={doc.requiredDate ?? ""} onChange={(event) => change("requiredDate", event.target.value || undefined)} /><small>A requested deadline, not a confirmed appointment.</small></label><label className="jobs-checkbox-field"><input type="checkbox" checked={schedule} onChange={(event) => { setSchedule(event.target.checked); setError(""); }} /><span>Schedule now</span></label>{schedule && <><label><span>Scheduled Date</span><input type="date" value={doc.scheduledDate} onChange={(event) => change("scheduledDate", event.target.value)} /></label><label><span>Engineer</span><select value={doc.engineer ?? ""} onChange={(event) => change("engineer", event.target.value || undefined)}><option value="">Select engineer</option>{engineers.map((engineer) => <option key={engineer.name}>{engineer.name}</option>)}</select></label><label><span>Time</span><input type="time" value={doc.plannedStart ?? "09:30"} onChange={(event) => change("plannedStart", event.target.value)} /></label></>}</div>{!schedule && <p className="erp-muted">Saved as unassigned with no appointment.</p>}</section>
    {error && <p className="jobs-form-error" role="alert">{error}</p>}
  </div><footer className="jobs-form-footer"><span>{selectedCount} instruments selected</span><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={create}>Create Job</button></footer></section></Overlay>;
}
