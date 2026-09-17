import { dateIso, prettyDate } from "./erpMasters";
import { masterNextDue, resetStore, updateStore, useErpStore } from "./erpStore";
import DemoConsole from "./DemoConsole";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type Section = "Company" | "Users & Roles" | "Items & Categories" | "Master Instruments" | "Vendors" | "Expense Types" | "Alerts" | "Tally" | "Manual Check-in/Checkout";
type Row = { name: string; detail: string; status?: "Active" | "Inactive"; values?: Record<string, string> };

const configs: Record<Section, { description: string; rows: Row[]; importable?: boolean }> = {
  "Company": { description: "Business identity, invoice numbering and defaults used across SPM ERP.", rows: [] },
  "Users & Roles": { description: "Invite teammates and define what each role can access.", rows: [{ name: "Arun Kumar", detail: "arun@spmlabsolutions.com · Admin", status: "Active", values: { "Full name": "Arun Kumar", "Email": "arun@spmlabsolutions.com", "Phone": "+91 98450 22110", "Role": "Admin" } }, { name: "Priya Shah", detail: "priya@spmlabsolutions.com · Office", status: "Active", values: { "Full name": "Priya Shah", "Email": "priya@spmlabsolutions.com", "Phone": "+91 98204 81291", "Role": "Office" } }, { name: "Nikhil Rao", detail: "nikhil@spmlabsolutions.com · Engineer", status: "Inactive", values: { "Full name": "Nikhil Rao", "Email": "nikhil@spmlabsolutions.com", "Phone": "+91 99805 77722", "Role": "Engineer" } }] },
  "Items & Categories": { description: "Classification, tracking and reorder defaults for stock items.", rows: [{ name: "Instruments", detail: "Root category · Individual tracking", status: "Active" }, { name: "Spares", detail: "Root category · Quantity tracking", status: "Active" }, { name: "Calibration kits", detail: "Parent: Instruments · Individual tracking", status: "Active" }], importable: true },
  "Master Instruments": { description: "Reference standards used to calibrate customer instruments.", rows: [] },
  "Vendors": { description: "Supplier records, tax settings and contacts.", rows: [{ name: "Precision Systems India", detail: "Pune · TDS 1%", status: "Active" }, { name: "Nanotech Supplies", detail: "Chennai · TDS not applicable", status: "Inactive" }], importable: true },
  "Expense Types": { description: "Expense categories available to engineers and office teams.", rows: [{ name: "Travel", detail: "Both · bill photo required", status: "Active" }, { name: "Internet", detail: "Company expenses · recurring monthly", status: "Active" }, { name: "Food", detail: "Engineer claims", status: "Active" }] },
  "Alerts": { description: "Control lead times, recipients and delivery channels.", rows: [] },
  "Tally": { description: "Map ERP records to Tally ledgers and export settings.", rows: [] },
  "Manual Check-in/Checkout": { description: "Manually log a site or office check-in/checkout for an engineer, and reset the sample data.", rows: [] },
};

const TEMPLATE_HEADERS: Partial<Record<Section, string[]>> = {
  "Items & Categories": ["Name", "Parent Category", "Tracking Type", "Status"],
  "Vendors": ["Name", "Contact", "City", "State", "TDS Section", "TDS Rate"],
};
function downloadCsvTemplate(section: Section) {
  const headers = TEMPLATE_HEADERS[section] ?? ["Name", "Detail", "Status"];
  const blob = new Blob([headers.join(",")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `${section.toLowerCase().replace(/[^a-z]+/g, "-")}-template.csv`; document.body.appendChild(link); link.click(); document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const ALL_SECTIONS = Object.keys(configs) as Section[];
const modules = ["Dashboard", "Attendance", "Expenses", "Leads", "Quotations", "Orders", "Purchases", "Rentals", "Customers", "Invoices", "Stock", "Accounts", "Reports", "Settings"];
const approveModules = new Set(["Quotations", "Purchases", "Expenses"]);

export default function Settings() {
  const demoMode = useMemo(() => new URLSearchParams(window.location.search).get("demo") === "1", []);
  const sections = useMemo(() => ALL_SECTIONS.filter((item) => demoMode || item !== "Manual Check-in/Checkout"), [demoMode]);
  const [section, setSection] = useState<Section>("Company");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Active");
  const [drawer, setDrawer] = useState<Row | "new" | null>(null);
  const [toast, setToast] = useState("");
  const [userTab, setUserTab] = useState<"Users" | "Roles">("Users");
  const config = configs[section];
  const isFormPage = section === "Company" || section === "Alerts" || section === "Manual Check-in/Checkout" || section === "Tally" || section === "Master Instruments";
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
        {section === "Company" ? <CompanyForm onSave={() => notify("Company settings saved")} /> : section === "Alerts" ? <AlertsForm onSave={() => notify("Alert preferences saved")} /> : section === "Manual Check-in/Checkout" ? <ManualCheckInSection /> : section === "Tally" ? <TallyForm onSave={() => notify("Tally export settings saved")} /> : section === "Master Instruments" ? <MasterInstrumentsSection /> : section === "Users & Roles" && userTab === "Roles" ? <RolePermissions onSave={() => notify("Role permissions saved")} /> : <>
          <div className="settings-toolbar"><div className="settings-list-search"><span>⌕</span><input aria-label={`Search ${title}`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${title.toLowerCase()}…`} /></div><span className="settings-count">{rows.length} records</span><select aria-label="Record status filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option>Active</option><option>Inactive</option><option>All</option></select>{config.importable && <button className="settings-link" onClick={() => downloadCsvTemplate(section)}>Download template</button>}</div>
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
  return <aside className="settings-drawer" aria-label="Edit record"><div className="settings-drawer-head"><div><p>{section}</p><div className="drawer-title-row"><h2>{record?.name ?? `Add ${section === "Users & Roles" ? "user" : section.slice(0, -1)}`}</h2></div></div><button onClick={attemptClose}>×</button></div>
    <FormShell onDirtyChange={setDirty} onSave={() => save("Record saved")}>
      {section === "Users & Roles" ? <><Field label="Full name" value={record?.values?.["Full name"]} /><Field label="Email" type="email" value={record?.values?.Email} /><Field label="Phone" value={record?.values?.Phone} /><Field label="Role" value={record?.values?.Role} options={["Admin", "Office", "Engineer"]} /><Toggle label="Active" defaultChecked={record?.status !== "Inactive"} /></> : <RecordFields section={section} />}
      <Submit />
    </FormShell>
  </aside>;
}

function RecordFields({ section }: { section: Section }) {
  if (section === "Vendors") return <><Field label="Company name" /><Field label="Contact person" /><Field label="Phone" /><Field label="Email" type="email" /><Field label="GSTIN" /><Field label="PAN" /><Field label="Billing address" type="textarea" /><Field label="Payment terms" options={["Net 15", "Net 30", "Net 45"]} /><Toggle label="TDS applicable" /><Field label="TDS section" value="194C — Contractors" options={["194C — Contractors", "194I — Rent", "194J — Professional fees", "194Q — Purchase of goods"]} /><Field label="TDS rate (%)" value="1" /><Toggle label="Active" /></>;
  if (section === "Items & Categories") return <><Field label="Category name" /><Field label="Parent category" value="None (root category)" options={["None (root category)", "Instruments", "Spares", "Consumables"]} /><Field label="Tracking type" value="Individual" options={["Individual", "Quantity"]} /><Field label="Unit of measure" value="Each" options={["Each", "Box", "Set", "Litre"]} /><Field label="Default minimum stock level" value="2" /><Field label="Internal equipment ID prefix" value="INS" /><Toggle label="Active" /></>;
  return <><Field label="Expense type" /><Field label="Description" type="textarea" /><Field label="Applies to" value="Both" options={["Engineer claims", "Company expenses", "Both"]} /><Toggle label="Bill photo required" /><Toggle label="TDS applicable" /><Field label="TDS section" value="194C — Contractors" options={["194C — Contractors", "194J — Professional fees"]} /><Field label="TDS rate (%)" value="1" /><Toggle label="Recurring monthly" /><Field label="Due day of month" value="5" type="number" /><Toggle label="Active" /></>;
}

function CompanyForm({ onSave }: { onSave: () => void }) { return <FormShell className="settings-form settings-form--page" onSave={onSave}><Field label="Company name" value="SPM Lab Solutions Pvt. Ltd." /><Field label="GSTIN" value="29AAJCS2441N1ZK" /><Field label="PAN" value="AAJCS2441N" /><Field label="Phone" value="+91 80 4123 9090" /><Field label="Email" type="email" value="hello@spmlabsolutions.com" /><Field label="Website" value="www.spmlabsolutions.com" /><Field label="Registered address" type="textarea" value="Indiranagar, Bengaluru, Karnataka 560038" /><div className="settings-upload"><span>Company logo</span><input type="file" accept="image/*" /><small>Preview ready · PNG, JPG up to 5 MB</small></div><div className="settings-upload"><span>Signature / stamp for PDFs</span><input type="file" accept="image/*" /><small>Use a transparent PNG where possible</small></div><section className="settings-subsection"><h3>Bank details</h3><div className="settings-form"><Field label="Bank name" value="HDFC Bank" /><Field label="Account number" value="50200012345678" /><Field label="IFSC" value="HDFC0000123" /><Field label="Branch" value="Indiranagar" /></div></section><section className="settings-subsection"><h3>Number series</h3>{["Quotation", "Purchase Order", "Sales invoice", "Service invoice", "Rental invoice"].map((x, i) => <div className="series-row" key={x}><b>{x}</b><Field label="Prefix" value={i === 0 ? "QT-" : i === 1 ? "PO-" : i === 2 ? "INV-S-" : i === 3 ? "INV-V-" : "INV-R-"} /><Field label="Next number" value={String(101 + i)} type="number" /></div>)}<Toggle label="Reset all number series at financial year start" defaultChecked={false} /></section><Field label="Default terms and conditions" type="textarea" value="Payment due within the agreed credit period." /><Submit /></FormShell>; }

function AlertsForm({ onSave }: { onSave: () => void }) { return <FormShell className="settings-form settings-form--page" onSave={onSave}><section className="settings-subsection"><h3>Lead times</h3><div className="settings-form">{[["Calibration", "30"], ["Rental return", "7"], ["AMC renewal", "30"], ["Payment due", "3"]].map(([name, days]) => <Field key={name} label={`${name} — days before`} value={days} type="number" />)}</div><Toggle label="Low-stock alert" /></section><section className="settings-subsection"><h3>Channels</h3><div className="toggle-stack"><Toggle label="Dashboard" /><Toggle label="Email" /><Toggle label="SMS / WhatsApp" /></div></section><Field label="From email" type="email" value="alerts@spmlabsolutions.com" /><Field label="Sender number" value="+91 99887 76655" /><Field label="Users who receive alerts" value="Arun Kumar, Priya Shah" /><Toggle label="Repeat daily until resolved" /><Submit /></FormShell>; }

function TallyForm({ onSave }: { onSave: () => void }) { const ledgers = [["Sales", "Sales"], ["Service income", "Service Income"], ["Rental income", "Rental Income"], ["Purchase", "Purchase"], ["CGST output", "Output CGST"], ["SGST output", "Output SGST"], ["IGST output", "Output IGST"], ["CGST input", "Input CGST"], ["SGST input", "Input SGST"], ["IGST input", "Input IGST"], ["TDS receivable", "TDS Receivable"], ["TDS payable", "TDS Payable"], ["Round Off", "Round Off"], ["Sundry Debtors", "Sundry Debtors"], ["Sundry Creditors", "Sundry Creditors"], ["Bank", "Bank Accounts"], ["Cash", "Cash-in-Hand"]]; const sample = () => { const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n  <BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Create"><DATE>20260915</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>SPM-SAMPLE-001</VOUCHERNUMBER><PARTYLEDGERNAME>Sample Customer</PARTYLEDGERNAME><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>1180.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sample Customer</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-1180.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY>\n</ENVELOPE>`; const blob = new Blob([xml], { type: "application/xml;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "spm-tally-sample.xml"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }; return <FormShell className="settings-form settings-form--page" onSave={onSave}><section className="settings-subsection settings-subsection--wide"><div className="settings-section-head"><div><h3>Ledger mapping</h3><p>Defaults follow Tally’s standard ledger names.</p></div></div><div className="ledger-table"><div><b>ERP account</b><b>Tally ledger</b></div>{ledgers.map(([a, b]) => <div key={a}><span>{a}</span><input aria-label={`${a} Tally ledger`} defaultValue={b} /></div>)}</div></section><Field label="Export format" value="Tally XML" options={["Tally XML", "Excel"]} /><button type="button" className="settings-outline" onClick={sample}>Test export</button><Submit /></FormShell>; }

function RolePermissions({ onSave }: { onSave: () => void }) { return <FormShell className="permission-grid" onSave={onSave}><div className="settings-workspace-head"><div><h3>Role permissions</h3><p>Grant module access for the selected role.</p></div><Field label="Role" value="Office" options={["Admin", "Office", "Engineer"]} /></div><div className="permission-table"><div className="permission-header"><span>Module</span><span>View</span><span>Create</span><span>Approve</span></div>{modules.map((module) => <div className="permission-row" key={module}><b>{module}</b><input type="checkbox" defaultChecked />{module === "Dashboard" ? <><i>—</i><i>—</i><i>—</i></> : <><input type="checkbox" defaultChecked /><input type="checkbox" defaultChecked />{approveModules.has(module) ? <input type="checkbox" /> : <i>—</i>}</>}</div>)}</div><Submit text="Save role permissions" /></FormShell>; }

function MasterInstrumentsSection() {
  const store = useErpStore();
  const blank = { name: "", serial: "", accuracy: "", intervalMonths: "12", lab: "", lastCalibrated: dateIso(), certificate: "" };
  const [form, setForm] = useState(blank);
  const change = (key: keyof typeof blank, value: string) => setForm({ ...form, [key]: value });
  const addMaster = () => {
    if (!form.name.trim() || !form.serial.trim()) return;
    updateStore((current) => ({ masters: [...current.masters, { id: `MST-${Date.now()}`, name: form.name.trim(), serial: form.serial.trim(), accuracy: form.accuracy.trim(), intervalMonths: Number(form.intervalMonths) || 12, lab: form.lab.trim(), lastCalibrated: form.lastCalibrated, certificate: form.certificate.trim() }] }));
    setForm(blank);
  };
  const removeMaster = (id: string) => updateStore((current) => ({ masters: current.masters.filter((entry) => entry.id !== id) }));

  return <div className="settings-form">
    <section className="settings-subsection">
      <h3>Add a master instrument</h3>
      <div className="settings-form-grid">
        <label className="settings-field"><span>Name</span><input value={form.name} onChange={(event) => change("name", event.target.value)} /></label>
        <label className="settings-field"><span>Serial number</span><input value={form.serial} onChange={(event) => change("serial", event.target.value)} /></label>
        <label className="settings-field"><span>Accuracy</span><input value={form.accuracy} onChange={(event) => change("accuracy", event.target.value)} placeholder="e.g. ±0.5%" /></label>
        <label className="settings-field"><span>Calibration interval (months)</span><input type="number" min="1" value={form.intervalMonths} onChange={(event) => change("intervalMonths", event.target.value)} /></label>
        <label className="settings-field"><span>Calibrating lab</span><input value={form.lab} onChange={(event) => change("lab", event.target.value)} /></label>
        <label className="settings-field"><span>Last calibrated</span><input type="date" value={form.lastCalibrated} onChange={(event) => change("lastCalibrated", event.target.value)} /></label>
        <label className="settings-field"><span>Certificate number</span><input value={form.certificate} onChange={(event) => change("certificate", event.target.value)} /></label>
      </div>
      <button type="button" className="settings-outline" onClick={addMaster} disabled={!form.name.trim() || !form.serial.trim()}>Add master instrument</button>
    </section>
    <section className="settings-subsection">
      <h3>Master instruments</h3>
      {store.masters.length > 0 && <ul className="due-spare-list">{store.masters.map((master) => <li key={master.id}>{master.name} · {master.serial} — next due {prettyDate(masterNextDue(master))}<button type="button" onClick={() => removeMaster(master.id)} aria-label="Remove">×</button></li>)}</ul>}
      {!store.masters.length && <p className="settings-notice">No master instruments recorded yet.</p>}
    </section>
  </div>;
}

function ManualCheckInSection() {
  const store = useErpStore();
  const resetDemoData = () => {
    if (!window.confirm("Reset all data back to the starting sample? This can't be undone.")) return;
    resetStore();
    window.location.reload();
  };
  return <div className="settings-form">
    <p className="erp-muted">Use this to record a check-in or checkout by hand until the mobile app and biometric device are connected.</p>
    <DemoConsole jobs={store.jobs} />
    <section className="settings-subsection">
      <h3>Reset demo data</h3>
      <p className="erp-muted">Clears everything you've entered and starts over from the original sample data.</p>
      <button type="button" className="settings-outline" onClick={resetDemoData}>Reset demo data</button>
    </section>
  </div>;
}

