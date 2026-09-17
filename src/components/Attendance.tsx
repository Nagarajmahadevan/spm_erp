import { useState } from "react";
import { dateIso, engineers, isoDateInIst, istStamp, istTime, nowIso, prettyDate, stamp } from "./erpMasters";
import { affectedJobsForLeave, attendanceStatusFor, blockedOn, eventsFor, reviewCorrection, updateStore, useErpStore, visitsOn, type AttendanceEvent, type Correction, type LeaveKind, type LeaveRequest, type LeaveStatus } from "./erpStore";
import { Overlay, Pagination, useTablePage } from "./ErpUi";
import "./attendance.css";

type Tab = "Daily" | "Monthly" | "Leave" | "Corrections";
type Store = ReturnType<typeof useErpStore>;
const statusClass = (status: string) => status.toLowerCase().replace(/ /g, "-");
const statusLabel = (status: string) => status === "No activity recorded" ? "No activity" : status;
const safeDate = (date: string) => date ? prettyDate(date) : "Not recorded";
const displayStamp = (value: string) => /^\d{4}-\d\d-\d\dT/.test(value) ? istStamp(value) : value;

export function dayRecord(store: Store, engineer: string, date: string) {
  const events = eventsFor(store.attendance, engineer, date);
  const status = attendanceStatusFor(store.attendance, store.leaves, store.holidays, engineer, date);
  const visits = visitsOn(store.jobs, date, nowIso()).filter((visit) => visit.engineer === engineer && visit.visitStatus !== "Cancelled");
  const siteEvents = events.filter((event) => event.kind.startsWith("Site"));
  const officeEvents = events.filter((event) => event.kind.startsWith("Office"));
  const latestSite = siteEvents.at(-1);
  const latestOffice = officeEvents.at(-1);
  const activeVisits = visits.filter((visit) => visit.checkIn && !visit.checkOut);
  const onSite = activeVisits.length > 0 || latestSite?.kind === "Site check-in";
  const attention: string[] = [];
  if (activeVisits.some((visit) => new Date(nowIso()).getTime() > new Date(`${visit.plannedDate}T${visit.plannedEnd}:00+05:30`).getTime())) attention.push("Visit running late");
  if (events.some((event) => event.locationCheck === "Outside site area" || event.locationCheck === "Needs review")) attention.push("Location needs review");
  const blocked = blockedOn(store.leaves, store.holidays, engineer, date);
  if (blocked && events.length) attention.push(`Activity during ${blocked.kind.toLowerCase()}`);
  if (store.corrections.some((entry) => entry.engineer === engineer && entry.status === "Pending" && store.attendance.find((event) => event.id === entry.eventId)?.date === date)) attention.push("Correction pending");
  const activity = onSite ? "On site" : latestOffice?.kind === "Office check-in" ? "At office" : siteEvents.length ? "Site visit completed" : officeEvents.length ? "Office visit recorded" : "—";
  const secondaryActivity = onSite && officeEvents.length ? "Office check-in recorded" : siteEvents.length && officeEvents.length ? "Office activity recorded" : "";
  return { engineer, status, events, first: events.find((event) => event.kind.endsWith("check-in")), last: events.at(-1), activity, secondaryActivity, attention };
}

export default function Attendance() {
  const store = useErpStore();
  const [tab, setTab] = useState<Tab>("Daily");
  const [showNew, setShowNew] = useState(false);
  const pending = store.corrections.filter((entry) => entry.status === "Pending").length;
  return <section className="leads-page attendance-page">
    <div className="leads-heading"><div><p className="erp-secondary-text">People / Attendance</p><h1>Attendance</h1><p className="erp-secondary-text mt-1">Daily activity, leave and attendance corrections.</p></div>{tab === "Leave" && <button className="erp-action" onClick={() => setShowNew(true)}>+ New leave</button>}</div>
    <div className="stock-tabs job-tabs">{(["Daily", "Monthly", "Leave", "Corrections"] as Tab[]).map((entry) => <button key={entry} className={tab === entry ? "is-active" : ""} onClick={() => setTab(entry)}>{entry}{entry === "Corrections" && pending > 0 && <span>{pending}</span>}</button>)}</div>
    {tab === "Daily" && <DailyView store={store} />}
    {tab === "Monthly" && <MonthlyView store={store} />}
    {tab === "Leave" && <LeaveView store={store} />}
    {tab === "Corrections" && <CorrectionsView store={store} />}
    {showNew && <NewLeave close={() => setShowNew(false)} />}
  </section>;
}

function DailyView({ store }: { store: Store }) {
  const [date, setDate] = useState(dateIso());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [attention, setAttention] = useState("All");
  const [sort, setSort] = useState("attention");
  const [openEngineer, setOpenEngineer] = useState<string | null>(null);
  const allRows = engineers.map((engineer) => dayRecord(store, engineer.name, date));
  const rows = allRows.filter((row) => row.engineer.toLowerCase().includes(query.toLowerCase()) && (status === "All" || row.status === status) && (attention === "All" || row.attention.length > 0)).sort((a, b) => sort === "name" ? a.engineer.localeCompare(b.engineer) : sort === "first" ? (a.first?.at ?? "z").localeCompare(b.first?.at ?? "z") : b.attention.length - a.attention.length || a.engineer.localeCompare(b.engineer));
  const { pageRows, page, setPage } = useTablePage(rows, `${query}|${status}|${attention}|${date}|${sort}`);
  const clear = () => { setQuery(""); setStatus("All"); setAttention("All"); setDate(dateIso()); };
  const active = Boolean(query || status !== "All" || attention !== "All" || date !== dateIso());
  return <>
    <div className="erp-summary-strip attendance-summary"><div><span>Present</span><b>{allRows.filter((row) => row.status === "Present").length}</b></div><div><span>On site</span><b>{allRows.filter((row) => row.activity === "On site").length}</b></div><div><span>Leave / training</span><b>{allRows.filter((row) => row.status === "On leave" || row.status === "Training").length}</b></div><button onClick={() => setAttention("Review")}><span>Needs review</span><b>{allRows.filter((row) => row.attention.length > 0).length}</b></button></div>
    <div className="erp-filters attendance-filters">
      <label className="attendance-search-field"><span>Search engineer</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name" /></label>
      <label><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value || dateIso())} /></label>
      <label><span>Day status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="All">All statuses</option>{["Present", "On leave", "Training", "Holiday", "Weekly off", "No activity recorded", "Upcoming"].map((entry) => <option key={entry} value={entry}>{statusLabel(entry)}</option>)}</select></label>
      <label><span>Attention</span><select value={attention} onChange={(event) => setAttention(event.target.value)}><option value="All">All records</option><option value="Review">Needs review</option></select></label>
    </div>
    <div className="erp-filter-summary attendance-result-line"><span>{rows.length} of {engineers.length} engineers{active && ` · ${[query && `Name: ${query}`, status !== "All" && statusLabel(status), attention !== "All" && "Needs review", date !== dateIso() && safeDate(date)].filter(Boolean).join(" · ")}`}</span><div>{active && <button className="settings-link" onClick={clear}>Clear all</button>}<label>Sort by <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="attention">Attention first</option><option value="name">Engineer A–Z</option><option value="first">First check-in</option></select></label></div></div>
    <div className="erp-table-shell"><table className="erp-data-table attendance-daily-table"><colgroup><col style={{ width: "18%" }} /><col style={{ width: "15%" }} /><col style={{ width: "13%" }} /><col style={{ width: "18%" }} /><col style={{ width: "18%" }} /><col style={{ width: "18%" }} /></colgroup><thead><tr><th>Engineer</th><th>Day status</th><th>First check-in</th><th>Latest event</th><th>Office / site activity</th><th>Attention</th></tr></thead><tbody>{pageRows.map((row) => <tr key={row.engineer} className={openEngineer === row.engineer ? "is-selected" : ""}>
      <td><button className="erp-record-link" onClick={() => setOpenEngineer(row.engineer)}>{row.engineer}</button></td><td><span className={`attendance-status attendance-status--${statusClass(row.status)}`}>{statusLabel(row.status)}</span></td><td className="attendance-nowrap">{row.first ? istTime(row.first.at) : "—"}</td><td>{row.last ? <><span className="attendance-nowrap">{istTime(row.last.at)}</span><small>{row.last.kind}</small></> : <span className="erp-muted">No events recorded</span>}</td><td>{row.activity}<small>{row.secondaryActivity}</small></td><td>{row.attention.length ? row.attention.map((entry) => <span className="attendance-attention" key={entry}>{entry}</span>) : <span className="erp-muted">—</span>}</td>
    </tr>)}</tbody></table>{!rows.length && <EmptyState title="No attendance records match" clear={clear} />}</div>
    <Pagination total={rows.length} page={page} onPage={setPage} />
    {openEngineer && <TimelineDrawer store={store} engineer={openEngineer} date={date} close={() => setOpenEngineer(null)} />}
  </>;
}

function EventTimeline({ events, onCorrect }: { events: AttendanceEvent[]; onCorrect?: (event: AttendanceEvent) => void }) {
  return <div className="lead-timeline quote-activity attendance-timeline">{events.map((event) => <div key={event.id}><i /><p><b>{istTime(event.at)} · {event.kind}</b><span>{event.source}{event.jobId ? ` · ${event.jobId}` : ""}</span>{event.syncedAt !== event.at && <span>Synced {istStamp(event.syncedAt)} · recorded time retained</span>}{event.locationCheck && <span>{event.locationCheck}{typeof event.siteDistanceM === "number" ? ` · ${event.siteDistanceM} m from site` : ""}</span>}{event.location && <span>{event.location.lat.toFixed(5)}, {event.location.lng.toFixed(5)} · accuracy {event.location.accuracyM} m</span>}{onCorrect && <button className="settings-link" onClick={() => onCorrect(event)}>Request correction</button>}</p></div>)}{!events.length && <p className="attendance-empty-note">No activity recorded. Events may not have synced yet.</p>}</div>;
}

function TimelineDrawer({ store, engineer, date, close }: { store: Store; engineer: string; date: string; close: () => void }) {
  const [correcting, setCorrecting] = useState<AttendanceEvent | null>(null);
  const row = dayRecord(store, engineer, date);
  const blocked = blockedOn(store.leaves, store.holidays, engineer, date);
  return <Overlay onClose={close} label={`Attendance for ${engineer}`} className="stock-modal-backdrop attendance-overlay">
    <aside className="settings-drawer attendance-drawer"><div className="settings-drawer-head"><div><p>Attendance · {safeDate(date)}</p><h2>{engineer}</h2></div><button onClick={close} aria-label="Close attendance details">×</button></div>
      <div className="attendance-drawer-body"><section className="erp-form-section"><h3>Day summary</h3><div className="attendance-detail-line"><span>Day status</span><b>{row.status}</b></div><div className="attendance-detail-line"><span>Activity</span><b>{row.activity}</b></div>{blocked && <div className="attendance-detail-line"><span>Scheduled availability</span><b>{blocked.reason}</b></div>}{row.attention.length > 0 && <div className="attendance-warning">{row.attention.join(" · ")}</div>}</section><section className="erp-form-section"><h3>Chronological timeline</h3><EventTimeline events={eventsFor(store.attendance, engineer, date)} onCorrect={setCorrecting} /></section></div>
      <footer className="attendance-drawer-footer"><button className="settings-outline" onClick={close}>Close</button></footer>
    </aside>{correcting && <RaiseCorrection original={correcting} close={() => setCorrecting(null)} />}
  </Overlay>;
}

function RaiseCorrection({ original, close }: { original: AttendanceEvent; close: () => void }) {
  const [requestedChange, setRequestedChange] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!requestedChange.trim() || !reason.trim()) { setError("Enter what should change and why."); return; }
    updateStore((current) => ({ corrections: [{ id: `COR-${Date.now()}`, eventId: original.id, engineer: original.engineer, requestedChange: requestedChange.trim(), reason: reason.trim(), status: "Pending", requestedBy: "Priya Shah", requestedAt: stamp() }, ...current.corrections] }));
    close();
  };
  return <Overlay onClose={close} label="Request attendance correction"><form className="stock-move-modal attendance-modal" onSubmit={submit}><header className="attendance-modal-header"><div><p>{original.engineer}</p><h2>Request correction</h2></div><button type="button" className="stock-modal-close" onClick={close} aria-label="Close correction form">×</button></header><div className="attendance-modal-body">
    <p className="attendance-help">Against {original.kind} · {istStamp(original.at)}</p>
    <div className="attendance-form-grid"><label className="attendance-full-width"><span>What should this say instead?</span><textarea value={requestedChange} onChange={(event) => setRequestedChange(event.target.value)} /></label><label className="attendance-full-width"><span>Reason</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label></div>{error && <p className="attendance-validation" role="alert">{error}</p>}</div><footer className="attendance-modal-footer"><button type="button" className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" type="submit">Submit for approval</button></footer></form></Overlay>;
}

function MonthlyView({ store }: { store: Store }) {
  const [month, setMonth] = useState(dateIso().slice(0, 7));
  const [query, setQuery] = useState("");
  const [drill, setDrill] = useState<{ engineer: string; date: string } | null>(null);
  const [year, monthNum] = month.split("-").map(Number);
  const dates = Array.from({ length: new Date(year, monthNum, 0).getDate() }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
  const rows = engineers.filter((engineer) => engineer.name.toLowerCase().includes(query.toLowerCase()));
  const letters: Record<string, string> = { Present: "P", "On leave": "L", Training: "T", Holiday: "H", "Weekly off": "O", Upcoming: "—", "No activity recorded": "·" };
  const exportCsv = () => {
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const records = rows.flatMap((engineer) => dates.map((date) => { const row = dayRecord(store, engineer.name, date); return [engineer.name, date, row.status, row.attention.join("; ")].map(quote).join(","); }));
    const blob = new Blob([["Engineer,Date,Attendance status,Attention", ...records].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `attendance-${month}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  return <><div className="erp-filters attendance-filters"><label className="attendance-search-field"><span>Search engineer</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name" /></label><label><span>Month</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value || dateIso().slice(0, 7))} /></label><button className="settings-outline attendance-filter-action" onClick={exportCsv}>Export CSV</button></div><div className="erp-filter-summary attendance-result-line"><span>{rows.length} of {engineers.length} engineers{query && ` · Name: ${query}`}</span>{(query || month !== dateIso().slice(0, 7)) && <button className="settings-link" onClick={() => { setQuery(""); setMonth(dateIso().slice(0, 7)); }}>Clear all</button>}</div>
    <div className="attendance-matrix-wrap" role="region" aria-label="Monthly attendance matrix" tabIndex={0}><table className="attendance-matrix"><thead><tr><th scope="col">Engineer</th>{dates.map((date) => <th scope="col" key={date} className={date === dateIso() ? "is-today" : ""}><span>{date.slice(8)}</span><small>{new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(new Date(`${date}T12:00`))}</small></th>)}</tr></thead><tbody>{rows.map((engineer) => <tr key={engineer.name}><th scope="row">{engineer.name}</th>{dates.map((date) => { const row = dayRecord(store, engineer.name, date); const label = `${engineer.name}, ${prettyDate(date)}: ${row.status}${date > dateIso() ? " · Future date" : ""}${row.attention.length ? ` · ${row.attention.join(", ")}` : ""}`; return <td key={date} className={`attendance-matrix-cell attendance-matrix-cell--${statusClass(row.status)}${date === dateIso() ? " is-today" : ""}${date > dateIso() ? " is-future" : ""}`}><button title={label} aria-label={label} onClick={() => setDrill({ engineer: engineer.name, date })}>{letters[row.status] ?? "·"}{row.attention.length > 0 && <sup aria-hidden="true">!</sup>}</button></td>; })}</tr>)}</tbody></table>{!rows.length && <EmptyState title="No engineers match" clear={() => setQuery("")} />}</div><div className="attendance-legend"><span><b>P</b> Present</span><span><b>L</b> Leave</span><span><b>T</b> Training</span><span><b>H</b> Holiday</span><span><b>O</b> Weekly off</span><span><b>·</b> No activity</span><span><b>—</b> Future</span><span><b className="attendance-attention">!</b> Needs review</span><span className="attendance-legend-today">Today</span></div>{drill && <TimelineDrawer store={store} engineer={drill.engineer} date={drill.date} close={() => setDrill(null)} />}</>;
}

function LeaveView({ store }: { store: Store }) {
  const [status, setStatus] = useState<"All" | LeaveStatus>("All");
  const [kind, setKind] = useState("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("date");
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = store.leaves.filter((entry) => (status === "All" || entry.status === status) && (kind === "All" || entry.kind === kind) && `${entry.engineer} ${entry.reason}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "name" ? a.engineer.localeCompare(b.engineer) : sort === "pending" ? Number(b.status === "Pending") - Number(a.status === "Pending") || b.fromDate.localeCompare(a.fromDate) : b.fromDate.localeCompare(a.fromDate));
  const { pageRows, page, setPage } = useTablePage(rows, `${query}|${status}|${kind}|${sort}`);
  const selected = store.leaves.find((entry) => entry.id === openId);
  const clear = () => { setQuery(""); setStatus("All"); setKind("All"); };
  const active = Boolean(query || status !== "All" || kind !== "All");
  return <><div className="erp-filters attendance-filters"><label className="attendance-search-field"><span>Search leave</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Engineer or reason" /></label><label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>{["All", "Pending", "Approved", "Rejected"].map((entry) => <option key={entry}>{entry}</option>)}</select></label><label><span>Type</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option>All</option><option>Leave</option><option>Training</option></select></label></div><div className="erp-filter-summary attendance-result-line"><span>{rows.length} of {store.leaves.length} requests{active && ` · ${[query && `Search: ${query}`, status !== "All" && status, kind !== "All" && kind].filter(Boolean).join(" · ")}`}</span><div>{active && <button className="settings-link" onClick={clear}>Clear all</button>}<label>Sort by <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="date">Latest leave date</option><option value="pending">Pending first</option><option value="name">Engineer A–Z</option></select></label></div></div><div className="erp-table-shell"><table className="erp-data-table attendance-leave-table"><colgroup><col style={{ width: "22%" }} /><col style={{ width: "12%" }} /><col style={{ width: "22%" }} /><col style={{ width: "18%" }} /><col style={{ width: "14%" }} /><col style={{ width: "12%" }} /></colgroup><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Assignments</th><th>Status</th><th>Review</th></tr></thead><tbody>{pageRows.map((leave) => { const affected = affectedJobsForLeave(store.jobs, leave); return <tr key={leave.id} className={leave.id === openId ? "is-selected" : ""}><td><button className="erp-record-link" onClick={() => setOpenId(leave.id)}>{leave.engineer}</button><small>{leave.id}</small></td><td>{leave.kind}</td><td><span className="attendance-nowrap">{prettyDate(leave.fromDate)}</span>{leave.toDate !== leave.fromDate && <small className="attendance-nowrap">to {prettyDate(leave.toDate)}</small>}{leave.halfDay && <small>Half day</small>}</td><td>{affected.length && leave.status !== "Rejected" ? <span className="attendance-attention">{affected.length} affected assignment{affected.length === 1 ? "" : "s"}</span> : <span className="erp-muted">None affected</span>}</td><td><span className={`job-status job-status--${leave.status.toLowerCase()}`}>{leave.status}</span></td><td><button className="settings-outline attendance-review-button" onClick={() => setOpenId(leave.id)}>{leave.status === "Pending" ? "Review" : "View"}</button></td></tr>; })}</tbody></table>{!rows.length && <EmptyState title="No leave requests match" clear={clear} />}</div><Pagination total={rows.length} page={page} onPage={setPage} />{selected && <LeaveDrawer store={store} leave={selected} close={() => setOpenId(null)} />}</>;
}

function LeaveDrawer({ store, leave, close }: { store: Store; leave: LeaveRequest; close: () => void }) {
  const affected = affectedJobsForLeave(store.jobs, leave);
  const decide = (status: "Approved" | "Rejected") => updateStore((current) => ({ leaves: current.leaves.map((entry) => entry.id === leave.id && entry.status === "Pending" ? { ...entry, status, reviewer: "Arun Kumar", reviewedAt: stamp() } : entry) }));
  return <Overlay onClose={close} label={`Leave request ${leave.id}`} className="stock-modal-backdrop attendance-overlay"><aside className="settings-drawer attendance-drawer"><div className="settings-drawer-head"><div><p>{leave.id} · {leave.status}</p><h2>{leave.engineer}</h2></div><button onClick={close} aria-label="Close leave details">×</button></div><div className="attendance-drawer-body"><section className="erp-form-section"><h3>{leave.kind} request</h3><p>{safeDate(leave.fromDate)}{leave.toDate !== leave.fromDate ? ` – ${safeDate(leave.toDate)}` : ""}{leave.halfDay ? " · Half day" : ""}</p><p className="attendance-reason">{leave.reason}</p><p className="attendance-help">Submitted {displayStamp(leave.appliedAt)}</p>{leave.reviewer && <p className="attendance-help">{leave.status} by {leave.reviewer} · {displayStamp(leave.reviewedAt ?? "")}</p>}</section>{affected.length > 0 && leave.status !== "Rejected" && <section className="erp-form-section"><h3>Assignments to review</h3><p className="attendance-warning">{leave.status === "Approved" ? "Capacity is updated. Reassign or reschedule these jobs in Jobs → Schedule." : "Approving updates available capacity. These assignments will need review."}</p>{affected.map((job) => <div className="attendance-affected-job" key={job.id}><b>{job.number} · {job.type}</b><span>{job.customer}</span><span>{safeDate(job.scheduledDate)}</span></div>)}</section>}</div><footer className="attendance-drawer-footer">{leave.status === "Pending" ? <><button className="settings-outline" onClick={() => decide("Rejected")}>Reject</button><button className="erp-action" onClick={() => decide("Approved")}>Approve</button></> : <button className="settings-outline" onClick={close}>Close</button>}</footer></aside></Overlay>;
}

function NewLeave({ close }: { close: () => void }) {
  const [engineer, setEngineer] = useState(engineers[0].name);
  const [kind, setKind] = useState<LeaveKind>("Leave");
  const [fromDate, setFromDate] = useState(dateIso());
  const [toDate, setToDate] = useState(dateIso());
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!fromDate || !toDate || (!halfDay && toDate < fromDate) || !reason.trim()) { setError("Enter valid dates and a reason. The end date must be on or after the start date."); return; }
    updateStore((current) => ({ leaves: [{ id: `LV-${Date.now()}`, engineer, kind, fromDate, toDate: halfDay ? fromDate : toDate, halfDay, reason: reason.trim(), status: "Pending", appliedAt: stamp() }, ...current.leaves] })); close();
  };
  return <Overlay onClose={close} label="New leave request"><form className="stock-move-modal attendance-modal" onSubmit={submit}><header className="attendance-modal-header"><h2>New leave request</h2><button type="button" className="stock-modal-close" onClick={close} aria-label="Close leave form">×</button></header><div className="attendance-modal-body"><div className="attendance-form-grid"><label><span>Engineer</span><select value={engineer} onChange={(event) => setEngineer(event.target.value)}>{engineers.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label><label><span>Type</span><select value={kind} onChange={(event) => setKind(event.target.value as LeaveKind)}><option>Leave</option><option>Training</option></select></label><label><span>From</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label><span>To</span><input type="date" value={halfDay ? fromDate : toDate} min={fromDate} disabled={halfDay} onChange={(event) => setToDate(event.target.value)} /></label><label className="attendance-check"><input type="checkbox" checked={halfDay} onChange={(event) => setHalfDay(event.target.checked)} /><span>Half day</span></label><label className="attendance-full-width"><span>Reason</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label></div><p className="attendance-help">Pending requests affect capacity after approval.</p>{error && <p className="attendance-validation" role="alert">{error}</p>}</div><footer className="attendance-modal-footer"><button type="button" className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" type="submit">Submit request</button></footer></form></Overlay>;
}

function CorrectionsView({ store }: { store: Store }) {
  const [status, setStatus] = useState("Pending");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("submitted");
  const [openId, setOpenId] = useState<string | null>(null);
  const dateFor = (entry: Correction) => store.attendance.find((event) => event.id === entry.eventId)?.date ?? "";
  const rows = store.corrections.filter((entry) => (status === "All" || entry.status === status) && `${entry.engineer} ${entry.requestedChange} ${entry.id}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "name" ? a.engineer.localeCompare(b.engineer) : sort === "date" ? dateFor(b).localeCompare(dateFor(a)) : (new Date(b.requestedAt).getTime() || 0) - (new Date(a.requestedAt).getTime() || 0));
  const { pageRows, page, setPage } = useTablePage(rows, `${query}|${status}|${sort}`);
  const selected = store.corrections.find((entry) => entry.id === openId);
  const clear = () => { setQuery(""); setStatus("All"); };
  const active = Boolean(query || status !== "All");
  return <><div className="erp-filters attendance-filters"><label className="attendance-search-field"><span>Search corrections</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Employee, ID or change" /></label><label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}>{["All", "Pending", "Approved", "Rejected"].map((entry) => <option key={entry}>{entry}</option>)}</select></label></div><div className="erp-filter-summary attendance-result-line"><span>{rows.length} of {store.corrections.length} requests{active && ` · ${[query && `Search: ${query}`, status !== "All" && status].filter(Boolean).join(" · ")}`}</span><div>{active && <button className="settings-link" onClick={clear}>Clear all</button>}<label>Sort by <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="submitted">Latest submitted</option><option value="date">Attendance date</option><option value="name">Employee A–Z</option></select></label></div></div><div className="erp-table-shell"><table className="erp-data-table attendance-corrections-table"><colgroup><col style={{ width: "18%" }} /><col style={{ width: "14%" }} /><col style={{ width: "30%" }} /><col style={{ width: "14%" }} /><col style={{ width: "13%" }} /><col style={{ width: "11%" }} /></colgroup><thead><tr><th>Employee</th><th>Attendance date</th><th>Requested change</th><th>Submitted on</th><th>Status</th><th>Review</th></tr></thead><tbody>{pageRows.map((entry) => <tr key={entry.id} className={entry.id === openId ? "is-selected" : ""}><td><button className="erp-record-link" onClick={() => setOpenId(entry.id)}>{entry.engineer}</button><small>{entry.id}</small></td><td className="attendance-nowrap">{safeDate(dateFor(entry))}</td><td><span className="attendance-clamp" title={entry.requestedChange}>{entry.requestedChange}</span></td><td><span className="attendance-nowrap">{displayStamp(entry.requestedAt).split(" · ")[0]}</span></td><td><span className={`job-status job-status--${entry.status.toLowerCase()}`}>{entry.status}</span></td><td><button className="settings-outline attendance-review-button" onClick={() => setOpenId(entry.id)}>{entry.status === "Pending" ? "Review" : "View"}</button></td></tr>)}</tbody></table>{!rows.length && <EmptyState title="No correction requests match" clear={clear} />}</div><Pagination total={rows.length} page={page} onPage={setPage} />{selected && <CorrectionDrawer store={store} correction={selected} close={() => setOpenId(null)} />}</>;
}

function CorrectionDrawer({ store, correction, close }: { store: Store; correction: Correction; close: () => void }) {
  const [decisionReason, setDecisionReason] = useState("");
  const [error, setError] = useState("");
  const original = store.attendance.find((event) => event.id === correction.eventId);
  const originalEvents = original ? eventsFor(store.attendance, correction.engineer, original.date) : [];
  const decide = (status: "Approved" | "Rejected") => {
    if (status === "Rejected" && !decisionReason.trim()) { setError("Enter a reason for rejection."); return; }
    updateStore((current) => reviewCorrection(current, correction.id, status, "Arun Kumar", decisionReason.trim() || undefined)); setError("");
  };
  return <Overlay onClose={close} label={`Review correction ${correction.id}`} className="stock-modal-backdrop attendance-overlay"><aside className="settings-drawer attendance-drawer"><div className="settings-drawer-head"><div><p>{correction.id} · {correction.status}</p><h2>{correction.engineer}</h2></div><button onClick={close} aria-label="Close correction review">×</button></div><div className="attendance-drawer-body"><section className="erp-form-section"><h3>Requested change</h3><p>{correction.requestedChange}</p>{original && <p className="attendance-help">Against {original.kind} · {istStamp(original.at)}</p>}</section><section className="erp-form-section"><h3>Employee reason</h3><p className="attendance-reason">{correction.reason}</p><p className="attendance-help">Submitted by {correction.requestedBy} · {displayStamp(correction.requestedAt)}</p></section>{original && <section className="erp-form-section"><h3>Original timeline · {safeDate(original.date)}</h3><EventTimeline events={originalEvents} /></section>}{correction.status === "Pending" ? <section className="erp-form-section attendance-form-grid"><label className="attendance-full-width"><span>Decision reason (required to reject)</span><textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} /></label>{error && <p className="attendance-validation attendance-full-width" role="alert">{error}</p>}</section> : <section className="erp-form-section"><h3>Decision</h3><div className="attendance-decision"><b>{correction.status} · {correction.reviewer}</b><span>{displayStamp(correction.reviewedAt ?? "")}</span>{correction.decisionReason && <p>{correction.decisionReason}</p>}</div></section>}</div><footer className="attendance-drawer-footer">{correction.status === "Pending" ? <><button className="settings-outline" onClick={() => decide("Rejected")}>Reject</button><button className="erp-action" onClick={() => decide("Approved")}>Approve correction</button></> : <button className="settings-outline" onClick={close}>Close</button>}</footer></aside></Overlay>;
}

function EmptyState({ title, clear }: { title: string; clear: () => void }) {
  return <div className="settings-empty"><b>{title}</b><p>Adjust the search or filters to see more records.</p><button className="settings-outline" onClick={clear}>Clear filters</button></div>;
}
