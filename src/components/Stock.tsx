import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import spmLogo from "@/imports/SPM_Logo.png";
import { ActionMenu, Overlay, Pagination, useTablePage } from "./ErpUi";
import { APPROVER, CALIBRATION_LABS, COMPANY, STOCK_LOCATIONS, STOCK_UNITS, WAREHOUSE, customerSites, dateIso, dayDifference, engineers, prettyDate, siteById, type Customer } from "./erpMasters";
import {
  addDeliveryChallan, adjustBalance, applyReceiptToStock, balanceAt, nextEquipmentId, nextEquipmentIds, onOrderFor, orderAfterReceipt, pendingOf, recordEquipmentSale, totalOf, transferBalances, updateStore, useErpStore,
  type DeliveryChallan, type EquipmentHolder, type EquipmentOpStatus, type Individual, type POLine, type PurchaseOrder, type Quantity, type Receipt, type StockItem, type StockMove,
} from "./erpStore";

export type ActionKey = "issue-engineer" | "transfer" | "issue-demo" | "sale" | "usage" | "receive-return" | "calibration-repair" | "adjust";
export const ACTION_LABEL: Record<ActionKey, string> = {
  "issue-engineer": "Issue to Engineer", transfer: "Transfer Location", "issue-demo": "Issue for Demo", sale: "Record Sale",
  usage: "Record Usage on Job", "receive-return": "Receive Return", "calibration-repair": "Send for Calibration / Repair", adjust: "Adjust Stock",
};
export const isIndividual = (item: StockItem): item is Individual => "holder" in item;
export const opClass = (status: string) => status.toLowerCase().replace(/ /g, "-");
export const operationLabel = (item: Individual) => item.holder === "Customer" && item.opStatus === "In use" ? "On rent" : item.opStatus;
const storeQuantity = (item: Quantity) => item.balances.filter((entry) => STOCK_LOCATIONS.includes(entry.location)).reduce((sum, entry) => sum + entry.quantity, 0);

/** Rentals are managed entirely on the Rentals page — an item backed by an active Rental
 *  record offers no quick actions here, only the "View rental" link (see Detail). */
function actionsFor(item: StockItem, activeRentalIds: Set<string>): ActionKey[] {
  if (isIndividual(item)) {
    if (item.opStatus === "Sold" || item.opStatus === "Retired") return [];
    if (item.holder === "Store") {
      if (item.opStatus === "Available") return ["issue-engineer", "transfer", "issue-demo", "sale", "calibration-repair"];
      return ["calibration-repair", "transfer"]; // Damaged / Awaiting calibration, still in the store
    }
    if (item.holder === "Customer" && activeRentalIds.has(item.id)) return [];
    return ["receive-return"]; // with an engineer, a demo customer, or a calibration/repair lab
  }
  return ["issue-engineer", "transfer", "usage", "sale", "receive-return", "adjust"];
}

export default function Stock({ isEngineer = false, focusItem, onCreatePO, onOpenRental }: { isEngineer?: boolean; focusItem?: string; onCreatePO?: () => void; onOpenRental?: (rentalRef: string) => void }) {
  const [tab, setTab] = useState<"equipment" | "spares" | "challans">("equipment");
  const [query, setQuery] = useState("");
  const [holderFilter, setHolderFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [alertFilter, setAlertFilter] = useState("All");
  const [dueSoon, setDueSoon] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const [sort, setSort] = useState("Name A–Z");
  const clearFilters = () => { setQuery(""); setHolderFilter("All"); setStatusFilter("All statuses"); setAlertFilter("All"); setDueSoon(false); };
  const { individuals, quantities, orders, moves, jobs, customers, deliveryChallans, rentals } = useErpStore();
  const activeRentalIds = useMemo(() => new Set(rentals.filter((entry) => entry.status === "Active").map((entry) => entry.equipmentId)), [rentals]);
  const [acting, setActing] = useState<{ item: StockItem; action: ActionKey } | null>(null);
  const [detail, setDetail] = useState<StockItem | null>(() => focusItem ? [...individuals, ...quantities].find((item) => item.id === focusItem) ?? null : null);
  const [receiving, setReceiving] = useState(false);
  const [returnPreset, setReturnPreset] = useState<StockItem | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const [editingItem, setEditingItem] = useState<StockItem | null>(null);
  const [labelItem, setLabelItem] = useState<Individual | null>(null);
  const [dcPreview, setDcPreview] = useState<DeliveryChallan | null>(null);
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
  const challanRows = useMemo(() => deliveryChallans.filter((entry) => `${entry.number} ${entry.customer} ${entry.reason} ${entry.reference ?? ""}`.toLowerCase().includes(query.toLowerCase())), [deliveryChallans, query]);
  const challanPage = useTablePage(challanRows, JSON.stringify([query]));
  const activeFilters = [query && `Search: ${query}`, tab === "equipment" && holderFilter !== "All" && `Currently with: ${holderFilter}`, tab === "equipment" && statusFilter !== "All statuses" && `Status: ${statusFilter}`, tab === "equipment" && dueSoon && "Calibration: overdue or within 7 days", tab === "spares" && alertFilter !== "All" && "Low stock"].filter(Boolean);

  const counts = useMemo(() => ({
    available: individuals.filter((item) => item.holder === "Store" && item.opStatus === "Available").length,
    onRent: individuals.filter((item) => operationLabel(item) === "On rent").length,
    review: individuals.filter((item) => item.holder === "Store" && item.opStatus === "Available" && (!item.calibrationDue || dayDifference(item.calibrationDue) < 0)).length,
    withEngineers: individuals.filter((item) => item.holder === "Engineer").length,
    lowSpares: quantities.filter((item) => totalOf(item) < item.minimum).length,
  }), [individuals, quantities]);

  return <section className="stock-page">
    <div className="stock-heading"><div><p className="erp-secondary-text">Operations / Stock</p><h1>Stock</h1></div><div className="stock-head-actions">{counts.lowSpares > 0 && onCreatePO && <button className="settings-outline" onClick={onCreatePO}>Create purchase order ({counts.lowSpares} low)</button>}<button className="settings-outline" onClick={() => setAddingItem(true)}>Add item</button><button className="erp-action" onClick={() => setReceiving(true)}>Receive stock</button></div></div>

    <div className="stock-tabs">
      <button className={tab === "equipment" ? "is-active" : ""} onClick={() => { setTab("equipment"); setHolderFilter("All"); setStatusFilter("All statuses"); setDueSoon(false); }}>Equipment <span>{individuals.length}</span></button>
      <button className={tab === "spares" ? "is-active" : ""} onClick={() => { setTab("spares"); setAlertFilter("All"); }}>Spares &amp; Consumables <span>{quantities.length}</span></button>
      <button className={tab === "challans" ? "is-active" : ""} onClick={() => setTab("challans")}>Delivery Challans <span>{deliveryChallans.length}</span></button>
    </div>

    <div className="erp-summary-strip stock-overview">
      <button className="leads-stat" onClick={() => { clearFilters(); setTab("equipment"); setHolderFilter("Store"); setStatusFilter("Available"); setDueSoon(false); }}><span>In store · operational</span><b>{counts.available}</b></button>
      <button className="leads-stat leads-stat--today" onClick={() => { clearFilters(); setTab("equipment"); setHolderFilter("Customer"); setStatusFilter("On rent"); setDueSoon(false); }}><span>On rent</span><b>{counts.onRent}</b></button>
      <button className="leads-stat" onClick={() => { clearFilters(); setTab("equipment"); setHolderFilter("Engineer"); setStatusFilter("All statuses"); setDueSoon(false); }}><span>With engineers</span><b>{counts.withEngineers}</b></button>
      <button className="leads-stat leads-stat--overdue" onClick={() => { clearFilters(); setTab("spares"); setAlertFilter("Low stock"); }}><span>Low-stock spares</span><b>{counts.lowSpares}</b></button>
    </div>

    {tab !== "challans" && <div className="erp-filters">
      <label className="erp-search-filter"><span>Search stock</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, equipment, model or serial" /></label>
      {tab === "equipment" ? <>
        <label><span>Currently with</span><select value={holderFilter} onChange={(event) => setHolderFilter(event.target.value)}><option value="All">All locations</option><option value="Store">Office / Store</option><option value="Engineer">Engineer</option><option value="Customer">Customer</option><option value="Calibration/Repair">Calibration / repair</option></select></label>
        <label><span>Operational status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>{["All statuses", "Available", "On rent", "In use", "Damaged", "Awaiting calibration", "Sold", "Retired"].map((status) => <option key={status}>{status}</option>)}</select></label>
      </> : <label><span>Stock alert</span><select value={alertFilter} onChange={(event) => setAlertFilter(event.target.value)}><option value="All">All items</option><option value="Low stock">Low stock</option></select></label>}
      <label><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option>Name A–Z</option><option>ID</option><option>{tab === "equipment" ? "Calibration due" : "Lowest stock"}</option></select></label>
      {tab === "equipment" && <button className="settings-outline" aria-expanded={moreFilters} onClick={() => setMoreFilters(!moreFilters)}>More filters</button>}
    </div>}
    {tab === "challans" && <div className="erp-filters"><label className="erp-search-filter"><span>Search challans</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="DC number, customer or reason" /></label></div>}
    {moreFilters && tab === "equipment" && <label className="stock-due-toggle"><input type="checkbox" checked={dueSoon} onChange={(event) => setDueSoon(event.target.checked)} /> Calibration overdue or due within 7 days</label>}
    {tab !== "challans" && activeFilters.length > 0 && <div className="erp-filter-summary">{activeFilters.map((filter) => <span key={String(filter)}>{filter}</span>)}<button className="erp-record-link" onClick={clearFilters}>Clear all</button></div>}
    {tab === "equipment" && counts.review > 0 && <p className="stock-review-note">{counts.review} operational item{counts.review === 1 ? "" : "s"} in store need{counts.review === 1 ? "s" : ""} calibration review before a calibration-dependent job. Issue restrictions await SPM confirmation.</p>}
    {tab === "equipment"
      ? <><EquipmentTable items={equipmentPage.pageRows} open={setDetail} /><Pagination total={equipmentRows.length} page={equipmentPage.page} onPage={equipmentPage.setPage} /></>
      : tab === "spares"
      ? <><SpareTable items={sparePage.pageRows} orders={orders} open={setDetail} /><Pagination total={spareRows.length} page={sparePage.page} onPage={sparePage.setPage} /></>
      : <><ChallanTable items={challanPage.pageRows} open={setDcPreview} /><Pagination total={challanRows.length} page={challanPage.page} onPage={challanPage.setPage} /></>}
    {!(tab === "equipment" ? equipmentRows.length : tab === "spares" ? spareRows.length : challanRows.length) && <div className="settings-empty"><b>{tab === "challans" ? "No delivery challans yet" : "No matching stock items"}</b><p>{tab === "challans" ? "A challan is created automatically whenever stock is sold, rented, put on demo, or a customer's instrument is returned to them." : "Try a different search or clear the filters."}</p>{tab !== "challans" && <button className="settings-outline" onClick={clearFilters}>Clear filters</button>}</div>}

    {detail && <Detail item={detail} moves={moves} close={() => setDetail(null)} act={(action) => { setDetail(null); if (action === "receive-return") { setReturnPreset(detail); setReceiving(true); } else { setActing({ item: detail, action }); } }} edit={() => { setDetail(null); setEditingItem(detail); }} label={isIndividual(detail) ? () => { setDetail(null); setLabelItem(detail); } : undefined} onCreatePO={onCreatePO} activeRentalIds={activeRentalIds} onOpenRental={onOpenRental} />}
    {acting && <ActionModal item={acting.item} action={acting.action} isEngineer={isEngineer} jobs={jobs} individuals={individuals} customers={customers} close={() => setActing(null)} flash={flash} />}
    {receiving && <ReceiveStockModal close={() => { setReceiving(false); setReturnPreset(null); }} flash={flash} presetItem={returnPreset} activeRentalIds={activeRentalIds} />}
    {addingItem && <ItemFormModal mode="add" individuals={individuals} quantities={quantities} close={() => setAddingItem(false)} flash={flash} />}
    {editingItem && <ItemFormModal mode="edit" item={editingItem} individuals={individuals} quantities={quantities} close={() => setEditingItem(null)} flash={flash} />}
    {labelItem && <LabelPreview item={labelItem} close={() => setLabelItem(null)} />}
    {dcPreview && <DcPreview dc={dcPreview} close={() => setDcPreview(null)} />}
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

function ChallanTable({ items, open }: { items: DeliveryChallan[]; open: (dc: DeliveryChallan) => void }) {
  return <div className="erp-table-shell"><table className="erp-data-table"><thead><tr><th>DC no.</th><th>Date</th><th>Customer</th><th>Reason</th><th>Items</th><th>Reference</th></tr></thead><tbody>{items.map((dc) => <tr key={dc.id} className="erp-row-clickable" onClick={() => open(dc)}>
    <td><b>{dc.number}</b></td>
    <td>{prettyDate(dc.date)}</td>
    <td>{dc.customer}</td>
    <td><span className="stock-status">{dc.reason}</span></td>
    <td>{dc.lines.length} line{dc.lines.length === 1 ? "" : "s"}</td>
    <td>{dc.reference || "—"}</td>
  </tr>)}</tbody></table></div>;
}

function Detail({ item, moves, close, act, edit, label, onCreatePO, activeRentalIds, onOpenRental }: { item: StockItem; moves: StockMove[]; close: () => void; act: (action: ActionKey) => void; edit: () => void; label?: () => void; onCreatePO?: () => void; activeRentalIds: Set<string>; onOpenRental?: (rentalRef: string) => void }) {
  const actions = actionsFor(item, activeRentalIds);
  const onRent = isIndividual(item) && item.rentalRef && activeRentalIds.has(item.id);
  const history = moves.filter((entry) => isIndividual(item) ? entry.equipmentId === item.id || (!entry.equipmentId && entry.item === item.name) : entry.item === item.name);
  return <Overlay onClose={close} label={item.name}><aside className="stock-detail"><div className="settings-drawer-head">
    <div><p>{item.id} · {isIndividual(item) ? "Equipment" : "Spares & Consumables"}</p><h2>{isIndividual(item) && <span className="stock-id">{item.id} · </span>}{item.name}</h2>
      <div className="stock-detail-meta">{isIndividual(item) ? <><span className={`stock-status ${opClass(item.opStatus)}`}>{operationLabel(item)}</span><span>{item.currentWith}</span></> : <span>{totalOf(item)} {item.unit} on hand</span>}</div>
    </div>
    <button onClick={close} aria-label="Close">×</button>
  </div>

  <div className="stock-quick"><button className="settings-outline" onClick={edit}>Edit item</button>{label && <button className="settings-outline" onClick={label}>Print label</button>}{onRent && onOpenRental && <button className="settings-outline" onClick={() => onOpenRental(item.rentalRef!)}>View rental</button>}{actions.length > 0 && <ActionMenu label="Stock actions" items={actions.map((key) => ({ label: ACTION_LABEL[key], onSelect: () => act(key) }))} />}</div>

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
  </dl></section> : <section className="stock-detail-section"><h3>Count by location</h3><div className="quantity-counts">{item.balances.map((entry) => <div key={entry.location}><span>{entry.location}</span><b>{entry.quantity}</b></div>)}</div><dl className="stock-quantity-facts"><div><dt>On hand</dt><dd>{totalOf(item)} {item.unit}</dd></div><div><dt>Minimum level</dt><dd>{item.minimum} {item.unit}</dd></div></dl><p className="erp-muted">Low stock means total on hand across all locations is below the minimum. Engineer-held quantities are not available in store.</p>{totalOf(item) < item.minimum && <p className="stock-review-note">Low stock: {item.minimum - totalOf(item)} {item.unit} below minimum.{onCreatePO && <button className="erp-record-link" onClick={onCreatePO}>Create purchase order</button>}</p>}</section>}

  <section className="stock-detail-section"><h3>Movement history</h3><Timeline moves={history} /></section>
  </aside></Overlay>;
}

export function Timeline({ moves }: { moves: StockMove[] }) {
  if (!moves.length) return <p className="stock-timeline-empty">No movements recorded yet.</p>;
  return <div className="stock-timeline">{moves.map((entry) => <div key={entry.id}><i /><p><b>{entry.action}</b><span>{entry.at} · {entry.who}</span><small>{entry.source} → {entry.destination}{entry.quantity ? ` · ${entry.quantity} units` : ""}{entry.equipmentId ? ` · ${entry.equipmentId}` : ""} · <em>{entry.document || "No document"}</em></small>{entry.reason && <small>Reason: {entry.reason}</small>}</p></div>)}</div>;
}

/* ─── Stock Actions modal — one action, already chosen from the row ─── */
export function ActionModal({ item, action, isEngineer, jobs, individuals, customers, close, flash }: {
  item: StockItem; action: ActionKey; isEngineer: boolean; jobs: Store2["jobs"]; individuals: Individual[]; customers: Customer[]; close: () => void; flash: (message: string) => void;
}) {
  const individual = isIndividual(item);
  const [source, setSource] = useState(!individual && item.balances.length === 1 ? item.balances[0].location : "");
  const available = !individual ? balanceAt(item, source) : 1;
  const [quantity, setQuantity] = useState("1");
  const [engineer, setEngineer] = useState(isEngineer ? engineers[0].name : engineers[0].name);
  const [jobId, setJobId] = useState("");
  const [customer, setCustomer] = useState(customers[0]?.name ?? "");
  const [siteId, setSiteId] = useState("");
  const [dispatchDate, setDispatchDate] = useState(dateIso());
  const [returnDate, setReturnDate] = useState(dateIso());
  const [saleRef, setSaleRef] = useState("");
  const [destination, setDestination] = useState(STOCK_LOCATIONS.find((loc) => individual ? loc !== item.currentWith : loc !== source) ?? STOCK_LOCATIONS[0]);
  const [lab, setLab] = useState(CALIBRATION_LABS[0]);
  const [newCount, setNewCount] = useState(String(!individual ? available : 0));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const sites = customerSites.filter((site) => site.customer === customer);
  const openJobs = jobs.filter((entry) => entry.status !== "Completed" && entry.status !== "Cancelled");
  const jobInstruments = useMemo(() => { const job = jobs.find((entry) => entry.id === jobId); return job ? { customer: job.customer, siteId: job.siteId } : null; }, [jobId, jobs]);

  const sourceLocations = !individual ? item.balances.map((entry) => entry.location) : [];
  const needsSource = !individual && sourceLocations.length > 1 && ["issue-engineer", "transfer", "usage", "sale"].includes(action);

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
      } else if (action === "issue-demo") {
        if (!siteId) { setError("Pick the customer's site."); return; }
        const site = sites.find((entry) => entry.id === siteId);
        const demoRef = `DEMO-${String(Date.now()).slice(-4)}`;
        const currentWith = `${customer} · ${site?.name ?? ""}`;
        updateStore((current) => ({
          individuals: current.individuals.map((row) => row.id === item.id ? { ...row, holder: "Customer" as EquipmentHolder, currentWith, opStatus: "In use" as EquipmentOpStatus, rentalCustomer: customer, rentalSiteId: siteId, rentalReturnDue: returnDate, rentalRef: demoRef, last: today } : row),
          moves: [{ id: `mv-${Date.now()}`, date: dispatchDate, at: `${prettyDate(dispatchDate)} · now`, action: ACTION_LABEL[action], source: item.currentWith, destination: currentWith, equipmentId: item.id, who: APPROVER, document: demoRef, item: item.name }, ...current.moves],
          ...addDeliveryChallan(current, { customer, siteId, reason: "Demo", reference: demoRef, date: dispatchDate, lines: [{ description: item.name, serial: item.serial, quantity: 1 }] }),
        }));
        flash(`${item.name} on demo to ${customer} until ${prettyDate(returnDate)}. It stays SPM-owned. A delivery challan was created.`);
      } else if (action === "sale") {
        if (!siteId) { setError("Pick the customer's site."); return; }
        const site = sites.find((entry) => entry.id === siteId);
        const ref = saleRef.trim() || `SALE-${String(Date.now()).slice(-4)}`;
        updateStore((current) => ({
          ...recordEquipmentSale(current, item.id, { customer, siteId, saleRef: ref }),
          moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${today} · now`, action: ACTION_LABEL[action], source: item.currentWith, destination: `${customer} · ${site?.name ?? ""}`, equipmentId: item.id, who: APPROVER, document: ref, item: item.name }, ...current.moves],
          ...addDeliveryChallan(current, { customer, siteId, reason: "Sale", reference: ref, lines: [{ description: item.name, serial: item.serial, quantity: 1 }] }),
        }));
        flash(`${item.name} sold to ${customer}. It has left available stock and now appears once under Customer Instruments. A delivery challan was created.`);
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
        const ref = saleRef.trim() || `SALE-${String(Date.now()).slice(-4)}`;
        updateStore((current) => ({
          quantities: current.quantities.map((row) => row.id === item.id ? { ...row, balances: adjustBalance(row.balances, source, -qty) } : row),
          moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${today} · now`, action: ACTION_LABEL[action], source, destination: customer || "Customer", quantity: qty, who: APPROVER, document: ref, item: item.name, beforeBalance: balanceAt(item, source), afterBalance: balanceAt(item, source) - qty }, ...current.moves],
          ...addDeliveryChallan(current, { customer: customer || "Customer", reason: "Sale", reference: ref, lines: [{ description: item.name, quantity: qty }] }),
        }));
        flash(`Sold ${qty} × ${item.name}. A delivery challan was created.`);
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

    {action === "issue-demo" && <>
      <label className="settings-field"><span>Customer</span><select value={customer} onChange={(event) => { setCustomer(event.target.value); setSiteId(""); }}>{customers.map((entry) => <option key={entry.id}>{entry.name}</option>)}</select></label>
      <label className="settings-field"><span>Site <b className="lead-required">Required</b></span><select value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">Pick a site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}</select></label>
      <label className="settings-field"><span>Dispatch date</span><input type="date" value={dispatchDate} onChange={(event) => setDispatchDate(event.target.value)} /></label>
      <label className="settings-field"><span>Expected return date</span><input type="date" value={returnDate} onChange={(event) => setReturnDate(event.target.value)} /></label>
      <p className="ci-derived-note">For a paid rental, use the Rentals page instead — it tracks the monthly rent and raises the invoices.</p>
    </>}

    {action === "sale" && <>
      <label className="settings-field"><span>Customer</span><select value={customer} onChange={(event) => { setCustomer(event.target.value); setSiteId(""); }}>{customers.map((entry) => <option key={entry.id}>{entry.name}</option>)}</select></label>
      {individual && <label className="settings-field"><span>Site <b className="lead-required">Required</b></span><select value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">Pick a site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}</select></label>}
      <label className="settings-field"><span>Sales document reference (optional)</span><input value={saleRef} onChange={(event) => setSaleRef(event.target.value)} placeholder="e.g. INV-2026-0119" /></label>
      {individual && <p className="ci-derived-note">This creates or links the Customer Instrument record automatically and preserves this unit's history.</p>}
    </>}

    {action === "usage" && <>
      <label className="settings-field"><span>Job</span><select value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="">Pick a job</option>{openJobs.map((job) => <option key={job.id} value={job.id}>{job.number} · {job.customer}</option>)}</select></label>
    </>}


    {action === "calibration-repair" && <label className="settings-field"><span>Send to</span><select value={lab} onChange={(event) => setLab(event.target.value)}>{CALIBRATION_LABS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>}

    {action === "adjust" && <>
      <label className="settings-field"><span>Location</span><select value={source} onChange={(event) => { setSource(event.target.value); setNewCount(String(balanceAt(item as Quantity, event.target.value))); }}><option value="">Choose a location</option>{sourceLocations.map((loc) => <option key={loc} value={loc}>{loc} · currently {balanceAt(item as Quantity, loc)}</option>)}</select></label>
      <label className="settings-field"><span>New physical count</span><input type="number" min="0" value={newCount} onChange={(event) => setNewCount(event.target.value)} /></label>
      <label className="settings-field"><span>Reason <b className="lead-required">Required</b></span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. physical count after stock-take" /></label>
      <p className="po-start-hint">Recorded with your name, the time, and the before/after balance.</p>
    </>}

    {error && <p className="stock-count-error">{error}</p>}
    {isIndividual(item) && ["issue-engineer", "issue-demo"].includes(action) && (!item.calibrationDue || dayDifference(item.calibrationDue) < 0) && <p className="stock-review-note">Needs review: calibration is overdue or not recorded. Confirm suitability before issue; SPM issue restrictions are not yet configured.</p>}
    <div className="stock-move-footer"><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={submit}>Confirm</button></div>
  </section></Overlay>;
}

/* ─── Receive stock — fields depend on the reason. Every kind of return (from an engineer, a
 *  rental customer, or a calibration/repair lab) goes through the one ReturnFields component
 *  below — this is the single place stock is received back into the store. ─── */
type ReceiveReason = "Purchase Receipt" | "Return" | "Opening Stock";
function ReceiveStockModal({ close, flash, presetItem, activeRentalIds }: { close: () => void; flash: (message: string) => void; presetItem?: StockItem | null; activeRentalIds: Set<string> }) {
  const { orders, individuals, quantities } = useErpStore();
  const [reason, setReason] = useState<ReceiveReason>(presetItem ? "Return" : "Purchase Receipt");

  return <Overlay onClose={close} label="Receive stock"><section className="stock-move-modal stock-receive-modal" role="dialog" aria-modal="true" aria-labelledby="receive-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <p>New stock</p><h2 id="receive-title">Receive stock</h2>
    <label className="settings-field"><span>Reason</span><select value={reason} onChange={(event) => setReason(event.target.value as ReceiveReason)}>
      <option>Purchase Receipt</option><option>Return</option><option>Opening Stock</option>
    </select></label>
    {reason === "Purchase Receipt" && <PurchaseReceiptFields orders={orders} individuals={individuals} close={close} flash={flash} />}
    {reason === "Return" && <ReturnFields individuals={individuals} quantities={quantities} presetItem={presetItem ?? null} close={close} flash={flash} activeRentalIds={activeRentalIds} />}
    {reason === "Opening Stock" && <OpeningStockFields quantities={quantities} close={close} flash={flash} />}
  </section></Overlay>;
}

/* Any equipment away from the store (with an engineer, a demo customer, or a calibration/repair
 * lab) or any spare balance held outside a store location. Equipment on an active rental is
 * excluded — that return happens on the Rentals page. */
export function ReturnFields({ individuals, quantities, presetItem, close, flash, activeRentalIds }: { individuals: Individual[]; quantities: Quantity[]; presetItem: StockItem | null; close: () => void; flash: (message: string) => void; activeRentalIds: Set<string> }) {
  const [kind, setKind] = useState<"equipment" | "spares">(presetItem && !isIndividual(presetItem) ? "spares" : "equipment");
  const away = individuals.filter((entry) => entry.holder !== "Store" && entry.opStatus !== "Sold" && entry.opStatus !== "Retired" && !activeRentalIds.has(entry.id));
  const [equipmentId, setEquipmentId] = useState(presetItem && isIndividual(presetItem) ? presetItem.id : "");
  const item = away.find((entry) => entry.id === equipmentId);
  const [condition, setCondition] = useState<"Good" | "Damaged">("Good");
  const [destination, setDestination] = useState(WAREHOUSE);
  const [remarks, setRemarks] = useState("");
  const [calibrationDone, setCalibrationDone] = useState(false);
  const [nextDue, setNextDue] = useState(dateIso());

  const [spareId, setSpareId] = useState(presetItem && !isIndividual(presetItem) ? presetItem.id : "");
  const spareItem = quantities.find((entry) => entry.id === spareId);
  const nonStoreHolders = spareItem ? spareItem.balances.filter((entry) => !STOCK_LOCATIONS.includes(entry.location) && entry.quantity > 0) : [];
  const [source, setSource] = useState("");
  const [quantity, setQuantity] = useState("1");
  const available = spareItem ? balanceAt(spareItem, source) : 0;

  const returnLabel = (holder: EquipmentHolder) => holder === "Customer" ? "Rental return" : holder === "Engineer" ? "Return from engineer" : "Return from calibration/repair";

  const submitEquipment = () => {
    if (!item) return;
    const opStatus: EquipmentOpStatus = condition === "Damaged" ? "Damaged" : "Available";
    updateStore((current) => ({
      individuals: current.individuals.map((row) => row.id === item.id ? { ...row, holder: "Store" as EquipmentHolder, currentWith: destination, opStatus, condition: remarks || condition, rentalCustomer: undefined, rentalSiteId: undefined, rentalReturnDue: undefined, calibrationDue: item.holder === "Calibration/Repair" && calibrationDone ? nextDue : row.calibrationDue, last: prettyDate(dateIso()) } : row),
      moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${prettyDate(dateIso())} · now`, action: returnLabel(item.holder), source: item.currentWith, destination, equipmentId: item.id, who: APPROVER, document: item.rentalRef ?? "", reason: item.holder === "Calibration/Repair" ? (calibrationDone ? "Calibration completed" : "Repair only — calibration date unchanged") : condition, item: item.name }, ...current.moves],
    }));
    close(); flash(condition === "Damaged" ? `${item.name} is back in ${destination} but marked Damaged — it will not show as available to issue.` : `${item.name} is back in ${destination} and available.${item.holder === "Calibration/Repair" && calibrationDone ? ` Next calibration set to ${prettyDate(nextDue)}.` : ""}`);
  };
  const submitSpares = () => {
    if (!spareItem || Number(quantity) <= 0 || Number(quantity) > available) return;
    updateStore((current) => ({
      quantities: current.quantities.map((row) => row.id === spareItem.id ? { ...row, balances: transferBalances(row.balances, source, destination, Number(quantity)) } : row),
      moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${prettyDate(dateIso())} · now`, action: "Receive Return", source, destination, quantity: Number(quantity), who: APPROVER, document: "", item: spareItem.name }, ...current.moves],
    }));
    close(); flash(`${quantity} × ${spareItem.name} returned from ${source}. Store stock is up; the company-wide total is unchanged.`);
  };

  return <>
    {!presetItem && <div className="stock-choice-row"><button className={kind === "equipment" ? "is-selected" : ""} onClick={() => setKind("equipment")}>Equipment</button><button className={kind === "spares" ? "is-selected" : ""} onClick={() => setKind("spares")}>Spares &amp; Consumables</button></div>}
    {kind === "equipment" ? <>
      <label className="settings-field"><span>Which item <b className="lead-required">Required</b></span><select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)} disabled={!!presetItem}><option value="">{away.length ? "Pick an item that is away" : "Nothing is away from the store"}</option>{away.map((entry) => <option key={entry.id} value={entry.id}>{entry.id} · {entry.name} · with {entry.currentWith}</option>)}</select></label>
      {item && <>
        <div className="stock-choice-row"><button className={condition === "Good" ? "is-selected" : ""} onClick={() => setCondition("Good")}>Good condition</button><button className={condition === "Damaged" ? "is-selected" : ""} onClick={() => setCondition("Damaged")}>Damaged</button></div>
        <label className="settings-field"><span>Remarks (optional)</span><input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Condition notes" /></label>
        <label className="settings-field"><span>Destination</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{STOCK_LOCATIONS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
        {item.holder === "Calibration/Repair" && <>
          <label className="stock-due-toggle"><input type="checkbox" checked={calibrationDone} onChange={(event) => setCalibrationDone(event.target.checked)} /> A calibration was completed — set a new due date</label>
          {calibrationDone && <label className="settings-field"><span>Next calibration due</span><input type="date" value={nextDue} onChange={(event) => setNextDue(event.target.value)} /></label>}
        </>}
        {condition === "Damaged" && <p className="po-start-hint">Damaged equipment returns to the store but will not be available to issue until it is repaired.</p>}
        <div className="invoice-payment-footer"><span>{condition === "Damaged" ? "Will not be available to issue" : "Will become available"}</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={submitEquipment}>Receive return</button></div></div>
      </>}
    </> : <>
      <label className="settings-field"><span>Which spare <b className="lead-required">Required</b></span><select value={spareId} onChange={(event) => { setSpareId(event.target.value); setSource(""); }} disabled={!!presetItem}><option value="">Pick a spare</option>{quantities.filter((entry) => entry.balances.some((balance) => !STOCK_LOCATIONS.includes(balance.location) && balance.quantity > 0)).map((entry) => <option key={entry.id} value={entry.id}>{entry.id} · {entry.name}</option>)}</select></label>
      {spareItem && <>
        <label className="settings-field"><span>Returning from <b className="lead-required">Required</b></span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="">Choose who is returning it</option>{nonStoreHolders.map((entry) => <option key={entry.location} value={entry.location}>{entry.location} · {entry.quantity} to return</option>)}</select></label>
        {source && <label className="settings-field"><span>Quantity</span><input type="number" min="1" max={available} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>}
        <label className="settings-field"><span>Destination</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{STOCK_LOCATIONS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
        <div className="invoice-payment-footer"><span>Store stock rises; company total unchanged</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" disabled={!source || Number(quantity) > available || Number(quantity) <= 0} onClick={submitSpares}>Receive return</button></div></div>
      </>}
    </>}
  </>;
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

/* Tops up an existing spare code only — creating a new equipment unit or a new spare code
 * happens through "Add item" so there is one place that mints new stock codes. */
function OpeningStockFields({ quantities, close, flash }: { quantities: Quantity[]; close: () => void; flash: (message: string) => void }) {
  const [destination, setDestination] = useState(WAREHOUSE);
  const [date, setDate] = useState(dateIso());
  const [note, setNote] = useState("");
  const [spareId, setSpareId] = useState(quantities[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");

  const submit = () => {
    const qty = Number(quantity) || 0;
    if (qty <= 0 || !spareId) return;
    updateStore((current) => ({
      quantities: current.quantities.map((row) => row.id === spareId ? { ...row, balances: adjustBalance(row.balances, destination, qty) } : row),
      moves: [{ id: `mv-${Date.now()}`, date, at: `${prettyDate(date)} · now`, action: "Opening stock", source: "Opening balance", destination, quantity: qty, who: APPROVER, document: note, item: quantities.find((entry) => entry.id === spareId)?.name ?? "" }, ...current.moves],
    }));
    close(); flash(`Opening stock of ${qty} added to ${destination}.`);
  };

  return <>
    <label className="settings-field"><span>Stock code <b className="lead-required">Required</b></span><select value={spareId} onChange={(event) => setSpareId(event.target.value)}>{quantities.length ? quantities.map((entry) => <option key={entry.id} value={entry.id}>{entry.id} · {entry.name}</option>) : <option value="">No spares set up yet — use "Add item" first</option>}</select></label>
    <label className="settings-field"><span>Quantity</span><input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
    <div className="po-receive-grid">
      <label><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label><span>Destination</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{STOCK_LOCATIONS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
      <label><span>Reference note (optional)</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. stock-take reference" /></label>
    </div>
    <div className="invoice-payment-footer"><span>No purchase order needed for opening stock</span><div><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" disabled={!spareId} onClick={submit}>Add to stock</button></div></div>
  </>;
}

/* ─── Add item / Edit item — the one place a new equipment unit or spare code is minted;
 *  editing only ever touches master fields (name, model, category…), never holder, status
 *  or balances, which stay the job of the stock actions above. ─── */
function ItemFormModal({ mode, item, individuals, quantities, close, flash }: {
  mode: "add" | "edit"; item?: StockItem; individuals: Individual[]; quantities: Quantity[]; close: () => void; flash: (message: string) => void;
}) {
  const equipItem = item && isIndividual(item) ? item : null;
  const spareItem = item && !isIndividual(item) ? item : null;
  const [kind, setKind] = useState<"equipment" | "spares">(spareItem ? "spares" : "equipment");

  const [name, setName] = useState(item?.name ?? "");
  const [model, setModel] = useState(equipItem?.model ?? "");
  const [serial, setSerial] = useState(equipItem?.serial ?? "");
  const [category, setCategory] = useState(item?.category ?? (kind === "equipment" ? "Instruments" : "Spares"));
  const [calibrationDue, setCalibrationDue] = useState(equipItem?.calibrationDue ?? "");
  const [unit, setUnit] = useState(spareItem?.unit ?? STOCK_UNITS[0]);
  const [minimum, setMinimum] = useState(String(spareItem?.minimum ?? 10));
  const [openingQty, setOpeningQty] = useState("0");
  const [destination, setDestination] = useState(WAREHOUSE);
  const generatedId = useMemo(() => nextEquipmentId(individuals), [individuals]);

  const submitEquipment = () => {
    if (!name.trim()) return;
    if (mode === "add") {
      const id = generatedId;
      updateStore((current) => ({
        individuals: [{ id, name: name.trim(), model: model.trim(), serial: serial.trim() || `INTERNAL-${id}`, category: category.trim() || "Instruments", holder: "Store" as EquipmentHolder, currentWith: destination, opStatus: "Available" as EquipmentOpStatus, calibrationDue: calibrationDue || undefined, last: prettyDate(dateIso()) }, ...current.individuals],
        moves: [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${prettyDate(dateIso())} · now`, action: "Item added", source: "New item", destination, equipmentId: id, who: APPROVER, document: "", item: name.trim() }, ...current.moves],
      }));
      close(); flash(`${name} added as ${id} in ${destination}.`);
    } else if (equipItem) {
      updateStore((current) => ({
        individuals: current.individuals.map((row) => row.id === equipItem.id ? { ...row, name: name.trim(), model: model.trim(), serial: serial.trim(), category: category.trim() || row.category, calibrationDue: calibrationDue || undefined } : row),
      }));
      close(); flash(`${name} updated.`);
    }
  };
  const submitSpare = () => {
    if (!name.trim()) return;
    if (mode === "add") {
      const highest = Math.max(0, ...quantities.map((entry) => Number(entry.id.split("-").at(-1)) || 0));
      const id = `SP-${String(highest + 1).padStart(3, "0")}`;
      const qty = Number(openingQty) || 0;
      updateStore((current) => ({
        quantities: [{ id, name: name.trim(), category: category.trim() || "Spares", unit, minimum: Number(minimum) || 0, balances: qty > 0 ? [{ location: destination, quantity: qty }] : [] }, ...current.quantities],
        moves: qty > 0 ? [{ id: `mv-${Date.now()}`, date: dateIso(), at: `${prettyDate(dateIso())} · now`, action: "Item added", source: "New item", destination, quantity: qty, who: APPROVER, document: "", item: name.trim() }, ...current.moves] : current.moves,
      }));
      close(); flash(`${name} added as ${id}${qty > 0 ? ` with an opening balance of ${qty} in ${destination}` : ""}.`);
    } else if (spareItem) {
      updateStore((current) => ({
        quantities: current.quantities.map((row) => row.id === spareItem.id ? { ...row, name: name.trim(), category: category.trim() || row.category, unit, minimum: Number(minimum) || 0 } : row),
      }));
      close(); flash(`${name} updated.`);
    }
  };

  return <Overlay onClose={close} label={mode === "add" ? "Add item" : "Edit item"}><section className="stock-move-modal" role="dialog" aria-modal="true" aria-labelledby="item-form-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <p>Stock catalog</p><h2 id="item-form-title">{mode === "add" ? "Add item" : `Edit ${item?.name}`}</h2>
    {mode === "add" && <div className="stock-choice-row"><button className={kind === "equipment" ? "is-selected" : ""} onClick={() => { setKind("equipment"); setCategory("Instruments"); }}>Equipment</button><button className={kind === "spares" ? "is-selected" : ""} onClick={() => { setKind("spares"); setCategory("Spares"); }}>Spares &amp; Consumables</button></div>}
    {kind === "equipment" ? <>
      {mode === "add" && <p className="po-start-hint">Internal ID {generatedId} will be generated for this unit.</p>}
      <label className="settings-field"><span>Equipment name <b className="lead-required">Required</b></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Airborne Particle Counter" /></label>
      <label className="settings-field"><span>Make / model</span><input value={model} onChange={(event) => setModel(event.target.value)} /></label>
      <label className="settings-field"><span>Serial number</span><input value={serial} onChange={(event) => setSerial(event.target.value)} placeholder={mode === "add" ? "Leave blank to use the generated internal ID" : ""} /></label>
      <label className="settings-field"><span>Category</span><input value={category} onChange={(event) => setCategory(event.target.value)} /></label>
      <label className="settings-field"><span>Calibration due (optional)</span><input type="date" value={calibrationDue} onChange={(event) => setCalibrationDue(event.target.value)} /></label>
      {mode === "add" && <label className="settings-field"><span>Destination</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{STOCK_LOCATIONS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>}
    </> : <>
      <label className="settings-field"><span>Item name <b className="lead-required">Required</b></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Zero Count Filter" /></label>
      <label className="settings-field"><span>Category</span><input value={category} onChange={(event) => setCategory(event.target.value)} /></label>
      <label className="settings-field"><span>Unit</span><select value={unit} onChange={(event) => setUnit(event.target.value)}>{STOCK_UNITS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
      <label className="settings-field"><span>Minimum stock level</span><input type="number" min="0" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label>
      {mode === "add" && <>
        <label className="settings-field"><span>Opening quantity (optional)</span><input type="number" min="0" value={openingQty} onChange={(event) => setOpeningQty(event.target.value)} /></label>
        <label className="settings-field"><span>Destination</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{STOCK_LOCATIONS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
      </>}
    </>}
    <div className="stock-move-footer"><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" disabled={!name.trim()} onClick={kind === "equipment" ? submitEquipment : submitSpare}>{mode === "add" ? "Add item" : "Save changes"}</button></div>
  </section></Overlay>;
}

/* ─── Printable equipment label: internal ID + QR code, rendered with a tiny pure-JS QR
 *  encoder so it works fully offline. ─── */
function QrCode({ value, size = 132 }: { value: string; size?: number }) {
  const qr = useMemo(() => { const code = qrcode(0, "M"); code.addData(value); code.make(); return code; }, [value]);
  const count = qr.getModuleCount();
  const cell = size / count;
  const cells: React.ReactNode[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) cells.push(<rect key={`${row}-${col}`} x={col * cell} y={row * cell} width={cell} height={cell} fill="#22303c" />);
    }
  }
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`QR code for ${value}`}><rect width={size} height={size} fill="#fff" />{cells}</svg>;
}

function LabelPreview({ item, close }: { item: Individual; close: () => void }) {
  return <div className="stock-modal-backdrop quote-preview-backdrop"><section className="quote-preview stock-label-preview" role="dialog" aria-modal="true" aria-labelledby="label-preview-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <div className="quote-preview-actions"><button className="settings-outline" onClick={() => window.print()}>Print</button><button className="erp-action" onClick={close}>Done</button></div>
    <article className="stock-label-card">
      <header><img src={spmLogo} alt="SPM Lab Solutions" /><div><h2 id="label-preview-title">EQUIPMENT LABEL</h2><span>{COMPANY.name}</span></div></header>
      <div className="stock-label-body">
        <div className="stock-label-id">{item.id}</div>
        <QrCode value={item.id} size={148} />
      </div>
      <dl className="invoice-facts stock-facts">
        <div><dt>Name</dt><dd>{item.name}</dd></div>
        <div><dt>Model</dt><dd>{item.model || "—"}</dd></div>
        <div><dt>Serial</dt><dd>{item.serial || "—"}</dd></div>
      </dl>
    </article>
  </section></div>;
}

/* ─── Delivery Challan print view. No pricing — a DC only documents what physically moved. ─── */
function DcPreview({ dc, close }: { dc: DeliveryChallan; close: () => void }) {
  return <div className="stock-modal-backdrop quote-preview-backdrop"><section className="quote-preview" role="dialog" aria-modal="true" aria-labelledby="dc-preview-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <div className="quote-preview-actions"><button className="settings-outline" onClick={() => window.print()}>Print / Save PDF</button><button className="erp-action" onClick={close}>Done</button></div>
    <article>
      <header><img src={spmLogo} alt="SPM Lab Solutions" /><div><h2 id="dc-preview-title">DELIVERY CHALLAN</h2><span>{dc.number}</span></div></header>
      <div className="quote-preview-company">
        <div><b>{COMPANY.name}</b><span>{COMPANY.address}</span><span>GSTIN: {COMPANY.gstin}</span></div>
        <div><b>Delivered to</b><span>{dc.customer}</span>{dc.siteId && <span>{siteById(dc.siteId)?.name ?? ""}</span>}</div>
      </div>
      <p className="quote-preview-subject"><b>Date:</b> {prettyDate(dc.date)} &nbsp;·&nbsp; <b>Reason:</b> {dc.reason}{dc.reference && <>&nbsp;·&nbsp;<b>Reference:</b> {dc.reference}</>}</p>
      <table><thead><tr><th>Description</th><th>Serial / ID</th><th className="number">Quantity</th></tr></thead><tbody>{dc.lines.map((line, index) => <tr key={index}><td>{line.description}</td><td>{line.serial || "—"}</td><td className="number">{line.quantity}</td></tr>)}</tbody></table>
      <footer><div><b>Received in good condition by</b><span>Name, signature &amp; date</span></div><div><i>Authorised signatory</i><b>For {COMPANY.name}</b></div></footer>
    </article>
  </section></div>;
}
