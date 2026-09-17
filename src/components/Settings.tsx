import { ATTENDANCE_SETTINGS, JOB_SETTINGS, JOB_SLOTS, prettyDate } from "./erpMasters";
import { updateStore, useErpStore } from "./erpStore";
import DemoConsole from "./DemoConsole";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type Section = "Company" | "Users & Roles" | "Customers" | "Vendors" | "Equipment Categories" | "Locations" | "Expense Types" | "Alerts" | "Operations" | "Attendance Rules" | "Prototype Tools" | "Tally Export";
type Row = { name: string; detail: string; status?: "Active" | "Inactive"; values?: Record<string, string> };

const configs: Record<Section, { description: string; rows: Row[]; importable?: boolean }> = {
  "Company": { description: "Business identity, invoice numbering and defaults used across SPM ERP.", rows: [] },
  "Users & Roles": { description: "Invite teammates and define what each role can access.", rows: [{ name: "Arun Kumar", detail: "arun@spmlabsolutions.com · Admin", status: "Active", values: { "Full name": "Arun Kumar", "Email": "arun@spmlabsolutions.com", "Phone": "+91 98450 22110", "Role": "Admin" } }, { name: "Priya Shah", detail: "priya@spmlabsolutions.com · Office", status: "Active", values: { "Full name": "Priya Shah", "Email": "priya@spmlabsolutions.com", "Phone": "+91 98204 81291", "Role": "Office" } }, { name: "Nikhil Rao", detail: "nikhil@spmlabsolutions.com · Engineer", status: "Inactive", values: { "Full name": "Nikhil Rao", "Email": "nikhil@spmlabsolutions.com", "Phone": "+91 99805 77722", "Role": "Engineer" } }] },
  "Customers": { description: "Customers and their default billing information.", rows: [{ name: "Nova Instruments", detail: "Bengaluru, Karnataka · Net 30", status: "Active" }, { name: "Arka Diagnostics", detail: "Mumbai, Maharashtra · Net 45", status: "Active" }], importable: true },
  "Vendors": { description: "Supplier records, tax settings and contacts.", rows: [{ name: "Precision Systems India", detail: "Pune · TDS 1%", status: "Active" }, { name: "Nanotech Supplies", detail: "Chennai · TDS not applicable", status: "Inactive" }], importable: true },
  "Equipment Categories": { description: "Classification, tracking and reorder defaults for stock items.", rows: [{ name: "Instruments", detail: "Root category · Individual tracking", status: "Active" }, { name: "Spares", detail: "Root category · Quantity tracking", status: "Active" }, { name: "Calibration kits", detail: "Parent: Instruments · Individual tracking", status: "Active" }], importable: true },
  "Locations": { description: "Every place where your equipment can be assigned or stored.", rows: [{ name: "Bengaluru Office", detail: "Office · Indiranagar", status: "Active" }, { name: "Central Warehouse", detail: "Warehouse · Peenya", status: "Active" }, { name: "Nova Instruments site", detail: "Customer site · Nova Instruments", status: "Active" }, { name: "Nikhil Rao", detail: "Engineer · linked user: Nikhil Rao", status: "Active" }] },
  "Expense Types": { description: "Expense categories available to engineers and office teams.", rows: [{ name: "Travel", detail: "Both · bill photo required", status: "Active" }, { name: "Internet", detail: "Company expenses · recurring monthly", status: "Active" }, { name: "Food", detail: "Engineer claims", status: "Active" }] },
  "Alerts": { description: "Control lead times, recipients and delivery channels.", rows: [] },
  "Operations": { description: "Job scheduling limits and calibration defaults.", rows: [] },
  "Attendance Rules": { description: "Working hours, weekly off and holidays used by Attendance and the Jobs schedule.", rows: [] },
  "Prototype Tools": { description: "Simulate mobile check-in/out and office biometric events for this demo. Not a real integration.", rows: [] },
  "Tally Export": { description: "Map ERP records to Tally ledgers and export settings.", rows: [] },
};

const sections = Object.keys(configs) as Section[];
const modules = ["Dashboard", "Attendance", "Advance & Expense", "Leads", "Quotations", "Purchase Orders", "Invoices", "Stock", "Due Dates", "Accounts", "Reports", "Settings"];
const approveModules = new Set(["Quotations", "Purchase Orders", "Advance & Expense"]);

export default function Settings() {
  const [section, setSection] = useState<Section>("Company");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Active");
  const [drawer, setDrawer] = useState<Row | "new" | null>(null);
  const [toast, setToast] = useState("");
  const [userTab, setUserTab] = useState<"Users" | "Roles">("Users");
  const config = configs[section];
  const isFormPage = section === "Company" || section === "Alerts" || section === "Operations" || section === "Attendance Rules" || section === "Prototype Tools" || section === "Tally Export";
  const rows = useMemo(() => config.rows.filter((row) => row.name.toLowerCase().includes(query.toLowerCase()) && (filter === "All" || row.status === filter)), [config, query, filter]);
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2800); };
  const listMode = !isFormPage && !(section === "Users & Roles" && userTab === "Roles");
  const title = section === "Users & Roles" ? userTab : section;

  return <section className="settings-page">
    <div className="settings-heading"><p className="erp-secondary-text">Administration</p><h1>Settings</h1><p className="erp-secondary-text mt-1">Set up the data and defaults used throughout SPM ERP.</p></div>
    <div className="settings-layout">
      <select className="settings-select" value={section} onChange={(e) => { setSection(e.target.value as Section); setQuery(""); }} aria-label="Settings section">{sections.map((item) => <option key={item}>{item}</option>)}</select>
      <nav className="settings-nav" aria-label="Settings navigation">{sections.map((item) => <button key={item} onClick={() => { setSection(item); setQuery(""); }} className={section === item ? "is-active" : ""}>{item}</button>)}</nav>
      <div className="settings-workspace">
        <div className="settings-workspace-head"><div><h2>{section}</h2><p>{config.description}</p></div>{listMode && <button className="erp-action" onClick={() => setDrawer("new")}>+ Add {section === "Users & Roles" ? "user" : section.slice(0, -1)}</button>}</div>
        {section === "Users & Roles" && <div className="settings-tabs"><button className={userTab === "Users" ? "is-active" : ""} onClick={() => setUserTab("Users")}>Users</button><button className={userTab === "Roles" ? "is-active" : ""} onClick={() => setUserTab("Roles")}>Roles</button></div>}
        {section === "Company" ? <CompanyForm onSave={() => notify("Company settings saved")} /> : section === "Alerts" ? <AlertsForm onSave={() => notify("Alert preferences saved")} /> : section === "Operations" ? <OperationsForm onSave={() => notify("Operations settings saved")} /> : section === "Attendance Rules" ? <AttendanceRulesForm onSave={() => notify("Attendance rules saved")} /> : section === "Prototype Tools" ? <PrototypeToolsSection /> : section === "Tally Export" ? <TallyForm onSave={() => notify("Tally export settings saved")} /> : section === "Users & Roles" && userTab === "Roles" ? <RolePermissions onSave={() => notify("Role permissions saved")} /> : <>
          <div className="settings-toolbar"><div className="settings-list-search"><span>⌕</span><input aria-label={`Search ${title}`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${title.toLowerCase()}…`} /></div><span className="settings-count">{rows.length} records</span><select aria-label="Record status filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option>Active</option><option>Inactive</option><option>All</option></select>{config.importable && <><button className="settings-link" onClick={() => notify("CSV template downloaded")}>Download template</button><button className="settings-link" onClick={() => notify("Choose a CSV file to import")}>Import CSV</button></>}</div>
          <div className="settings-list">{rows.map((row) => <button key={row.name} onClick={() => setDrawer(row)} className="settings-row"><span className="settings-row-avatar">{row.name.slice(0, 1)}</span><span><b>{row.name}</b><small>{row.detail}</small></span><em className={row.status === "Inactive" ? "is-inactive" : ""}>{row.status}</em><span className="settings-row-arrow">›</span></button>)}</div>
        </>}
      </div>
    </div>
    {drawer && <Drawer section={section} record={drawer === "new" ? undefined : drawer} close={() => setDrawer(null)} save={(message) => { setDrawer(null); notify(message); }} />}
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </section>;
}

const FormState = createContext({ dirty: false, saving: false });
function FormShell({ children, className = "settings-form", onSave, onDirtyChange }: { children: ReactNode; className?: string; onSave: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const edit = () => { if (!dirty) { setDirty(true); onDirtyChange?.(true); } };
  return <FormState.Provider value={{ dirty, saving }}><form className={className} onInput={edit} onChange={edit} onSubmit={(e) => { e.preventDefault(); if (!dirty || saving) return; setSaving(true); window.setTimeout(() => { setSaving(false); setDirty(false); onDirtyChange?.(false); onSave(); }, 650); }}>
    {dirty && <span className="settings-edited">Edited · unsaved changes</span>}{children}
  </form></FormState.Provider>;
}
const Toggle = ({ label, defaultChecked = true }: { label: string; defaultChecked?: boolean }) => <label className="settings-toggle"><span>{label}</span><input type="checkbox" defaultChecked={defaultChecked} /><i /></label>;
const Field = ({ label, value = "", type = "text", options }: { label: string; value?: string; type?: string; options?: string[] }) => <label className="settings-field"><span>{label}</span>{options ? <select defaultValue={value}>{options.map((o) => <option key={o}>{o}</option>)}</select> : type === "textarea" ? <textarea defaultValue={value} placeholder={`Enter ${label.toLowerCase()}`} /> : <input type={type} defaultValue={value} placeholder={`Enter ${label.toLowerCase()}`} />}</label>;
const Submit = ({ text = "Save changes" }: { text?: string }) => { const { dirty, saving } = useContext(FormState); return <button className="erp-action" type="submit" disabled={!dirty || saving}>{saving ? "Saving…" : text}</button>; };

function Drawer({ section, record, close, save }: { section: Section; record?: Row; close: () => void; save: (message: string) => void }) {
  const [dirty, setDirty] = useState(false);
  const attemptClose = () => { if (!dirty || window.confirm("Discard unsaved changes?")) close(); };
  return <aside className="settings-drawer" aria-label="Edit record"><div className="settings-drawer-head"><div><p>{section}</p><div className="drawer-title-row"><h2>{record?.name ?? `Add ${section === "Users & Roles" ? "user" : section.slice(0, -1)}`}</h2>{section === "Customers" && record && <div className="customer-summary customer-summary--inline"><button>₹ 1,24,600 <small>Outstanding</small></button><button>3 <small>Open quotes</small></button></div>}</div></div><button onClick={attemptClose}>×</button></div>
    <FormShell onDirtyChange={setDirty} onSave={() => save("Record saved")}>
      {section === "Users & Roles" ? <><Field label="Full name" value={record?.values?.["Full name"]} /><Field label="Email" type="email" value={record?.values?.Email} /><Field label="Phone" value={record?.values?.Phone} /><Field label="Role" value={record?.values?.Role} options={["Admin", "Office", "Engineer"]} /><Toggle label="Active" defaultChecked={record?.status !== "Inactive"} /><div className="settings-inline-actions"><button type="button">Resend invite</button><button type="button">Reset password</button></div></> : <RecordFields section={section} />}
      <Submit />
    </FormShell>
  </aside>;
}

function RecordFields({ section }: { section: Section }) {
  if (section === "Customers") return <><Field label="Company name" /><Field label="Contact person" /><Field label="Phone" /><Field label="Email" type="email" /><Field label="GSTIN" /><Field label="City" /><Field label="State" /><Field label="Payment terms" options={["Net 15", "Net 30", "Net 45", "Due on receipt"]} /><Field label="Billing address" type="textarea" /><label className="settings-check"><input type="checkbox" defaultChecked /> Same as billing address</label><Field label="Shipping address" type="textarea" /><Toggle label="Active" /></>;
  if (section === "Vendors") return <><Field label="Company name" /><Field label="Contact person" /><Field label="Phone" /><Field label="Email" type="email" /><Field label="GSTIN" /><Field label="PAN" /><Field label="Billing address" type="textarea" /><Field label="Payment terms" options={["Net 15", "Net 30", "Net 45"]} /><Toggle label="TDS applicable" /><Field label="TDS section" value="194C — Contractors" options={["194C — Contractors", "194I — Rent", "194J — Professional fees", "194Q — Purchase of goods"]} /><Field label="TDS rate (%)" value="1" /><Toggle label="Active" /></>;
  if (section === "Equipment Categories") return <><Field label="Category name" /><Field label="Parent category" value="None (root category)" options={["None (root category)", "Instruments", "Spares", "Consumables"]} /><Field label="Tracking type" value="Individual" options={["Individual", "Quantity"]} /><Field label="Unit of measure" value="Each" options={["Each", "Box", "Set", "Litre"]} /><Field label="Default minimum stock level" value="2" /><Field label="Internal equipment ID prefix" value="INS" /><Toggle label="Active" /></>;
  if (section === "Locations") return <><Field label="Location name" /><Field label="Location type" value="Office" options={["Office", "Warehouse", "Customer site", "Engineer"]} /><Field label="Linked customer" value="Nova Instruments" options={["Nova Instruments", "Arka Diagnostics"]} /><Field label="Linked user" value="Nikhil Rao" options={["Nikhil Rao", "Arun Kumar", "Priya Shah"]} /><Field label="Address" type="textarea" /><Toggle label="Active" /></>;
  return <><Field label="Expense type" /><Field label="Description" type="textarea" /><Field label="Applies to" value="Both" options={["Engineer claims", "Company expenses", "Both"]} /><Toggle label="Bill photo required" /><Toggle label="TDS applicable" /><Field label="TDS section" value="194C — Contractors" options={["194C — Contractors", "194J — Professional fees"]} /><Field label="TDS rate (%)" value="1" /><Toggle label="Recurring monthly" /><Field label="Due day of month" value="5" type="number" /><Toggle label="Active" /></>;
}

function CompanyForm({ onSave }: { onSave: () => void }) { return <FormShell className="settings-form settings-form--page" onSave={onSave}><Field label="Company name" value="SPM Lab Solutions Pvt. Ltd." /><Field label="GSTIN" value="29AAJCS2441N1ZK" /><Field label="PAN" value="AAJCS2441N" /><Field label="Phone" value="+91 80 4123 9090" /><Field label="Email" type="email" value="hello@spmlabsolutions.com" /><Field label="Website" value="www.spmlabsolutions.com" /><Field label="Registered address" type="textarea" value="Indiranagar, Bengaluru, Karnataka 560038" /><div className="settings-upload"><span>Company logo</span><input type="file" accept="image/*" /><small>Preview ready · PNG, JPG up to 5 MB</small></div><div className="settings-upload"><span>Signature / stamp for PDFs</span><input type="file" accept="image/*" /><small>Use a transparent PNG where possible</small></div><section className="settings-subsection"><h3>Bank details</h3><div className="settings-form"><Field label="Bank name" value="HDFC Bank" /><Field label="Account number" value="50200012345678" /><Field label="IFSC" value="HDFC0000123" /><Field label="Branch" value="Indiranagar" /></div></section><section className="settings-subsection"><h3>Number series</h3>{["Quotation", "Purchase Order", "Sales invoice", "Service invoice", "Rental invoice"].map((x, i) => <div className="series-row" key={x}><b>{x}</b><Field label="Prefix" value={i === 0 ? "QT-" : i === 1 ? "PO-" : i === 2 ? "INV-S-" : i === 3 ? "INV-V-" : "INV-R-"} /><Field label="Next number" value={String(101 + i)} type="number" /></div>)}<Toggle label="Reset all number series at financial year start" defaultChecked={false} /></section><Field label="Default terms and conditions" type="textarea" value="Payment due within the agreed credit period." /><Submit /></FormShell>; }

function AlertsForm({ onSave }: { onSave: () => void }) { return <FormShell className="settings-form settings-form--page" onSave={onSave}><section className="settings-subsection"><h3>Lead times</h3><div className="settings-form">{[["Calibration", "30"], ["Rental return", "7"], ["AMC renewal", "30"], ["Payment due", "3"]].map(([name, days]) => <Field key={name} label={`${name} — days before`} value={days} type="number" />)}</div><Toggle label="Low-stock alert" /></section><section className="settings-subsection"><h3>Channels</h3><div className="toggle-stack"><Toggle label="Dashboard" /><Toggle label="Email" /><Toggle label="SMS / WhatsApp" /></div></section><Field label="From email" type="email" value="alerts@spmlabsolutions.com" /><Field label="Sender number" value="+91 99887 76655" /><Field label="Users who receive alerts" value="Arun Kumar, Priya Shah" /><Toggle label="Repeat daily until resolved" /><Submit /></FormShell>; }

function TallyForm({ onSave }: { onSave: () => void }) { const ledgers = [["Sales", "Sales"], ["Service income", "Service Income"], ["Rental income", "Rental Income"], ["Purchase", "Purchase"], ["CGST output", "Output CGST"], ["SGST output", "Output SGST"], ["IGST output", "Output IGST"], ["CGST input", "Input CGST"], ["SGST input", "Input SGST"], ["IGST input", "Input IGST"], ["TDS receivable", "TDS Receivable"], ["TDS payable", "TDS Payable"], ["Round Off", "Round Off"], ["Sundry Debtors", "Sundry Debtors"], ["Sundry Creditors", "Sundry Creditors"], ["Bank", "Bank Accounts"], ["Cash", "Cash-in-Hand"]]; const sample = () => { const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n  <BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Create"><DATE>20260915</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>SPM-SAMPLE-001</VOUCHERNUMBER><PARTYLEDGERNAME>Sample Customer</PARTYLEDGERNAME><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>1180.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sample Customer</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-1180.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY>\n</ENVELOPE>`; const blob = new Blob([xml], { type: "application/xml;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "spm-tally-sample.xml"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }; return <FormShell className="settings-form settings-form--page" onSave={onSave}><section className="settings-subsection settings-subsection--wide"><div className="settings-section-head"><div><h3>Ledger mapping</h3><p>Defaults follow Tally’s standard ledger names.</p></div></div><div className="ledger-table"><div><b>ERP account</b><b>Tally ledger</b></div>{ledgers.map(([a, b]) => <div key={a}><span>{a}</span><input aria-label={`${a} Tally ledger`} defaultValue={b} /></div>)}</div></section><Field label="Export format" value="Tally XML" options={["Tally XML", "Excel"]} /><button type="button" className="settings-outline" onClick={sample}>Test export</button><Submit /></FormShell>; }

function RolePermissions({ onSave }: { onSave: () => void }) { return <FormShell className="permission-grid" onSave={onSave}><div className="settings-workspace-head"><div><h3>Role permissions</h3><p>Grant module access for the selected role.</p></div><Field label="Role" value="Office" options={["Admin", "Office", "Engineer"]} /></div><div className="permission-table"><div className="permission-header"><span>Module</span><span>View</span><span>Create</span><span>Approve</span></div>{modules.map((module) => <div className="permission-row" key={module}><b>{module}</b><input type="checkbox" defaultChecked />{module === "Dashboard" ? <><i>—</i><i>—</i><i>—</i></> : <><input type="checkbox" defaultChecked /><input type="checkbox" defaultChecked />{approveModules.has(module) ? <input type="checkbox" /> : <i>—</i>}</>}</div>)}</div><Submit text="Save role permissions" /></FormShell>; }

function OperationsForm({ onSave }: { onSave: () => void }) {
  return <form className="settings-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <div className="settings-form-grid">
      <label className="settings-field"><span>Jobs one engineer can take in a day</span><input type="number" min="1" max="10" defaultValue={JOB_SETTINGS.engineerDailyLimit} /><small>The schedule board turns amber at this number and red above it.</small></label>
      <label className="settings-field"><span>Default calibration interval</span><select defaultValue={String(JOB_SETTINGS.defaultCalibrationMonths)}>{[3, 6, 12, 24, 36].map((months) => <option key={months} value={months}>{months} months</option>)}</select><small>Used when a new customer instrument does not say.</small></label>
      <label className="settings-field"><span>Default job slot</span><select defaultValue={JOB_SETTINGS.defaultSlot}>{JOB_SLOTS.map((slot) => <option key={slot}>{slot}</option>)}</select><small>Morning, afternoon or a full day.</small></label>
      <label className="settings-field"><span>Who hears about unassigned jobs</span><input defaultValue={JOB_SETTINGS.unassignedAlertTo.join(", ")} /><small>They get a note when a job has nobody on it.</small></label>
    </div>
    <button className="erp-action" type="submit">Save operations settings</button>
  </form>;
}

function PrototypeToolsSection() {
  const store = useErpStore();
  return <div className="settings-form">
    <p className="erp-muted">This stands in for the mobile app and office biometric device, neither of which exist yet. It is kept out of ordinary work screens on purpose — use it here to generate sample check-in/checkout activity for demos and testing.</p>
    <DemoConsole jobs={store.jobs} />
  </div>;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function AttendanceRulesForm({ onSave }: { onSave: () => void }) {
  const store = useErpStore();
  const [name, setName] = useState(""); const [date, setDate] = useState("");
  const addHoliday = () => {
    if (!name.trim() || !date) return;
    updateStore((current) => ({ holidays: [...current.holidays, { id: `HOL-${Date.now()}`, date, name }].sort((a, b) => a.date.localeCompare(b.date)) }));
    setName(""); setDate("");
  };
  const removeHoliday = (id: string) => updateStore((current) => ({ holidays: current.holidays.filter((entry) => entry.id !== id) }));

  return <form className="settings-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <div className="settings-form-grid">
      <label className="settings-field"><span>Working hours start</span><input type="time" defaultValue={ATTENDANCE_SETTINGS.workStart} /></label>
      <label className="settings-field"><span>Working hours end</span><input type="time" defaultValue={ATTENDANCE_SETTINGS.workEnd} /></label>
      <label className="settings-field"><span>Weekly off</span><select defaultValue={String(ATTENDANCE_SETTINGS.weeklyOff[0])}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select><small>Used to compute schedule capacity.</small></label>
      <label className="settings-field"><span>Late grace period (minutes)</span><input type="number" min="0" defaultValue={ATTENDANCE_SETTINGS.lateGraceMinutesDemo} /><small>Demo default — not yet confirmed by SPM. A visit is only flagged "Check-in Not Received" after this grace window.</small></label>
      <label className="settings-field"><span>Site check-in radius (metres)</span><input type="number" min="10" defaultValue={ATTENDANCE_SETTINGS.siteRadiusMetersDemo} /><small>Demo default — not yet confirmed by SPM.</small></label>
    </div>
    <button className="erp-action" type="submit">Save attendance rules</button>

    <section className="settings-subsection">
      <h3>Holidays</h3>
      <div className="due-spare-add"><input placeholder="Holiday name" value={name} onChange={(event) => setName(event.target.value)} /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /><button type="button" className="settings-outline" onClick={addHoliday} disabled={!name.trim() || !date}>Add</button></div>
      {store.holidays.length > 0 && <ul className="due-spare-list">{store.holidays.map((holiday) => <li key={holiday.id}>{prettyDate(holiday.date)} — {holiday.name}<button type="button" onClick={() => removeHoliday(holiday.id)} aria-label="Remove">×</button></li>)}</ul>}
      {!store.holidays.length && <p className="settings-notice">No holidays configured yet.</p>}
    </section>
  </form>;
}
