// Stand-in for the mobile app and the office biometric device, neither of which exist yet.
// Deliberately kept separate from every normal planner/engineer button — SPM asked for
// simulation to live in its own clearly-labelled mechanism, not inside real workflows.
import { useState } from "react";
import { engineers, istStamp, nowIso, siteById } from "./erpMasters";
import { applyVisitStamp, demoLocationStamp, recordAttendanceEvent, updateStore, type AttendanceEventKind, type Job } from "./erpStore";

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (value: string) => new Date(value).toISOString();

export default function DemoConsole({ jobs }: { jobs: Job[] }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"site" | "office">("site");
  const [toast, setToast] = useState("");
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3400); };

  const assignable = jobs.filter((job) => job.engineer && job.status !== "Cancelled" && job.status !== "Completed");
  const [jobId, setJobId] = useState(assignable.length === 1 ? assignable[0].id : "");
  const [action, setAction] = useState<"checkIn" | "checkOut">("checkIn");
  const [preset, setPreset] = useState<"within" | "outside" | "unavailable">("within");
  const [occurredAt, setOccurredAt] = useState(toLocalInput(nowIso()));
  const [syncedAt, setSyncedAt] = useState(toLocalInput(nowIso()));
  const job = jobs.find((entry) => entry.id === jobId);
  const site = job ? siteById(job.siteId) : undefined;

  const runSite = () => {
    if (!job) { flash("Pick a job first."); return; }
    const at = fromLocalInput(occurredAt); const synced = fromLocalInput(syncedAt);
    const stamp = demoLocationStamp(preset, site, at, synced, "Mobile");
    updateStore((current) => applyVisitStamp(current, job.id, action, stamp));
    flash(`Simulated ${action === "checkIn" ? "check-in" : "checkout"} for ${job.engineer} on ${job.number} (${stamp.locationCheck}).`);
  };

  const [bioEngineer, setBioEngineer] = useState(engineers[0].name);
  const [bioKind, setBioKind] = useState<AttendanceEventKind>("Office check-in");
  const [bioAt, setBioAt] = useState(toLocalInput(nowIso()));
  const [bioEventId, setBioEventId] = useState(() => `BIO-${Date.now()}`);

  const runBio = () => {
    const at = fromLocalInput(bioAt);
    let duplicate = false;
    updateStore((current) => {
      const patch = recordAttendanceEvent(current, { engineer: bioEngineer, kind: bioKind, source: "Biometric", at, syncedAt: at, sourceEventId: bioEventId });
      duplicate = !patch.attendance;
      return patch;
    });
    flash(duplicate ? `Device event "${bioEventId}" was already imported — no duplicate created.` : `Simulated ${bioKind.toLowerCase()} for ${bioEngineer} · ${istStamp(at)}.`);
    if (!duplicate) setBioEventId(`BIO-${Date.now()}`);
  };

  return <div className="demo-console">
    <button className="demo-console-toggle" onClick={() => setOpen((value) => !value)}>
      Log a check-in or checkout {open ? "▲" : "▼"}
    </button>
    {open && <div className="demo-console-panel">
      <p className="demo-console-note">Use this to record a check-in or checkout by hand until the mobile app and biometric device are connected.</p>
      <div className="settings-tabs"><button className={tab === "site" ? "is-active" : ""} onClick={() => setTab("site")}>Site visit event</button><button className={tab === "office" ? "is-active" : ""} onClick={() => setTab("office")}>Office biometric event</button></div>

      {tab === "site" ? <div className="demo-console-grid">
        <label><span>Job</span><select value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="">Pick a job with an engineer</option>{assignable.map((entry) => <option key={entry.id} value={entry.id}>{entry.number} · {entry.engineer} · {entry.customer}</option>)}</select></label>
        <label><span>Event</span><select value={action} onChange={(event) => setAction(event.target.value as typeof action)}><option value="checkIn">Site check-in</option><option value="checkOut">Site checkout</option></select></label>
        <label><span>Location</span><select value={preset} onChange={(event) => setPreset(event.target.value as typeof preset)}><option value="within">Within site area</option><option value="outside">Outside site area</option><option value="unavailable">Location unavailable</option></select></label>
        <label><span>Occurred at</span><input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
        <label><span>Synced at</span><input type="datetime-local" value={syncedAt} onChange={(event) => setSyncedAt(event.target.value)} /><small>Set later than "Occurred at" to simulate a delayed sync.</small></label>
        <button className="erp-action" onClick={runSite}>Simulate event</button>
      </div> : <div className="demo-console-grid">
        <label><span>Engineer</span><select value={bioEngineer} onChange={(event) => setBioEngineer(event.target.value)}>{engineers.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label>
        <label><span>Event</span><select value={bioKind} onChange={(event) => setBioKind(event.target.value as AttendanceEventKind)}><option>Office check-in</option><option>Office checkout</option></select></label>
        <label><span>Occurred at</span><input type="datetime-local" value={bioAt} onChange={(event) => setBioAt(event.target.value)} /></label>
        <label><span>Device event id</span><input value={bioEventId} onChange={(event) => setBioEventId(event.target.value)} /><small>Re-run the same id to see the duplicate-import guard.</small></label>
        <button className="erp-action" onClick={runBio}>Simulate event</button>
      </div>}
      {toast && <p className="demo-console-toast">{toast}</p>}
    </div>}
  </div>;
}
