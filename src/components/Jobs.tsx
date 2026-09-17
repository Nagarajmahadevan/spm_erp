import { Fragment, useMemo, useState } from "react";
import { CITIES, ENGINEER, JOB_SETTINGS, JOB_SLOTS, JOB_TYPES, SLOT_TIMES, addDaysIso, addMonths, customerMaster, customerSites, dateIso, dayDifference, engineers, istStamp, istTime, label12h, minutesToTime, nowIso, prettyDate, shortDay, siteById, stamp, timeToMinutes, weekStart } from "./erpMasters";
import { adjustBalance, balanceAt, billingStatusOf, computeVisitStatus, dayCapacity, jobFullyResolved, openJobFor, priorityOf, skillFitFor, updateStore, useErpStore, visitWindow, visitsOn, type Job, type JobPriority, type JobResult, type JobSlot, type JobStatus, type JobType, type JobVisit, type StockMove, type VisitOutcome, type VisitRow } from "./erpStore";
import { Overlay, Pagination, useTablePage } from "./ErpUi";
import "./jobs.css";

const STATUS_TABS: (JobStatus | "All Jobs")[] = ["All Jobs", "Unassigned", "Scheduled", "In progress", "On hold", "Completed", "Cancelled"];
const statusClass = (status: JobStatus) => `job-status job-status--${status.toLowerCase().replace(/ /g, "-")}`;
const isLate = (job: Job) => Boolean(job.scheduledDate) && job.status !== "Completed" && job.status !== "Cancelled" && dayDifference(job.scheduledDate) < 0;
const nextJobNumber = (jobs: Job[]) => `JOB-${Math.max(1041, ...jobs.map((job) => Number(job.number.split("-")[1]) || 0)) + 1}`;
const hoursLabel = (minutes: number) => `${Number((minutes / 60).toFixed(1))}h`;
const sameCity = (a?: string, b?: string) => a?.toLowerCase() === b?.toLowerCase();
const scheduledLabel = (job: Job) => job.scheduledDate ? prettyDate(job.scheduledDate) : "Not scheduled";
const slotForStart = (start: string): JobSlot => start < "13:00" ? "Morning" : "Afternoon";
const fitsWindow = (segments: { start: string; end: string }[], start: string, end: string, travel = 0) => Boolean(start && end && end > start && segments.some((segment) => timeToMinutes(start) >= timeToMinutes(segment.start) && timeToMinutes(end) + travel * 60 <= timeToMinutes(segment.end)));

function blankJob(number: string): Job {
  return { id: number, number, type: "Calibration", customer: "", siteId: "", instrumentIds: [], stockIds: [], description: "", doneAt: "Customer site", scheduledDate: "", slot: JOB_SETTINGS.defaultSlot, hours: 2, status: "Unassigned", expectedSpares: [], usedSpares: [], results: [], travelNotes: "", photos: 0, activities: [{ title: "Job created", meta: stamp(), tone: "system" }] };
}

export default function Jobs({ isEngineer = false, focusJob }: { isEngineer?: boolean; focusJob?: string }) {
  const store = useErpStore();
  const [section, setSection] = useState<"list" | "schedule" | "today">("list");
  const [tab, setTab] = useState<JobStatus | "All Jobs">("All Jobs");
  const [billing, setBilling] = useState("All billing statuses");
  const [openId, setOpenId] = useState<string | null>(focusJob ?? null);
  const [assignId, setAssignId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
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
  return <section className="leads-page jobs-page">
    <div className="leads-heading"><div><p className="erp-secondary-text">Operations / Jobs</p><h1>Jobs</h1></div><button className="erp-action" onClick={() => setCreating(true)}>+ New Job</button></div>
    {!isEngineer && <div className="stock-tabs jobs-view-tabs">{(["list", "schedule", "today"] as const).map((view) => <button key={view} className={section === view ? "is-active" : ""} onClick={() => setSection(view)}>{view === "list" ? "Jobs List" : view === "schedule" ? "Schedule" : "Today"}</button>)}</div>}
    {section === "schedule" && !isEngineer ? <ScheduleBoard store={store} openJob={setOpenId} flash={flash} /> : section === "today" && !isEngineer ? <JobsToday store={store} openJob={setOpenId} /> : <>
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
        <td><b>{job.number}</b><small>{job.type}</small>{priorityOf(job) !== "Normal" && <small className="job-late">{priorityOf(job)} priority</small>}</td>
        <td><b>{job.customer}</b><small>{siteById(job.siteId)?.name} · {siteById(job.siteId)?.city}</small></td>
        <td>{job.requiredDate && <small className="jobs-date">Required: {prettyDate(job.requiredDate)}</small>}<span className="jobs-date">{job.scheduledDate ? `Scheduled: ${prettyDate(job.scheduledDate)}` : "Not scheduled"}</span>{job.scheduledDate && <small className="jobs-date">{label12h(visitWindow(job).start)}–{label12h(visitWindow(job).end)}</small>}</td>
        <td>{job.hours}h</td><td>{job.engineer ?? <span className="erp-muted">Unassigned</span>}</td><td><span className={statusClass(job.status)}>{job.status}</span>{billingStatusOf(job) !== "Not applicable" && <small>Billing: {billingStatusOf(job)}</small>}</td>
        <td>{job.status === "Unassigned" && !isEngineer && <button className="erp-record-link" onClick={(event) => { event.stopPropagation(); setAssignId(job.id); }}>Assign</button>}</td>
      </tr>)}</tbody></table>{!rows.length && <div className="settings-empty"><b>No jobs match these filters</b><p>Try another customer, engineer or date.</p><button className="erp-record-link" onClick={clear}>Clear filters</button></div>}</div>
      <Pagination total={rows.length} page={page} onPage={setPage} />
    </>}
    {open && <Overlay label={`${open.number} details`} onClose={() => setOpenId(null)} className="stock-modal-backdrop jobs-drawer-backdrop"><div className="jobs-detail-drawer"><JobRecord job={open} store={store} isEngineer={isEngineer} close={() => setOpenId(null)} flash={flash} /></div></Overlay>}
    {assignJob && <AssignEngineer job={assignJob} store={store} close={() => setAssignId(null)} flash={flash} />}
    {creating && <NewJob store={store} close={() => setCreating(false)} done={(job) => { setCreating(false); flash(`${job.number} created${job.engineer ? " and scheduled" : " · unassigned"}.`); }} />}
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
  const cap = dayCapacity(store.jobs, store.leaves, store.holidays, row.engineer, row.plannedDate);
  if (cap.blocked) issues.push(`${cap.blocked.reason} conflict`);
  if (cap.overlap) issues.push("Schedule overlap");
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
  const keyOf = (row: VisitRow) => `${row.jobId}-${row.visitId ?? "primary"}-${row.engineer}`;
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

function ScheduleBoard({ store, openJob, flash }: { store: ReturnType<typeof useErpStore>; openJob: (id: string) => void; flash: (message: string) => void }) {
  const [viewMode, setViewMode] = useState<"day" | "week">("week");
  const [anchor, setAnchor] = useState(dateIso());
  const [city, setCity] = useState("All cities");
  const [engineerFilter, setEngineerFilter] = useState("All engineers");
  const [queueOpen, setQueueOpen] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [target, setTarget] = useState<{ jobId: string; engineer: string; date: string } | null>(null);
  const [assignId, setAssignId] = useState<string | null>(null);
  const days = viewMode === "week" ? Array.from({ length: 6 }, (_, i) => addDaysIso(weekStart(anchor), i)) : [anchor];
  const unassigned = store.jobs.filter((job) => job.status === "Unassigned" && (city === "All cities" || siteById(job.siteId)?.city === city));
  const visibleEngineers = engineers.filter((engineer) => engineerFilter === "All engineers" || engineer.name === engineerFilter);
  const assignJob = store.jobs.find((job) => job.id === (target?.jobId ?? assignId));
  return <div className="board-wrap jobs-board">
    <div className="board-toolbar"><div className="board-week"><div className="job-view-toggle"><button className={viewMode === "day" ? "is-active" : ""} onClick={() => setViewMode("day")}>Day</button><button className={viewMode === "week" ? "is-active" : ""} onClick={() => setViewMode("week")}>Week</button></div><button className="settings-outline" aria-label="Previous date range" onClick={() => setAnchor(addDaysIso(anchor, viewMode === "week" ? -7 : -1))}>←</button><b>{viewMode === "week" ? `${shortDay(days[0])} – ${shortDay(days[5])}` : prettyDate(anchor)}</b><button className="settings-outline" aria-label="Next date range" onClick={() => setAnchor(addDaysIso(anchor, viewMode === "week" ? 7 : 1))}>→</button><button className="settings-outline" onClick={() => setAnchor(dateIso())}>Today</button></div><button className="settings-outline" aria-expanded={queueOpen} onClick={() => setQueueOpen(!queueOpen)}>{queueOpen ? "Hide" : "Show"} Unassigned Jobs ({unassigned.length})</button></div>
    <div className="erp-filters jobs-filters"><label><span>Engineer</span><select value={engineerFilter} onChange={(event) => setEngineerFilter(event.target.value)}><option>All engineers</option>{engineers.map((engineer) => <option key={engineer.name}>{engineer.name}</option>)}</select></label><label><span>Site city</span><select value={city} onChange={(event) => setCity(event.target.value)}><option>All cities</option>{CITIES.map((value) => <option key={value}>{value}</option>)}</select></label>{(engineerFilter !== "All engineers" || city !== "All cities") && <button className="erp-record-link" onClick={() => { setEngineerFilter("All engineers"); setCity("All cities"); }}>Clear all</button>}</div>
    <div className={`board-layout${queueOpen ? "" : " jobs-queue-collapsed"}`}>
      {queueOpen && <aside className="board-queue"><h3>Unassigned Jobs <span>{unassigned.length}</span></h3>{unassigned.map((job) => <div key={job.id} className="board-chip is-queued" draggable onDragStart={() => setDragged(job.id)} onDragEnd={() => setDragged(null)}><button className="erp-record-link" onClick={() => openJob(job.id)}>{job.number}</button><b>{job.customer}</b><span>{siteById(job.siteId)?.name} · {siteById(job.siteId)?.city}</span><small>{job.type} · {job.hours}h{job.requiredDate ? ` · Required ${prettyDate(job.requiredDate)}` : ""}</small><button className="erp-record-link" onClick={() => setAssignId(job.id)}>Assign</button></div>)}{!unassigned.length && <p>No unassigned jobs.</p>}</aside>}
      <div className="board-grid-wrap" tabIndex={0} aria-label="Engineer schedule, scroll for all days"><div className="board-grid" style={{ gridTemplateColumns: `150px repeat(${days.length}, minmax(195px, 1fr))` }}><div className="board-corner">Engineer</div>{days.map((day) => <div key={day} className={`board-day${day === dateIso() ? " is-today" : ""}`}>{shortDay(day)}{store.holidays.some((holiday) => holiday.date === day) && <small>Holiday</small>}</div>)}{visibleEngineers.map((engineer) => <Fragment key={engineer.name}><div className="board-engineer"><b>{engineer.name}</b><span>{engineer.base}</span></div>{days.map((day) => {
        const cap = dayCapacity(store.jobs, store.leaves, store.holidays, engineer.name, day);
        const visits = visitsOn(store.jobs, day).filter((row) => row.engineer === engineer.name && row.visitStatus !== "Cancelled" && (city === "All cities" || siteById(row.siteId)?.city === city));
        const off = Boolean(cap.blocked && !cap.blocked.halfDay);
        return <div key={day} className={`board-cell board-cell--${off ? "off" : cap.overlap ? "over" : cap.freeMinutes <= 0 ? "full" : "ok"}`} onDragOver={(event) => { if (dragged && !off) event.preventDefault(); }} onDrop={() => { if (dragged && !off) setTarget({ jobId: dragged, engineer: engineer.name, date: day }); }}>
          <span className="board-load">{hoursLabel(cap.bookedMinutes)} booked · {hoursLabel(cap.freeMinutes)} free</span>{cap.blocked && <span className="board-off">{cap.blocked.reason}{visits.length ? " · Assignment needs review" : ""}</span>}{cap.overlap && <small className="job-late">Schedule overlap</small>}{visits.map((row) => <button key={`${row.jobId}-${row.visitId ?? "primary"}`} className={`board-chip board-chip--${row.jobType.toLowerCase().split(" ")[0]}`} onClick={() => openJob(row.jobId)}><b>{row.customer}</b><span>{siteById(row.siteId)?.name}</span><small className="board-slot">{label12h(row.plannedStart)}–{label12h(row.plannedEnd)}</small><small>{row.jobType}</small>{!sameCity(engineer.base, siteById(row.siteId)?.city) && <small className="job-late">Travel review · {siteById(row.siteId)?.city}</small>}</button>)}
        </div>;
      })}</Fragment>)}</div></div>
    </div>
    {assignJob && <AssignEngineer key={`${assignJob.id}-${target?.date ?? ""}`} job={assignJob} store={store} initialEngineer={target?.engineer} initialDate={target?.date} close={() => { setTarget(null); setAssignId(null); setDragged(null); }} flash={flash} />}
  </div>;
}

function AssignEngineer({ job, store, close, flash, initialEngineer, initialDate }: { job: Job; store: ReturnType<typeof useErpStore>; close: () => void; flash: (message: string) => void; initialEngineer?: string; initialDate?: string }) {
  const [date, setDate] = useState(initialDate ?? job.scheduledDate ?? "");
  const [engineer, setEngineer] = useState(initialEngineer ?? job.engineer ?? "");
  const [start, setStart] = useState(job.plannedStart ?? "");
  const [end, setEnd] = useState(job.plannedEnd ?? "");
  const [travel, setTravel] = useState(job.travelAllowanceHours ?? 0);
  const [error, setError] = useState("");
  const site = siteById(job.siteId);
  const otherJobs = store.jobs.map((entry) => entry.id === job.id ? { ...entry, engineer: undefined, additionalEngineers: [] } : entry);
  const cap = engineer && date ? dayCapacity(otherJobs, store.leaves, store.holidays, engineer, date) : undefined;
  const base = engineers.find((entry) => entry.name === engineer)?.base;
  const crossCity = base && !sameCity(base, site?.city);
  const ranked = engineers.map((entry) => ({ ...entry, capacity: date ? dayCapacity(otherJobs, store.leaves, store.holidays, entry.name, date) : undefined, fit: skillFitFor(job.type, entry.skills) })).sort((a, b) => Number(Boolean(a.capacity?.blocked)) - Number(Boolean(b.capacity?.blocked)) || Number(!sameCity(a.base, site?.city)) - Number(!sameCity(b.base, site?.city)));
  const assign = () => {
    if (!date || !engineer || !start || !end) { setError("Choose a date, engineer, planned start and end time."); return; }
    if (end <= start) { setError("Planned end must be after planned start."); return; }
    if (!Number.isFinite(travel) || travel < 0) { setError("Travel allowance must be zero or a positive number."); return; }
    if (!cap || !fitsWindow(cap.freeSegments, start, end, travel)) { setError("This booking and travel allowance must fit one available time slot. Choose a free slot below."); return; }
    updateStore((current) => ({ jobs: current.jobs.map((entry) => entry.id !== job.id ? entry : { ...entry, engineer, scheduledDate: date, plannedStart: start, plannedEnd: end, slot: slotForStart(start), hours: (timeToMinutes(end) - timeToMinutes(start)) / 60, travelAllowanceHours: travel || undefined, status: entry.status === "In progress" ? "In progress" as const : "Scheduled" as const, activities: [{ title: `Assigned to ${engineer} for ${prettyDate(date)}, ${label12h(start)}–${label12h(end)}${crossCity ? ` · Travel review: ${base} to ${site?.city}` : ""}`, meta: stamp(), tone: "assigned" as const }, ...entry.activities] }) }));
    close(); flash(`${job.number} scheduled with ${engineer}.${crossCity ? " Travel review required." : ""}`);
  };
  return <Overlay label="Assign engineer" onClose={close}><section className="stock-move-modal jobs-form-modal"><header className="jobs-form-header"><div><h2>Assign engineer</h2><p>{job.number} · {job.customer} · {site?.name}</p></div><button className="settings-outline" aria-label="Close assignment" onClick={close}>×</button></header><div className="jobs-form-body"><div className="quote-header-grid ci-form-grid"><label><span>Scheduled date</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setError(""); }} /></label><label><span>Engineer</span><select value={engineer} onChange={(event) => { setEngineer(event.target.value); setError(""); }}><option value="">Select engineer</option>{ranked.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} · {entry.base}{entry.capacity?.blocked ? ` · ${entry.capacity.blocked.reason}` : ""}</option>)}</select></label><label><span>Planned start</span><input type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label><label><span>Planned end</span><input type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></label><label><span>Travel allowance (hours)</span><input type="number" min="0" step="0.5" value={travel} onChange={(event) => setTravel(Number(event.target.value))} /></label></div>
      {cap && <section className="erp-form-section jobs-free-slots"><h3>Available time slots</h3><p>{hoursLabel(cap.bookedMinutes)} booked · {hoursLabel(cap.freeMinutes)} free</p>{cap.blocked && <p className="job-late">{cap.blocked.reason}</p>}{cap.freeSegments.length ? cap.freeSegments.map((segment) => <button className="settings-outline" key={segment.start} onClick={() => { setStart(segment.start); setEnd(minutesToTime(Math.min(timeToMinutes(segment.end) - travel * 60, timeToMinutes(segment.start) + job.hours * 60))); setError(""); }}>{label12h(segment.start)}–{label12h(segment.end)}</button>) : <p>No available slots. Choose another engineer or date.</p>}<small>Choose a slot to fill the planned times. Travel allowance reserves time after the visit.</small></section>}
      {crossCity && <p className="master-warning"><b>Travel review required</b><span>{engineer} is based in {base}; the site is in {site?.city}. Confirm travel arrangements and reserve suitable travel time.</span></p>}{engineer && skillFitFor(job.type, engineers.find((entry) => entry.name === engineer)?.skills ?? []) === "gap" && <p className="master-warning">Engineer skills need review for {job.type.toLowerCase()}.</p>}{job.checkIn && <p className="erp-muted">Recorded check-in will be preserved.</p>}{error && <p className="jobs-form-error" role="alert">{error}</p>}
    </div><footer className="jobs-form-footer"><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={assign}>Confirm assignment</button></footer></section></Overlay>;
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

/* ─── Add engineer / Add visit ───────────────────────────────────── */
function AddVisitForm({ job, close }: { job: Job; close: () => void }) {
  const [engineer, setEngineer] = useState(job.engineer ?? engineers[0].name);
  const [plannedDate, setPlannedDate] = useState(job.scheduledDate);
  const [slot, setSlot] = useState<JobSlot>(job.slot);
  const submit = () => {
    const window = SLOT_TIMES[slot];
    const visit: JobVisit = { id: `visit-${Date.now()}`, engineer, plannedDate, plannedStart: window.start, plannedEnd: window.end };
    updateStore((current) => ({ jobs: current.jobs.map((entry) => entry.id !== job.id ? entry : { ...entry, additionalVisits: [...(entry.additionalVisits ?? []), visit], activities: [{ title: `Added a visit for ${engineer} on ${prettyDate(plannedDate)}`, meta: stamp(), tone: "assigned" as const }, ...entry.activities] }) }));
    close();
  };
  return <div className="stock-modal-backdrop" onClick={close}><section className="stock-move-modal" role="dialog" aria-modal="true" aria-labelledby="add-visit-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <h2 id="add-visit-title">Add a visit</h2>
    <div className="quote-header-grid ci-form-grid">
      <label><span>Engineer</span><select value={engineer} onChange={(event) => setEngineer(event.target.value)}>{engineers.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label>
      <label><span>Date</span><input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} /></label>
      <label><span>Slot</span><select value={slot} onChange={(event) => setSlot(event.target.value as JobSlot)}>{JOB_SLOTS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
    </div>
    <div className="invoice-payment-footer"><span /><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={submit}>Add visit</button></div></div>
  </section></div>;
}

function AddEngineerForm({ job, close }: { job: Job; close: () => void }) {
  const options = engineers.filter((entry) => entry.name !== job.engineer && !(job.additionalEngineers ?? []).includes(entry.name));
  const [name, setName] = useState(options[0]?.name ?? "");
  const submit = () => {
    updateStore((current) => ({ jobs: current.jobs.map((entry) => entry.id !== job.id ? entry : { ...entry, additionalEngineers: [...(entry.additionalEngineers ?? []), name], activities: [{ title: `Added ${name} to this visit`, meta: stamp(), tone: "assigned" as const }, ...entry.activities] }) }));
    close();
  };
  return <div className="stock-modal-backdrop" onClick={close}><section className="stock-move-modal" role="dialog" aria-modal="true" aria-labelledby="add-engineer-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <h2 id="add-engineer-title">Add engineer</h2>
    {options.length ? <><label className="settings-field"><span>Engineer</span><select value={name} onChange={(event) => setName(event.target.value)}>{options.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label>
      <div className="invoice-payment-footer"><span /><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={submit}>Add</button></div></div></> : <p className="po-start-hint">Everyone is already on this visit.</p>}
  </section></div>;
}

function VisitRowView({ label, engineer, plannedDate, window, checkIn, checkOut, outcome, cancelled }: { label: string; engineer?: string; plannedDate: string; window: { start: string; end: string }; checkIn?: Job["checkIn"]; checkOut?: Job["checkOut"]; outcome?: VisitOutcome; cancelled: boolean }) {
  const status = computeVisitStatus({ plannedDate, plannedStart: window.start, checkIn, checkOut, cancelled }, nowIso());
  return <div>
    <b>{label} · {engineer ?? "Nobody assigned"}</b>
    <span>{plannedDate ? `${prettyDate(plannedDate)} · ${label12h(window.start)}–${label12h(window.end)} · ${status}` : "Not scheduled"}</span>
    <small>Check-in {checkIn ? istStamp(checkIn.at) : "—"}{checkIn?.locationCheck ? ` · ${checkIn.locationCheck}` : ""} · Check-out {checkOut ? istStamp(checkOut.at) : "—"}{outcome ? ` · ${outcome}` : ""}</small>
  </div>;
}

/* ─── Job record ─────────────────────────────────────────────────── */
function JobRecord({ job, store, isEngineer, close, flash }: { job: Job; store: ReturnType<typeof useErpStore>; isEngineer: boolean; close: () => void; flash: (message: string) => void }) {
  const [assigning, setAssigning] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [holding, setHolding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [addingVisit, setAddingVisit] = useState(false);
  const [addingEngineer, setAddingEngineer] = useState(false);
  const site = siteById(job.siteId);
  const instruments = store.instruments.filter((item) => job.instrumentIds.includes(item.id));
  const stock = store.individuals.filter((item) => job.stockIds.includes(item.id));
  const billing = billingStatusOf(job);

  const start = () => {
    updateStore((current) => ({ jobs: current.jobs.map((entry) => entry.id !== job.id ? entry : { ...entry, status: "In progress" as const, startedAt: dateIso(), activities: [{ title: "Started on site", meta: stamp(), tone: "system" as const }, ...entry.activities] }) }));
    flash("Job started. Fill in each instrument as you go.");
  };
  const createInvoice = () => {
    updateStore((current) => {
      const number = `INV-2026-${String(Math.max(118, ...current.invoices.map((inv) => Number(inv.number.split("-").at(-1)) || 0)) + 1).padStart(4, "0")}`;
      return { jobs: current.jobs.map((entry) => entry.id !== job.id ? entry : { ...entry, invoiceNumber: number, activities: [{ title: `Invoice ${number} created`, meta: stamp(), tone: "system" as const }, ...entry.activities] }) };
    });
    flash("Invoice draft created with the service lines and spares used. Open it in Invoices to send.");
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

  return <section className="quote-editor-page invoice-editor-page job-record-page">
    <header className="quote-editor-head"><div>
      <button className="quote-back" aria-label="Close job details" onClick={close}>× Close</button>
      <p>Operations / Jobs</p>
      <h1>{job.number}</h1>
      <span className={statusClass(job.status)}>{job.status}</span>
      {billing !== "Not applicable" && <span className={billing === "To invoice" ? "due-nojob" : "due-job-chip"}>{billing}</span>}
      {isLate(job) && <span className="invoice-due-chip is-late">Overdue · {Math.abs(dayDifference(job.scheduledDate))}d</span>}
    </div><div className="quote-editor-actions">
      {job.status === "Unassigned" && <button className="erp-action" onClick={() => setAssigning(true)}>Assign engineer</button>}
      {job.status === "Scheduled" && <><button className="erp-action" onClick={start}>Start job</button>{!isEngineer && <button className="settings-outline" onClick={() => setAssigning(true)}>Reassign</button>}{!isEngineer && <button className="settings-outline" onClick={() => setHolding(true)}>Put on hold</button>}</>}
      {job.status === "In progress" && <><button className="erp-action" onClick={() => setCompleting(true)}>Log visit outcome</button>{!isEngineer && <button className="settings-outline" onClick={() => setHolding(true)}>Put on hold</button>}</>}
      {job.status === "On hold" && <button className="erp-action" onClick={resume}>Resume</button>}
      {job.status === "Completed" && billing === "To invoice" && !isEngineer && <button className="erp-action" onClick={createInvoice}>Create invoice</button>}
      {job.status === "Completed" && billing === "Invoiced" && <button className="settings-outline" onClick={() => flash(`${job.invoiceNumber} opened in Invoices`)}>Open {job.invoiceNumber}</button>}
      {!isEngineer && job.status !== "Completed" && job.status !== "Cancelled" && <button className="settings-outline" onClick={() => setCancelling(true)}>Cancel job</button>}
    </div></header>

    <main className="invoice-editor-layout">
      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>Work Details</h2><span>{job.type}</span></div></div>
        <p className="job-description">{job.description || "No description."}</p>
        <div className="job-instrument-list">{instruments.map((item) => <div key={item.id}><b>{item.name}</b><span>{item.make} {item.model} · {item.serial}</span><small>{item.intervalMonths ? `Every ${item.intervalMonths} months` : "Calibration interval unknown"}</small></div>)}
          {stock.map((item) => <div key={item.id}><b>{item.name}</b><span>Our equipment · {item.id}</span><small>{item.opStatus}</small></div>)}
          {!instruments.length && !stock.length && <p className="stock-timeline-empty">No instruments on this job yet.</p>}
        </div>
      </section>

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>Customer & Site</h2><span>{job.doneAt === "Our lab" ? "At SPM" : job.doneAt}</span></div></div>
        <dl className="invoice-facts due-facts">
          <div><dt>Customer</dt><dd>{job.customer}</dd></div>
          <div><dt>Site</dt><dd>{site?.name}</dd></div>
          <div className="invoice-fact-wide"><dt>Address</dt><dd>{site?.address}, {site?.city}</dd></div>
          <div><dt>Contact</dt><dd>{site?.contact}</dd></div>
          <div><dt>Phone</dt><dd><a className="job-call" href={`tel:${site?.phone.replace(/\s/g, "")}`}>{site?.phone}</a></dd></div>
        </dl>
      </section>

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>Visits</h2><span>{(job.scheduledDate && job.engineer ? 1 : 0) + (job.additionalVisits?.length ?? 0)} planned</span></div>{!isEngineer && job.status !== "Cancelled" && <div className="quote-editor-actions"><button className="settings-outline" onClick={() => setAddingEngineer(true)}>+ Add engineer</button><button className="settings-outline" onClick={() => setAddingVisit(true)}>+ Add visit</button></div>}</div>
        <div className="job-instrument-list">
          <VisitRowView label="Primary" engineer={job.engineer} plannedDate={job.scheduledDate} window={visitWindow(job)} checkIn={job.checkIn} checkOut={job.checkOut} outcome={job.outcome} cancelled={job.status === "Cancelled"} />
          {(job.additionalVisits ?? []).map((visit) => <VisitRowView key={visit.id} label="Additional" engineer={visit.engineer} plannedDate={visit.plannedDate} window={{ start: visit.plannedStart, end: visit.plannedEnd }} checkIn={visit.checkIn} checkOut={visit.checkOut} outcome={visit.outcome} cancelled={Boolean(visit.cancelled)} />)}
        </div>
        {(job.additionalEngineers ?? []).length > 0 && <p className="po-start-hint">Also on this visit: {job.additionalEngineers!.join(", ")}</p>}
        {job.remainingWork && <p className="po-start-hint">Remaining work: {job.remainingWork}</p>}
      </section>

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>When and who</h2><span>{job.hours} hours estimated{job.travelAllowanceHours ? ` · ${job.travelAllowanceHours}h travel allowance` : ""}</span></div></div>
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
          {result.certificate && <button className="ci-cert">{result.certificate}</button>}
        </div>; })}</div>
        {job.travelNotes && <p className="job-travel">Travel: {job.travelNotes}</p>}
        {job.signature && <p className="job-signed">Signed by the customer · {job.photos} photo{job.photos === 1 ? "" : "s"} attached</p>}
      </section>}

      <section className="quote-document-section invoice-block">
        <div className="quote-section-title"><div><h2>History</h2><span>What has happened to this job.</span></div></div>
        <div className="lead-timeline quote-activity">{job.activities.map((activity, index) => <div key={index} className={activity.tone ? `job-timeline--${activity.tone}` : ""}><i /><p><b>{activity.title}</b><span>{activity.meta}</span></p></div>)}</div>
      </section>


    </main>

    {job.status === "In progress" && <div className="invoice-mobile-bar"><button className="erp-action" onClick={() => setCompleting(true)}>Log visit outcome</button><a className="settings-outline" href={`tel:${site?.phone.replace(/\s/g, "")}`}>Call site</a></div>}
    {job.status === "Scheduled" && <div className="invoice-mobile-bar"><button className="erp-action" onClick={start}>Start job</button><a className="settings-outline" href={`tel:${site?.phone.replace(/\s/g, "")}`}>Call site</a></div>}

    {assigning && <AssignEngineer job={job} store={store} close={() => setAssigning(false)} flash={flash} />}
    {completing && <CompleteVisit job={job} store={store} close={() => setCompleting(false)} flash={flash} />}
    {holding && <ReasonPrompt title="Put this job on hold" submitLabel="Put on hold" close={() => setHolding(false)} submit={putOnHold} />}
    {cancelling && <ReasonPrompt title="Cancel this job" submitLabel="Cancel job" close={() => setCancelling(false)} submit={cancelJob} />}
    {addingVisit && <AddVisitForm job={job} close={() => setAddingVisit(false)} />}
    {addingEngineer && <AddEngineerForm job={job} close={() => setAddingEngineer(false)} />}
  </section>;
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
  const [scheduleFollowUp, setScheduleFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState(addDaysIso(job.scheduledDate, 2));
  const isCalibration = job.type === "Calibration";

  const total = instruments.length + 1;
  const engineerName = job.engineer ?? ENGINEER;
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

  const finish = () => {
    if (!outcome) return;
    const today = dateIso();
    updateStore((current) => {
      // Only a completed Calibration job updates calibration history and the next due date —
      // a generic service or repair job must leave the existing schedule untouched.
      const instrumentsNext = current.instruments.map((item) => {
        const result = results.find((entry) => entry.instrumentId === item.id);
        if (!result || !isCalibration) return item;
        return { ...item, history: [...item.history, { id: `cr-${Date.now()}-${item.id}`, date: today, engineer: engineerName, result: result.outcome, certificate: `CERT-2026-${String(300 + item.history.length).padStart(4, "0")}`, jobNumber: job.number }] };
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
      const followUpWindow = SLOT_TIMES[job.slot];
      const nextVisit: JobVisit | null = scheduleFollowUp ? { id: `visit-${Date.now()}`, engineer: engineerName, plannedDate: followUpDate, plannedStart: followUpWindow.start, plannedEnd: followUpWindow.end } : null;
      const resolvesJob = willResolve && jobFullyResolved({ ...job, outcome: outcome || undefined });
      const jobs = current.jobs.map((entry) => entry.id !== job.id ? entry : {
        ...entry, status: resolvesJob ? "Completed" as const : entry.status, completedAt: resolvesJob ? today : entry.completedAt,
        results, usedSpares: used, travelNotes: travel, photos, signature: signed ? "signed" : undefined,
        outcome: outcome || undefined, outcomeNote: outcomeNote || undefined, remainingWork: needsRemaining ? remainingWork || undefined : undefined,
        additionalVisits: nextVisit ? [...(entry.additionalVisits ?? []), nextVisit] : entry.additionalVisits,
        activities: [{ title: `Visit outcome: ${outcome}${nextVisit ? ` — follow-up scheduled ${prettyDate(followUpDate)}` : ""}${resolvesJob ? " — job completed" : ""}`, meta: stamp(), tone: resolvesJob ? "done" as const : "system" as const }, ...entry.activities],
      });
      return { instruments: instrumentsNext, quantities, moves: [...moves, ...current.moves], jobs };
    });
    close();
    const dueList = isCalibration ? instruments.map((item) => item.intervalMonths ? `${item.name} → ${prettyDate(addMonths(today, item.intervalMonths))}` : `${item.name} → interval unknown, due date not set`) : [];
    flash(willResolve ? `${job.number} — outcome recorded.${dueList.length ? ` Next due set: ${dueList.join(", ")}.` : isCalibration ? "" : " Calibration schedules are unchanged for a service/repair job."}${jobFullyResolved({ ...job, outcome: outcome || undefined }) ? " Ready to invoice." : ""}` : `${job.number} — outcome recorded. Job stays open until all visits are resolved.`);
  };

  const onInstrument = step < instruments.length;
  const current = onInstrument ? results[step] : null;
  const item = onInstrument ? instruments[step] : null;
  const canNext = !onInstrument || Boolean(current?.asFound.trim() && current?.asLeft.trim());
  const canFinish = Boolean(outcome && outcomeNote.trim() && (!scheduleFollowUp || followUpDate));

  return <div className="stock-modal-backdrop" onClick={close}><section className="stock-move-modal complete-modal" role="dialog" aria-modal="true" aria-labelledby="complete-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <h2 id="complete-title">{onInstrument ? item?.name : "Visit outcome"}</h2>
    {!isCalibration && <p className="po-start-hint">This is a {job.type.toLowerCase()} job — calibration due dates will not change.</p>}
    <div className="complete-progress"><span>Step {step + 1} of {total}</span><div><i style={{ width: `${((step + 1) / total) * 100}%` }} /></div></div>

    {onInstrument && current && item && <div className="complete-body">
      <p className="po-start-hint">{item.make} {item.model} · {item.serial}</p>
      <label className="due-notes"><span>As found</span><textarea value={current.asFound} onChange={(event) => setResult(step, { asFound: event.target.value })} placeholder="How was it when you arrived?" /></label>
      <label className="due-notes"><span>As left</span><textarea value={current.asLeft} onChange={(event) => setResult(step, { asLeft: event.target.value })} placeholder="How did you leave it?" /></label>
      <div className="complete-outcome">{(["Pass", "Pass after adjustment", "Fail"] as const).map((entry) => <button key={entry} className={current.outcome === entry ? "is-active" : ""} onClick={() => setResult(step, { outcome: entry })}>{entry}</button>)}</div>
      <label className="due-notes"><span>Readings or observations</span><textarea value={current.readings} onChange={(event) => setResult(step, { readings: event.target.value })} placeholder="e.g. 10 V: 10.02 · 100 V: 99.8" /></label>
      <label className="due-notes"><span>Remarks</span><textarea value={current.remarks} onChange={(event) => setResult(step, { remarks: event.target.value })} /></label>
      <label className="complete-file"><span>Certificate</span><input type="file" accept="application/pdf" /></label>
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

      <span className="due-spares-label">Visit outcome</span>
      <div className="complete-outcome complete-outcome--visit">{(["Work completed", "Partially completed", "Customer unavailable", "Follow-up required"] as VisitOutcome[]).map((entry) => <button key={entry} className={outcome === entry ? "is-active" : ""} onClick={() => setOutcome(entry)}>{entry}</button>)}</div>
      <label className="due-notes"><span>Outcome note</span><textarea value={outcomeNote} onChange={(event) => setOutcomeNote(event.target.value)} placeholder="Short note — required to mark the visit outcome" /></label>
      {needsRemaining && <>
        <label className="due-notes"><span>What remains</span><textarea value={remainingWork} onChange={(event) => setRemainingWork(event.target.value)} placeholder="What still needs doing" /></label>
        <label className="settings-check"><input type="checkbox" checked={scheduleFollowUp} onChange={(event) => setScheduleFollowUp(event.target.checked)} /> Schedule a follow-up visit</label>
        {scheduleFollowUp && <label className="assign-date"><span>Follow-up date</span><input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} /></label>}
      </>}
    </div>}

    <div className="invoice-payment-footer complete-footer">
      <span>{onInstrument ? `${instruments.length - step - 1} more instrument${instruments.length - step - 1 === 1 ? "" : "s"}` : willResolve ? "Job will be marked Completed" : "Job stays open"}</span>
      <div>
        <button className="settings-outline" onClick={() => step === 0 ? close() : setStep(step - 1)}>{step === 0 ? "Cancel" : "Back"}</button>
        {onInstrument ? <button className="erp-action" disabled={!canNext} onClick={() => setStep(step + 1)}>Next</button> : <button className="erp-action" disabled={!canFinish} onClick={finish}>Save outcome</button>}
      </div>
    </div>
  </section></div>;
}

/* ─── New job ────────────────────────────────────────────────────── */
function NewJob({ store, close, done }: { store: ReturnType<typeof useErpStore>; close: () => void; done: (job: Job) => void }) {
  const [doc, setDoc] = useState(blankJob(nextJobNumber(store.jobs)));
  const [schedule, setSchedule] = useState(false);
  const [error, setError] = useState("");
  const change = <K extends keyof Job>(key: K, value: Job[K]) => setDoc({ ...doc, [key]: value });
  const sites = customerSites.filter((site) => site.customer === doc.customer);
  const rental = doc.type.startsWith("Rental");
  const pickable = rental ? [] : store.instruments.filter((item) => item.siteId === doc.siteId && item.status === "Active");
  const stockPickable = rental ? store.individuals.filter((item) => item.holder === "Store" && item.opStatus === "Available") : [];
  const selectedCount = doc.instrumentIds.length + doc.stockIds.length;
  const cap = schedule && doc.engineer && doc.scheduledDate ? dayCapacity(store.jobs, store.leaves, store.holidays, doc.engineer, doc.scheduledDate) : undefined;
  const base = engineers.find((engineer) => engineer.name === doc.engineer)?.base;
  const crossCity = base && !sameCity(base, siteById(doc.siteId)?.city);
  const create = () => {
    if (!doc.customer || !doc.siteId) { setError("Select a customer and site."); return; }
    if (!doc.description.trim() && !selectedCount) { setError("Enter a work description or select at least one instrument."); return; }
    if (!Number.isFinite(doc.hours) || doc.hours <= 0) { setError("Estimated duration must be greater than zero."); return; }
    if (doc.instrumentIds.some((id) => openJobFor(store.jobs, id))) { setError("One or more selected instruments already have an active job. Review the linked job before creating another."); return; }
    if (doc.stockIds.some((id) => store.jobs.some((job) => !["Completed", "Cancelled"].includes(job.status) && job.stockIds.includes(id)))) { setError("Selected equipment already belongs to an active job. Choose other equipment."); return; }
    if (schedule && (!doc.engineer || !doc.scheduledDate || !doc.plannedStart || !doc.plannedEnd)) { setError("To schedule this job, choose an engineer, date, planned start and end. Otherwise turn off Schedule now."); return; }
    if (schedule && (!cap || !fitsWindow(cap.freeSegments, doc.plannedStart!, doc.plannedEnd!, doc.travelAllowanceHours ?? 0))) { setError("Planned end must follow start, and the visit plus travel allowance must fit an available time slot."); return; }
    const created: Job = schedule ? { ...doc, status: "Scheduled", slot: slotForStart(doc.plannedStart!), hours: (timeToMinutes(doc.plannedEnd!) - timeToMinutes(doc.plannedStart!)) / 60, activities: [{ title: `Job created and scheduled with ${doc.engineer}${crossCity ? " · Travel review required" : ""}`, meta: stamp(), tone: "assigned" }] } : { ...doc, scheduledDate: "", engineer: undefined, plannedStart: undefined, plannedEnd: undefined, travelAllowanceHours: undefined };
    updateStore((current) => ({ jobs: [created, ...current.jobs] })); done(created);
  };
  return <Overlay label="New Job" onClose={close}><section className="stock-move-modal job-new-modal jobs-form-modal"><header className="jobs-form-header"><div><h2>New Job</h2><p>{doc.number}</p></div><button className="settings-outline" aria-label="Close New Job" onClick={close}>×</button></header><div className="jobs-form-body">
    <section className="erp-form-section"><h3>Customer & Site</h3><div className="quote-header-grid ci-form-grid"><label><span>Customer <b className="lead-required">Required</b></span><select value={doc.customer} onChange={(event) => setDoc({ ...doc, customer: event.target.value, siteId: "", instrumentIds: [], stockIds: [] })}><option value="">Select customer</option>{customerMaster.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label><label><span>Site <b className="lead-required">Required</b></span><select value={doc.siteId} disabled={!doc.customer} onChange={(event) => setDoc({ ...doc, siteId: event.target.value, instrumentIds: [], stockIds: [] })}><option value="">Select site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}</select></label></div></section>
    <section className="erp-form-section"><h3>Work Details</h3><div className="quote-header-grid ci-form-grid"><label><span>Job Type</span><select value={doc.type} onChange={(event) => setDoc({ ...doc, type: event.target.value as JobType, instrumentIds: [], stockIds: [] })}>{JOB_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label><label><span>Work Location</span><select value={doc.doneAt} onChange={(event) => change("doneAt", event.target.value as Job["doneAt"])}><option>Customer site</option><option value="Our lab">At SPM</option></select></label><label><span>Estimated Duration (hours)</span><input type="number" min="0.25" step="0.25" value={doc.hours} onChange={(event) => change("hours", Number(event.target.value))} /></label><label><span>Priority</span><select value={doc.priority ?? "Normal"} onChange={(event) => change("priority", event.target.value as JobPriority)}>{["Low", "Normal", "High", "Urgent"].map((entry) => <option key={entry}>{entry}</option>)}</select></label><label className="quote-grid-wide"><span>Work Description</span><textarea value={doc.description} onChange={(event) => change("description", event.target.value)} /></label></div></section>
    <section className="erp-form-section"><h3>Instruments <small>{selectedCount} selected</small></h3><div className="job-pick-list">{!doc.siteId && <p className="erp-muted">Select a customer and site to see instruments.</p>}{doc.siteId && !rental && !pickable.length && <p className="erp-muted">No active instruments at this site. You can save a job with a work description.</p>}{pickable.map((item) => { const conflict = openJobFor(store.jobs, item.id); return <label key={item.id} className={doc.instrumentIds.includes(item.id) ? "is-ticked" : ""}><input type="checkbox" disabled={Boolean(conflict)} checked={doc.instrumentIds.includes(item.id)} onChange={(event) => change("instrumentIds", event.target.checked ? [...doc.instrumentIds, item.id] : doc.instrumentIds.filter((id) => id !== item.id))} /><div><b>{item.name}</b><span>{item.make} {item.model} · {item.serial || `Asset ID: ${item.id}`}</span>{conflict && <span className="job-late">Already assigned: {conflict.number} · {conflict.status}</span>}</div></label>; })}{doc.siteId && stockPickable.map((item) => { const conflict = store.jobs.find((job) => !["Completed", "Cancelled"].includes(job.status) && job.stockIds.includes(item.id)); return <label key={item.id} className={doc.stockIds.includes(item.id) ? "is-ticked" : ""}><input type="checkbox" disabled={Boolean(conflict)} checked={doc.stockIds.includes(item.id)} onChange={(event) => change("stockIds", event.target.checked ? [...doc.stockIds, item.id] : doc.stockIds.filter((id) => id !== item.id))} /><div><b>{item.name}</b><span>{item.id} · {item.opStatus}</span>{conflict && <span className="job-late">Already assigned: {conflict.number}</span>}{item.calibrationDue && dayDifference(item.calibrationDue) < 0 && <span className="job-late">Calibration overdue · Review before issue</span>}</div></label>; })}</div>{selectedCount > 0 && <p className="jobs-selected-instruments">Selected: {[...store.instruments.filter((item) => doc.instrumentIds.includes(item.id)).map((item) => item.name), ...store.individuals.filter((item) => doc.stockIds.includes(item.id)).map((item) => item.name)].join(", ")}</p>}</section>
    <section className="erp-form-section"><h3>Scheduling</h3><div className="quote-header-grid ci-form-grid"><label><span>Required Date (optional)</span><input type="date" value={doc.requiredDate ?? ""} onChange={(event) => change("requiredDate", event.target.value || undefined)} /><small>A requested deadline, not a confirmed appointment.</small></label><label className="jobs-checkbox-field"><input type="checkbox" checked={schedule} onChange={(event) => { setSchedule(event.target.checked); setError(""); }} /><span>Schedule now</span></label>{schedule && <><label><span>Scheduled Date</span><input type="date" value={doc.scheduledDate} onChange={(event) => change("scheduledDate", event.target.value)} /></label><label><span>Engineer</span><select value={doc.engineer ?? ""} onChange={(event) => change("engineer", event.target.value || undefined)}><option value="">Select engineer</option>{engineers.map((engineer) => <option key={engineer.name}>{engineer.name}</option>)}</select></label><label><span>Planned Start</span><input type="time" value={doc.plannedStart ?? ""} onChange={(event) => change("plannedStart", event.target.value)} /></label><label><span>Planned End</span><input type="time" value={doc.plannedEnd ?? ""} onChange={(event) => change("plannedEnd", event.target.value)} /></label><label><span>Travel allowance (hours)</span><input type="number" min="0" step="0.5" value={doc.travelAllowanceHours ?? 0} onChange={(event) => change("travelAllowanceHours", Math.max(0, Number(event.target.value)))} /></label></>}</div>{!schedule && <p className="erp-muted">Saved as unassigned with no appointment.</p>}{cap && <div className="jobs-free-slots"><h4>Available time slots</h4>{cap.freeSegments.length ? cap.freeSegments.map((segment) => <button key={segment.start} className="settings-outline" onClick={() => setDoc({ ...doc, plannedStart: segment.start, plannedEnd: minutesToTime(Math.min(timeToMinutes(segment.end) - (doc.travelAllowanceHours ?? 0) * 60, timeToMinutes(segment.start) + doc.hours * 60)) })}>{label12h(segment.start)}–{label12h(segment.end)}</button>) : <p className="job-late">{cap.blocked?.reason ?? "No available time"}. Choose another date or engineer.</p>}</div>}{crossCity && schedule && <p className="master-warning"><b>Travel review required</b><span>{doc.engineer} is based in {base}; this site is in {siteById(doc.siteId)?.city}. Confirm travel arrangements and allowance.</span></p>}</section>
    {error && <p className="jobs-form-error" role="alert">{error}</p>}
  </div><footer className="jobs-form-footer"><span>{selectedCount} instruments selected</span><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={create}>Create Job</button></footer></section></Overlay>;
}
