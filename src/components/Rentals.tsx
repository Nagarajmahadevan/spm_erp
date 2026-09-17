import { useMemo, useState } from "react";
import { addDaysIso, addMonths, customerSites, dateIso, money, prettyDate, stamp, STOCK_LOCATIONS, WAREHOUSE } from "./erpMasters";
import { invoiceFromRental, nextNumber as nextInvoiceNumber } from "./Invoices";
import { Overlay, Pagination, useTablePage } from "./ErpUi";
import { Timeline } from "./Stock";
import { issueRental, returnRental, rentalInvoiceDue, rentalNextInvoiceDate, rentalOverdue, updateStore, useErpStore, type CustomerOrder, type Individual, type Rental } from "./erpStore";

export default function Rentals({ focus }: { focus?: string } = {}) {
  const store = useErpStore();
  const { rentals, individuals, customerOrders } = store;
  const today = dateIso();
  const [search, setSearch] = useState(focus ?? "");
  const [statusFilter, setStatusFilter] = useState<"Active" | "Returned" | "All">("Active");
  const [issuing, setIssuing] = useState<CustomerOrder | null>(null);
  const [returning, setReturning] = useState<Rental | null>(null);
  const [detail, setDetail] = useState<Rental | null>(null);
  const [toast, setToast] = useState("");
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3200); };

  const active = rentals.filter((entry) => entry.status === "Active");
  const overdue = active.filter((entry) => rentalOverdue(entry, today));
  const due = rentals.filter((entry) => rentalInvoiceDue(entry, today));
  const pendingOrders = customerOrders.filter((order) => order.orderType === "Rental" && order.status === "Open");

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rentals
      .filter((entry) => statusFilter === "All" || entry.status === statusFilter)
      .filter((entry) => {
        if (!query) return true;
        const unit = individuals.find((item) => item.id === entry.equipmentId);
        return [entry.number, entry.orderRef, entry.customer, unit?.name, unit?.id, unit?.serial].some((value) => value?.toLowerCase().includes(query));
      })
      .sort((a, b) => a.expectedReturnDate.localeCompare(b.expectedReturnDate));
  }, [rentals, individuals, statusFilter, search]);
  const { pageRows, page, setPage } = useTablePage(rows, `${statusFilter}|${search}`);

  const createDueInvoices = () => {
    let createdCount = 0;
    updateStore((current) => {
      const dueList = current.rentals.filter((entry) => rentalInvoiceDue(entry, dateIso()));
      if (!dueList.length) return {};
      let invoices = current.invoices;
      let nextRentals = current.rentals;
      dueList.forEach((rental) => {
        const unit = current.individuals.find((entry) => entry.id === rental.equipmentId);
        if (!unit) return;
        const number = nextInvoiceNumber(invoices);
        const periodStart = rentalNextInvoiceDate(rental);
        const periodEnd = addMonths(periodStart, 1);
        const invoice = invoiceFromRental(rental, unit, current.customers, number, `${prettyDate(periodStart)} – ${prettyDate(periodEnd)}`);
        invoices = [invoice, ...invoices];
        nextRentals = nextRentals.map((entry) => entry.id === rental.id ? { ...entry, lastInvoicedThrough: periodEnd, activities: [{ title: `Rental invoice ${number} created`, meta: stamp(), tone: "system" as const }, ...entry.activities] } : entry);
        createdCount += 1;
      });
      return { invoices, rentals: nextRentals };
    });
    flash(createdCount ? `Created ${createdCount} rent invoice${createdCount === 1 ? "" : "s"}.` : "No rent invoices are due right now.");
  };

  return <section className="leads-page">
    <div className="leads-heading">
      <div><p className="erp-secondary-text">Operations / Rentals</p><h1>Rentals</h1><p className="erp-secondary-text mt-1">Equipment out on rent, monthly billing, and returns.</p></div>
      <div className="leads-actions"><button className="erp-action" disabled={!due.length} onClick={createDueInvoices}>Create {due.length || ""} due invoice{due.length === 1 ? "" : "s"}</button></div>
    </div>

    <div className="quotations-overview">
      <button className="leads-stat quotations-stat quotations-stat--sent" onClick={() => setStatusFilter("Active")}><span>Active rentals</span><b>{active.length}</b></button>
      <button className="leads-stat quotations-stat quotations-stat--expiring" onClick={() => setStatusFilter("Active")}><span>Overdue return</span><b>{overdue.length}</b></button>
      <button className="leads-stat quotations-stat quotations-stat--draft"><span>Invoices due</span><b>{due.length}</b></button>
    </div>

    {pendingOrders.length > 0 && <section className="settings-subsection">
      <h3>Rental orders awaiting issue</h3>
      <div className="erp-table-shell"><table className="erp-data-table"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th /></tr></thead><tbody>{pendingOrders.map((order) => <tr key={order.id}>
        <td>{order.number}</td>
        <td>{order.customer}</td>
        <td>{order.items.map((line) => `${line.quantity} × ${line.item}`).join(", ")}</td>
        <td><button className="erp-record-link" onClick={() => setIssuing(order)}>Issue equipment</button></td>
      </tr>)}</tbody></table></div>
    </section>}

    <div className="erp-filters">
      <label className="erp-search-filter"><span>Search rentals</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Equipment, customer, rental or order number" /></label>
      <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="Active">Active</option><option value="Returned">Returned</option><option value="All">All</option></select></label>
    </div>

    <div className="erp-table-shell"><table className="erp-data-table"><thead><tr><th>Rental</th><th>Equipment</th><th>Customer · Site</th><th>Monthly rent</th><th>Return due</th><th>Next invoice</th><th /></tr></thead><tbody>{pageRows.map((rental) => {
      const unit = individuals.find((entry) => entry.id === rental.equipmentId);
      const site = customerSites.find((entry) => entry.id === rental.siteId);
      const overdueFlag = rentalOverdue(rental, today);
      return <tr key={rental.id} className="erp-row-clickable" onClick={() => setDetail(rental)}>
        <td><b>{rental.number}</b><small>{rental.orderRef || "—"}</small></td>
        <td><b>{unit?.name ?? rental.equipmentId}</b><small>{unit?.id} · {unit?.serial}</small></td>
        <td>{rental.customer}<small>{site?.name}</small></td>
        <td>{money(rental.monthlyRate)}</td>
        <td className={overdueFlag ? "invoice-overdue" : ""}>{prettyDate(rental.expectedReturnDate)}{overdueFlag && <small> · Overdue</small>}</td>
        <td>{rental.status === "Active" ? prettyDate(rentalNextInvoiceDate(rental)) : "—"}</td>
        <td>{rental.status === "Active" && <button className="erp-record-link" onClick={(event) => { event.stopPropagation(); setReturning(rental); }}>Return</button>}</td>
      </tr>;
    })}</tbody></table>
    {!rows.length && <div className="settings-empty"><b>No rentals match</b><p>Try a different search, or change the status filter.</p></div>}
    </div>
    <Pagination total={rows.length} page={page} onPage={setPage} />

    {detail && <RentalDetail rental={detail} individuals={individuals} moves={store.moves} close={() => setDetail(null)} onReturn={() => { setReturning(detail); setDetail(null); }} />}
    {issuing && <IssueRentalModal order={issuing} individuals={individuals} rentals={rentals} close={() => setIssuing(null)} flash={flash} />}
    {returning && <ReturnRentalModal rental={returning} unit={individuals.find((entry) => entry.id === returning.equipmentId)} close={() => setReturning(null)} flash={flash} />}
    {toast && <div className="settings-toast" role="status">✓ {toast}</div>}
  </section>;
}

function RentalDetail({ rental, individuals, moves, close, onReturn }: { rental: Rental; individuals: Individual[]; moves: import("./erpStore").StockMove[]; close: () => void; onReturn: () => void }) {
  const unit = individuals.find((entry) => entry.id === rental.equipmentId);
  const site = customerSites.find((entry) => entry.id === rental.siteId);
  const history = moves.filter((move) => move.equipmentId === rental.equipmentId);
  const overdueFlag = rentalOverdue(rental, dateIso());
  return <Overlay onClose={close} label={rental.number}><aside className="stock-detail">
    <div className="settings-drawer-head">
      <div><p>{rental.number} · {rental.status}</p><h2>{unit?.name ?? rental.equipmentId}</h2><div className="stock-detail-meta"><span>{rental.customer}</span><span>{site?.name}</span></div></div>
      <button onClick={close} aria-label="Close">×</button>
    </div>
    <div className="stock-quick">{rental.status === "Active" && <button className="settings-outline" onClick={onReturn}>Return</button>}</div>
    <section className="stock-detail-section"><h3>Rental details</h3><dl className="invoice-facts stock-facts">
      <div><dt>Order</dt><dd>{rental.orderRef || "—"}</dd></div>
      <div><dt>Equipment</dt><dd>{unit?.id} · {unit?.serial}</dd></div>
      <div><dt>Start date</dt><dd>{prettyDate(rental.startDate)}</dd></div>
      <div><dt>Monthly rent</dt><dd>{money(rental.monthlyRate)}</dd></div>
      <div><dt>Expected return</dt><dd>{prettyDate(rental.expectedReturnDate)}{overdueFlag && <span className="job-late"> · Overdue</span>}</dd></div>
      <div><dt>Next invoice due</dt><dd>{rental.status === "Active" ? prettyDate(rentalNextInvoiceDate(rental)) : "—"}</dd></div>
      {rental.returnedAt && <div className="invoice-fact-wide"><dt>Returned</dt><dd>{prettyDate(rental.returnedAt)} · {rental.returnCondition}</dd></div>}
    </dl></section>
    <section className="stock-detail-section"><h3>Movement history</h3><Timeline moves={history} /></section>
    <section className="stock-detail-section"><h3>Activity</h3><div className="lead-timeline quote-activity">{rental.activities.map((entry, index) => <div key={index}><i /><p><b>{entry.title}</b><span>{entry.meta}</span></p></div>)}</div></section>
  </aside></Overlay>;
}

function IssueRentalModal({ order, individuals, rentals, close, flash }: { order: CustomerOrder; individuals: Individual[]; rentals: Rental[]; close: () => void; flash: (message: string) => void }) {
  const sites = customerSites.filter((entry) => entry.customer === order.customer);
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [startDate, setStartDate] = useState(dateIso());
  const [expectedReturnDate, setExpectedReturnDate] = useState(addDaysIso(dateIso(), 30));
  const [rates, setRates] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const matchedUnits = useMemo(() => {
    const taken = new Set<string>();
    const units: Individual[] = [];
    order.items.filter((line) => line.inStock).forEach((line) => {
      let remaining = line.quantity;
      for (const item of individuals) {
        if (remaining <= 0) break;
        if (item.name === line.item && item.holder === "Store" && item.opStatus === "Available" && !taken.has(item.id)) {
          taken.add(item.id);
          units.push(item);
          remaining -= 1;
        }
      }
    });
    return units;
  }, [order, individuals]);

  const submit = () => {
    if (!siteId) { setError("Pick the customer's site."); return; }
    if (!matchedUnits.length) { setError("Nothing in this order is currently available in stock to issue."); return; }
    if (matchedUnits.some((entry) => !(Number(rates[entry.id]) > 0))) { setError("Enter a monthly rent for each unit."); return; }
    const units = matchedUnits.map((entry) => ({ equipmentId: entry.id, monthlyRate: Number(rates[entry.id]) }));
    let result: ReturnType<typeof issueRental> = {};
    updateStore((current) => { result = issueRental(current, order, siteId, startDate, expectedReturnDate, units); return result; });
    if (!result.rentals) { setError("Nothing was issued — check the units are still available."); return; }
    close();
    flash(`Issued ${units.length} unit${units.length === 1 ? "" : "s"} · ${result.deliveryChallans![0].number} created.`);
  };

  return <Overlay onClose={close} label={`Issue equipment — ${order.number}`}><section className="stock-move-modal" role="dialog" aria-modal="true" aria-labelledby="issue-rental-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <p>Rentals</p><h2 id="issue-rental-title">Issue equipment — {order.number}</h2>
    <label className="settings-field"><span>Site <b className="lead-required">Required</b></span><select value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">{sites.length ? "Pick a site" : "No sites on file for this customer"}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}</select></label>
    <label className="settings-field"><span>Start date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
    <label className="settings-field"><span>Expected return date</span><input type="date" value={expectedReturnDate} onChange={(event) => setExpectedReturnDate(event.target.value)} /></label>
    {matchedUnits.length > 0 ? <div className="po-receive-list">{matchedUnits.map((unit) => <div key={unit.id} className="po-receive-row">
      <div className="po-receive-head"><b>{unit.name}</b><span>{unit.id} · {unit.serial}</span></div>
      <label className="po-receive-qty"><span>Monthly rent</span><input type="number" min="0" value={rates[unit.id] ?? ""} onChange={(event) => setRates((all) => ({ ...all, [unit.id]: event.target.value }))} placeholder="₹" /></label>
    </div>)}</div> : <p className="po-start-hint">None of this order's lines are currently available in stock to issue.</p>}
    {error && <p className="stock-count-error">{error}</p>}
    <div className="stock-move-footer"><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" disabled={!matchedUnits.length} onClick={submit}>Issue</button></div>
  </section></Overlay>;
}

function ReturnRentalModal({ rental, unit, close, flash }: { rental: Rental; unit?: Individual; close: () => void; flash: (message: string) => void }) {
  const [condition, setCondition] = useState<"Good" | "Damaged">("Good");
  const [remarks, setRemarks] = useState("");
  const [date, setDate] = useState(dateIso());
  const [destination, setDestination] = useState(WAREHOUSE);

  const submit = () => {
    updateStore((current) => returnRental(current, rental.id, condition, remarks, date, destination));
    close();
    flash(`${unit?.name ?? "Item"} returned${condition === "Damaged" ? " — marked Damaged" : ""}.`);
  };

  return <Overlay onClose={close} label={`Return ${unit?.name ?? rental.number}`}><section className="stock-move-modal" role="dialog" aria-modal="true" aria-labelledby="return-rental-title" onClick={(event) => event.stopPropagation()}>
    <button className="stock-modal-close" onClick={close} aria-label="Close">×</button>
    <p>Rentals</p><h2 id="return-rental-title">Return {unit?.name ?? rental.number}</h2>
    <p className="po-start-hint">{rental.customer} · {rental.number}</p>
    <div className="stock-choice-row"><button className={condition === "Good" ? "is-selected" : ""} onClick={() => setCondition("Good")}>Good condition</button><button className={condition === "Damaged" ? "is-selected" : ""} onClick={() => setCondition("Damaged")}>Damaged</button></div>
    <label className="settings-field"><span>Remarks (optional)</span><input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Condition notes" /></label>
    <label className="settings-field"><span>Return date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
    <label className="settings-field"><span>Destination</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{STOCK_LOCATIONS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
    {condition === "Damaged" && <p className="po-start-hint">Damaged equipment returns to the store but will not be available to issue until it is repaired.</p>}
    <div className="stock-move-footer"><button className="settings-outline" onClick={close}>Cancel</button><button className="erp-action" onClick={submit}>Confirm return</button></div>
  </section></Overlay>;
}
