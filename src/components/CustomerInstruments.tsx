import { useEffect, useMemo, useState } from "react";
import { CALIBRATION_PROVIDERS, CITIES, customerSites, dayDifference, prettyDate, siteById, stamp } from "./erpMasters";
import { addDeliveryChallan, findDuplicateInstrument, groupInstrumentsBySite, lastCalibrated, nextDueFor, openJobFor, updateStore, useErpStore, type CustodyEvent, type CustomerInstrument } from "./erpStore";
import { ActionMenu, Overlay, Pagination, useTablePage } from "./ErpUi";
import "./customerInstruments.css";

const blank = (id: string, customer: string): CustomerInstrument => ({
  id, customer, siteId: "", department: "", name: "", make: "", model: "", serial: "",
  range: "", accuracy: "", intervalMonths: undefined, procedure: "", notes: "",
  status: "Active", custody: "Customer site", history: [], calibrationRecorded: false,
});
const custodyName = (value: CustomerInstrument["custody"]) => value === "In our lab" ? "At SPM" : value;
const nextInstrumentId = (all: CustomerInstrument[]) => `CI-${String(Math.max(100, ...all.map((item) => Number(item.id.split("-").at(-1)) || 0)) + 1).padStart(4, "0")}`;

export function dueLabel(date?: string) {
  if (!date) return { text: "Not recorded", tone: "later" as const };
  const diff = dayDifference(date);
  if (diff < 0) return { text: `Overdue · ${Math.abs(diff)}d`, tone: "late" as const };
  if (diff === 0) return { text: "Due today", tone: "late" as const };
  if (diff <= 30) return { text: `Due in ${diff}d`, tone: "soon" as const };
  return { text: "", tone: "later" as const };
}

/** The instrument register, scoped to one customer — embedded as the "Instruments" section of
 *  that customer's detail page in Customers.tsx. Everything here used to be its own full page
 *  (browsing instruments across every customer); the customer picker is gone because the
 *  customer is now fixed by whichever detail page is open. */
export default function CustomerInstrumentsPanel({ customer, openJob }: { customer: string; openJob?: (jobId: string) => void }) {
  const { instruments: allInstruments, jobs } = useErpStore();
  const instruments = useMemo(() => allInstruments.filter((item) => item.customer === customer), [allInstruments, customer]);
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("All cities");
  const [window_, setWindow] = useState("Any time");
  const [status, setStatus] = useState("Active");
  const [custody, setCustody] = useState("All locations");
  const [moreFilters, setMoreFilters] = useState(false);
  const [sort, setSort] = useState("due");
  const [editing, setEditing] = useState<CustomerInstrument | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 5000); };
  const clearFilters = () => { setSearch(""); setCity("All cities"); setWindow("Any time"); setStatus("All"); setCustody("All locations"); };

  const rows = useMemo(() => instruments.filter((item) => {
    const site = siteById(item.siteId);
    const due = nextDueFor(item);
    const diff = due ? dayDifference(due) : undefined;
    const inWindow = window_ === "Any time" || (window_ === "Not recorded" ? !due : diff !== undefined && (window_ === "Overdue" ? diff < 0 : window_ === "Next 7 days" ? diff >= 0 && diff <= 7 : window_ === "Next 30 days" ? diff >= 0 && diff <= 30 : diff >= 0 && diff <= 90));
    return `${item.id} ${item.name} ${item.make} ${item.model} ${item.serial} ${item.customerAssetId ?? ""} ${site?.name ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())
      && (city === "All cities" || site?.city === city)
      && (status === "All" || item.status === status)
      && (custody === "All locations" || item.custody === custody)
      && inWindow;
  }).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "site" ? a.siteId.localeCompare(b.siteId) : (nextDueFor(a) ?? "9999").localeCompare(nextDueFor(b) ?? "9999") || a.name.localeCompare(b.name)), [instruments, search, city, window_, status, custody, sort]);
  const filterKey = JSON.stringify([search, city, window_, status, custody, sort]);
  const { pageRows, page, setPage } = useTablePage(rows, filterKey, 10);
  const allOnPagePicked = pageRows.length > 0 && pageRows.every((item) => picked.includes(item.id));
  const activeFilters = [search.trim() && `Search: ${search.trim()}`, city !== "All cities" && city, window_ !== "Any time" && window_, custody !== "All locations" && custodyName(custody as CustomerInstrument["custody"]), status !== "All" && `Status: ${status}`].filter(Boolean);
  const counts = useMemo(() => ({
    overdue: instruments.filter((item) => item.status === "Active" && nextDueFor(item) && dayDifference(nextDueFor(item)!) < 0).length,
    dueWeek: instruments.filter((item) => item.status === "Active" && nextDueFor(item) && dayDifference(nextDueFor(item)!) >= 0 && dayDifference(nextDueFor(item)!) <= 7).length,
    atSpm: instruments.filter((item) => item.custody === "In our lab").length,
  }), [instruments]);
  const applySummary = (kind: "overdue" | "week" | "spm") => {
    clearFilters();
    if (kind === "spm") setCustody("In our lab");
    else { setStatus("Active"); setWindow(kind === "overdue" ? "Overdue" : "Next 7 days"); }
  };
  const open = instruments.find((item) => item.id === openId) ?? null;
  const chosen = instruments.filter((item) => picked.includes(item.id));
  const conflicts = chosen.filter((item) => openJobFor(jobs, item.id));
  const createable = chosen.filter((item) => !openJobFor(jobs, item.id) && item.status === "Active");
  const endedCount = chosen.filter((item) => item.status !== "Active" && !openJobFor(jobs, item.id)).length;
  const groups = groupInstrumentsBySite(createable);
  const createJobs = () => {
    if (!groups.length) return;
    updateStore((current) => {
      const valid = current.instruments.filter((item) => picked.includes(item.id) && item.status === "Active" && !openJobFor(current.jobs, item.id));
      const currentGroups = groupInstrumentsBySite(valid);
      const highest = Math.max(1041, ...current.jobs.map((job) => Number(job.number.split("-")[1]) || 0));
      return { jobs: [...currentGroups.map((group, index) => {
        const first = group[0];
        const number = `JOB-${highest + index + 1}`;
        return {
          id: number, number, type: "Calibration" as const, customer: first.customer, siteId: first.siteId,
          instrumentIds: group.map((item) => item.id), stockIds: [], description: `Calibration of ${group.length} instrument${group.length === 1 ? "" : "s"}.`,
          doneAt: "Site visit" as const, scheduledDate: "", hours: group.length * 2,
          status: "Unassigned" as const, expectedSpares: [], usedSpares: [], results: [], travelNotes: "", photos: 0,
          activities: [{ title: `Job created for ${group.length} instrument${group.length === 1 ? "" : "s"}`, meta: stamp(), tone: "system" as const }],
        };
      }), ...current.jobs] };
    });
    flash(`${groups.length} unscheduled job${groups.length === 1 ? "" : "s"} created for ${createable.length} instrument${createable.length === 1 ? "" : "s"}. Assign and schedule in Jobs.`);
    setPicked([]);
  };

  return <section className="ci-page">
    <div className="settings-workspace-head"><div><h3>Instruments</h3><p>Instruments owned by this customer and their calibration history.</p></div><div className="leads-actions"><button className="settings-outline" onClick={() => setImporting(true)}>Import CSV</button><button className="erp-action" onClick={() => setEditing(blank(nextInstrumentId(allInstruments), customer))}>+ Add instrument</button></div></div>
    <div className="erp-summary-strip ci-summary">
      <button onClick={() => applySummary("overdue")}><span>Overdue calibration</span><b>{counts.overdue}</b></button>
      <button onClick={() => applySummary("week")}><span>Due in next 7 days</span><b>{counts.dueWeek}</b></button>
      <button onClick={() => applySummary("spm")}><span>At SPM</span><b>{counts.atSpm}</b></button>
    </div>
    <div className="erp-filters ci-register-filters">
      <label><span>Search instruments</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, serial, asset ID or site" /></label>
      <label><span>Calibration due</span><select value={window_} onChange={(event) => setWindow(event.target.value)}>{["Any time", "Overdue", "Next 7 days", "Next 30 days", "Next 90 days", "Not recorded"].map((entry) => <option key={entry}>{entry}</option>)}</select></label>
      <label><span>Currently with</span><select value={custody} onChange={(event) => setCustody(event.target.value)}><option>All locations</option><option>Customer site</option><option value="In our lab">At SPM</option><option>In transit</option></select></label>
      <button className="settings-outline" aria-expanded={moreFilters} aria-controls="ci-more-filters" onClick={() => setMoreFilters(!moreFilters)}>More filters{city !== "All cities" || status !== "All" ? ` (${Number(city !== "All cities") + Number(status !== "All")})` : ""}</button>
    </div>
    {moreFilters && <div className="erp-filters ci-more-filters" id="ci-more-filters">
      <label><span>City</span><select value={city} onChange={(event) => setCity(event.target.value)}><option>All cities</option>{CITIES.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
      <label><span>Contract status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="All">All statuses</option><option>Active</option><option>Contract ended</option></select></label>
    </div>}
    <div className="erp-filter-summary ci-results"><div><b>{rows.length} instrument{rows.length === 1 ? "" : "s"}</b>{activeFilters.length > 0 && <><span>{activeFilters.join(" · ")}</span><button className="invoice-edit-link" onClick={clearFilters}>Clear all</button></>}</div><label><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="due">Calibration due</option><option value="name">Instrument name</option><option value="site">Site</option></select></label></div>
    {picked.length > 0 && <div className="cluster-bar ci-cluster-bar">
      <span><b>{picked.length} selected</b>{picked.some((id) => !pageRows.some((item) => item.id === id)) ? " across pages or filters" : ""}{groups.length > 1 ? ` · ${groups.length} sites; one separate job per site` : groups.length === 1 ? ` · ${siteById(groups[0][0].siteId)?.name ?? customer}` : ""}{endedCount > 0 ? ` · ${endedCount} ended contract${endedCount === 1 ? "" : "s"} excluded` : ""}</span>
      <div><button className="settings-outline" onClick={() => setPicked([])}>Clear selection</button><button className="erp-action" disabled={!groups.length} onClick={createJobs}>{groups.length > 1 ? `Create ${groups.length} jobs` : "Create job"}</button></div>
    </div>}
    {conflicts.length > 0 && <div className="ci-conflict-note"><b>{conflicts.length} already assigned; excluded from new jobs</b>{conflicts.map((item) => { const job = openJobFor(jobs, item.id)!; return <span key={item.id}>{item.name} · {openJob ? <button className="invoice-edit-link" onClick={() => openJob(job.id)}>{job.number}</button> : job.number}</span>; })}</div>}
    <div className="erp-table-shell"><table className="erp-data-table ci-register"><colgroup><col style={{ width: 44 }} /><col style={{ width: "25%" }} /><col style={{ width: "16%" }} /><col style={{ width: "22%" }} /><col style={{ width: "14%" }} /><col style={{ width: "17%" }} /><col /></colgroup><thead><tr>
      <th className="ci-selection-cell"><input type="checkbox" checked={allOnPagePicked} ref={(node) => { if (node) node.indeterminate = !allOnPagePicked && pageRows.some((item) => picked.includes(item.id)); }} onChange={(event) => setPicked((all) => event.target.checked ? [...new Set([...all, ...pageRows.map((item) => item.id)])] : all.filter((id) => !pageRows.some((item) => item.id === id)))} aria-label="Select instruments on this page" /></th>
      <th>Instrument</th><th>Serial / Asset ID</th><th>Site</th><th>Currently With</th><th>Calibration Due</th><th>Current Job</th>
    </tr></thead><tbody>{pageRows.map((item) => {
      const site = siteById(item.siteId);
      const due = nextDueFor(item);
      const when = dueLabel(due);
      const job = openJobFor(jobs, item.id);
      return <tr key={item.id} className={`${picked.includes(item.id) ? "is-selected " : ""}${item.status === "Contract ended" ? "is-ended" : ""}`}>
        <td className="ci-selection-cell"><input type="checkbox" checked={picked.includes(item.id)} onChange={(event) => setPicked((all) => event.target.checked ? [...all, item.id] : all.filter((id) => id !== item.id))} aria-label={`Select ${item.name} ${item.serial || item.id}`} /></td>
        <td><button className="erp-record-link" onClick={() => setOpenId(item.id)}>{item.name}</button><small>{[item.make, item.model].filter(Boolean).join(" ") || "Make / model not recorded"}</small>{item.status === "Contract ended" && <small>Contract ended</small>}</td>
        <td><span className="ci-register-serial">{item.serial || item.customerAssetId || item.id}</span>{!item.serial && <small>Asset ID{!item.customerAssetId ? " · internal" : ""}</small>}</td>
        <td><span>{site?.name ?? "Site not recorded"}</span>{site?.city && <small>{site.city}</small>}</td>
        <td>{custodyName(item.custody)}</td>
        <td><span className="ci-date">{due ? prettyDate(due) : "Not recorded"}</span>{due && when.text && <small className={`ci-due-note ci-due-note--${when.tone}`}>{when.text}</small>}</td>
        <td>{job ? <><button className="erp-record-link ci-date" onClick={() => openJob ? openJob(job.id) : setOpenId(item.id)}>{job.number}</button><small>{job.status}</small></> : <span className="erp-muted">—</span>}</td>
      </tr>;
    })}</tbody></table>{!rows.length && <div className="settings-empty"><b>No instruments match these filters</b><p>{instruments.length ? "Clear the filters to see the complete register." : "This customer has no instruments recorded yet."}</p>{instruments.length ? <button className="settings-outline" onClick={clearFilters}>Clear filters</button> : <button className="erp-action" onClick={() => setEditing(blank(nextInstrumentId(allInstruments), customer))}>+ Add instrument</button>}</div>}</div>
    <Pagination total={rows.length} page={page} onPage={setPage} pageSize={10} />
    {open && <InstrumentRecord instrument={open} jobs={jobs} close={() => setOpenId(null)} edit={() => { setEditing(open); setOpenId(null); }} openJob={openJob} flash={flash} />}
    {editing && <InstrumentForm instrument={editing} customer={customer} all={allInstruments} save={(next) => {
      updateStore((current) => ({ instruments: current.instruments.some((item) => item.id === next.id) ? current.instruments.map((item) => item.id === next.id ? next : item) : [next, ...current.instruments] }));
      setEditing(null); flash(`${next.name} saved.`);
    }} close={() => setEditing(null)} />}
    {importing && <ImportCsv customer={customer} close={() => setImporting(false)} done={(count) => { setImporting(false); flash(`${count} instrument${count === 1 ? "" : "s"} imported. Unknown calibration dates remain unrecorded.`); }} />}
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </section>;
}

function InstrumentRecord({ instrument, jobs, close, edit, openJob, flash }: { instrument: CustomerInstrument; jobs: ReturnType<typeof useErpStore>["jobs"]; close: () => void; edit: () => void; openJob?: (jobId: string) => void; flash: (message: string) => void }) {
  const site = siteById(instrument.siteId);
  const due = nextDueFor(instrument);
  const when = dueLabel(due);
  const job = openJobFor(jobs, instrument.id);
  const last = lastCalibrated(instrument);
  const returnToCustomer = () => {
    const log: CustodyEvent = { id: `cl-${Date.now()}`, at: stamp(), action: "Returned to customer", location: site?.name ?? instrument.customer };
    updateStore((current) => ({
      instruments: current.instruments.map((entry) => entry.id !== instrument.id ? entry : { ...entry, custody: "Customer site", receivedAt: undefined, condition: undefined, custodyLog: [log, ...(entry.custodyLog ?? [])] }),
      ...addDeliveryChallan(current, { customer: instrument.customer, siteId: instrument.siteId, reason: "Return", reference: instrument.id, lines: [{ description: instrument.name, serial: instrument.serial, quantity: 1 }] }),
    }));
    close(); flash(`${instrument.name} marked as returned to ${instrument.customer}. A delivery challan was created.`);
  };
  return <Overlay onClose={close} label={`${instrument.name} details`}><aside className="stock-detail due-drawer ci-record-drawer">
    <div className="settings-drawer-head ci-drawer-heading"><div><p>{instrument.id} · Customer instrument</p><h2>{instrument.name}</h2><p>{[instrument.make, instrument.model].filter(Boolean).join(" ")}</p></div><button onClick={close} aria-label="Close instrument details">×</button></div>
    <div className="ci-drawer-actions"><button className="erp-action" onClick={edit}>Edit details</button>{instrument.custody === "In our lab" && <ActionMenu items={[{ label: "Return to customer", onSelect: returnToCustomer }]} />}</div>
    <div className="ci-drawer-body">
      {job && <p className="ci-open-job">Current job: {openJob ? <button className="erp-record-link" onClick={() => { close(); openJob(job.id); }}>{job.number}</button> : <b>{job.number}</b>}<span> · {job.status}{job.engineer ? ` · ${job.engineer}` : ""}</span></p>}
      <section className="stock-detail-section"><h3>Customer, site &amp; contact</h3><dl className="invoice-facts due-facts">
        <div className="invoice-fact-wide"><dt>Customer</dt><dd>{instrument.customer}</dd></div><div className="invoice-fact-wide"><dt>Site</dt><dd>{site?.name ?? "Not recorded"}{site?.city ? ` · ${site.city}` : ""}</dd></div>
        <div className="invoice-fact-wide"><dt>Contact</dt><dd>{site?.contact || "Not recorded"}{site?.phone && <><small>{site.phone}</small><span className="ci-drawer-contact"><a href={`tel:${site.phone.replace(/\s/g, "")}`}>Call</a><a href={`https://wa.me/${site.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a></span></>}</dd></div>
      </dl></section>
      <section className="stock-detail-section"><h3>Instrument &amp; location</h3><dl className="invoice-facts due-facts">
        <div><dt>{instrument.serial ? "Serial number" : "Asset ID · internal"}</dt><dd>{instrument.serial || instrument.id}</dd></div>{instrument.customerAssetId && <div><dt>Customer asset ID</dt><dd>{instrument.customerAssetId}</dd></div>}
        <div><dt>Currently with</dt><dd>{custodyName(instrument.custody)}</dd></div><div><dt>Received</dt><dd>{instrument.receivedAt ? prettyDate(instrument.receivedAt) : "Not recorded"}</dd></div><div><dt>Receipt condition</dt><dd>{instrument.condition || "Not recorded"}</dd></div>
        <div><dt>Contract status</dt><dd>{instrument.status}</dd></div>{instrument.saleRef && <div><dt>Sale reference</dt><dd>{instrument.saleRef}</dd></div>}
      </dl></section>
      <section className="stock-detail-section"><h3>Calibration</h3><dl className="invoice-facts due-facts">
        <div><dt>Last calibrated</dt><dd>{last ? prettyDate(last) : "Not recorded"}</dd></div><div><dt>Interval</dt><dd>{instrument.intervalMonths ? `${instrument.intervalMonths} months` : "Not recorded"}</dd></div>
        <div className="invoice-fact-wide"><dt>Next due</dt><dd>{due ? prettyDate(due) : "Not recorded"}{due && when.text && <span className={`ci-due-note ci-due-note--${when.tone}`}> · {when.text}</span>}<small>{due ? instrument.nextDueDate ? "Entered due date" : "Calculated from last calibration and interval" : "Enter calibration details when available"}</small>{instrument.nextDueOverrideReason && <small>Reason: {instrument.nextDueOverrideReason}</small>}</dd></div>
        {instrument.calibrationProvider && <div><dt>Provider</dt><dd>{instrument.calibrationProvider}</dd></div>}{instrument.certificateNumber && <div><dt>Certificate</dt><dd>{instrument.certificateNumber}{instrument.certificateFile && <small>{instrument.certificateFile}</small>}</dd></div>}
        {instrument.procedure && <div className="invoice-fact-wide"><dt>Procedure / standard</dt><dd>{instrument.procedure}</dd></div>}
      </dl></section>
      {instrument.notes && <section className="stock-detail-section"><h3>Notes</h3><p className="erp-muted">{instrument.notes}</p></section>}
      <section className="stock-detail-section"><h3>Calibration history</h3>{instrument.history.length ? <div className="stock-timeline">{instrument.history.slice().sort((a, b) => b.date.localeCompare(a.date)).map((entry) => <div key={entry.id}><i /><p><b>{prettyDate(entry.date)} · {entry.result}</b><span>{entry.engineer} · {entry.jobNumber}</span>{entry.certificate && <small>Certificate: {entry.certificate}</small>}</p></div>)}</div> : <p className="stock-timeline-empty">No completed calibration jobs recorded.</p>}</section>
      {!!instrument.dueDateHistory?.length && <section className="stock-detail-section"><h3>Due date changes</h3><div className="stock-timeline">{instrument.dueDateHistory.map((entry) => <div key={entry.id}><i /><p><b>{entry.previousDate ? prettyDate(entry.previousDate) : "Not recorded"} → {entry.nextDate ? prettyDate(entry.nextDate) : "Not recorded"}</b><span>{entry.at}</span><small>{entry.reason}</small></p></div>)}</div></section>}
      {!!instrument.custodyLog?.length && <section className="stock-detail-section"><h3>Movement history</h3><div className="stock-timeline">{instrument.custodyLog.map((entry) => <div key={entry.id}><i /><p><b>{entry.action}</b><span>{entry.at}</span><small>{entry.location}</small></p></div>)}</div></section>}
    </div>
  </aside></Overlay>;
}

function InstrumentForm({ instrument, customer, all, close, save }: { instrument: CustomerInstrument; customer: string; all: CustomerInstrument[]; close: () => void; save: (next: CustomerInstrument) => void }) {
  const [doc, setDoc] = useState({ ...instrument, customer, lastCalibrationDate: lastCalibrated(instrument) });
  const [calibrationMode, setCalibrationMode] = useState(instrument.nextDueDate && !lastCalibrated(instrument) ? "due" : lastCalibrated(instrument) ? "last" : "none");
  const [correctingDue, setCorrectingDue] = useState(Boolean(instrument.nextDueDate));
  const [overrideDate, setOverrideDate] = useState(instrument.nextDueDate ?? "");
  const [overrideReason, setOverrideReason] = useState("");
  const [certFile, setCertFile] = useState(instrument.certificateFile ?? "");
  const [certPreview, setCertPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => () => { if (certPreview) URL.revokeObjectURL(certPreview); }, [certPreview]);
  const change = <K extends keyof CustomerInstrument>(key: K, value: CustomerInstrument[K]) => setDoc((current) => ({ ...current, [key]: value }));
  const sites = customerSites.filter((site) => site.customer === customer);
  const suggestedDue = nextDueFor({ ...doc, nextDueDate: undefined });
  const effectiveDue = calibrationMode === "none" ? undefined : calibrationMode === "due" || correctingDue ? overrideDate || undefined : suggestedDue;
  const oldDue = nextDueFor(instrument);
  const isExisting = all.some((item) => item.id === instrument.id);
  const changingDue = isExisting && !!oldDue && effectiveDue !== oldDue;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!doc.siteId || !doc.name.trim()) { setError("Select a site, and enter an instrument name."); return; }
    if (calibrationMode === "last" && !doc.lastCalibrationDate) { setError("Enter the last calibration date, or choose another calibration option."); return; }
    if ((calibrationMode === "due" || calibrationMode === "last" && correctingDue) && !overrideDate) { setError("Enter the next due date, or choose no calibration details available."); return; }
    if (doc.intervalMonths !== undefined && (!Number.isFinite(doc.intervalMonths) || doc.intervalMonths <= 0)) { setError("Enter an interval greater than zero, or leave it unknown."); return; }
    const duplicate = findDuplicateInstrument(all, { id: doc.id, customer: doc.customer, siteId: doc.siteId, serial: doc.serial, name: doc.name, model: doc.model });
    if (duplicate) { setError(`${duplicate.name} (${duplicate.serial || duplicate.id}) already exists at this customer site. Open the existing record or check the serial number.`); return; }
    if (changingDue && !overrideReason.trim()) { setError("Enter a reason for changing the recorded due date."); return; }
    const reason = overrideReason.trim() || (effectiveDue ? calibrationMode === "last" && !correctingDue ? "Calculated from last calibration and interval" : "Due date entered" : "Calibration details not available");
    const next: CustomerInstrument = {
      ...doc, name: doc.name.trim(), serial: doc.serial.trim(),
      lastCalibrationDate: calibrationMode === "last" ? doc.lastCalibrationDate : undefined,
      intervalMonths: calibrationMode === "last" ? doc.intervalMonths : undefined,
      calibrationRecorded: calibrationMode === "last" && Boolean(doc.lastCalibrationDate),
      nextDueDate: calibrationMode === "due" || calibrationMode === "last" && correctingDue ? overrideDate : undefined,
      nextDueOverrideReason: effectiveDue === oldDue ? instrument.nextDueOverrideReason : overrideReason.trim() || undefined,
      dueDateHistory: effectiveDue !== oldDue ? [{ id: `due-${Date.now()}`, at: stamp(), previousDate: oldDue, nextDate: effectiveDue, reason }, ...(instrument.dueDateHistory ?? [])] : instrument.dueDateHistory,
      certificateFile: certFile || undefined,
      custodyLog: isExisting && doc.custody !== instrument.custody ? [{ id: `cl-${Date.now()}`, at: stamp(), action: `Location changed to ${custodyName(doc.custody)}`, location: doc.custody === "Customer site" ? siteById(doc.siteId)?.name ?? doc.customer : custodyName(doc.custody) }, ...(instrument.custodyLog ?? [])] : instrument.custodyLog,
    };
    save(next);
  };
  return <Overlay onClose={close} label={isExisting ? "Edit instrument" : "Add instrument"}><form className="stock-move-modal ci-form-modal ci-scroll-modal" onSubmit={submit} noValidate>
    <header className="ci-modal-heading"><div><h2>{isExisting ? "Edit instrument" : "Add instrument"}</h2><p>{customer}{isExisting ? ` · ${instrument.id}` : ""}</p></div><button type="button" onClick={close} aria-label="Close instrument form">×</button></header>
    <div className="ci-modal-body">
      <section className="ci-form-section erp-form-section"><h3>Basic details</h3><div className="quote-header-grid ci-form-grid">
        <label><span>Site <b className="lead-required">Required</b></span><select value={doc.siteId} onChange={(event) => change("siteId", event.target.value)}><option value="">Select site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}</select></label>
        <label className="quote-grid-wide"><span>Instrument name <b className="lead-required">Required</b></span><input value={doc.name} onChange={(event) => change("name", event.target.value)} /></label>
        <label><span>Make</span><input value={doc.make} onChange={(event) => change("make", event.target.value)} /></label><label><span>Model</span><input value={doc.model} onChange={(event) => change("model", event.target.value)} /></label>
        <label><span>Serial number</span><input value={doc.serial} onChange={(event) => change("serial", event.target.value)} />{!doc.serial.trim() && <small>{isExisting ? `Internal asset ID: ${instrument.id}` : "An internal ID will be assigned on save."}</small>}</label><label><span>Customer asset ID (optional)</span><input value={doc.customerAssetId ?? ""} onChange={(event) => change("customerAssetId", event.target.value)} /></label>
      </div></section>
      <section className="ci-form-section erp-form-section"><h3>Calibration details</h3><label className="ci-mode-field"><span>Available calibration information</span><select value={calibrationMode} onChange={(event) => setCalibrationMode(event.target.value)}><option value="none">No calibration details available</option><option value="last">Last calibration date and interval</option><option value="due">Only the next due date is known</option></select></label>
        {calibrationMode === "none" && <p className="ci-form-helper">The due date will remain unrecorded until calibration information is available.</p>}
        {calibrationMode === "last" && <div className="quote-header-grid ci-form-grid"><label><span>Last calibration date</span><input type="date" value={doc.lastCalibrationDate ?? ""} onChange={(event) => change("lastCalibrationDate", event.target.value)} /></label><label><span>Interval (months)</span><input type="number" min="1" step="1" value={doc.intervalMonths ?? ""} onChange={(event) => change("intervalMonths", event.target.value ? Number(event.target.value) : undefined)} /><small>Leave blank if unknown.</small></label></div>}
        {calibrationMode === "last" && !correctingDue && <div className="ci-due-preview"><p>Next due: <b>{suggestedDue ? prettyDate(suggestedDue) : "Not recorded"}</b><small>{suggestedDue ? "Calculated from last calibration and interval." : "A last calibration date and interval are needed to calculate the due date."}</small></p><button type="button" className="invoice-edit-link" onClick={() => { setCorrectingDue(true); setOverrideDate(suggestedDue ?? ""); }}>{suggestedDue ? "Edit due date" : "Enter due date"}</button></div>}
        {(calibrationMode === "due" || calibrationMode === "last" && correctingDue) && <div className="quote-header-grid ci-form-grid"><label><span>Next due date</span><input type="date" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)} /><small>Entered from a certificate or agreed schedule.</small></label>{calibrationMode === "last" && <button type="button" className="invoice-edit-link ci-reset-due" onClick={() => setCorrectingDue(false)}>Use calculated date</button>}</div>}
        {(changingDue || calibrationMode === "due" || calibrationMode === "last" && correctingDue) && <label className="ci-mode-field"><span>{changingDue ? "Reason for date change (required)" : "Date source or reason (optional)"}</span><input value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder={instrument.nextDueOverrideReason || "Certificate reference or agreed schedule"} /></label>}
      </section>
      <details className="invoice-more ci-additional"><summary><b>Certificate details</b><span>Optional reference, provider and attachment</span></summary><div className="quote-header-grid ci-form-grid invoice-more-grid"><label><span>Certificate number</span><input value={doc.certificateNumber ?? ""} onChange={(event) => change("certificateNumber", event.target.value)} /></label><label><span>Calibration provider</span><select value={doc.calibrationProvider ?? ""} onChange={(event) => change("calibrationProvider", event.target.value)}><option value="">Not specified</option>{CALIBRATION_PROVIDERS.map((entry) => <option key={entry}>{entry}</option>)}</select></label><label className="quote-grid-wide settings-upload"><span>Certificate attachment</span><input type="file" accept="application/pdf,image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setCertFile(file.name); setCertPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null); } }} />{certFile && <small>{certFile}</small>}{certPreview && <img src={certPreview} alt="Certificate preview" className="ci-cert-preview" />}</label></div></details>
      <details className="invoice-more ci-additional"><summary><b>Location &amp; technical details</b><span>Custody, condition, department, range and notes</span></summary><div className="quote-header-grid ci-form-grid invoice-more-grid">
        <label><span>Currently with</span><select value={doc.custody} onChange={(event) => change("custody", event.target.value as CustomerInstrument["custody"])}><option>Customer site</option><option value="In our lab">At SPM</option><option>In transit</option></select></label><label><span>Contract status</span><select value={doc.status} onChange={(event) => change("status", event.target.value as CustomerInstrument["status"])}><option>Active</option><option>Contract ended</option></select></label>
        {doc.custody === "In our lab" && <><label><span>Received date</span><input type="date" value={doc.receivedAt ?? ""} onChange={(event) => change("receivedAt", event.target.value || undefined)} /></label><label><span>Condition on receipt</span><input value={doc.condition ?? ""} onChange={(event) => change("condition", event.target.value)} /></label></>}
        <label><span>Department</span><input value={doc.department} onChange={(event) => change("department", event.target.value)} /></label><label><span>Range</span><input value={doc.range} onChange={(event) => change("range", event.target.value)} /></label><label><span>Accuracy class</span><input value={doc.accuracy} onChange={(event) => change("accuracy", event.target.value)} /></label><label className="quote-grid-wide"><span>Procedure / standard</span><input value={doc.procedure} onChange={(event) => change("procedure", event.target.value)} /></label><label className="quote-grid-wide"><span>Notes</span><textarea value={doc.notes} onChange={(event) => change("notes", event.target.value)} /></label>
      </div></details>
    </div>
    <footer className="ci-modal-footer">{error && <p className="stock-count-error" role="alert">{error}</p>}<div><button type="button" className="settings-outline" onClick={close}>Cancel</button><button type="submit" className="erp-action">Save instrument</button></div></footer>
  </form></Overlay>;
}

type ImportRow = { name: string; make: string; model: string; serial: string; department: string; lastCalibrated: string; intervalMonths?: number; errors: string[] };
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && char === ",") { row.push(value.trim()); value = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) { if (char === "\r" && text[i + 1] === "\n") i++; row.push(value.trim()); if (row.some(Boolean)) rows.push(row); row = []; value = ""; }
    else value += char;
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

function ImportCsv({ customer, close, done }: { customer: string; close: () => void; done: (count: number) => void }) {
  const { instruments } = useErpStore();
  const [siteId, setSiteId] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const sites = customerSites.filter((site) => site.customer === customer);
  const clean = rows?.filter((row) => !row.errors.length) ?? [];
  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(""); setRows(null); setFileName(file.name);
    try {
      const parsed = parseCsv((await file.text()).replace(/^﻿/, ""));
      const headers = parsed.shift()?.map((header) => header.toLowerCase().replace(/[^a-z]/g, "")) ?? [];
      const nameIndex = headers.findIndex((header) => ["instrument", "instrumentname", "name"].includes(header));
      if (nameIndex < 0 || !parsed.length) throw new Error("Include an Instrument column and at least one data row.");
      const get = (row: string[], keys: string[]) => row[headers.findIndex((header) => keys.includes(header))] ?? "";
      const seen = new Set<string>();
      setRows(parsed.map((values) => {
        const interval = get(values, ["intervalmonths", "calibrationinterval", "interval"]);
        const row: ImportRow = { name: values[nameIndex] ?? "", make: get(values, ["make"]), model: get(values, ["model"]), serial: get(values, ["serial", "serialnumber"]), department: get(values, ["department"]), lastCalibrated: get(values, ["lastcalibrated", "lastcalibrationdate"]), intervalMonths: interval ? Number(interval) : undefined, errors: [] };
        if (!row.name) row.errors.push("Instrument name required");
        if (row.lastCalibrated && (!/^\d{4}-\d{2}-\d{2}$/.test(row.lastCalibrated) || !Number.isFinite(Date.parse(row.lastCalibrated)) || new Date(row.lastCalibrated).toISOString().slice(0, 10) !== row.lastCalibrated)) row.errors.push("Use a valid YYYY-MM-DD date");
        if (row.intervalMonths !== undefined && (!Number.isInteger(row.intervalMonths) || row.intervalMonths <= 0)) row.errors.push("Invalid interval");
        const duplicateKey = row.serial ? `serial:${row.serial.toLowerCase()}` : `name:${row.name.toLowerCase()}|${row.model.toLowerCase()}`;
        if (seen.has(duplicateKey) || findDuplicateInstrument(instruments, { ...row, customer, siteId })) row.errors.push("Possible duplicate");
        seen.add(duplicateKey);
        return row;
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The CSV could not be read."); }
  };
  const confirm = () => {
    if (!clean.length) { setError("Choose a CSV with at least one valid instrument."); return; }
    updateStore((current) => {
      const highest = Math.max(100, ...current.instruments.map((entry) => Number(entry.id.split("-").at(-1)) || 0));
      const created = clean.map((row, index): CustomerInstrument => ({
        ...blank(`CI-${String(highest + index + 1).padStart(4, "0")}`, customer), siteId,
        name: row.name, make: row.make, model: row.model, serial: row.serial, department: row.department,
        intervalMonths: row.intervalMonths, lastCalibrationDate: row.lastCalibrated || undefined, calibrationRecorded: Boolean(row.lastCalibrated), notes: `Imported from ${fileName}.`,
      }));
      return { instruments: [...created, ...current.instruments] };
    });
    done(clean.length);
  };
  return <Overlay onClose={close} label="Import instruments"><section className="stock-move-modal ci-import-modal ci-scroll-modal">
    <header className="ci-modal-heading"><h2>Import instruments</h2><button onClick={close} aria-label="Close import">×</button></header>
    <div className="ci-modal-body"><p className="ci-form-helper">Select the site, then preview a CSV before importing — all instruments will belong to {customer}.</p><div className="quote-header-grid ci-form-grid">
      <label><span>Site (required)</span><select value={siteId} onChange={(event) => { setSiteId(event.target.value); setRows(null); }}><option value="">Select site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}</select></label>
      <label className="quote-grid-wide"><span>CSV file</span><input type="file" accept=".csv,text/csv" disabled={!siteId} onChange={chooseFile} />{!siteId && <small>Select a site first.</small>}</label>
    </div><p className="ci-form-helper">Columns: Instrument, Make, Model, Serial, Department, Last calibrated, Interval months. Use YYYY-MM-DD dates; unknown dates and intervals can be blank.</p>
      {rows && <><p className="ci-form-helper"><b>{clean.length} ready to import</b> · {rows.length - clean.length} need review and will be skipped</p><div className="erp-table-shell ci-import-preview"><table className="erp-data-table"><thead><tr><th>Instrument</th><th>Serial</th><th>Calibration</th><th>Review</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><td>{row.name || "Missing name"}<small>{row.make} {row.model}</small></td><td>{row.serial || "Internal ID on save"}</td><td>{row.lastCalibrated || "Not recorded"}<small>{row.intervalMonths ? `${row.intervalMonths} months` : "Interval unknown"}</small></td><td>{row.errors.join("; ") || "Ready"}</td></tr>)}</tbody></table></div></>}
    </div><footer className="ci-modal-footer">{error && <p className="stock-count-error" role="alert">{error}</p>}<div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={confirm}>Import {clean.length || ""} instrument{clean.length === 1 ? "" : "s"}</button></div></footer>
  </section></Overlay>;
}
