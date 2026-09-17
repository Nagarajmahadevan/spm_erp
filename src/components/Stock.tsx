import { useMemo, useState } from "react";
import { ActionMenu, Overlay, Pagination, useTablePage } from "./ErpUi";
import { APPROVER, CALIBRATION_LABS, STOCK_LOCATIONS, STOCK_UNITS, WAREHOUSE, customerMaster, customerSites, dateIso, dayDifference, engineers, prettyDate } from "./erpMasters";
import {
  adjustBalance, applyReceiptToStock, balanceAt, nextEquipmentId, nextEquipmentIds, onOrderFor, orderAfterReceipt, pendingOf, recordEquipmentSale, totalOf, transferBalances, updateStore, useErpStore,
  type EquipmentHolder, type EquipmentOpStatus, type Individual, type POLine, type PurchaseOrder, type Quantity, type Receipt, type StockItem, type StockMove,
} from "./erpStore";

type ActionKey = "issue-engineer" | "transfer" | "issue-rent" | "sale" | "usage" | "receive-return" | "calibration-repair" | "adjust";
const ACTION_LABEL: Record<ActionKey, string> = {
  "issue-engineer": "Issue to Engineer", transfer: "Transfer Location", "issue-rent": "Issue on Rent", sale: "Record Sale",
  usage: "Record Usage on Job", "receive-return": "Receive Return", "calibration-repair": "Send for Calibration / Repair", adjust: "Adjust Stock",
};
const isIndividual = (item: StockItem): item is Individual => "holder" in item;
const opClass = (status: string) => status.toLowerCase().replace(/ /g, "-");
const operationLabel = (item: Individual) => item.holder === "Customer" && item.opStatus === "In use" ? "On rent" : item.opStatus;
const storeQuantity = (item: Quantity) => item.balances.filter((entry) => STOCK_LOCATIONS.includes(entry.location)).reduce((sum, entry) => sum + entry.quantity, 0);

function actionsFor(item: StockItem): ActionKey[] {
  if (isIndividual(item)) {
    if (item.opStatus === "Sold" || item.opStatus === "Retired") return [];
    if (item.holder === "Store") {
      if (item.opStatus === "Available") return ["issue-engineer", "transfer", "issue-rent", "sale", "calibration-repair"];
      return ["calibration-repair", "transfer"]; // Damaged / Awaiting calibration, still in the store
    }
    return ["receive-return"]; // with an engineer, a customer on rent, or at a calibration/repair lab
  }
  return ["issue-engineer", "transfer", "usage", "sale", "receive-return", "adjust"];
}

export default function Stock({ isEngineer = false, focusItem }: { isEngineer?: boolean; focusItem?: string }) {
  const [tab, setTab] = useState<"equipment" | "spares">("equipment");
  const [query, setQuery] = useState("");
  const [holderFilter, setHolderFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [alertFilter, setAlertFilter] = useState("All");
  const [dueSoon, setDueSoon] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const [sort, setSort] = useState("Name A–Z");
  const clearFilters = () => { setQuery(""); setHolderFilter("All"); setStatusFilter("All statuses"); setAlertFilter("All"); setDueSoon(false); };
  const { individuals, quantities, orders, moves, jobs } = useErpStore();
  const [acting, setActing] = useState<{ item: StockItem; action: ActionKey } | null>(null);
  const [detail, setDetail] = useState<StockItem | null>(() => focusItem ? [...individuals, ...quantities].find((item) => item.id === focusItem) ?? null : null);
  const [receiving, setReceiving] = useState(false);
  const [toast, setToast] = useState("");
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3200); };

  const equipmentRows = useMemo(() => individuals.filter((item) =>
    (holderFilter === "All" || item.holder === holderFilter)
    && (statusFilter === "All statuses" || operationLabel(item) === statusFilter)
    && (!dueSoon || Boolean(item.calibrationDue && dayDifference(item.calibrationDue) <= 7))
    && `${item.id} ${item.name} ${item.serial} ${item.currentWith}`.toLowerCase().includes(query.toLowerCase())
  ).sort((a, b) => sort === "Calibration due" ? (a.calibrationDue || "9999").localeCompare(b.calibrationDue || "9999") : sort === "ID" ? a.id.localeCompare(b.id) : a.name.localeCompare(b.name)), [individuals, holderFilter, statusFilter, dueSoon, query, sort]);
  const spareRows = useMemo(() => quantities.filter((item) =>
    (alertFilter === "All" || totalOf(item) < item.minimum)
    && `${item.id} ${item.name}`.toLowerCase().includes(query.toLowerCase())
  ).sort((a, b) => sort === "ID" ? a.id.localeCompare(b.id) : sort === "Lowest stock" ? totalOf(a) - totalOf(b) : a.name.localeCompare(b.name)), [quantities, alertFilter, query, sort]);
  const equipmentPage = useTablePage(equipmentRows, JSON.stringify([query, holderFilter, statusFilter, dueSoon, sort]));
  const sparePage = useTablePage(spareRows, JSON.stringify([query, alertFilter, sort]));
  const activeFilters = [query && `Search: ${query}`, tab === "equipment" && holderFilter !== "All" && `Currently with: ${holderFilter}`, tab === "equipment" && statusFilter !== "All statuses" && `Status: ${statusFilter}`, tab === "equipment" && dueSoon && "Calibration: overdue or within 7 days", tab === "spares" && alertFilter !== "All" && "Low stock"].filter(Boolean);

  const counts = useMemo(() => ({
    available: individuals.filter((item) => item.holder === "Store" && item.opStatus === "Available").length,
    onRent: individuals.filter((item) => operationLabel(item) === "On rent").length,
    review: individuals.filter((item) => item.holder === "Store" && item.opStatus === "Available" && (!item.calibrationDue || dayDifference(item.calibrationDue) < 0)).length,
    withEngineers: individuals.filter((item) => item.holder === "Engineer").length,
    lowSpares: quantities.filter((item) => totalOf(item) < item.minimum).length,
  }), [individuals, quantities]);

  return <section className="stock-page">
    <div className="stock-heading"><div><p className="erp-secondary-text">Operations / Stock</p><h1>Stock</h1></div><div className="stock-head-actions"><button className="erp-action" onClick={() => setReceiving(true)}>Receive stock</button></div></div>

    <div className="stock-tabs">
      <button className={tab === "equipment" ? "is-active" : ""} onClick={() => { setTab("equipment"); setHolderFilter("All"); setStatusFilter("All statuses"); setDueSoon(false); }}>Equipment <span>{individuals.length}</span></button>
      <button className={tab === "spares" ? "is-active" : ""} onClick={() => { setTab("spares"); setAlertFilter("All"); }}>Spares &amp; Consumables <span>{quantities.length}</span></button>
    </div>

    <div className="erp-summary-strip stock-overview">
      <button className="leads-stat" onClick={() => { clearFilters(); setTab("equipment"); setHolderFilter("Store"); setStatusFilter("Available"); setDueSoon(false); }}><span>In store · operational</span><b>{counts.available}</b></button>
      <button className="leads-stat leads-stat--today" onClick={() => { clearFilters(); setTab("equipment"); setHolderFilter("Customer"); setStatusFilter("On rent"); setDueSoon(false); }}><span>On rent</span><b>{counts.onRent}</b></button>
      <button className="leads-stat" onClick={() => { clearFilters(); setTab("equipment"); setHolderFilter("Engineer"); setStatusFilter("All statuses"); setDueSoon(false); }}><span>With engineers</span><b>{counts.withEngineers}</b></button>
      <button className="leads-stat leads-stat--overdue" onClick={() => { clearFilters(); setTab("spares"); setAlertFilter("Low stock"); }}><span>Low-stock spares</span><b>{counts.lowSpares}</b></button>
    </div>

    <div className="erp-filters">
      <label className="erp-search-filter"><span>Search stock</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, equipment, model or serial" /></label>
      {tab === "equipment" ? <>
        <label><span>Currently with</span><select value={holderFilter} onChange={(event) => setHolderFilter(event.target.value)}><option value="All">All locations</option><option value="Store">Office / Store</option><option value="Engineer">Engineer</option><option value="Customer">Customer</option><option value="Calibration/Repair">Calibration / repair</option></select></label>
        <label><span>Operational status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>{["All statuses", "Available", "On rent", "In use", "Damaged", "Awaiting calibration", "Sold", "Retired"].map((status) => <option key={status}>{status}</option>)}</select></label>
      </> : <label><span>Stock alert</span><select value={alertFilter} onChange={(event) => setAlertFilter(event.target.value)}><option value="All">All items</option><option value="Low stock">Low stock</option></select></label>}
      <label><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option>Name A–Z</option><option>ID</option><option>{tab === "equipment" ? "Calibration due" : "Lowest stock"}</option></select></label>
      {tab === "equipment" && <button className="settings-outline" aria-expanded={moreFilters} onClick={() => setMoreFilters(!moreFilters)}>More filters</button>}
    </div>
    {moreFilters && tab === "equipment" && <label className="stock-due-toggle"><input type="checkbox" checked={dueSoon} onChange={(event) => setDueSoon(event.target.checked)} /> Calibration overdue or due within 7 days</label>}
    {activeFilters.length > 0 && <div className="erp-filter-summary">{activeFilters.map((filter) => <span key={String(filter)}>{filter}</span>)}<button className="erp-record-link" onClick={clearFilters}>Clear all</button></div>}
    {tab === "equipment" && counts.review > 0 && <p className="stock-review-note">{counts.review} operational item{counts.review === 1 ? "" : "s"} in store need{counts.review === 1 ? "s" : ""} calibration review before a calibration-dependent job. Issue restrictions await SPM confirmation.</p>}
    {tab === "equipment"
      ? <><EquipmentTable items={equipmentPage.pageRows} open={setDetail} /><Pagination total={equipmentRows.length} page={equipmentPage.page} onPage={equipmentPage.setPage} /></>
      : <><SpareTable items={sparePage.pageRows} orders={orders} open={setDetail} /><Pagination total={spareRows.length} page={sparePage.page} onPage={sparePage.setPage} /></>}
    {!(tab === "equipment" ? equipmentRows.length : spareRows.length) && <div className="settings-empty"><b>No matching stock items</b><p>Try a different search or clear the filters.</p><button className="settings-outline" onClick={clearFilters}>Clear filters</button></div>}

    {detail && <Detail item={detail} moves={moves} close={() => setDetail(null)} act={(action) => { setDetail(null); setActing({ item: detail, action }); }} />}
    {acting && <ActionModal item={acting.item} action={acting.action} isEngineer={isEngineer} jobs={jobs} individuals={individuals} close={() => setActing(null)} flash={flash} />}
    {receiving && <ReceiveStockModal close={() => setReceiving(false)} flash={flash} />}
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </section>;
}
type Store2 = ReturnType<typeof useErpStore>;

function EquipmentTable({ items, open }: { items: Individual[]; open: (item: Individual) => void }) {
  return <div className="erp-table-shell"><table className="erp-data-table stock-equipment-register"><colgroup><col style={{ width: 92 }} /><col /><col style={{ width: 140 }} /><col style={{ width: "18%" }} /><col style={{ width: 200 }} /></colgroup><thead><tr><th>Internal ID</th><th>Equipment</th><th>Operational status</th><th>Currently with</th><th>Due information</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="erp-row-clickable" onClick={() => open(item)}>
    <td><b className="erp-nowrap">{item.id}</b></td>
    <td><b>{item.name}</b><small>{item.model}</small><small>{item.serial}</small></td>
    <td><span className={`stock-status ${opClass(item.opStatus)}`}>{operationLabel(item)}</span></td>
    <td>{item.currentWith}</td>
    <td>{item.calibrationDue ? <div className={dayDifference(item.calibrationDue) < 0 ? "stock-due-info is-overdue" : "stock-due-info"}><span>Calibration: <time>{prettyDate(item.calibrationDue)}</time></span>{dayDifference(item.calibrationDue) < 0 && <small>Overdue · Needs review</small>}{dayDifference(item.calibrationDue) >= 0 && dayDifference(item.calibrationDue) <= 7 && <small>Due soon</small>}</div> : <small>Calibration not recorded</small>}{operationLabel(item) === "On rent" && <div className="stock-due-info"><span>Rental return: <time>{item.rentalReturnDue ? prettyDate(item.rentalReturnDue) : "Not set"}</time></span>{item.rentalReturnDue && dayDifference(item.rentalReturnDue) < 0 && <small>Overdue</small>}</div>}</td>
  </tr>)}</tbody></table></div>;
}

function SpareTable({ items, orders, open }: { items: Quantity[]; orders: PurchaseOrder[]; open: (item: Quantity) => void }) {
  return <div className="erp-table-shell"><table className="erp-data-table stock-spares-register"><colgroup><col /><col style={{ width: 110 }} /><col style={{ width: 116 }} /><col style={{ width: 95 }} /><col style={{ width: 90 }} /><col style={{ width: 110 }} /></colgroup><thead><tr><th>Item / Stock code</th><th className="number">Total on hand</th><th className="number">Available in store</th><th className="number">Minimum level</th><th className="number">On order</th><th>Stock alert</th></tr></thead><tbody>{items.map((item) => { const total = totalOf(item); return <tr key={item.id} className="erp-row-clickable" onClick={() => open(item)}>
    <td><b>{item.name}</b><small>{item.id} · {item.unit}</small></td>
    <td className="number">{total.toLocaleString("en-IN")}</td><td className="number">{storeQuantity(item).toLocaleString("en-IN")}</td><td className="number">{item.minimum.toLocaleString("en-IN")}</td><td className="number">{onOrderFor(item.id, orders).toLocaleString("en-IN")}</td>
    <td>{total < item.minimum ? <span className="stock-status low">Low stock</span> : <span className="erp-muted">Within level</span>}</td>
  </tr>; })}</tbody></table></div>;
}

function Detail({ item, moves, close, act }: { item: StockItem; moves: StockMove[]; close: () => void; act: (action: ActionKey) => void }) {
  const actions = actionsFor(item);
  const history = moves.filter((entry) => isIndividual(item) ? entry.equipmentId === item.id || (!entry.equipmentId && entry.item === item.name) : entry.item === item.name);
  return <Overlay onClose={close} label={item.name}><aside className="stock-detail"><div className="settings-drawer-head">
    <div><p>{item.id} · {isIndividual(item) ? "Equipment" : "Spares & Consumables"}</p><h2>{isIndividual(item) && <span className="stock-id">{item.id} · </span>}{item.name}</h2>
      <div className="stock-detail-meta">{isIndividual(item) ? <><span className={`stock-status ${opClass(item.opStatus)}`}>{operationLabel(item)}</span><span>{item.currentWith}</span></> : <span>{totalOf(item)} {item.unit} on hand</span>}</div>
    </div>
    <button onClick={close} aria-label="Close">×</button>
  </div>

  {actions.length > 0 && <div className="stock-quick"><ActionMenu label="Stock actions" items={actions.map((key) => ({ label: ACTION_LABEL[key], onSelect: () => act(key) }))} /></div>}

  {isIndividual(item) ? <section className="stock-detail-section"><h3>Equipment details</h3><dl className="invoice-facts stock-facts">
    <div><dt>Model</dt><dd>{item.model}</dd></div>
    <div><dt>Serial</dt><dd>{item.serial}</dd></div>
    <div><dt>Ownership</dt><dd>SPM Lab Solutions</dd></div>
    <div><dt>Currently with</dt><dd>{item.currentWith}</dd></div>
    <div><dt>Operational status</dt><dd>{item.opStatus}</dd></div>
    <div><dt>Calibration due</dt><dd>{item.calibrationDue ? prettyDate(item.calibrationDue) : "—"}</dd></div>
    {item.holder === "Customer" && <div className="invoice-fact-wide"><dt>Rental return due</dt><dd>{item.rentalReturnDue ? prettyDate(item.rentalReturnDue) : "Not set"}{item.rentalRef ? ` · ${item.rentalRef}` : ""}</dd></div>}
    {item.condition && <div className="invoice-fact-wide"><dt>Condition noted</dt><dd>{item.condition}</dd></div>}
    {item.saleRef && <div className="invoice-fact-wide"><dt>Sold</dt><dd>{item.saleRef} — see Customer Instruments for the customer record.</dd></div>}
  </dl></section> : <section className="stock-detail-section"><h3>Count by location</h3><div className="quantity-counts">{item.balances.map((entry) => <div key={entry.location}><span>{entry.location}</span><b>{entry.quantity}</b></div>)}</div><dl className="stock-quantity-facts"><div><dt>On hand</dt><dd>{totalOf(item)} {item.unit}</dd></div><div><dt>Minimum level</dt><dd>{item.minimum} {item.unit}</dd></div></dl><p className="erp-muted">Low stock means total on hand across all locations is below the minimum. Engineer-held quantities are not available in store.</p>{totalOf(item) < item.minimum && <p className="stock-review-note">Low stock: {item.minimum - totalOf(item)} {item.unit} below minimum.</p>}</section>}

  <section className="stock-detail-section"><h3>Movement history</h3><Timeline moves={history} /></section>
  </aside></Overlay>;
}

function Timeline({ moves }: { moves: StockMove[] }) {
  if (!moves.length) return <p className="stock-timeline-empty">No movements recorded yet.</p>;
  return <div className="stock-timeline">{moves.map((entry) => <div key={entry.id}><i /><p><b>{entry.action}</b><span>{entry.at} · {entry.who}</span><small>{entry.source} → {entry.destination}{entry.quantity ? ` · ${entry.quantity} units` : ""}{entry.equipmentId ? ` · ${entry.equipmentId}` : ""} · <em>{entry.document || "No document"}</em></small>{entry.reason && <small>Reason: {entry.reason}</small>}</p></div>)}</div>;
}

/* ─── Stock Actions modal — one action, already chosen from the row ─── */
function ActionModal({ item, action, isEngineer, jobs, individuals, close, flash }: {
  item: StockItem; action: ActionKey; isEngineer: boolean; jobs: Store2["jobs"]; individuals: Individual[]; close: () => void; flash: (message: string) => void;
}) {
  const individual = isIndividual(item);
  const [source, setSource] = useState(!individual && item.balances.length === 1 ? item.balances[0].location : "");
  const available = !individual ? balanceAt(item, source) : 1;
  const [quantity, setQuantity] = useState("1");
  const [engineer, setEngineer] = useState(isEngineer ? engineers[0].name : engineers[0].name);
  const [jobId, setJobId] = useState("");
  const [customer, setCustomer] = useState(customerMaster[0]?.name ?? "");
  const [siteId, setSiteId] = useState("");
  const [dispatchDate, setDispatchDate] = useState(dateIso());
  const [returnDate, setReturnDate] = useState(dateIso());
  const [saleRef, setSaleRef] = useState("");
  const [destination, setDestination] = useState(STOCK_LOCATIONS.find((loc) => individual ? loc !== item.currentWith : loc !== source) ?? STOCK_LOCATIONS[0]);
  const [lab, setLab] = useState(CALIBRATION_LABS[0]);
  const [condition, setCondition] = useState<"Good" | "Damaged">("Good");
  const [remarks, setRemarks] = useState("");
  const [newCount, setNewCount] = useState(String(!individual ? available : 0));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const sites = customerSites.filter((site) => site.customer === customer);
  const openJobs = jobs.filter((entry) => entry.status !== "Completed" && entry.status !== "Cancelled");
  const jobInstruments = useMemo(() => { const job = jobs.find((entry) => entry.id === jobId); return job ? { customer: job.customer, siteId: job.siteId } : null; }, [jobId, jobs]);

  const sourceLocations = !individual ? item.balances.map((entry) => entry.location) : [];
  const needsSource = !individual && sourceLocations.length > 1 && ["issue-engineer", "transfer", "usage", "sale"].includes(action);
  const nonStoreHolders = !individual ? item.balances.filter((entry) => !STOCK_LOCATIONS.includes(entry.location) && entry.quantity > 0) : [];

  const submit = () => {
    setError("");
    const qty = Number(quantity) || 0;
    if (!individual && ["issue-engineer", "transfer", "usage", "sale"].includes(action)) {
      if (!source) { setError("Choose which location this is coming from."); return; }
      if (qty <= 0 || qty > balanceAt(item, source)) { setError(`Only ${balanceAt(item, source)} units are available at ${source}.`); return; }
    }
    const today = prettyDate(dateIso());

    if (individual) {
      if (action === "issue-engineer") {
        updateStore((current) => ({
          individuals: current.individuals.map((row) => row.id === item.id ? { ...row, holder: "Engineer" as EquipmentHolder, currentWith: engineer, opStatus: "In use" as EquipmentOpStatus, last: today } : row),
          moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${today} · now`, action: ACTION_LABEL[action], source: item.currentWith, destination: engineer, equipmentId: item.id, who: APPROVER, document: jobId || "", reason: jobId ? jobs.find((j) => j.id === jobId)?.number ?? "" : "", item: item.name }, ...current.moves],
        }));
        flash(`${item.name} issued to ${engineer}.`);
      } else if (action === "transfer") {
        updateStore((current) => ({
          individuals: current.individuals.map((row) => row.id === item.id ? { ...row, currentWith: destination, last: today } : row),
          moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${today} · now`, action: ACTION_LABEL[action], source: item.currentWith, destination, equipmentId: item.id, who: APPROVER, document: "", item: item.name }, ...current.moves],
        }));
        flash(`${item.name} transferred to ${destination}.`);
      } else if (action === "issue-rent") {
        if (!siteId) { setError("Pick the customer's site."); return; }
        const site = sites.find((entry) => entry.id === siteId);
        const rentalRef = `RENT-${String(Date.now()).slice(-4)}`;
        const currentWith = `${customer} · ${site?.name ?? ""}`;
        updateStore((current) => ({
          individuals: current.individuals.map((row) => row.id === item.id ? { ...row, holder: "Customer" as EquipmentHolder, currentWith, opStatus: "In use" as EquipmentOpStatus, rentalCustomer: customer, rentalSiteId: siteId, rentalReturnDue: returnDate, rentalRef, last: today } : row),
          moves: [{ id: `mv-${Date.now()}`, date: dispatchDate, at: `${prettyDate(dispatchDate)} · now`, action: ACTION_LABEL[action], source: item.currentWith, destination: currentWith, equipmentId: item.id, who: APPROVER, document: rentalRef, item: item.name }, ...current.moves],
        }));
        flash(`${item.name} on rent to ${customer} until ${prettyDate(returnDate)}. It stays SPM-owned.`);
      } else if (action === "sale") {
        if (!siteId) { setError("Pick the customer's site."); return; }
        const site = sites.find((entry) => entry.id === siteId);
        const ref = saleRef.trim() || `SALE-${String(Date.now()).slice(-4)}`;
        updateStore((current) => ({
          ...recordEquipmentSale(current, item.id, { customer, siteId, saleRef: ref }),
          moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${today} · now`, action: ACTION_LABEL[action], source: item.currentWith, destination: `${customer} · ${site?.name ?? ""}`, equipmentId: item.id, who: APPROVER, document: ref, item: item.name }, ...current.moves],
        }));
        flash(`${item.name} sold to ${customer}. It has left available stock and now appears once under Customer Instruments.`);
      } else if (action === "receive-return") {
        const opStatus: EquipmentOpStatus = condition === "Damaged" ? "Damaged" : "Available";
        const label = item.holder === "Customer" ? "Rental return" : item.holder === "Engineer" ? "Return from engineer" : "Return from calibration/repair";
        updateStore((current) => ({
          individuals: current.individuals.map((row) => row.id === item.id ? { ...row, holder: "Store" as EquipmentHolder, currentWith: destination, opStatus, condition: remarks || condition, rentalCustomer: undefined, rentalSiteId: undefined, rentalReturnDue: undefined, last: today } : row),
          moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${today} · now`, action: label, source: item.currentWith, destination, equipmentId: item.id, who: APPROVER, document: "", reason: condition, item: item.name }, ...current.moves],
        }));
        flash(condition === "Damaged" ? `${item.name} is back in ${destination} but marked Damaged — it will not show as available to issue.` : `${item.name} is back in ${destination} and available.`);
      } else if (action === "calibration-repair") {
        updateStore((current) => ({
          individuals: current.individuals.map((row) => row.id === item.id ? { ...row, holder: "Calibration/Repair" as EquipmentHolder, currentWith: lab, opStatus: "Awaiting calibration" as EquipmentOpStatus, last: today } : row),
          moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${today} · now`, action: ACTION_LABEL[action], source: item.currentWith, destination: lab, equipmentId: item.id, who: APPROVER, document: "", item: item.name }, ...current.moves],
        }));
        flash(`${item.name} sent to ${lab}.`);
      }
    } else {
      if (action === "issue-engineer") {
        updateStore((current) => ({
          quantities: current.quantities.map((row) => row.id === item.id ? { ...row, balances: transferBalances(row.balances, source, engineer, qty) } : row),
          moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${today} · now`, action: ACTION_LABEL[action], source, destination: engineer, quantity: qty, who: APPROVER, document: jobId ? jobs.find((j) => j.id === jobId)?.number ?? "" : "", item: item.name, beforeBalance: balanceAt(item, source), afterBalance: balanceAt(item, source) - qty }, ...current.moves],
        }));
        flash(`${qty} × ${item.name} issued to ${engineer}.`);
      } else if (action === "transfer") {
        updateStore((current) => ({
          quantities: current.quantities.map((row) => row.id === item.id ? { ...row, balances: transferBalances(row.balances, source, destination, qty) } : row),
          moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${today} · now`, action: ACTION_LABEL[action], source, destination, quantity: qty, who: APPROVER, document: "", item: item.name, beforeBalance: balanceAt(item, source), afterBalance: balanceAt(item, source) - qty }, ...current.moves],
        }));
        flash(`Transferred ${qty} × ${item.name}: ${source} → ${destination}. Total unchanged.`);
      } else if (action === "usage") {
        const job = jobs.find((entry) => entry.id === jobId);
        updateStore((current) => ({
          quantities: current.quantities.map((row) => row.id === item.id ? { ...row, balances: adjustBalance(row.balances, source, -qty) } : row),
          moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${today} · now`, action: ACTION_LABEL[action], source, destination: job?.customer ?? "Job", quantity: qty, who: APPROVER, document: job?.number ?? "", item: item.name, beforeBalance: balanceAt(item, source), afterBalance: balanceAt(item, source) - qty }, ...current.moves],
        }));
        flash(`Used ${qty} × ${item.name} on ${job?.number ?? "the job"}.`);
      } else if (action === "sale") {
        updateStore((current) => ({
          quantities: current.quantities.map((row) => row.id === item.id ? { ...row, balances: adjustBalance(row.balances, source, -qty) } : row),
          moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${today} · now`, action: ACTION_LABEL[action], source, destination: customer || "Customer", quantity: qty, who: APPROVER, document: saleRef, item: item.name, beforeBalance: balanceAt(item, source), afterBalance: balanceAt(item, source) - qty }, ...current.moves],
        }));
        flash(`Sold ${qty} × ${item.name}.`);
      } else if (action === "receive-return") {
        if (!source) { setError("Pick who is returning it."); return; }
        updateStore((current) => ({
          quantities: current.quantities.map((row) => row.id === item.id ? { ...row, balances: transferBalances(row.balances, source, destination, qty) } : row),
          moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${today} · now`, action: ACTION_LABEL[action], source, destination, quantity: qty, who: APPROVER, document: "", item: item.name, beforeBalance: balanceAt(item, source), afterBalance: balanceAt(item, source) - qty }, ...current.moves],
        }));
        flash(`${qty} × ${item.name} returned to ${destination}. Store stock is up; the company-wide total is unchanged.`);
      } else if (action === "adjust") {
        if (!reason.trim()) { setError("Say why you are adjusting the count."); return; }
        const loc = source || sourceLocations[0] || WAREHOUSE;
        const before = balanceAt(item, loc);
        const after = Number(newCount) || 0;
        updateStore((current) => ({
          quantities: current.quantities.map((row) => row.id === item.id ? { ...row, balances: adjustBalance(row.balances, loc, after - before) } : row),
          moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${today} · now`, action: ACTION_LABEL[action], source: loc, destination: loc, who: APPROVER, document: "", reason, item: item.name, beforeBalance: before, afterBalance: after }, ...current.moves],
        }));
        flash(`${loc}: ${item.name} adjusted from ${before} to ${after}.`);
      }
    }
    close();
  };

  return <Overlay onClose={close} label={ACTION_LABEL[action]}><section className="stock-move-modal stock-action-modal" role="dialog" aria-modal="true" aria-labelledby="action-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <p>Stock Actions</p><h2 id="action-title">{ACTION_LABEL[action]}</h2>
    <div className="stock-picked"><b>{item.name}</b><span>{individual ? `${(item as Individual).id} · ${(item as Individual).currentWith}` : `${totalOf(item as Quantity)} ${(item as Quantity).unit} across ${(item as Quantity).balances.length} location${(item as Quantity).balances.length === 1 ? "" : "s"}`}</span></div>

    {needsSource && <label className="settings-field"><span>Source location <b className="lead-required">Required</b></span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="">Choose where this is coming from</option>{sourceLocations.map((loc) => <option key={loc} value={loc}>{loc} · {balanceAt(item as Quantity, loc)} available</option>)}</select></label>}
    {!individual && source && ["issue-engineer", "transfer", "usage", "sale"].includes(action) && <p className="po-start-hint">{available} available at {source}.</p>}

    {!individual && ["issue-engineer", "transfer", "usage", "sale"].includes(action) && <label className="settings-field"><span>Quantity</span><input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>}

    {action === "issue-engineer" && <>
      <label className="settings-field"><span>Engineer</span><select value={engineer} onChange={(event) => setEngineer(event.target.value)}>{engineers.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label>
      <label className="settings-field"><span>Date</span><input type="date" value={dispatchDate} onChange={(event) => setDispatchDate(event.target.value)} /></label>
      <label className="settings-field"><span>Job (optional)</span><select value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="">No specific job</option>{openJobs.map((job) => <option key={job.id} value={job.id}>{job.number} · {job.customer}</option>)}</select></label>
    </>}

    {action === "transfer" && <label className="settings-field"><span>Transfer to</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{(individual ? STOCK_LOCATIONS : [...STOCK_LOCATIONS, ...engineers.map((entry) => entry.name)]).filter((loc) => loc !== (individual ? item.currentWith : source)).map((loc) => <option key={loc}>{loc}</option>)}</select></label>}

    {action === "issue-rent" && <>
      <label className="settings-field"><span>Customer</span><select value={customer} onChange={(event) => { setCustomer(event.target.value); setSiteId(""); }}>{customerMaster.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label>
      <label className="settings-field"><span>Site <b className="lead-required">Required</b></span><select value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">Pick a site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}</select></label>
      <label className="settings-field"><span>Dispatch date</span><input type="date" value={dispatchDate} onChange={(event) => setDispatchDate(event.target.value)} /></label>
      <label className="settings-field"><span>Expected return date</span><input type="date" value={returnDate} onChange={(event) => setReturnDate(event.target.value)} /></label>
    </>}

    {action === "sale" && <>
      <label className="settings-field"><span>Customer</span><select value={customer} onChange={(event) => { setCustomer(event.target.value); setSiteId(""); }}>{customerMaster.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label>
      {individual && <label className="settings-field"><span>Site <b className="lead-required">Required</b></span><select value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">Pick a site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}</select></label>}
      <label className="settings-field"><span>Sales document reference (optional)</span><input value={saleRef} onChange={(event) => setSaleRef(event.target.value)} placeholder="e.g. INV-2026-0119" /></label>
      {individual && <p className="ci-derived-note">This creates or links the Customer Instrument record automatically and preserves this unit's history.</p>}
    </>}

    {action === "usage" && <>
      <label className="settings-field"><span>Job</span><select value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="">Pick a job</option>{openJobs.map((job) => <option key={job.id} value={job.id}>{job.number} · {job.customer}</option>)}</select></label>
    </>}

    {action === "receive-return" && <>
      {!individual && <label className="settings-field"><span>Returning from <b className="lead-required">Required</b></span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="">Choose who is returning it</option>{nonStoreHolders.map((entry) => <option key={entry.location} value={entry.location}>{entry.location} · {entry.quantity} to return</option>)}</select></label>}
      {!individual && source && <label className="settings-field"><span>Quantity</span><input type="number" min="1" max={balanceAt(item as Quantity, source)} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>}
      <label className="settings-field"><span>Destination</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{STOCK_LOCATIONS.map((loc) => <option key={loc}>{loc}</option>)}</select></label>
      {individual && <>
        <div className="stock-choice-row"><button className={condition === "Good" ? "is-selected" : ""} onClick={() => setCondition("Good")}>Good condition</button><button className={condition === "Damaged" ? "is-selected" : ""} onClick={() => setCondition("Damaged")}>Damaged</button></div>
        <label className="settings-field"><span>Remarks (optional)</span><input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Condition notes" /></label>
        {condition === "Damaged" && <p className="po-start-hint">Damaged equipment returns to the store but will not be available to issue until it is repaired.</p>}
      </>}
    </>}

    {action === "calibration-repair" && <label className="settings-field"><span>Send to</span><select value={lab} onChange={(event) => setLab(event.target.value)}>{CALIBRATION_LABS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>}

    {action === "adjust" && <>
      <label className="settings-field"><span>Location</span><select value={source} onChange={(event) => { setSource(event.target.value); setNewCount(String(balanceAt(item as Quantity, event.target.value))); }}><option value="">Choose a location</option>{sourceLocations.map((loc) => <option key={loc} value={loc}>{loc} · currently {balanceAt(item as Quantity, loc)}</option>)}</select></label>
      <label className="settings-field"><span>New physical count</span><input type="number" min="0" value={newCount} onChange={(event) => setNewCount(event.target.value)} /></label>
      <label className="settings-field"><span>Reason <b className="lead-required">Required</b></span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. physical count after stock-take" /></label>
      <p className="po-start-hint">Recorded with your name, the time, and the before/after balance.</p>
    </>}

    {error && <p className="stock-count-error">{error}</p>}
    {isIndividual(item) && ["issue-engineer", "issue-rent"].includes(action) && (!item.calibrationDue || dayDifference(item.calibrationDue) < 0) && <p className="stock-review-note">Needs review: calibration is overdue or not recorded. Confirm suitability before issue; SPM issue restrictions are not yet configured.</p>}
    <div className="stock-move-footer"><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={submit}>Confirm</button></div>
  </section></Overlay>;
}

/* ─── Receive stock — fields depend on the reason ─── */
type ReceiveReason = "Purchase Receipt" | "Return from Engineer" | "Rental Return" | "Return from Calibration / Repair" | "Opening Stock";
function ReceiveStockModal({ close, flash }: { close: () => void; flash: (message: string) => void }) {
  const { orders, individuals, quantities } = useErpStore();
  const [reason, setReason] = useState<ReceiveReason>("Purchase Receipt");

  return <Overlay onClose={close} label="Receive stock"><section className="stock-move-modal stock-receive-modal" role="dialog" aria-modal="true" aria-labelledby="receive-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <p>New stock</p><h2 id="receive-title">Receive stock</h2>
    <label className="settings-field"><span>Reason</span><select value={reason} onChange={(event) => setReason(event.target.value as ReceiveReason)}>
      <option>Purchase Receipt</option><option>Return from Engineer</option><option>Rental Return</option><option>Return from Calibration / Repair</option><option>Opening Stock</option>
    </select></label>
    {reason === "Purchase Receipt" && <PurchaseReceiptFields orders={orders} individuals={individuals} close={close} flash={flash} />}
    {reason === "Return from Engineer" && <EngineerReturnFields individuals={individuals} quantities={quantities} close={close} flash={flash} />}
    {reason === "Rental Return" && <RentalReturnFields individuals={individuals} close={close} flash={flash} />}
    {reason === "Return from Calibration / Repair" && <CalibrationReturnFields individuals={individuals} close={close} flash={flash} />}
    {reason === "Opening Stock" && <OpeningStockFields individuals={individuals} quantities={quantities} close={close} flash={flash} />}
  </section></Overlay>;
}

function PurchaseReceiptFields({ orders, individuals, close, flash }: { orders: PurchaseOrder[]; individuals: Individual[]; close: () => void; flash: (message: string) => void }) {
  const open = orders.filter((order) => order.status === "Sent" || order.status === "Partly received");
  const [orderId, setOrderId] = useState("");
  const order = open.find((entry) => entry.id === orderId) ?? null;
  const [location, setLocation] = useState(order?.deliveryAddress || WAREHOUSE);
  const [date, setDate] = useState(dateIso());
  const [challan, setChallan] = useState("");
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [serials, setSerials] = useState<Record<string, string[]>>({});

  const pick = (id: string) => { const found = open.find((entry) => entry.id === id); setOrderId(id); setLocation(found?.deliveryAddress || WAREHOUSE); setAmounts(Object.fromEntries((found?.items ?? []).map((line) => [line.id, pendingOf(line)]))); setSerials({}); };
  const generate = (line: POLine) => {
    const count = amounts[line.id] ?? 0;
    const taken = Object.values(serials).flat().map((id) => ({ id } as Individual));
    setSerials((all) => ({ ...all, [line.id]: nextEquipmentIds([...individuals, ...taken], count) }));
  };
  const total = order ? order.items.reduce((sum, line) => sum + (amounts[line.id] ?? 0), 0) : 0;

  const submit = () => {
    if (!order) return;
    const lines = order.items.map((line) => ({ lineId: line.id, quantity: amounts[line.id] ?? 0, serials: (serials[line.id] ?? []).filter(Boolean) })).filter((entry) => entry.quantity > 0);
    if (!lines.length) return;
    const receipt: Receipt = { id: `rc-${Date.now()}`, date, location, challan, note: "", lines };
    const nextOrder = orderAfterReceipt(order, receipt);
    updateStore((current) => ({ orders: current.orders.map((entry) => entry.id === order.id ? nextOrder : entry), ...applyReceiptToStock(current, order, receipt) }));
    close(); flash(`Received against ${order.number}. ${order.items.map((line) => { const got = lines.find((entry) => entry.lineId === line.id); return got ? `${line.item}: ${line.received + got.quantity} of ${line.quantity} now in.` : ""; }).filter(Boolean).join(" ")}`);
  };

  return <>
    <label className="settings-field"><span>Purchase order <b className="lead-required">Required</b></span><select value={orderId} onChange={(event) => pick(event.target.value)}><option value="">Pick an open PO</option>{open.map((entry) => <option key={entry.id} value={entry.id}>{entry.number} · {entry.vendor}</option>)}</select></label>
    {order && <>
      <p className="po-start-hint">Supplier: {order.vendor}. Check what actually turned up.</p>
      <div className="po-receive-list">{order.items.map((line) => { const pending = pendingOf(line); const entered = amounts[line.id] ?? 0; return <div key={line.id} className="po-receive-row">
        <div className="po-receive-head"><b>{line.item}</b><span>Ordered {line.quantity} · received {line.received} · pending {pending}</span></div>
        <label className="po-receive-qty"><span>Received now</span><input type="number" min="0" max={pending} value={entered} onChange={(event) => setAmounts((all) => ({ ...all, [line.id]: Number(event.target.value) }))} /></label>
        {line.tracked && entered > 0 && <div className="po-serials">
          <div className="po-serials-head"><span>Serial / internal ID for each unit</span><button className="invoice-edit-link" onClick={() => generate(line)}>Generate</button></div>
          {Array.from({ length: entered }, (_, index) => <input key={index} value={serials[line.id]?.[index] ?? ""} placeholder={`Scan or enter ID ${index + 1}`} onChange={(event) => setSerials((all) => { const next = [...(all[line.id] ?? [])]; next[index] = event.target.value; return { ...all, [line.id]: next }; })} />)}
        </div>}
      </div>; })}</div>
      <div className="po-receive-grid">
        <label><span>Date received</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label><span>Destination</span><select value={location} onChange={(event) => setLocation(event.target.value)}>{STOCK_LOCATIONS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
        <label><span>Supplier document (optional)</span><input value={challan} onChange={(event) => setChallan(event.target.value)} placeholder="Challan or bill no." /></label>
      </div>
      <div className="invoice-payment-footer"><span>Adding {total} item{total === 1 ? "" : "s"}</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" disabled={!total} onClick={submit}>Receive stock</button></div></div>
    </>}
  </>;
}

function EngineerReturnFields({ individuals, quantities, close, flash }: { individuals: Individual[]; quantities: Quantity[]; close: () => void; flash: (message: string) => void }) {
  const [engineerName, setEngineerName] = useState(engineers[0].name);
  const [kind, setKind] = useState<"equipment" | "spares">("equipment");
  const held = individuals.filter((item) => item.holder === "Engineer" && item.currentWith === engineerName);
  const [equipmentId, setEquipmentId] = useState("");
  const [condition, setCondition] = useState<"Good" | "Damaged">("Good");
  const [destination, setDestination] = useState(WAREHOUSE);
  const [spareId, setSpareId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const spareItem = quantities.find((entry) => entry.id === spareId);
  const available = spareItem ? balanceAt(spareItem, engineerName) : 0;

  const submitEquipment = () => {
    const item = held.find((entry) => entry.id === equipmentId);
    if (!item) return;
    const opStatus: EquipmentOpStatus = condition === "Damaged" ? "Damaged" : "Available";
    updateStore((current) => ({
      individuals: current.individuals.map((row) => row.id === item.id ? { ...row, holder: "Store" as EquipmentHolder, currentWith: destination, opStatus, condition, last: prettyDate(dateIso()) } : row),
      moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${prettyDate(dateIso())} · now`, action: "Return from engineer", source: engineerName, destination, equipmentId: item.id, who: APPROVER, document: "", reason: condition, item: item.name }, ...current.moves],
    }));
    close(); flash(`${item.name} received back from ${engineerName} into ${destination}.`);
  };
  const submitSpares = () => {
    if (!spareItem || Number(quantity) <= 0 || Number(quantity) > available) return;
    updateStore((current) => ({
      quantities: current.quantities.map((row) => row.id === spareItem.id ? { ...row, balances: transferBalances(row.balances, engineerName, destination, Number(quantity)) } : row),
      moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${prettyDate(dateIso())} · now`, action: "Return from engineer", source: engineerName, destination, quantity: Number(quantity), who: APPROVER, document: "", item: spareItem.name }, ...current.moves],
    }));
    close(); flash(`${quantity} × ${spareItem.name} returned from ${engineerName}. Store stock is up; the total is unchanged.`);
  };

  return <>
    <label className="settings-field"><span>Engineer</span><select value={engineerName} onChange={(event) => { setEngineerName(event.target.value); setEquipmentId(""); setSpareId(""); }}>{engineers.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label>
    <div className="stock-choice-row"><button className={kind === "equipment" ? "is-selected" : ""} onClick={() => setKind("equipment")}>Equipment</button><button className={kind === "spares" ? "is-selected" : ""} onClick={() => setKind("spares")}>Spares &amp; Consumables</button></div>
    {kind === "equipment" ? <>
      <label className="settings-field"><span>Which item <b className="lead-required">Required</b></span><select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)}><option value="">{held.length ? "Pick an item" : `${engineerName} has nothing checked out`}</option>{held.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select></label>
      {equipmentId && <>
        <div className="stock-choice-row"><button className={condition === "Good" ? "is-selected" : ""} onClick={() => setCondition("Good")}>Good condition</button><button className={condition === "Damaged" ? "is-selected" : ""} onClick={() => setCondition("Damaged")}>Damaged</button></div>
        <label className="settings-field"><span>Destination</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{STOCK_LOCATIONS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
        <div className="invoice-payment-footer"><span>{condition === "Damaged" ? "Will not be available to issue" : "Will become available"}</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={submitEquipment}>Receive return</button></div></div>
      </>}
    </> : <>
      <label className="settings-field"><span>Which spare <b className="lead-required">Required</b></span><select value={spareId} onChange={(event) => setSpareId(event.target.value)}><option value="">Pick a spare</option>{quantities.filter((entry) => balanceAt(entry, engineerName) > 0).map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {balanceAt(entry, engineerName)} with {engineerName}</option>)}</select></label>
      {spareItem && <>
        <label className="settings-field"><span>Quantity</span><input type="number" min="1" max={available} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
        <label className="settings-field"><span>Destination</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{STOCK_LOCATIONS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
        <div className="invoice-payment-footer"><span>Store stock rises; company total unchanged</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" disabled={Number(quantity) > available || Number(quantity) <= 0} onClick={submitSpares}>Receive return</button></div></div>
      </>}
    </>}
  </>;
}

function RentalReturnFields({ individuals, close, flash }: { individuals: Individual[]; close: () => void; flash: (message: string) => void }) {
  const onRent = individuals.filter((item) => item.holder === "Customer" && item.opStatus !== "Sold");
  const [equipmentId, setEquipmentId] = useState("");
  const [condition, setCondition] = useState<"Good" | "Damaged">("Good");
  const [destination, setDestination] = useState(WAREHOUSE);
  const [remarks, setRemarks] = useState("");
  const item = onRent.find((entry) => entry.id === equipmentId);

  const submit = () => {
    if (!item) return;
    const opStatus: EquipmentOpStatus = condition === "Damaged" ? "Damaged" : "Available";
    updateStore((current) => ({
      individuals: current.individuals.map((row) => row.id === item.id ? { ...row, holder: "Store" as EquipmentHolder, currentWith: destination, opStatus, condition: remarks || condition, rentalCustomer: undefined, rentalSiteId: undefined, rentalReturnDue: undefined, last: prettyDate(dateIso()) } : row),
      moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${prettyDate(dateIso())} · now`, action: "Rental return", source: item.currentWith, destination, equipmentId: item.id, who: APPROVER, document: item.rentalRef ?? "", reason: condition, item: item.name }, ...current.moves],
    }));
    close(); flash(condition === "Damaged" ? `${item.name} returned from rental but marked Damaged — not available to issue.` : `${item.name} returned from rental and back in ${destination}.`);
  };

  return <>
    <label className="settings-field"><span>Which rental <b className="lead-required">Required</b></span><select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)}><option value="">Pick an item on rent</option>{onRent.map((entry) => <option key={entry.id} value={entry.id}>{entry.id} · {entry.name} · {entry.currentWith}</option>)}</select></label>
    {item && <>
      <div className="stock-choice-row"><button className={condition === "Good" ? "is-selected" : ""} onClick={() => setCondition("Good")}>Good condition</button><button className={condition === "Damaged" ? "is-selected" : ""} onClick={() => setCondition("Damaged")}>Damaged</button></div>
      <label className="settings-field"><span>Remarks (optional)</span><input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Condition notes" /></label>
      <label className="settings-field"><span>Destination</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{STOCK_LOCATIONS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
      <div className="invoice-payment-footer"><span>{condition === "Damaged" ? "Will not be available to issue" : "Will become available"}</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={submit}>Receive return</button></div></div>
    </>}
  </>;
}

function CalibrationReturnFields({ individuals, close, flash }: { individuals: Individual[]; close: () => void; flash: (message: string) => void }) {
  const outForCal = individuals.filter((item) => item.holder === "Calibration/Repair");
  const [equipmentId, setEquipmentId] = useState("");
  const [condition, setCondition] = useState<"Good" | "Damaged">("Good");
  const [destination, setDestination] = useState(WAREHOUSE);
  const [remarks, setRemarks] = useState("");
  const [calibrationDone, setCalibrationDone] = useState(false);
  const [nextDue, setNextDue] = useState(dateIso());
  const item = outForCal.find((entry) => entry.id === equipmentId);

  const submit = () => {
    if (!item) return;
    const opStatus: EquipmentOpStatus = condition === "Damaged" ? "Damaged" : "Available";
    updateStore((current) => ({
      individuals: current.individuals.map((row) => row.id === item.id ? { ...row, holder: "Store" as EquipmentHolder, currentWith: destination, opStatus, condition: remarks || condition, calibrationDue: calibrationDone ? nextDue : row.calibrationDue, last: prettyDate(dateIso()) } : row),
      moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${prettyDate(dateIso())} · now`, action: "Return from calibration/repair", source: item.currentWith, destination, equipmentId: item.id, who: APPROVER, document: "", reason: calibrationDone ? "Calibration completed" : "Repair only — calibration date unchanged", item: item.name }, ...current.moves],
    }));
    close(); flash(`${item.name} back in ${destination}.${calibrationDone ? ` Next calibration set to ${prettyDate(nextDue)}.` : " Calibration date left unchanged — this was a repair, not a calibration."}`);
  };

  return <>
    <label className="settings-field"><span>Which item <b className="lead-required">Required</b></span><select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)}><option value="">Pick an item</option>{outForCal.map((entry) => <option key={entry.id} value={entry.id}>{entry.id} · {entry.name} · at {entry.currentWith}</option>)}</select></label>
    {item && <>
      <div className="stock-choice-row"><button className={condition === "Good" ? "is-selected" : ""} onClick={() => setCondition("Good")}>Good condition</button><button className={condition === "Damaged" ? "is-selected" : ""} onClick={() => setCondition("Damaged")}>Damaged</button></div>
      <label className="settings-field"><span>Remarks (optional)</span><input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Condition notes" /></label>
      <label className="settings-field"><span>Destination</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{STOCK_LOCATIONS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
      <label className="stock-due-toggle"><input type="checkbox" checked={calibrationDone} onChange={(event) => setCalibrationDone(event.target.checked)} /> A calibration was completed — set a new due date</label>
      {calibrationDone && <label className="settings-field"><span>Next calibration due</span><input type="date" value={nextDue} onChange={(event) => setNextDue(event.target.value)} /></label>}
      {!calibrationDone && <p className="ci-derived-note">Leave this unchecked for a plain repair — the calibration schedule stays exactly as it was.</p>}
      <div className="invoice-payment-footer"><span>{condition === "Damaged" ? "Will not be available to issue" : "Will become available"}</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={submit}>Receive return</button></div></div>
    </>}
  </>;
}

function OpeningStockFields({ individuals, quantities, close, flash }: { individuals: Individual[]; quantities: Quantity[]; close: () => void; flash: (message: string) => void }) {
  const [kind, setKind] = useState<"equipment" | "spares">("equipment");
  const [name, setName] = useState(""); const [model, setModel] = useState(""); const [serial, setSerial] = useState("");
  const [calibrationDue, setCalibrationDue] = useState("");
  const [destination, setDestination] = useState(WAREHOUSE);
  const [date, setDate] = useState(dateIso());
  const [note, setNote] = useState("");
  const [spareId, setSpareId] = useState("");
  const [newSpareName, setNewSpareName] = useState(""); const [unit, setUnit] = useState(STOCK_UNITS[0]); const [minimum, setMinimum] = useState("10");
  const [quantity, setQuantity] = useState("1");
  const generatedId = useMemo(() => nextEquipmentId(individuals), [individuals]);

  const submitEquipment = () => {
    if (!name.trim()) return;
    updateStore((current) => ({
      individuals: [{ id: generatedId, name: name.trim(), model: model.trim(), serial: serial.trim() || `INTERNAL-${generatedId}`, category: "Instruments", holder: "Store", currentWith: destination, opStatus: "Available", calibrationDue: calibrationDue || undefined, last: prettyDate(date) }, ...current.individuals],
      moves: [{ id: `mv-${Date.now()}`, date, at: `${prettyDate(date)} · now`, action: "Opening stock", source: "Opening balance", destination, equipmentId: generatedId, who: APPROVER, document: note, item: name.trim() }, ...current.moves],
    }));
    close(); flash(`${name} added as ${generatedId} in ${destination}.`);
  };
  const submitSpares = () => {
    const qty = Number(quantity) || 0;
    if (qty <= 0) return;
    if (spareId) {
      updateStore((current) => ({
        quantities: current.quantities.map((row) => row.id === spareId ? { ...row, balances: adjustBalance(row.balances, destination, qty) } : row),
        moves: [{ id: `mv-${Date.now()}`, date, at: `${prettyDate(date)} · now`, action: "Opening stock", source: "Opening balance", destination, quantity: qty, who: APPROVER, document: note, item: quantities.find((entry) => entry.id === spareId)?.name ?? "" }, ...current.moves],
      }));
      close(); flash(`Opening stock of ${qty} added to ${destination}.`);
    } else {
      if (!newSpareName.trim()) return;
      const highest = Math.max(0, ...quantities.map((entry) => Number(entry.id.split("-").at(-1)) || 0));
      const id = `SP-${String(highest + 1).padStart(3, "0")}`;
      updateStore((current) => ({
        quantities: [{ id, name: newSpareName.trim(), category: "Spares", unit, minimum: Number(minimum) || 0, balances: [{ location: destination, quantity: qty }] }, ...current.quantities],
        moves: [{ id: `mv-${Date.now()}`, date, at: `${prettyDate(date)} · now`, action: "Opening stock", source: "Opening balance", destination, quantity: qty, who: APPROVER, document: note, item: newSpareName.trim() }, ...current.moves],
      }));
      close(); flash(`${newSpareName} added as ${id} with an opening balance of ${qty} in ${destination}.`);
    }
  };

  return <>
    <div className="stock-choice-row"><button className={kind === "equipment" ? "is-selected" : ""} onClick={() => setKind("equipment")}>Equipment</button><button className={kind === "spares" ? "is-selected" : ""} onClick={() => setKind("spares")}>Spares &amp; Consumables</button></div>
    {kind === "equipment" ? <>
      <p className="po-start-hint">Internal ID {generatedId} will be generated for this unit.</p>
      <label className="settings-field"><span>Equipment name <b className="lead-required">Required</b></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Airborne Particle Counter" /></label>
      <label className="settings-field"><span>Make / model</span><input value={model} onChange={(event) => setModel(event.target.value)} /></label>
      <label className="settings-field"><span>Serial number</span><input value={serial} onChange={(event) => setSerial(event.target.value)} placeholder="Leave blank to use the generated internal ID" /></label>
      <label className="settings-field"><span>Calibration due (optional)</span><input type="date" value={calibrationDue} onChange={(event) => setCalibrationDue(event.target.value)} /></label>
    </> : <>
      <label className="settings-field"><span>Existing stock code</span><select value={spareId} onChange={(event) => setSpareId(event.target.value)}><option value="">— Add a new stock code instead —</option>{quantities.map((entry) => <option key={entry.id} value={entry.id}>{entry.id} · {entry.name}</option>)}</select></label>
      {!spareId && <><label className="settings-field"><span>New item name <b className="lead-required">Required</b></span><input value={newSpareName} onChange={(event) => setNewSpareName(event.target.value)} /></label>
        <label className="settings-field"><span>Unit</span><select value={unit} onChange={(event) => setUnit(event.target.value)}>{STOCK_UNITS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
        <label className="settings-field"><span>Minimum stock level</span><input type="number" min="0" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label></>}
      <label className="settings-field"><span>Quantity</span><input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
    </>}
    <div className="po-receive-grid">
      <label><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label><span>Destination</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{STOCK_LOCATIONS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
      <label><span>Reference note (optional)</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. stock-take reference" /></label>
    </div>
    <div className="invoice-payment-footer"><span>No purchase order needed for opening stock</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={kind === "equipment" ? submitEquipment : submitSpares}>Add to stock</button></div></div>
  </>;
}
