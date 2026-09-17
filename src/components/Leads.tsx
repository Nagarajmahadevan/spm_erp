import { useEffect, useMemo, useState } from "react";
import { COMPANY, money, totalsFor, type Quote } from "./erpMasters";
import { updateStore, useErpStore, type Lead, type LeadActivity as Activity, type LeadSource as Source, type LeadStage as Stage } from "./erpStore";
import { blankQuote, displayNumber as displayQuoteNumber, nextNumber as nextQuoteNumber, statusFor as quoteStatusFor } from "./Quotations";

const stages: Stage[] = ["New", "Contacted", "Quoted", "Won", "Lost"];

const stageClass = (stage: Stage) => stage.toLowerCase();
const initials = (name: string) => name.split(" ").map((part) => part[0]).join("");
const timestamp = () => "Just now · Arun Kumar";

function defaultActivity(lead: Lead): Activity[] {
  return [
    { title: `${lead.source} enquiry captured`, meta: "Today · 09:42 · System" },
    { title: `Follow-up assigned to ${lead.assigned}`, meta: "Today · 09:45 · Arun Kumar" },
  ];
}

function dayDifference(value: string) {
  const target = new Date(value);
  const today = new Date();
  target.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function followUpLabel(value?: string) {
  if (!value) return "—";
  const diff = dayDifference(value);
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  if (diff === 0) return `Today · ${time}`;
  if (diff === 1) return `Tomorrow · ${time}`;
  if (diff < 0) return `Overdue · ${Math.abs(diff)} ${Math.abs(diff) === 1 ? "day" : "days"}`;
  if (diff <= 7) return `In ${diff} days · ${time}`;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function isFollowUpMatch(value: string | undefined, filter: string) {
  if (filter === "All follow-ups") return true;
  if (!value) return false;
  const diff = dayDifference(value);
  if (filter === "Overdue") return diff < 0;
  if (filter === "Today") return diff === 0;
  return diff >= 0 && diff <= 7;
}

function nextFollowUp(days: number) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(10, 30, 0, 0);
  const offset = value.getTimezoneOffset();
  return new Date(value.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export default function Leads() {
  const { leads, quotes } = useErpStore();
  const setLeads = (change: (all: Lead[]) => Lead[]) => updateStore((current) => ({ leads: change(current.leads) }));
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("All stages");
  const [source, setSource] = useState("All sources");
  const [assigned, setAssigned] = useState("Everyone");
  const [followUp, setFollowUp] = useState("All follow-ups");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const drawer = leads.find((lead) => lead.id === drawerId) ?? null;
  const [creating, setCreating] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [toast, setToast] = useState("");

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };
  const updateLead = (id: string, patch: Partial<Lead>, message = "Lead updated") => {
    setLeads((all) => all.map((lead) => lead.id === id ? { ...lead, ...patch } : lead));
    flash(message);
  };
  const addLead = (lead: Lead) => {
    setLeads((all) => [lead, ...all]);
    setCreating(false);
    setDrawerId(lead.id);
    flash("Lead created");
  };
  const filtered = useMemo(
    () => leads.filter((lead) => `${lead.name} ${lead.company} ${lead.enquiry}`.toLowerCase().includes(search.toLowerCase())
      && (stage === "All stages" || lead.stage === stage)
      && (source === "All sources" || lead.source === source)
      && (assigned === "Everyone" || lead.assigned === assigned)
      && isFollowUpMatch(lead.followUpAt, followUp)),
    [leads, search, stage, source, assigned, followUp],
  );
  const cards = [
    ["New this week", leads.filter((lead) => lead.stage === "New").length, "new"],
    ["Follow-ups due today", leads.filter((lead) => lead.followUpAt && dayDifference(lead.followUpAt) === 0).length, "today"],
    ["Overdue follow-ups", leads.filter((lead) => lead.followUpAt && dayDifference(lead.followUpAt) < 0).length, "overdue"],
    ["Open leads", leads.filter((lead) => !["Won", "Lost"].includes(lead.stage)).length, "open"],
    ["Won this month", leads.filter((lead) => lead.stage === "Won").length, "won"],
  ] as const;

  return <section className="leads-page">
    <div className="leads-heading"><div><p className="erp-secondary-text">Sales / Leads</p><h1>Leads</h1><p className="erp-secondary-text mt-1">Capture every enquiry. Never miss a follow-up.</p></div><div className="leads-actions"><button className="erp-action" onClick={() => setCreating(true)}>+ New lead</button><div className="leads-overflow"><button className="settings-outline" onClick={() => setOverflow((open) => !open)}>⋯</button>{overflow && <div><button onClick={() => flash("CSV import is ready")}>Import CSV</button><button onClick={() => flash("Leads exported")}>Export</button></div>}</div></div></div>
    <div className="leads-overview">{cards.map(([label, value, tone]) => <button key={label} className={`leads-stat leads-stat--${tone}`} onClick={() => setFollowUp(label.includes("Overdue") ? "Overdue" : label.includes("today") ? "Today" : "All follow-ups")}><span>{label}</span><b>{value}</b></button>)}</div>
    <div className="leads-toolbar"><div className="settings-list-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search leads" /></div><select value={stage} onChange={(event) => setStage(event.target.value)}><option>All stages</option>{stages.map((item) => <option key={item}>{item}</option>)}</select><select value={source} onChange={(event) => setSource(event.target.value)}><option>All sources</option>{["Website", "Phone", "WhatsApp", "Email", "Referral"].map((item) => <option key={item}>{item}</option>)}</select><select value={assigned} onChange={(event) => setAssigned(event.target.value)}><option>Everyone</option><option>Arun Kumar</option><option>Priya Shah</option></select><select value={followUp} onChange={(event) => setFollowUp(event.target.value)}><option>All follow-ups</option><option>Today</option><option>This week</option><option>Overdue</option></select></div>
    <div className="leads-table-wrap"><table className="leads-table"><thead><tr><th>Name & company</th><th>Source</th><th>Enquiry</th><th>Stage</th><th>Next follow-up</th><th>Assigned to</th></tr></thead><tbody>{filtered.map((lead) => { const label = followUpLabel(lead.followUpAt); return <tr key={lead.id} onClick={() => setDrawerId(lead.id)}><td><b>{lead.name}</b><small>{lead.company} {lead.auto && <em className="lead-auto">Auto-captured</em>}</small></td><td><span className="lead-source">{lead.source}</span></td><td className="lead-enquiry">{lead.enquiry}</td><td><span className={`lead-stage lead-stage--${stageClass(lead.stage)}`}>{lead.stage}</span></td><td className={label.startsWith("Overdue") ? "lead-overdue" : ""}>{label}</td><td><span className="lead-assignee"><i>{initials(lead.assigned)}</i>{lead.assigned}</span></td></tr>; })}</tbody></table>{!filtered.length && <div className="settings-empty"><b>No leads match these filters</b><p>Clear a filter or add a new enquiry to get started.</p><button className="erp-action" onClick={() => setCreating(true)}>+ New lead</button></div>}</div>
    {creating && <NewLead leads={leads} close={() => setCreating(false)} create={addLead} />}
    {drawer && <LeadDrawer lead={drawer} quotes={quotes} close={() => setDrawerId(null)} update={updateLead} flash={flash} />}
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </section>;
}

function NewLead({ leads, close, create }: { leads: Lead[]; close: () => void; create: (lead: Lead) => void }) {
  const [form, setForm] = useState({ name: "", company: "", phone: "", email: "", source: "Phone" as Source, need: "", assigned: "Arun Kumar", date: "" });
  const duplicate = leads.find((lead) => (form.phone && lead.phone === form.phone) || (form.email && lead.email === form.email));
  const change = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  const submit = () => create({ id: `LD-${1050 + leads.length}`, name: form.name.trim(), company: form.company.trim(), phone: form.phone.trim(), email: form.email.trim(), city: "—", source: form.source, enquiry: form.need, stage: "New", followUpAt: `${form.date}T10:00`, assigned: form.assigned, activities: [{ title: "Phone enquiry captured", meta: "Just now · Arun Kumar" }, { title: `Follow-up set for ${form.date}`, meta: "Just now · Arun Kumar" }] });

  return <div className="stock-modal-backdrop"><section className="stock-move-modal lead-new-modal" role="dialog" aria-modal="true" aria-labelledby="new-lead-title"><button className="stock-modal-close" onClick={close}>×</button><p>Sales / Leads</p><h2 id="new-lead-title">New lead</h2><p className="lead-form-intro">A quick capture now keeps the follow-up from slipping away.</p><form className="settings-form" onSubmit={(event) => { event.preventDefault(); submit(); }}><label><span>Name</span><input value={form.name} onChange={(event) => change("name", event.target.value)} autoFocus required /></label><label><span>Company</span><input value={form.company} onChange={(event) => change("company", event.target.value)} /></label><label><span>Phone <b className="lead-required">Required</b></span><input value={form.phone} onChange={(event) => change("phone", event.target.value)} inputMode="tel" required /></label><label><span>Email <em className="lead-optional">Optional</em></span><input value={form.email} onChange={(event) => change("email", event.target.value)} type="email" /></label>{duplicate && <div className="lead-duplicate">This looks like an existing lead: <button type="button" onClick={close}>View {duplicate.name}</button> · <button type="button" onClick={close}>Add a note there</button></div>}<label><span>Source</span><select value={form.source} onChange={(event) => change("source", event.target.value)}>{["Website", "Phone", "WhatsApp", "Email", "Referral"].map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Assigned to</span><select value={form.assigned} onChange={(event) => change("assigned", event.target.value)}><option>Arun Kumar</option><option>Priya Shah</option></select></label><label className="lead-form-wide"><span>What they need</span><textarea value={form.need} onChange={(event) => change("need", event.target.value)} /></label><label><span>Next follow-up date <b className="lead-required">Required</b></span><input value={form.date} onChange={(event) => change("date", event.target.value)} type="date" required /></label><button className="erp-action" type="submit" disabled={!form.name.trim() || !form.phone.trim() || !form.date}>Create lead</button></form></section></div>;
}

function LeadDrawer({ lead, quotes, close, update, flash }: { lead: Lead; quotes: Quote[]; close: () => void; update: (id: string, patch: Partial<Lead>, message?: string) => void; flash: (message: string) => void }) {
  const [note, setNote] = useState("");
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostNote, setLostNote] = useState("");
  const [callOutcomesOpen, setCallOutcomesOpen] = useState(false);
  const [followUpPrompt, setFollowUpPrompt] = useState(false);
  const [deal, setDeal] = useState({ interestedIn: lead.interestedIn ?? "", value: lead.value ?? "", decision: lead.decision ?? "" });
  const isOpen = lead.stage === "New" || lead.stage === "Contacted" || lead.stage === "Quoted";

  useEffect(() => {
    setDeal({ interestedIn: lead.interestedIn ?? "", value: lead.value ?? "", decision: lead.decision ?? "" });
  }, [lead.id, lead.interestedIn, lead.value, lead.decision]);

  const activities = lead.activities ?? defaultActivity(lead);
  const addActivity = (activity: Activity, patch: Partial<Lead> = {}, message = "Lead updated") => update(lead.id, { ...patch, activities: [activity, ...activities] }, message);
  const setFollowUp = (days: number, message = "Follow-up set") => {
    update(lead.id, { followUpAt: nextFollowUp(days) }, message);
    setFollowUpPrompt(false);
  };
  const linkedQuotes = quotes.filter((quote) => quote.lead === lead.id);
  const latestQuote = linkedQuotes[0];
  const quoteSummary = latestQuote ? {
    number: displayQuoteNumber(latestQuote),
    value: money(totalsFor(latestQuote.items, latestQuote.customerState === COMPANY.state, latestQuote.overallDiscount ?? 0, latestQuote.freightCharges ?? 0).grandTotal),
    status: quoteStatusFor(latestQuote),
  } : undefined;
  const createQuotation = () => {
    const number = nextQuoteNumber(quotes);
    const quote: Quote = { ...blankQuote(number), customer: lead.company || lead.name, subject: lead.enquiry, lead: lead.id };
    updateStore((current) => ({
      quotes: [quote, ...current.quotes],
      leads: current.leads.map((item) => item.id === lead.id ? { ...item, stage: "Quoted", activities: [{ title: `Quotation ${displayQuoteNumber(quote)} created`, meta: timestamp(), tone: "deal" }, ...(item.activities ?? defaultActivity(item))] } : item),
    }));
    flash("Quotation created");
  };
  const markWon = () => {
    updateStore((current) => ({
      quotes: current.quotes.map((quote) => quote.lead === lead.id ? { ...quote, status: "Accepted" } : quote),
      leads: current.leads.map((item) => item.id === lead.id ? { ...item, stage: "Won", followUpAt: undefined, customer: { name: item.company || item.name, code: `CUS-${item.id.slice(-4)}` }, activities: [{ title: "Lead marked won", meta: timestamp(), tone: "deal" }, ...(item.activities ?? defaultActivity(item))] } : item),
    }));
    flash("Lead marked won");
  };
  const confirmLost = () => {
    if (!lostReason) return;
    addActivity({ title: `Lead marked lost — ${lostReason}`, meta: timestamp(), tone: "lost" }, { stage: "Lost", followUpAt: undefined, lostReason, lostNote, lostDate: "Today" }, "Lead marked lost");
    setLostOpen(false);
  };
  const reopen = () => addActivity({ title: "Lead reopened", meta: timestamp(), tone: "deal" }, { stage: "Contacted", followUpAt: nextFollowUp(1), lostReason: undefined, lostNote: undefined, lostDate: undefined }, "Lead reopened with a follow-up tomorrow");
  const logCall = (outcome: string) => {
    addActivity({ title: `Call logged — ${outcome}`, meta: timestamp(), tone: "call" }, {}, "Call outcome logged");
    setCallOutcomesOpen(false);
    setFollowUpPrompt(true);
  };
  const saveDeal = (patch: Partial<Lead>) => update(lead.id, patch, "Lead details saved");
  const closeDrawer = () => {
    if (followUpPrompt) {
      update(lead.id, {}, "Set the next follow-up before closing");
      return;
    }
    close();
  };

  return <aside className="lead-drawer" aria-label={`${lead.name} lead details`}>
    <div className="settings-drawer-head"><div><p>{lead.id}</p><h2>{lead.name}</h2><div className="lead-drawer-meta"><span>{lead.company}</span><span className="lead-source">{lead.source}</span><span className="lead-assignee"><i>{initials(lead.assigned)}</i>{lead.assigned}</span></div></div><button onClick={closeDrawer} aria-label="Close lead details">×</button></div>
    <div className="lead-stage-strip" aria-label={`Lead stage: ${lead.stage}`}>{stages.map((item) => <span key={item} className={`${item === lead.stage ? "is-current" : ""} ${stages.indexOf(item) <= stages.indexOf(lead.stage) && lead.stage !== "Lost" ? "is-complete" : ""} ${item === "Lost" && lead.stage === "Lost" ? "is-lost" : ""}`}>{item}</span>)}</div>
    <div className="lead-drawer-actions lead-drawer-actions--pinned">
      {(lead.stage === "New" || lead.stage === "Contacted") && <><button className="erp-action" onClick={createQuotation}>Create quotation</button><LossAction open={lostOpen} setOpen={setLostOpen} reason={lostReason} setReason={setLostReason} note={lostNote} setNote={setLostNote} confirm={confirmLost} /></>}
      {lead.stage === "Quoted" && <><button className="erp-action" onClick={markWon}>Mark won</button><LossAction open={lostOpen} setOpen={setLostOpen} reason={lostReason} setReason={setLostReason} note={lostNote} setNote={setLostNote} confirm={confirmLost} /></>}
      {lead.stage === "Lost" && <button className="erp-action" onClick={reopen}>Reopen lead</button>}
    </div>
    {lead.stage === "Quoted" && quoteSummary && <QuotationCard quotation={quoteSummary} open={() => flash(`Opened ${quoteSummary.number}`)} />}
    {lead.stage === "Won" && <section className="lead-section lead-result-section"><h3>Linked records</h3>{quoteSummary && <QuotationCard quotation={quoteSummary} open={() => flash(`Opened ${quoteSummary.number}`)} />}<div className="lead-customer-card"><span>Customer</span><b>{lead.customer?.name || lead.company}</b><a href={`#${lead.customer?.code || "customer"}`} onClick={(event) => { event.preventDefault(); flash("Opened customer record"); }}>{lead.customer?.code || "Customer record"} ↗</a></div></section>}
    {lead.stage === "Lost" && <section className="lead-section lead-lost-summary"><h3>Lost</h3><div><span>Reason</span><b>{lead.lostReason || "Not recorded"}</b></div><div><span>Date</span><b>{lead.lostDate || "Today"}</b></div>{lead.lostNote && <p>{lead.lostNote}</p>}</section>}
    <section className="lead-section"><h3>Contact</h3><div className="lead-contact"><span>{lead.phone}</span><a href={`tel:${lead.phone}`}>Call</a><a href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`}>WhatsApp</a></div>{lead.email && <p>{lead.email}</p>}<p>{lead.city}</p></section>
    <section className="lead-section"><h3>Enquiry</h3><p>{lead.enquiry}</p><div className="settings-form"><label><span>Interested in</span><input value={deal.interestedIn} onChange={(event) => setDeal({ ...deal, interestedIn: event.target.value })} onBlur={() => saveDeal({ interestedIn: deal.interestedIn })} placeholder="Pick a stock item or type" /></label><label><span>Estimated value</span><input value={deal.value} onChange={(event) => setDeal({ ...deal, value: event.target.value })} onBlur={() => saveDeal({ value: deal.value })} placeholder="₹" /></label><label><span>Expected decision</span><input value={deal.decision} onChange={(event) => setDeal({ ...deal, decision: event.target.value })} onBlur={() => saveDeal({ decision: deal.decision })} type="date" /></label></div></section>
    {isOpen && <section className="lead-section"><h3>Next follow-up <b className="lead-required">Required</b></h3><div className="settings-form"><label><span>Date & time</span><input type="datetime-local" value={lead.followUpAt ?? ""} required onChange={(event) => { if (event.target.value) update(lead.id, { followUpAt: event.target.value }, "Follow-up updated"); }} /></label><label className="lead-reminder"><input type="checkbox" defaultChecked /> Send reminder</label></div><div className="lead-snooze"><span>Quick set</span>{[[1, "1 day"], [3, "3 days"], [7, "1 week"]].map(([days, label]) => <button key={days} onClick={() => setFollowUp(days as number)}>{label}</button>)}</div></section>}
    <section className="lead-section"><h3>Activity</h3><div className="lead-log"><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a note" /><button onClick={() => { if (note.trim()) { addActivity({ title: note.trim(), meta: timestamp() }, {}, "Note added"); setNote(""); } }}>Add note</button>{isOpen && <button onClick={() => setCallOutcomesOpen((open) => !open)}>Log call</button>}</div>{callOutcomesOpen && <div className="lead-call-outcome"><span>Call outcome</span><div>{["Spoke", "No answer", "Call back", "Wrong number"].map((outcome) => <button key={outcome} onClick={() => logCall(outcome)}>{outcome}</button>)}</div></div>}{followUpPrompt && <div className="lead-followup-prompt"><b>Set the next follow-up</b><span>Every open lead needs a date before you continue.</span><div>{[[1, "1 day"], [3, "3 days"], [7, "1 week"]].map(([days, label]) => <button key={days} onClick={() => setFollowUp(days as number, "Call logged and follow-up set")}>{label}</button>)}</div></div>}<div className="lead-timeline">{activities.map((activity, index) => <div key={`${activity.title}-${index}`} className={activity.tone ? `lead-timeline--${activity.tone}` : ""}><i /><p><b>{activity.title}</b><span>{activity.meta}</span></p></div>)}</div></section>
  </aside>;
}

function LossAction({ open, setOpen, reason, setReason, note, setNote, confirm }: { open: boolean; setOpen: (value: boolean) => void; reason: string; setReason: (value: string) => void; note: string; setNote: (value: string) => void; confirm: () => void }) {
  return <div className="lead-loss-action"><button className="lead-lost-button" onClick={() => setOpen(!open)}>Mark lost</button>{open && <div className="lead-loss-popover"><b>Mark lead as lost</b><label><span>Reason</span><select value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Select a reason</option><option>Price</option><option>Competitor</option><option>No response</option><option>Not needed</option><option>Other</option></select></label><label><span>Note <em>Optional</em></span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context" /></label><div><button className="settings-outline" onClick={() => setOpen(false)}>Cancel</button><button className="erp-action" disabled={!reason} onClick={confirm}>Confirm lost</button></div></div>}</div>;
}

function QuotationCard({ quotation, open }: { quotation: { number: string; value: string; status: string }; open: () => void }) {
  return <div className="lead-quotation-card"><div><span>Quotation</span><b>{quotation.number}</b></div><div><span>Value</span><b>{quotation.value}</b></div><span className={`lead-quote-status lead-quote-status--${quotation.status.toLowerCase()}`}>{quotation.status}</span><a href={`#${quotation.number}`} onClick={(event) => { event.preventDefault(); open(); }}>Open quotation ↗</a></div>;
}
