// Live state shared between modules. Stock and Purchase Orders both read and write it, so
// a PO that is still awaiting delivery shows as "On order" in Stock, and receiving a PO
// puts the goods on the shelf without anyone re-keying them.
import { useSyncExternalStore } from "react";
import { APPROVER, ATTENDANCE_SETTINGS, COMPANY, JOB_SETTINGS, STOCK_LOCATIONS, WAREHOUSE, addDaysIso, addMonths, dateIso, dayDifference, isoDateInIst, isWeeklyOff, engineers, customerMaster, customerSites, metersBetween, minutesToTime, nowIso, prettyDate, stamp, timeToMinutes, totalsFor, initialQuotes, type Customer, type Quote, type QuoteLine } from "./erpMasters";

// Equipment SPM owns and tracks unit by unit. Ownership (always SPM here), current holder,
// operational status and calibration are kept as separate facts — a unit with an engineer
// can be Available or In use; a unit sitting in the store can be Damaged or Awaiting
// calibration. None of these axes is inferred from another.
export type EquipmentHolder = "Store" | "Engineer" | "Customer" | "Calibration/Repair";
export type EquipmentOpStatus = "Available" | "In use" | "Damaged" | "Awaiting calibration" | "Sold" | "Retired";
export type Individual = {
  id: string; name: string; model: string; serial: string; category: string;
  holder: EquipmentHolder; currentWith: string; opStatus: EquipmentOpStatus;
  rentalCustomer?: string; rentalSiteId?: string; rentalReturnDue?: string; rentalRef?: string;
  saleRef?: string;
  calibrationDue?: string;
  condition?: string;
  last: string;
};
export type StockBalance = { location: string; quantity: number };
export type Quantity = { id: string; name: string; category: string; unit: string; balances: StockBalance[]; minimum: number };
export type StockItem = Individual | Quantity;
export type StockMove = {
  id: string; date: string; at: string; action: string;
  source: string; destination: string;
  quantity?: number; equipmentId?: string;
  reason?: string; who: string; document: string; item: string;
  beforeBalance?: number; afterBalance?: number;
};

export function totalOf(item: Quantity) { return item.balances.reduce((sum, entry) => sum + entry.quantity, 0); }
export function balanceAt(item: Quantity, location: string) { return item.balances.find((entry) => entry.location === location)?.quantity ?? 0; }
export function adjustBalance(balances: StockBalance[], location: string, delta: number): StockBalance[] {
  const exists = balances.some((entry) => entry.location === location);
  const next = exists ? balances.map((entry) => entry.location === location ? { ...entry, quantity: entry.quantity + delta } : entry) : [...balances, { location, quantity: delta }];
  return next.map((entry) => ({ ...entry, quantity: Math.max(0, entry.quantity) }));
}
export function transferBalances(balances: StockBalance[], from: string, to: string, amount: number): StockBalance[] {
  return adjustBalance(adjustBalance(balances, from, -amount), to, amount);
}
export function nextEquipmentId(individuals: Individual[]) {
  const highest = Math.max(0, ...individuals.map((item) => Number(item.id.split("-").at(-1)) || 0));
  return `INS-${String(highest + 1).padStart(4, "0")}`;
}
export function nextEquipmentIds(individuals: Individual[], count: number) {
  const highest = Math.max(0, ...individuals.map((item) => Number(item.id.split("-").at(-1)) || 0));
  return Array.from({ length: count }, (_, index) => `INS-${String(highest + index + 1).padStart(4, "0")}`);
}

export type POStatus = "Draft" | "Sent" | "Partly received" | "Received" | "Cancelled";
export type POLine = { id: string; item: string; description: string; hsn: string; quantity: number; rate: number; gst: number; stockId?: string; tracked?: boolean; received: number; serials: string[] };
export type Receipt = { id: string; date: string; location: string; challan: string; note: string; lines: { lineId: string; quantity: number; serials: string[] }[] };
export type POActivity = { title: string; meta: string; tone?: "sent" | "received" | "approved" | "system" };
export type PurchaseOrder = {
  id: string;
  number: string;
  vendor: string;
  contact: string;
  vendorGstin: string;
  vendorState: string;
  vendorAddress: string;
  paymentTerms: string;
  tdsSection: string;
  tdsRate: number;
  orderDate: string;
  expectedDate: string;
  status: POStatus;
  owner: string;
  deliveryAddress: string;
  freightCharges: number;
  notes: string;
  linkedOrder: string;
  items: POLine[];
  receipts: Receipt[];
  approvedBy?: string;
  sentAt?: string;
  activities: POActivity[];
};

export function pendingOf(line: POLine) { return Math.max(line.quantity - line.received, 0); }
/** Pure order-side effect of a receipt: updated lines, receipts and status. No stock mutation here. */
export function orderAfterReceipt(order: PurchaseOrder, receipt: Receipt): PurchaseOrder {
  const items = order.items.map((line) => {
    const got = receipt.lines.find((entry) => entry.lineId === line.id);
    return got ? { ...line, received: line.received + got.quantity, serials: [...line.serials, ...got.serials] } : line;
  });
  const complete = items.every((line) => line.received >= line.quantity);
  const named = receipt.lines.map((entry) => { const line = order.items.find((item) => item.id === entry.lineId); return `${entry.quantity} × ${line?.item}`; });
  const title = `Added to ${receipt.location}: ${named.join(", ")}.`;
  return { ...order, items, receipts: [receipt, ...order.receipts], status: complete ? "Received" : "Partly received", activities: [{ title, meta: stamp(), tone: "received" }, ...order.activities] };
}
/** Pure stock-side effect of a receipt: puts goods on the shelf and writes each item's movement.
 *  Shared by Purchase Orders (receiving against this PO) and Stock (Receive Stock → Purchase Receipt),
 *  so the same physical delivery is only ever posted once no matter which screen it is entered from. */
export function applyReceiptToStock(current: Store, order: PurchaseOrder, receipt: Receipt): Pick<Store, "quantities" | "individuals" | "moves"> {
  let quantities = current.quantities;
  let individuals = current.individuals;
  const moves: StockMove[] = [];
  receipt.lines.forEach((entry) => {
    const line = order.items.find((item) => item.id === entry.lineId);
    if (!line || entry.quantity <= 0) return;
    if (line.stockId) quantities = quantities.map((stock) => stock.id === line.stockId ? { ...stock, balances: adjustBalance(stock.balances, receipt.location, entry.quantity) } : stock);
    if (entry.serials.length) individuals = [...individuals, ...entry.serials.map((serial) => ({
      id: serial, name: line.item, model: line.description || "Model not recorded", serial, category: "Instruments",
      holder: "Store" as const, currentWith: receipt.location, opStatus: "Available" as const, last: prettyDate(receipt.date),
    }))];
    moves.push({ id: `mv-${receipt.id}-${entry.lineId}`, date: receipt.date, at: prettyDate(receipt.date), action: "Purchase receipt", source: order.vendor, destination: receipt.location, quantity: line.stockId ? entry.quantity : undefined, equipmentId: entry.serials[0], who: APPROVER, document: order.number, item: line.item });
  });
  return { quantities, individuals, moves: [...moves, ...current.moves] };
}
/** Orchestrates both halves against the live store for a given order id. */
export function receiveAgainstOrder(current: Store, orderId: string, receipt: Receipt): Partial<Store> {
  const order = current.orders.find((entry) => entry.id === orderId);
  if (!order) return {};
  const nextOrder = orderAfterReceipt(order, receipt);
  const stockPatch = applyReceiptToStock(current, order, receipt);
  return { orders: current.orders.map((entry) => entry.id === orderId ? nextOrder : entry), ...stockPatch };
}

// Customer orders. Created when a quotation is accepted — the record of what the customer
// confirmed, holding their PO details and an optional advance, ahead of dispatch/jobs/invoicing.
// Named CustomerOrder (not Order) since PurchaseOrder already uses "order" for the vendor side.
export type CustomerOrderType = "Sale" | "Service" | "Rental";
export type CustomerOrderStatus = "Open" | "Fulfilled" | "Cancelled";
export type CustomerOrderActivity = { title: string; meta: string; tone?: "system" | "paid" };
export type CustomerOrder = {
  id: string;
  number: string;
  customer: string;
  contact: string;
  customerGstin: string;
  customerState: string;
  billingAddress: string;
  shippingAddress: string;
  fromQuote: string;
  orderDate: string;
  orderType: CustomerOrderType;
  poNumber?: string;
  poDate?: string;
  poAttachment?: string;
  advanceAmount?: number;
  installationNeeded?: boolean;
  dispatchedAt?: string;
  items: QuoteLine[];
  status: CustomerOrderStatus;
  activities: CustomerOrderActivity[];
};

// Delivery Challans. Any stock that physically leaves the office for a customer — a sale,
// a rental or demo dispatch, or returning a customer's own instrument after it was in our
// lab — gets one of these so there is always a document covering the movement.
export type DCReason = "Sale" | "Rental" | "Demo" | "Return";
export type DCLine = { description: string; serial?: string; quantity: number };
export type DeliveryChallan = {
  id: string; number: string; date: string;
  customer: string; siteId?: string;
  reason: DCReason;
  reference?: string;
  lines: DCLine[];
};
export function nextDcNumber(challans: DeliveryChallan[]) {
  const highest = Math.max(0, ...challans.map((entry) => Number(entry.number.split("-").at(-1)) || 0));
  return `DC-${String(highest + 1).padStart(4, "0")}`;
}
export function addDeliveryChallan(current: Store, input: { customer: string; siteId?: string; reason: DCReason; reference?: string; lines: DCLine[]; date?: string }): Partial<Store> {
  const dc: DeliveryChallan = { id: `dc-${Date.now()}`, number: nextDcNumber(current.deliveryChallans), date: input.date || dateIso(), customer: input.customer, siteId: input.siteId, reason: input.reason, reference: input.reference, lines: input.lines };
  return { deliveryChallans: [dc, ...current.deliveryChallans] };
}

/** Dispatching a Sale order issues each in-stock line from the store (selling equipment units
 *  one by one, decrementing spare balances) and raises one Delivery Challan covering everything
 *  that actually moved. Lines with nothing in stock are simply left out — this only ever moves
 *  real stock, never invents it. Equipment sold this way carries saleRef === order.number, so it
 *  shows up under the order's existing "Dispatches" section for free. */
export function dispatchSaleOrder(current: Store, order: CustomerOrder, siteId: string, date: string): Partial<Store> {
  let individuals = current.individuals;
  let quantities = current.quantities;
  let instruments = current.instruments;
  const moves: StockMove[] = [];
  const dcLines: DCLine[] = [];
  const today = prettyDate(date);

  order.items.filter((line) => line.inStock).forEach((line) => {
    let remaining = line.quantity;
    while (remaining > 0) {
      const unit = individuals.find((entry) => entry.name === line.item && entry.holder === "Store" && entry.opStatus === "Available");
      if (!unit) break;
      const patch = recordEquipmentSale({ ...current, individuals, instruments }, unit.id, { customer: order.customer, siteId, saleRef: order.number });
      individuals = patch.individuals ?? individuals;
      instruments = patch.instruments ?? instruments;
      moves.push({ id: `mv-${Date.now()}-${unit.id}`, date, at: `${today} · now`, action: "Record Sale", source: unit.currentWith, destination: order.customer, equipmentId: unit.id, who: APPROVER, document: order.number, item: unit.name });
      dcLines.push({ description: unit.name, serial: unit.serial, quantity: 1 });
      remaining -= 1;
    }
    if (remaining > 0) {
      const qtyItem = quantities.find((entry) => entry.name === line.item);
      const storeLoc = qtyItem?.balances.find((entry) => STOCK_LOCATIONS.includes(entry.location) && entry.quantity > 0);
      if (qtyItem && storeLoc) {
        const take = Math.min(remaining, storeLoc.quantity);
        quantities = quantities.map((entry) => entry.id === qtyItem.id ? { ...entry, balances: adjustBalance(entry.balances, storeLoc.location, -take) } : entry);
        moves.push({ id: `mv-${Date.now()}-${qtyItem.id}`, date, at: `${today} · now`, action: "Record Sale", source: storeLoc.location, destination: order.customer, quantity: take, who: APPROVER, document: order.number, item: qtyItem.name });
        dcLines.push({ description: qtyItem.name, quantity: take });
      }
    }
  });

  if (!dcLines.length) return {};
  const dcPatch = addDeliveryChallan({ ...current, individuals, quantities, instruments }, { customer: order.customer, siteId, reason: "Sale", reference: order.number, date, lines: dcLines });
  return {
    individuals, quantities, instruments, moves: [...moves, ...current.moves], ...dcPatch,
    customerOrders: current.customerOrders.map((entry) => entry.id === order.id ? { ...entry, dispatchedAt: date, activities: [{ title: `Dispatched · ${dcPatch.deliveryChallans![0].number}`, meta: stamp(), tone: "system" as const }, ...entry.activities] } : entry),
  };
}

// Rentals — the single place equipment goes out on rent and comes back. A Rental is its own
// record (not just fields on Individual) because it carries a billing agreement — start date,
// monthly rate, and how far it has been invoiced — that outlives any one stock movement.
export type RentalStatus = "Active" | "Returned";
export type RentalActivity = { title: string; meta: string; tone?: "system" };
export type Rental = {
  id: string; number: string;
  orderRef: string;
  equipmentId: string;
  customer: string; siteId: string;
  startDate: string;
  monthlyRate: number;
  expectedReturnDate: string;
  status: RentalStatus;
  lastInvoicedThrough?: string; // ISO date up to which rent has been invoiced; next invoice due here
  returnedAt?: string;
  returnCondition?: string;
  activities: RentalActivity[];
};
export function nextRentalNumber(rentals: Rental[]) {
  const highest = Math.max(0, ...rentals.map((entry) => Number(entry.number.split("-").at(-1)) || 0));
  return `RENT-2026-${String(highest + 1).padStart(4, "0")}`;
}
export function rentalOverdue(rental: Rental, today: string) { return rental.status === "Active" && rental.expectedReturnDate < today; }
export function rentalNextInvoiceDate(rental: Rental) { return rental.lastInvoicedThrough ?? rental.startDate; }
export function rentalInvoiceDue(rental: Rental, today: string) { return rental.status === "Active" && rentalNextInvoiceDate(rental) <= today; }

/** Issues one or more available units against a Rental order: marks each Store/Available unit
 *  out to the customer, opens a Rental record per unit (its own monthly rate), and raises one
 *  Delivery Challan covering the whole batch — the same "leaves the office" rule as a sale. */
export function issueRental(current: Store, order: CustomerOrder, siteId: string, startDate: string, expectedReturnDate: string, units: { equipmentId: string; monthlyRate: number }[]): Partial<Store> {
  let individuals = current.individuals;
  const newRentals: Rental[] = [];
  const dcLines: DCLine[] = [];
  const moves: StockMove[] = [];
  const site = customerSites.find((entry) => entry.id === siteId);
  const currentWith = `${order.customer} · ${site?.name ?? ""}`;
  const today = prettyDate(startDate);
  units.forEach(({ equipmentId, monthlyRate }) => {
    const unit = individuals.find((entry) => entry.id === equipmentId);
    if (!unit || unit.holder !== "Store" || unit.opStatus !== "Available" || !(monthlyRate > 0)) return;
    const number = nextRentalNumber([...current.rentals, ...newRentals]);
    individuals = individuals.map((row) => row.id === equipmentId ? { ...row, holder: "Customer" as const, currentWith, opStatus: "In use" as const, rentalCustomer: order.customer, rentalSiteId: siteId, rentalReturnDue: expectedReturnDate, rentalRef: number, last: today } : row);
    newRentals.push({ id: number, number, orderRef: order.number, equipmentId, customer: order.customer, siteId, startDate, monthlyRate, expectedReturnDate, status: "Active", activities: [{ title: `Issued to ${order.customer}`, meta: stamp(), tone: "system" }] });
    moves.push({ id: `mv-${Date.now()}-${equipmentId}`, date: startDate, at: `${today} · now`, action: "Issue on Rent", source: unit.currentWith, destination: currentWith, equipmentId, who: APPROVER, document: number, item: unit.name });
    dcLines.push({ description: unit.name, serial: unit.serial, quantity: 1 });
  });
  if (!newRentals.length) return {};
  const dcPatch = addDeliveryChallan({ ...current, individuals }, { customer: order.customer, siteId, reason: "Rental", reference: order.number, date: startDate, lines: dcLines });
  return { individuals, rentals: [...newRentals, ...current.rentals], moves: [...moves, ...current.moves], ...dcPatch };
}
/** Return: check the condition and bring the unit back to stock. No DC — nothing leaves the
 *  office on a return, so it isn't a delivery. */
export function returnRental(current: Store, rentalId: string, condition: "Good" | "Damaged", remarks: string, date: string, destination: string): Partial<Store> {
  const rental = current.rentals.find((entry) => entry.id === rentalId);
  if (!rental || rental.status !== "Active") return {};
  const unit = current.individuals.find((entry) => entry.id === rental.equipmentId);
  if (!unit) return {};
  const opStatus: EquipmentOpStatus = condition === "Damaged" ? "Damaged" : "Available";
  const today = prettyDate(date);
  const individuals = current.individuals.map((row) => row.id === rental.equipmentId ? { ...row, holder: "Store" as const, currentWith: destination, opStatus, condition: remarks || condition, rentalCustomer: undefined, rentalSiteId: undefined, rentalReturnDue: undefined, last: today } : row);
  const rentals = current.rentals.map((entry) => entry.id !== rentalId ? entry : { ...entry, status: "Returned" as const, returnedAt: date, returnCondition: remarks || condition, activities: [{ title: `Returned — condition: ${remarks || condition}`, meta: stamp(), tone: "system" as const }, ...entry.activities] });
  const moves = [{ id: `mv-${Date.now()}`, date, at: `${today} · now`, action: "Rental return", source: unit.currentWith, destination, equipmentId: unit.id, who: APPROVER, document: rental.number, reason: condition, item: unit.name }, ...current.moves];
  return { individuals, rentals, moves };
}

// Invoices. Due Dates reads the unpaid ones, so they live here rather than in the module.
// Document Status (Draft/Sent/Cancelled) and Payment Status (Unpaid/Partly Paid/Paid) are
// deliberately separate axes — see Accounts §7. "Sent" is displayed as "Issued" wherever the
// two could be confused; the enum value is kept as "Sent" to avoid touching every comparison.
export type InvoiceStatus = "Draft" | "Sent" | "Cancelled";
export type InvoicePaymentStatus = "Unpaid" | "Partly Paid" | "Paid";
export type InvoiceDisplayStatus = InvoiceStatus | "Overdue";
export type PaymentMode = "Bank" | "UPI" | "Cheque" | "Cash";
export type InvoiceLine = { id: string; item: string; description: string; hsn: string; quantity: number; rate: number; gst: number; stockCode?: string };
export type InvoiceActivity = { title: string; meta: string; tone?: "sent" | "paid" | "system" };
export type Invoice = {
  id: string;
  number: string;
  customer: string;
  contact: string;
  customerGstin: string;
  customerState: string;
  billingAddress: string;
  shippingAddress: string;
  paymentTerms: string;
  invoiceDate: string;
  dueDate: string;
  status: InvoiceStatus;
  invoiceType: "Sales" | "Service" | "Rental";
  poNumber: string;
  poDate: string;
  deliveryNote: string;
  vehicleNumber: string;
  placeOfSupply: string;
  irn: string;
  ewayBill: string;
  freightCharges: number;
  overallDiscount: number;
  items: InvoiceLine[];
  fromQuote?: string;
  orderRef?: string;
  sentAt?: string;
  lastReminder?: string;
  activities: InvoiceActivity[];
};

// ─── Accounts: customer receipts and TDS ledger (single source of truth) ───────────────
// A receipt is money actually received from a customer, optionally split across several of
// their invoices in one go; whatever isn't allocated stays visible as that customer's advance
// until someone explicitly applies it. TDS the customer deducted is tracked as a separate
// ledger — it reduces the invoice balance but is never counted as cash collected. Recorded
// directly, once — no clearance or verification step, and nothing here is ever reversed.
export type ReceiptAllocation = { invoiceId: string; amount: number };
export type CustomerReceipt = {
  id: string; customer: string; date: string; amount: number; mode: PaymentMode;
  reference?: string; notes?: string; orderRef?: string;
  allocations: ReceiptAllocation[];
  recordedBy: string; recordedAt: string;
};
export type CustomerTds = {
  id: string; invoiceId: string; customer: string; amount: number; date: string;
  reference?: string; attachment?: string;
  recordedBy: string; recordedAt: string;
};

/** Every allocation ever made against an invoice — the only receipts that count toward
 *  settlement, since every receipt counts the moment it is recorded. */
export function invoiceReceiptsApplied(invoiceId: string, receipts: CustomerReceipt[]) {
  return receipts.flatMap((receipt) => receipt.allocations.filter((allocation) => allocation.invoiceId === invoiceId))
    .reduce((sum, allocation) => sum + allocation.amount, 0);
}
export function invoiceTdsRecorded(invoiceId: string, tds: CustomerTds[]) {
  return tds.filter((entry) => entry.invoiceId === invoiceId).reduce((sum, entry) => sum + entry.amount, 0);
}
export function paidSoFar(invoice: Invoice, receipts: CustomerReceipt[]) { return invoiceReceiptsApplied(invoice.id, receipts); }
export function invoiceTotals(invoice: Invoice) { return totalsFor(invoice.items, invoice.customerState === COMPANY.state, invoice.overallDiscount, invoice.freightCharges); }
export function balanceOf(invoice: Invoice, receipts: CustomerReceipt[], tds: CustomerTds[]) {
  return Math.max(invoiceTotals(invoice).grandTotal - invoiceReceiptsApplied(invoice.id, receipts) - invoiceTdsRecorded(invoice.id, tds), 0);
}
export function invoicePaymentStatus(invoice: Invoice, receipts: CustomerReceipt[], tds: CustomerTds[]): InvoicePaymentStatus {
  const applied = invoiceReceiptsApplied(invoice.id, receipts) + invoiceTdsRecorded(invoice.id, tds);
  if (applied <= 0.005) return "Unpaid";
  return balanceOf(invoice, receipts, tds) <= 0.005 ? "Paid" : "Partly Paid";
}
export function invoiceStatusFor(invoice: Invoice, receipts: CustomerReceipt[], tds: CustomerTds[]): InvoiceDisplayStatus {
  if (invoice.status === "Sent" && invoicePaymentStatus(invoice, receipts, tds) !== "Paid" && dayDifference(invoice.dueDate) < 0) return "Overdue";
  return invoice.status;
}
/** Total owed by a customer — the balance of every issued (Sent) invoice, same basis as the
 *  Customer Outstanding report. Draft and Cancelled invoices don't count. */
export function customerOutstanding(customer: string, invoices: Invoice[], receipts: CustomerReceipt[], tds: CustomerTds[]) {
  return invoices.filter((invoice) => invoice.customer === customer && invoice.status === "Sent").reduce((sum, invoice) => sum + balanceOf(invoice, receipts, tds), 0);
}
/** Unallocated money from a customer's receipts — kept separate until someone applies it to an
 *  invoice by hand; never used silently to mark something paid. */
export function customerAdvance(customer: string, receipts: CustomerReceipt[]) {
  return receipts.filter((receipt) => receipt.customer === customer)
    .reduce((sum, receipt) => sum + (receipt.amount - receipt.allocations.reduce((total, allocation) => total + allocation.amount, 0)), 0);
}
/** Same invoice, same TDS amount recorded again — a real (if unusual) coincidence can happen on
 *  a further partial payment, so this is a review warning, never an automatic block. */
export function duplicateCustomerTds(tds: CustomerTds[], invoiceId: string, amount: number, excludeId?: string) {
  return tds.filter((entry) => entry.id !== excludeId && entry.invoiceId === invoiceId && entry.amount === amount);
}
export function duplicateReceiptReference(receipts: CustomerReceipt[], reference: string, excludeId?: string) {
  if (!reference.trim()) return [];
  return receipts.filter((receipt) => receipt.id !== excludeId && receipt.reference?.trim().toLowerCase() === reference.trim().toLowerCase());
}

export function recordCustomerReceipt(current: Store, receipt: CustomerReceipt): Partial<Store> {
  return { customerReceipts: [receipt, ...current.customerReceipts] };
}

export const seedInvoices: Invoice[] = [
  // Rental billing for RENT-0241, first month already invoiced — see rentals seed below for the
  // second month, which is left due so the real "Create due invoice" button has something to do.
  { id: "INV-2026-0121", number: "INV-2026-0121", customer: "Aster Pharma", contact: "Divya Menon", customerGstin: "29AAMCA4820G1ZJ", customerState: "Karnataka", billingAddress: "Whitefield Industrial Area, Bengaluru, Karnataka 560066", shippingAddress: "Sterile Manufacturing Block, Aster Pharma, Bengaluru, Karnataka 560066", paymentTerms: "Net 30", invoiceDate: "2026-09-01", dueDate: "2026-10-01", status: "Sent", invoiceType: "Rental", poNumber: "", poDate: "", deliveryNote: "", vehicleNumber: "", placeOfSupply: "Karnataka", irn: "", ewayBill: "", freightCharges: 0, overallDiscount: 0, items: [{ id: "i121-1", item: "Airborne Particle Counter", description: "Rental — 15 Aug 2026 – 14 Sep 2026 · INS-0042 · RENT-0241", hsn: "9973", quantity: 1, rate: 18500, gst: 18 }], sentAt: "01 Sep 2026", activities: [{ title: "Rental invoice for 15 Aug 2026 – 14 Sep 2026", meta: "01 Sep 2026 · Arun Kumar", tone: "system" }, { title: "Invoice sent to Divya Menon", meta: "01 Sep 2026 · Arun Kumar", tone: "sent" }] },
  // Sale + dispatch for ORD-2026-0498 — see deliveryChallans (DC-0001) and the sold INS-0047 above.
  { id: "INV-2026-0120", number: "INV-2026-0120", customer: "Arka Diagnostics", contact: "Meera Nair", customerGstin: "29AAECA5512M1Z3", customerState: "Karnataka", billingAddress: "44, Peenya Industrial Area, Bengaluru, Karnataka 560058", shippingAddress: "44, Peenya Industrial Area, Bengaluru, Karnataka 560058", paymentTerms: "Net 30", invoiceDate: "2026-09-16", dueDate: "2026-10-16", status: "Sent", invoiceType: "Sales", poNumber: "ARK/PO/2026/077", poDate: "2026-09-12", deliveryNote: "DC-0002", vehicleNumber: "KA 03 CD 5521", placeOfSupply: "Karnataka", irn: "", ewayBill: "", freightCharges: 0, overallDiscount: 0, items: [{ id: "i120-1", item: "Optical Microscope MX-5", description: "Optical microscope with 5 MP imaging", hsn: "9011", quantity: 1, rate: 215000, gst: 18, stockCode: "INS-0047" }, { id: "i120-2", item: "Vacuum seal kit", description: "Vacuum seal maintenance kit", hsn: "8484", quantity: 2, rate: 12400, gst: 18, stockCode: "SP-033" }], sentAt: "16 Sep 2026", orderRef: "ORD-2026-0498", activities: [{ title: "Invoice sent to Meera Nair", meta: "16 Sep 2026 · Arun Kumar", tone: "sent" }] },
  // Website lead LD-1048 → QT-2026-0850 → ORD-2026-0502 → JOB-1045 → certificate on CI-0116 → this invoice → part payment RCP-005.
  { id: "INV-2026-0119", number: "INV-2026-0119", customer: "Nova Instruments", contact: "Rhea Mehta", customerGstin: "29AABCN4106D1Z7", customerState: "Karnataka", billingAddress: "12, HAL 2nd Stage, Indiranagar, Bengaluru, Karnataka 560038", shippingAddress: "Materials Lab, Nova Instruments, Bengaluru, Karnataka 560038", paymentTerms: "Net 30", invoiceDate: "2026-09-16", dueDate: "2026-10-16", status: "Sent", invoiceType: "Service", poNumber: "NI/PO/2026/402", poDate: "2026-09-12", deliveryNote: "", vehicleNumber: "", placeOfSupply: "Karnataka", irn: "", ewayBill: "", freightCharges: 0, overallDiscount: 0, items: [{ id: "i119-1", item: "AFM Probe Station — Annual verification", description: "Annual verification and certification, in-lab · JOB-1045", hsn: "9987", quantity: 1, rate: 42000, gst: 18 }], sentAt: "16 Sep 2026", fromQuote: "QT-2026-0850 R1", orderRef: "ORD-2026-0502", activities: [{ title: "Part payment received ₹25,000", meta: "17 Sep 2026 · Arun Kumar", tone: "paid" }, { title: "Invoice sent to Rhea Mehta", meta: "16 Sep 2026 · Arun Kumar", tone: "sent" }] },
  { id: "INV-2026-0118", number: "INV-2026-0118", customer: "Nova Instruments", contact: "Rhea Mehta", customerGstin: "29AABCN4106D1Z7", customerState: "Karnataka", billingAddress: "12, HAL 2nd Stage, Indiranagar, Bengaluru, Karnataka 560038", shippingAddress: "Materials Lab, Nova Instruments, Bengaluru, Karnataka 560038", paymentTerms: "Net 30", invoiceDate: "2026-08-20", dueDate: "2026-09-19", status: "Sent", invoiceType: "Sales", poNumber: "NI/PO/2026/318", poDate: "2026-08-18", deliveryNote: "DN-4471", vehicleNumber: "KA 01 AB 4471", placeOfSupply: "Karnataka", irn: "", ewayBill: "", freightCharges: 0, overallDiscount: 0, items: [{ id: "i118-1", item: "Optical Microscope MX-5", description: "Optical microscope with 5 MP imaging", hsn: "9011", quantity: 1, rate: 215000, gst: 18, stockCode: "INS-0042" }], sentAt: "20 Aug 2026", activities: [{ title: "Invoice sent to Rhea Mehta", meta: "20 Aug 2026 · Arun Kumar", tone: "sent" }] },
  { id: "INV-2026-0117", number: "INV-2026-0117", customer: "Arka Diagnostics", contact: "Meera Nair", customerGstin: "29AAECA5512M1Z3", customerState: "Karnataka", billingAddress: "44, Peenya Industrial Area, Bengaluru, Karnataka 560058", shippingAddress: "44, Peenya Industrial Area, Bengaluru, Karnataka 560058", paymentTerms: "Net 30", invoiceDate: "2026-08-05", dueDate: "2026-09-04", status: "Sent", invoiceType: "Sales", poNumber: "ARK/PO/2026/061", poDate: "2026-08-02", deliveryNote: "", vehicleNumber: "", placeOfSupply: "Karnataka", irn: "", ewayBill: "", freightCharges: 0, overallDiscount: 0, items: [{ id: "i117-1", item: "AFM probe tips — 10 pack", description: "Consumable AFM probe tips, pack of 10", hsn: "9012", quantity: 4, rate: 18500, gst: 18, stockCode: "INS-0118" }], sentAt: "05 Aug 2026", activities: [{ title: "Invoice sent to Meera Nair", meta: "05 Aug 2026 · Priya Shah", tone: "sent" }] },
  { id: "INV-2026-0116", number: "INV-2026-0116", customer: "Tera Research", contact: "Sana Iyer", customerGstin: "33AABCT6281H1ZA", customerState: "Tamil Nadu", billingAddress: "21, OMR Road, Thoraipakkam, Chennai, Tamil Nadu 600097", shippingAddress: "Surface Science Lab, OMR Road, Chennai, Tamil Nadu 600097", paymentTerms: "Net 30", invoiceDate: "2026-09-10", dueDate: "2026-10-10", status: "Sent", invoiceType: "Sales", poNumber: "TR/PO/2026/119", poDate: "2026-09-10", deliveryNote: "DN-4460", vehicleNumber: "", placeOfSupply: "Tamil Nadu", irn: "", ewayBill: "", freightCharges: 0, overallDiscount: 0, items: [{ id: "i116-1", item: "Surface Profilometer", description: "Surface profilometer, standard measurement package", hsn: "9027", quantity: 1, rate: 1090000, gst: 18 }, { id: "i116-2", item: "On-site commissioning", description: "Installation and commissioning", hsn: "9987", quantity: 1, rate: 130000, gst: 18 }], sentAt: "10 Sep 2026", fromQuote: "QT-2026-0827 R1", orderRef: "ORD-2026-0500", activities: [{ title: "Part payment received ₹7,00,000", meta: "12 Sep 2026 · Arun Kumar", tone: "paid" }, { title: "Invoice sent to Sana Iyer", meta: "10 Sep 2026 · Priya Shah", tone: "sent" }] },
  { id: "INV-2026-0115", number: "INV-2026-0115", customer: "Helix Labs", contact: "Kiran Rao", customerGstin: "36AABCH2119P1Z5", customerState: "Telangana", billingAddress: "Plot 7, Genome Valley, Hyderabad, Telangana 500078", shippingAddress: "Plot 7, Genome Valley, Hyderabad, Telangana 500078", paymentTerms: "Net 15", invoiceDate: "2026-08-28", dueDate: "2026-09-12", status: "Sent", invoiceType: "Service", poNumber: "HL/PO/2026/443", poDate: "2026-08-26", deliveryNote: "", vehicleNumber: "", placeOfSupply: "Telangana", irn: "", ewayBill: "", freightCharges: 0, overallDiscount: 0, items: [{ id: "i115-1", item: "Annual maintenance contract", description: "AMC for optical microscopy bench, 12 months", hsn: "9987", quantity: 1, rate: 145000, gst: 18 }], sentAt: "28 Aug 2026", activities: [{ title: "Payment received in full", meta: "09 Sep 2026 · Arun Kumar", tone: "paid" }, { title: "Invoice sent to Kiran Rao", meta: "28 Aug 2026 · Arun Kumar", tone: "sent" }] },
  { id: "INV-2026-0114", number: "INV-2026-0114", customer: "Vector Bio Labs", contact: "Nikhil Arora", customerGstin: "27AABCV8041G1ZQ", customerState: "Maharashtra", billingAddress: "88, MIDC Andheri East, Mumbai, Maharashtra 400093", shippingAddress: "88, MIDC Andheri East, Mumbai, Maharashtra 400093", paymentTerms: "Net 45", invoiceDate: "2026-09-15", dueDate: "2026-10-30", status: "Draft", invoiceType: "Sales", poNumber: "", poDate: "", deliveryNote: "", vehicleNumber: "", placeOfSupply: "Maharashtra", irn: "", ewayBill: "", freightCharges: 0, overallDiscount: 0, items: [{ id: "i114-1", item: "Digital temperature controller", description: "PID digital temperature controller", hsn: "9032", quantity: 2, rate: 128500, gst: 18 }], activities: [{ title: "Draft created", meta: "15 Sep 2026 · Priya Shah", tone: "system" }] },
  { id: "INV-2026-0113", number: "INV-2026-0113", customer: "Helix Labs", contact: "Kiran Rao", customerGstin: "36AABCH2119P1Z5", customerState: "Telangana", billingAddress: "Plot 7, Genome Valley, Hyderabad, Telangana 500078", shippingAddress: "Plot 7, Genome Valley, Hyderabad, Telangana 500078", paymentTerms: "Net 15", invoiceDate: "2026-08-20", dueDate: "2026-09-04", status: "Cancelled", invoiceType: "Sales", poNumber: "", poDate: "", deliveryNote: "", vehicleNumber: "", placeOfSupply: "Telangana", irn: "", ewayBill: "", freightCharges: 0, overallDiscount: 0, items: [{ id: "i113-1", item: "Vacuum seal kit", description: "Vacuum seal maintenance kit", hsn: "8484", quantity: 3, rate: 12400, gst: 18 }], sentAt: "20 Aug 2026", activities: [{ title: "Invoice cancelled — duplicate of INV-2026-0112", meta: "22 Aug 2026 · Arun Kumar", tone: "system" }] },
];

// AMC / service contracts. NOT USED BY ANY SCREEN RIGHT NOW — the Due Dates AMC tab and its
// due items were removed. Kept, with its seed and schedule generator, so AMC can be brought
// back without rebuilding it. Delete this block if that decision becomes final.
export type AmcStatus = "Active" | "Expiring" | "Expired";
export type AmcFrequency = "Monthly" | "Quarterly" | "Half-yearly" | "Yearly";
export type AmcVisit = { id: string; due: string; scheduled?: string; done?: string; engineer: string; notes: string; spares: { item: string; quantity: number }[]; proof?: string };
export type AmcContract = {
  id: string;
  number: string;
  customer: string;
  contact: string;
  equipment: string[];
  startDate: string;
  endDate: string;
  frequency: AmcFrequency;
  value: number;
  billing: string;
  terms: string;
  engineer: string;
  visits: AmcVisit[];
};

export const VISIT_MONTHS: Record<AmcFrequency, number> = { Monthly: 1, Quarterly: 3, "Half-yearly": 6, Yearly: 12 };

export function amcStatusFor(contract: AmcContract): AmcStatus {
  const left = dayDifference(contract.endDate);
  if (left < 0) return "Expired";
  return left <= 60 ? "Expiring" : "Active";
}
export function nextVisit(contract: AmcContract) { return contract.visits.find((visit) => !visit.done); }
export function visitsDone(contract: AmcContract) { return contract.visits.filter((visit) => visit.done).length; }
/** Visit dates generated from the frequency, start date to end date. */
export function generateVisits(startDate: string, endDate: string, frequency: AmcFrequency, engineer: string): AmcVisit[] {
  const months = VISIT_MONTHS[frequency];
  const end = new Date(`${endDate}T12:00`);
  const visits: AmcVisit[] = [];
  for (let index = 0; index < 48; index += 1) {
    const due = new Date(`${startDate}T12:00`);
    due.setMonth(due.getMonth() + months * (index + 1));
    if (due > end) break;
    visits.push({ id: `visit-${index + 1}`, due: due.toISOString().slice(0, 10), engineer, notes: "", spares: [] });
  }
  return visits;
}


// Reference standards (optional feature). SPM has not confirmed whether it needs a formal
// reference-standards register, so this is kept out of the default Stock UI entirely — the
// types and seed stay so the screen can come back without rebuilding it. Nothing here should
// claim accreditation or automatically flag customer instruments as affected.
export type Master = {
  id: string;
  name: string;
  serial: string;
  accuracy: string;
  intervalMonths: number;
  lab: string;
  lastCalibrated: string;
  certificate: string;
  sentOut?: { date: string; expectedReturn: string; lab: string };
};
export type StatutoryKind = "GST" | "TDS" | "PF/ESI";
export type StatutoryDue = { id: string; name: string; kind: StatutoryKind; dueDate: string; period: string; owner: string; note: string };
export type PaymentRecord = { amount: number; date: string; mode: string; reference: string };

export function masterNextDue(master: Master) { return addMonths(master.lastCalibrated, master.intervalMonths); }
export function masterExpired(master: Master) { return dayDifference(masterNextDue(master)) < 0; }
export function expiredMasters(masters: Master[]) { return masters.filter(masterExpired); }
/** How many active customer instruments cite this master — kept for when Reference Standards
 *  is switched back on; not surfaced in the default Stock/Jobs UI today. */
export function dependentsOf(masterId: string, instruments: CustomerInstrument[]) {
  return instruments.filter((item) => item.masterId === masterId && item.status === "Active").length;
}

/** The Indian compliance calendar. Generated, never typed by a user. */
export function statutoryDues(fromMonth: string): StatutoryDue[] {
  const [year, month] = fromMonth.split("-").map(Number);
  const period = new Date(year, month - 2, 1);
  const label = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(period);
  const on = (day: number) => `${fromMonth}-${String(day).padStart(2, "0")}`;
  const quarter = [1, 4, 7, 10].includes(month);
  const dues: StatutoryDue[] = [
    { id: `tds-${fromMonth}`, name: "TDS payment", kind: "TDS", dueDate: on(7), period: label, owner: "Arun Kumar", note: "Interest of 1.5% a month if late." },
    { id: `gstr1-${fromMonth}`, name: "GSTR-1 return", kind: "GST", dueDate: on(11), period: label, owner: "Arun Kumar", note: "Late fee ₹50 a day." },
    { id: `pf-${fromMonth}`, name: "PF and ESI", kind: "PF/ESI", dueDate: on(15), period: label, owner: "Priya Shah", note: "Damages and interest apply if late." },
    { id: `gstr3b-${fromMonth}`, name: "GSTR-3B return and GST payment", kind: "GST", dueDate: on(20), period: label, owner: "Arun Kumar", note: "Interest of 18% a year on the tax due." },
  ];
  if (quarter) dues.push({ id: `tdsq-${fromMonth}`, name: "TDS return (quarterly)", kind: "TDS", dueDate: on(31), period: `Quarter to ${label}`, owner: "Arun Kumar", note: "Late fee ₹200 a day." });
  return dues;
}

// ─── Accounts: Bills & Expenses (supplier bills, company bills and their payments) ─────
// One ledger for both a supplier's invoice and a recurring company bill — they differ only by
// category. A received Purchase Order's vendor bill is created here too, citing the PO for
// reference (poRef) and carrying the vendor's TDS rate/section so it can be deducted at payment.
export type PayableCategory = "Supplier Purchase" | "Rent" | "Electricity" | "Internet / Phone" | "Office Expense" | "Other";
export const PAYABLE_CATEGORIES: PayableCategory[] = ["Supplier Purchase", "Rent", "Electricity", "Internet / Phone", "Office Expense", "Other"];
export type PayablePaymentStatus = "Unpaid" | "Partly Paid" | "Paid";
export type Payable = {
  id: string; number?: string; payee: string; category: PayableCategory;
  billDate: string; dueDate: string; amount: number; description: string;
  attachment?: string; poRef?: string; recurringLabel?: string; clonedFrom?: string;
  tdsRate?: number; tdsSection?: string;
  createdBy: string; createdAt: string;
};
export type SupplierPayment = {
  id: string; billId: string; date: string; amount: number; mode: PaymentMode;
  reference?: string; notes?: string; tds?: number;
  recordedBy: string; recordedAt: string;
};

export function payableAppliedPayments(billId: string, payments: SupplierPayment[]) {
  return payments.filter((payment) => payment.billId === billId).reduce((sum, payment) => sum + payment.amount, 0);
}
export function payableTdsRecorded(billId: string, payments: SupplierPayment[]) {
  return payments.filter((payment) => payment.billId === billId).reduce((sum, payment) => sum + (payment.tds ?? 0), 0);
}
export function payableBalance(bill: Payable, payments: SupplierPayment[]) {
  return Math.max(bill.amount - payableAppliedPayments(bill.id, payments) - payableTdsRecorded(bill.id, payments), 0);
}
export function payablePaymentStatus(bill: Payable, payments: SupplierPayment[]): PayablePaymentStatus {
  const applied = payableAppliedPayments(bill.id, payments) + payableTdsRecorded(bill.id, payments);
  if (applied <= 0.005) return "Unpaid";
  return payableBalance(bill, payments) <= 0.005 ? "Paid" : "Partly Paid";
}
/** Same supplier, same bill number — a real warning worth surfacing, since re-keying the same
 *  bill twice is the most common way a payable gets duplicated. Never an automatic block. */
export function duplicateBillNumber(bills: Payable[], payee: string, number: string, excludeId?: string) {
  if (!number.trim()) return [];
  return bills.filter((bill) => bill.id !== excludeId && bill.payee === payee && (bill.number ?? "").trim().toLowerCase() === number.trim().toLowerCase());
}
export function duplicatePaymentReference(payments: SupplierPayment[], reference: string, excludeId?: string) {
  if (!reference.trim()) return [];
  return payments.filter((payment) => payment.id !== excludeId && payment.reference?.trim().toLowerCase() === reference.trim().toLowerCase());
}
export function addPayable(current: Store, bill: Payable, payment?: SupplierPayment): Partial<Store> {
  return { payables: [bill, ...current.payables], supplierPayments: payment ? [payment, ...current.supplierPayments] : current.supplierPayments };
}
export function recordSupplierPayment(current: Store, payment: SupplierPayment): Partial<Store> {
  return { supplierPayments: [payment, ...current.supplierPayments] };
}


// Customer-owned instruments we calibrate or service. Kept separate from Stock, which is
// SPM's own equipment. Covers instruments SPM sold (linked back to the internal equipment
// record) as well as instruments bought elsewhere that a customer sends in for service.
export type CalibrationRecord = { id: string; date: string; engineer: string; result: "Pass" | "Fail" | "Pass after adjustment"; certificate?: string; jobNumber: string };
export type CustodyEvent = { id: string; at: string; action: string; location: string; note?: string };
export type CustomerInstrument = {
  id: string;
  customer: string;
  siteId: string;
  department: string;
  name: string;
  make: string;
  model: string;
  serial: string;
  customerAssetId?: string;
  range: string;
  accuracy: string;
  intervalMonths?: number;
  procedure: string;
  masterId?: string;
  custody: "Customer site" | "In our lab" | "In transit";
  receivedAt?: string;
  condition?: string;
  relatedJob?: string;
  notes: string;
  status: "Active" | "Contract ended";
  history: CalibrationRecord[];
  lastCalibrationDate?: string;
  calibrationRecorded?: boolean;
  nextDueDate?: string;
  nextDueOverrideReason?: string;
  dueDateHistory?: { id: string; at: string; previousDate?: string; nextDate?: string; reason: string }[];
  certificateNumber?: string;
  certificateFile?: string;
  calibrationProvider?: string;
  internalEquipmentId?: string;
  saleRef?: string;
  custodyLog?: CustodyEvent[];
};

/** The latest calibration date we know of, from a manual entry/import or from job history —
 *  whichever is more recent. */
export function lastCalibrated(instrument: CustomerInstrument) {
  const fromHistory = instrument.history.map((entry) => entry.date).sort().at(-1);
  const manual = instrument.lastCalibrationDate;
  if (fromHistory && manual) return fromHistory > manual ? fromHistory : manual;
  return fromHistory ?? manual;
}
/** Next due comes from an explicit date (typed in, imported, or a corrected override) when one
 *  exists; otherwise it is worked out from the last calibration and the interval. It no longer
 *  requires a completed job in this system — an instrument can arrive with calibration history
 *  already known. */
export function nextDueFor(instrument: CustomerInstrument) {
  if (instrument.nextDueDate) return instrument.nextDueDate;
  const last = lastCalibrated(instrument);
  return last && instrument.intervalMonths && instrument.intervalMonths > 0 ? addMonths(last, instrument.intervalMonths) : undefined;
}
/** Duplicates are scoped to the same customer + site — a serial (or, lacking one, the same
 *  name and model) repeating there is the signal, not a global serial-number registry. */
export function findDuplicateInstrument(instruments: CustomerInstrument[], candidate: { id?: string; customer: string; siteId: string; serial: string; name: string; model: string }) {
  return instruments.find((entry) => entry.id !== candidate.id && entry.customer === candidate.customer && entry.siteId === candidate.siteId && (
    candidate.serial.trim()
      ? entry.serial.trim().toLowerCase() === candidate.serial.trim().toLowerCase()
      : entry.name.trim().toLowerCase() === candidate.name.trim().toLowerCase() && entry.model.trim().toLowerCase() === candidate.model.trim().toLowerCase()
  ));
}
/** After a completed equipment sale: mark the unit sold and off available stock, and create or
 *  link its Customer Instrument record. Checked by internalEquipmentId so calling this twice
 *  for the same unit (e.g. from two screens) never creates a second record. */
export function recordEquipmentSale(current: Store, individualId: string, input: { customer: string; siteId: string; saleRef: string; department?: string }): Partial<Store> {
  const item = current.individuals.find((entry) => entry.id === individualId);
  if (!item) return {};
  const individuals = current.individuals.map((entry) => entry.id === individualId ? { ...entry, holder: "Customer" as const, currentWith: input.customer, opStatus: "Sold" as const, saleRef: input.saleRef } : entry);
  const already = current.instruments.find((entry) => entry.internalEquipmentId === individualId);
  if (already) return { individuals };
  const nextId = `CI-${String(Math.max(100, ...current.instruments.map((entry) => Number(entry.id.split("-").at(-1)) || 0)) + 1).padStart(4, "0")}`;
  const instrument: CustomerInstrument = {
    id: nextId, customer: input.customer, siteId: input.siteId, department: input.department ?? "",
    name: item.name, make: "", model: item.model, serial: item.serial,
    range: "", accuracy: "", intervalMonths: JOB_SETTINGS.defaultCalibrationMonths, procedure: "",
    custody: "Customer site", notes: `Created automatically from the sale of ${item.id} (${input.saleRef}).`,
    status: "Active", history: [], internalEquipmentId: individualId, saleRef: input.saleRef, calibrationRecorded: false,
  };
  return { individuals, instruments: [instrument, ...current.instruments] };
}
/** Selected instruments grouped by customer + site — the unit a single visit can cover. Two
 *  instruments in the same city but different sites are not one trip. */
export function groupInstrumentsBySite(instruments: CustomerInstrument[]) {
  const groups = new Map<string, CustomerInstrument[]>();
  instruments.forEach((item) => {
    const key = `${item.customer}||${item.siteId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  return [...groups.values()];
}

export type JobType = "Calibration" | "Repair" | "Validation/Testing" | "Install";
// Billing ("Invoiced") is tracked separately via `invoiceNumber` — a Completed job stays
// Completed whether or not it has been invoiced yet. See invoiceStatusOf() below.
export type JobStatus = "Unassigned" | "Scheduled" | "In progress" | "On hold" | "Completed" | "Cancelled";
export type JobResult = { instrumentId: string; asFound: string; asLeft: string; outcome: "Pass" | "Fail" | "Pass after adjustment"; readings: string; remarks: string };
export type JobActivity = { title: string; meta: string; tone?: "system" | "assigned" | "done" };

// Location check on a site check-in/out. Low-accuracy or missing coordinates never present as
// verified attendance — they land in "Location unavailable" or "Needs review" instead.
export type LocationCheck = "Within site area" | "Outside site area" | "Location unavailable" | "Needs review";
export type GeoPoint = { lat: number; lng: number; accuracyM: number };
/** A single check-in or check-out on a job's one visit — event-based, not continuous tracking. */
export type VisitStamp = { at: string; syncedAt: string; source: "Mobile" | "Manual correction"; location?: GeoPoint; siteDistanceM?: number; locationCheck: LocationCheck };
export type VisitStatus = "Scheduled" | "Check-in not received" | "On site" | "Checked out" | "Cancelled";
export type VisitOutcome = "Work completed" | "Partially completed" | "Customer unavailable" | "Follow-up required";

export type Job = {
  id: string;
  number: string;
  type: JobType;
  customer: string;
  siteId: string;
  instrumentIds: string[];
  stockIds: string[];
  description: string;
  doneAt: "In-lab" | "Site visit";
  scheduledDate: string;
  requiredDate?: string;
  plannedStart?: string; // "HH:MM" 24h — the one scheduled time
  hours: number; // estimated duration, used to derive the end of the visit window
  engineer?: string;
  status: JobStatus;
  expectedSpares: { item: string; quantity: number }[];
  usedSpares: { item: string; quantity: number }[];
  results: JobResult[];
  travelNotes: string;
  signature?: string;
  photos: number;
  startedAt?: string;
  completedAt?: string;
  invoiceNumber?: string;
  orderRef?: string;
  activities: JobActivity[];
  // Actual attendance on the visit — status (Scheduled/On site/...) is always derived from
  // these plus the clock (see computeVisitStatus), never stored, so it can't go stale.
  checkIn?: VisitStamp;
  checkOut?: VisitStamp;
  outcome?: VisitOutcome;
  outcomeNote?: string;
  remainingWork?: string;
  onHoldReason?: string;
  cancelReason?: string;
  // In-lab custody: the instrument is received onto SPM's premises, worked on, then returned
  // to the customer with a Delivery Challan. Only meaningful when doneAt === "In-lab".
  receivedAt?: string;
  receivedCondition?: string;
  returnedAt?: string;
  returnDc?: string;
  // Calibration/Validation completion: reference standards used (blocked if any is out of its
  // own calibration — see masterExpired) and the certificate that closed the job out.
  mastersUsed?: string[];
  certificateNumber?: string;
  certificateFile?: string;
  certificateGeneratedAt?: string;
};

export function visitWindow(job: Pick<Job, "plannedStart" | "hours">) {
  const start = job.plannedStart ?? "09:30";
  return { start, end: minutesToTime(timeToMinutes(start) + Math.max(0, job.hours) * 60) };
}
/** A job already covering this instrument, so Due Dates and Customer Instruments can say so
 *  without opening anything, and can offer it instead of creating a duplicate. */
export function openJobFor(jobs: Job[], instrumentId: string) {
  return jobs.find((job) => job.instrumentIds.includes(instrumentId) && job.status !== "Completed" && job.status !== "Cancelled");
}
/** Billing is a separate axis from job status — a Completed job is "To invoice" until an
 *  invoice number is attached, then "Invoiced". Never changes job.status. */
export function billingStatusOf(job: Job): "Not applicable" | "To invoice" | "Invoiced" {
  if (job.status !== "Completed") return "Not applicable";
  return job.invoiceNumber ? "Invoiced" : "To invoice";
}
/** A job's one visit is resolved (eligible to be marked Completed) once its outcome is a
 *  resolved one — a pending follow-up or partial visit blocks job completion. */
export function jobFullyResolved(job: Job) {
  return job.outcome === "Work completed" || job.outcome === "Customer unavailable";
}

/** In-lab jobs only: the instrument arrives at SPM's premises — recorded with its condition on
 *  receipt, same as any other custody change (see CustomerInstruments' custody field). */
export function receiveInLabJob(current: Store, jobId: string, condition: string, date: string): Partial<Store> {
  const job = current.jobs.find((entry) => entry.id === jobId);
  if (!job) return {};
  const log: CustodyEvent = { id: `cl-${Date.now()}`, at: stamp(), action: "Received at SPM lab", location: "SPM Lab Solutions", note: condition };
  const instruments = current.instruments.map((item) => job.instrumentIds.includes(item.id) ? { ...item, custody: "In our lab" as const, receivedAt: date, condition, custodyLog: [log, ...(item.custodyLog ?? [])] } : item);
  const jobs = current.jobs.map((entry) => entry.id !== jobId ? entry : { ...entry, receivedAt: date, receivedCondition: condition, activities: [{ title: `Instrument received — condition: ${condition}`, meta: stamp(), tone: "system" as const }, ...entry.activities] });
  return { instruments, jobs };
}
/** In-lab jobs only: hands the instrument back once work is done, creating one Delivery Challan
 *  for everything on the job — the same document any other stock leaving the office gets. */
export function returnInLabJob(current: Store, jobId: string, date: string): Partial<Store> {
  const job = current.jobs.find((entry) => entry.id === jobId);
  if (!job) return {};
  const targets = current.instruments.filter((item) => job.instrumentIds.includes(item.id));
  if (!targets.length) return {};
  const log: CustodyEvent = { id: `cl-${Date.now()}-r`, at: stamp(), action: "Returned to customer", location: job.customer };
  const instruments = current.instruments.map((item) => job.instrumentIds.includes(item.id) ? { ...item, custody: "Customer site" as const, receivedAt: undefined, condition: undefined, custodyLog: [log, ...(item.custodyLog ?? [])] } : item);
  const dcPatch = addDeliveryChallan({ ...current, instruments }, { customer: job.customer, siteId: job.siteId, reason: "Return", reference: job.number, date, lines: targets.map((item) => ({ description: item.name, serial: item.serial, quantity: 1 })) });
  const jobs = current.jobs.map((entry) => entry.id !== jobId ? entry : { ...entry, returnedAt: date, returnDc: dcPatch.deliveryChallans![0].number, activities: [{ title: `Returned to customer · ${dcPatch.deliveryChallans![0].number}`, meta: stamp(), tone: "system" as const }, ...entry.activities] });
  return { instruments, ...dcPatch, jobs };
}

// Leave, training blocks and holidays — the read-model Attendance uses to say who is
// unavailable on a given day. Approving a leave never silently cancels a job; it only flags
// the jobs it now conflicts with.
export type LeaveKind = "Leave" | "Training";
export type LeaveStatus = "Pending" | "Approved" | "Rejected";
export type LeaveRequest = {
  id: string; engineer: string; kind: LeaveKind; fromDate: string; toDate: string; halfDay?: boolean;
  reason: string; status: LeaveStatus; appliedAt: string; reviewer?: string; reviewedAt?: string;
};
export type Holiday = { id: string; date: string; name: string };
export function leaveDates(leave: Pick<LeaveRequest, "fromDate" | "toDate">) {
  const out: string[] = []; let day = leave.fromDate;
  while (day <= leave.toDate) { out.push(day); day = addDaysIso(day, 1); }
  return out;
}
export type BlockedInfo = { reason: string; kind: LeaveKind | "Holiday" | "Weekly off"; halfDay: boolean };
export function blockedOn(leaves: LeaveRequest[], holidays: Holiday[], engineer: string, date: string): BlockedInfo | undefined {
  const holiday = holidays.find((entry) => entry.date === date);
  if (holiday) return { reason: holiday.name, kind: "Holiday", halfDay: false };
  const leave = leaves.find((entry) => entry.status === "Approved" && entry.engineer === engineer && leaveDates(entry).includes(date));
  if (leave) return { reason: leave.halfDay ? `${leave.kind} (half day)` : leave.kind, kind: leave.kind, halfDay: Boolean(leave.halfDay) };
  if (isWeeklyOff(date)) return { reason: "Weekly off", kind: "Weekly off", halfDay: false };
  return undefined;
}
/** Existing, still-open assignments that a newly approved leave now conflicts with — shown as a
 *  warning to resolve by hand, never auto-cancelled. */
export function affectedJobsForLeave(jobs: Job[], leave: LeaveRequest) {
  const dates = leaveDates(leave);
  return jobs.filter((job) => job.status !== "Completed" && job.status !== "Cancelled" && job.engineer === leave.engineer && dates.includes(job.scheduledDate));
}

// Attendance: office (biometric) and site (mobile) events.
export type AttendanceEventKind = "Office check-in" | "Office checkout" | "Site check-in" | "Site checkout";
export type AttendanceEventSource = "Biometric" | "Mobile" | "Manual correction";
export type AttendanceEvent = {
  id: string; engineer: string; date: string; kind: AttendanceEventKind; source: AttendanceEventSource;
  at: string; syncedAt: string; jobId?: string; siteId?: string;
  location?: GeoPoint; siteDistanceM?: number; locationCheck?: LocationCheck;
  sourceEventId?: string;
};
export function eventsFor(events: AttendanceEvent[], engineer: string, date: string) {
  return events.filter((event) => event.engineer === engineer && event.date === date).sort((a, b) => a.at.localeCompare(b.at));
}
export type AttendanceStatus = "Present" | "On leave" | "Training" | "Holiday" | "Weekly off" | "Upcoming" | "No activity recorded";
/** Never infers absence/half-day/overtime from incomplete events — recorded activity always
 *  wins, and the neutral fallback is "no activity recorded", not "absent". */
export function attendanceStatusFor(events: AttendanceEvent[], leaves: LeaveRequest[], holidays: Holiday[], engineer: string, date: string): AttendanceStatus {
  if (eventsFor(events, engineer, date).length) return "Present";
  const blocked = blockedOn(leaves, holidays, engineer, date);
  if (blocked?.kind === "Holiday") return "Holiday";
  if (blocked?.kind === "Training") return "Training";
  if (blocked?.kind === "Weekly off") return "Weekly off";
  if (blocked) return "On leave";
  if (date > dateIso()) return "Upcoming";
  return "No activity recorded";
}
function newEventId() { return `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
/** Dedupe key for a re-imported biometric batch: same device event id for the same engineer
 *  never creates a second row. */
export function isDuplicateBiometric(events: AttendanceEvent[], sourceEventId: string) {
  return events.some((event) => event.source === "Biometric" && event.sourceEventId === sourceEventId);
}
export function recordAttendanceEvent(current: Store, input: Omit<AttendanceEvent, "id" | "date"> & { date?: string }): Partial<Store> {
  if (input.sourceEventId && isDuplicateBiometric(current.attendance, input.sourceEventId)) return {};
  const event: AttendanceEvent = { ...input, id: newEventId(), date: input.date ?? isoDateInIst(input.at) };
  return { attendance: [event, ...current.attendance] };
}

// Demo-only mechanism for simulating what the (not-yet-built) mobile app and office biometric
// device would send. Kept as an explicit, separately-labelled mechanism per SPM's requirement —
// never wired into normal planner/engineer buttons.
export function demoLocationStamp(preset: "within" | "outside" | "unavailable", site: { lat?: number; lng?: number } | undefined, at: string, syncedAt: string, source: "Mobile" | "Manual correction"): VisitStamp {
  if (preset === "unavailable" || site?.lat === undefined || site?.lng === undefined) return { at, syncedAt, source, locationCheck: "Location unavailable" };
  const offsetM = preset === "within" ? 30 : ATTENDANCE_SETTINGS.siteRadiusMetersDemo + 500;
  const location: GeoPoint = { lat: site.lat + offsetM / 111_000, lng: site.lng, accuracyM: 14 };
  const siteDistanceM = metersBetween(location, { lat: site.lat, lng: site.lng });
  return { at, syncedAt, source, location, siteDistanceM, locationCheck: siteDistanceM <= ATTENDANCE_SETTINGS.siteRadiusMetersDemo ? "Within site area" : "Outside site area" };
}
/** Writes a check-in/out onto a job's one visit, and — for a real (non-cancelled) visit —
 *  mirrors it into the Attendance timeline as a Site event, so the two stay consistent by
 *  construction rather than by convention. */
export function applyVisitStamp(current: Store, jobId: string, kind: "checkIn" | "checkOut", stampValue: VisitStamp): Partial<Store> {
  const job = current.jobs.find((entry) => entry.id === jobId);
  if (!job) return {};
  const engineer = job.engineer;
  const jobs = current.jobs.map((entry) => entry.id === jobId ? { ...entry, [kind]: stampValue } : entry);
  if (!engineer) return { jobs };
  const attendancePatch = recordAttendanceEvent(current, {
    engineer, kind: kind === "checkIn" ? "Site check-in" : "Site checkout", source: stampValue.source, at: stampValue.at, syncedAt: stampValue.syncedAt,
    jobId, siteId: job.siteId, location: stampValue.location, siteDistanceM: stampValue.siteDistanceM, locationCheck: stampValue.locationCheck,
  });
  return { jobs, ...attendancePatch };
}

// Corrections: a simple request-and-review trail against one attendance event — what the
// employee says it should be, why, and the admin's one decision. No categorisation, no
// re-decision history; approving never rewrites the attendance timeline by itself.
export type CorrectionStatus = "Pending" | "Approved" | "Rejected";
export type Correction = {
  id: string; eventId: string; engineer: string; requestedChange: string; reason: string;
  status: CorrectionStatus; requestedBy: string; requestedAt: string; reviewer?: string; reviewedAt?: string;
  decisionReason?: string;
};
export function reviewCorrection(current: Store, correctionId: string, status: "Approved" | "Rejected", reviewer: string, reason?: string): Partial<Store> {
  if (status === "Rejected" && !reason?.trim()) return {};
  return { corrections: current.corrections.map((entry) => entry.id === correctionId && entry.status === "Pending" ? { ...entry, status, reviewer, reviewedAt: nowIso(), decisionReason: reason?.trim() || undefined } : entry) };
}

/** A missing check-in is never treated as proof of absence — "Check-in not received" only fires
 *  once the planned start time plus an explicit demo grace period has passed. */
export function computeVisitStatus(visit: { plannedDate: string; plannedStart: string; checkIn?: VisitStamp; checkOut?: VisitStamp; cancelled?: boolean }, nowIsoValue: string): VisitStatus {
  if (visit.cancelled) return "Cancelled";
  if (visit.checkOut) return "Checked out";
  if (visit.checkIn) return "On site";
  const plannedAt = new Date(`${visit.plannedDate}T${visit.plannedStart}:00+05:30`).getTime();
  if (new Date(nowIsoValue).getTime() > plannedAt + ATTENDANCE_SETTINGS.lateGraceMinutesDemo * 60_000) return "Check-in not received";
  return "Scheduled";
}
/** One row per job scheduled on a given day — the backbone of Jobs → Today. */
export type VisitRow = {
  jobId: string; jobNumber: string; jobType: JobType; customer: string; siteId: string;
  engineer: string; plannedDate: string; plannedStart: string; plannedEnd: string;
  visitStatus: VisitStatus; checkIn?: VisitStamp; checkOut?: VisitStamp;
  outcome?: VisitOutcome; jobStatus: JobStatus;
};
export function visitsOn(jobs: Job[], date: string, nowIsoValue: string = nowIso()): VisitRow[] {
  const rows: VisitRow[] = [];
  jobs.forEach((job) => {
    if (!job.engineer || job.scheduledDate !== date) return;
    const window = visitWindow(job);
    rows.push({
      jobId: job.id, jobNumber: job.number, jobType: job.type, customer: job.customer, siteId: job.siteId, engineer: job.engineer,
      plannedDate: date, plannedStart: window.start, plannedEnd: window.end,
      visitStatus: computeVisitStatus({ plannedDate: date, plannedStart: window.start, checkIn: job.checkIn, checkOut: job.checkOut, cancelled: job.status === "Cancelled" }, nowIsoValue),
      checkIn: job.checkIn, checkOut: job.checkOut, outcome: job.outcome, jobStatus: job.status,
    });
  });
  return rows.sort((a, b) => timeToMinutes(a.plannedStart) - timeToMinutes(b.plannedStart));
}

// Advance & Expense — engineer cash advances, their expense claims and the settlement
// payments against them. Deliberately separate from CompanyBill (office/company expenses):
// these are person-linked claims, not vendor bills, and must never be conflated in Accounts.
export type ExpenseCategory = "Travel" | "Food" | "Accommodation" | "Parking / Toll" | "Materials" | "Other";
export type ExpenseStatus = "Draft" | "Pending Approval" | "Approved" | "Rejected";
export const EXPENSE_CATEGORIES: ExpenseCategory[] = ["Travel", "Food", "Accommodation", "Parking / Toll", "Materials", "Other"];
export type ExpenseHistoryEntry = { action: string; at: string; by: string; reason?: string };
export type Expense = {
  id: string;
  engineer: string;
  submittedBy: string;
  expenseDate: string;
  category: ExpenseCategory;
  amount: number;
  description: string;
  billFiles: string[];
  billMissingReason?: string;
  jobId?: string;
  status: ExpenseStatus;
  submittedAt?: string;
  history: ExpenseHistoryEntry[];
};

export type PaymentKind = "Advance Paid" | "Reimbursement Paid" | "Money Returned";
export type SettlementMode = "Cash" | "UPI" | "Bank Transfer";
export type ExpensePayment = {
  id: string;
  engineer: string;
  type: PaymentKind;
  amount: number;
  date: string;
  mode: SettlementMode;
  reference?: string;
  jobId?: string;
  notes?: string;
  overrideReason?: string;
  recordedBy: string;
  recordedAt: string;
};

/** The one shared balance calculation. Positive = cash still with the engineer; negative =
 *  SPM owes a reimbursement; zero = settled. An advance is settled against approved claims
 *  only — a claim still pending or rejected never reduces it. */
export function engineerBalance(expenses: Expense[], payments: ExpensePayment[], engineer: string) {
  const paid = payments.filter((p) => p.engineer === engineer);
  const advancesPaid = paid.filter((p) => p.type === "Advance Paid").reduce((sum, p) => sum + p.amount, 0);
  const reimbursementsPaid = paid.filter((p) => p.type === "Reimbursement Paid").reduce((sum, p) => sum + p.amount, 0);
  const moneyReturned = paid.filter((p) => p.type === "Money Returned").reduce((sum, p) => sum + p.amount, 0);
  const mine = expenses.filter((e) => e.engineer === engineer);
  const approvedExpenses = mine.filter((e) => e.status === "Approved").reduce((sum, e) => sum + e.amount, 0);
  const pendingClaims = mine.filter((e) => e.status === "Pending Approval").reduce((sum, e) => sum + e.amount, 0);
  const balance = Math.round((advancesPaid + reimbursementsPaid - moneyReturned - approvedExpenses) * 100) / 100;
  return { advancesPaid, reimbursementsPaid, moneyReturned, approvedExpenses, pendingClaims, balance };
}
export function balanceStatus(balance: number, pendingClaims: number): "With engineer" | "To reimburse" | "Settled" | "Settled · claims pending" {
  if (balance > 0.005) return "With engineer";
  if (balance < -0.005) return "To reimburse";
  return pendingClaims > 0 ? "Settled · claims pending" : "Settled";
}
/** Same engineer, same date, same amount — a legitimate coincidence can happen, so this is a
 *  review warning, never an automatic block. */
export function duplicateExpenses(expenses: Expense[], candidate: Pick<Expense, "id" | "engineer" | "expenseDate" | "amount">) {
  return expenses.filter((e) => e.id !== candidate.id && e.engineer === candidate.engineer && e.expenseDate === candidate.expenseDate && e.amount === candidate.amount);
}
/** A reused transaction reference — flagged for review, not rejected, since references are
 *  not guaranteed globally unique across modes/engineers. */
export function duplicateReference(payments: ExpensePayment[], reference: string, excludeId?: string) {
  if (!reference.trim()) return [];
  return payments.filter((p) => p.id !== excludeId && p.reference?.trim().toLowerCase() === reference.trim().toLowerCase());
}

// Sales pipeline, ahead of a quotation existing. A lead's `stage` and a linked quotation's
// `status` are tracked separately — creating a quotation moves a lead to "Quoted" but the
// quotation itself still goes through its own Draft → Sent → Accepted workflow.
export type LeadStage = "New" | "Contacted" | "Quoted" | "Won" | "Lost";
export type LeadSource = "Website" | "Phone" | "WhatsApp" | "Email" | "Referral";
export type LeadActivity = { title: string; meta: string; tone?: "call" | "deal" | "lost" };
export type WonCustomerRef = { name: string; code: string };
export type Lead = {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  city: string;
  source: LeadSource;
  enquiry: string;
  stage: LeadStage;
  followUpAt?: string;
  assigned: string;
  auto?: boolean;
  interestedIn?: string;
  value?: string;
  decision?: string;
  customer?: WonCustomerRef;
  lostReason?: string;
  lostNote?: string;
  lostDate?: string;
  activities?: LeadActivity[];
};

type Store = {
  individuals: Individual[]; quantities: Quantity[]; orders: PurchaseOrder[]; moves: StockMove[]; invoices: Invoice[];
  contracts: AmcContract[]; masters: Master[]; statutoryPaid: Record<string, PaymentRecord>;
  snoozed: Record<string, string>; instruments: CustomerInstrument[]; jobs: Job[];
  leaves: LeaveRequest[]; holidays: Holiday[]; attendance: AttendanceEvent[]; corrections: Correction[];
  expenses: Expense[]; advancePayments: ExpensePayment[];
  customerReceipts: CustomerReceipt[]; customerTds: CustomerTds[];
  payables: Payable[]; supplierPayments: SupplierPayment[];
  leads: Lead[]; quotes: Quote[]; customers: Customer[]; customerOrders: CustomerOrder[];
  deliveryChallans: DeliveryChallan[];
  rentals: Rental[];
};

// ─── Advance & Expense actions ──────────────────────────────────────────────
export function submitExpense(current: Store, expense: Expense): Partial<Store> {
  return { expenses: [expense, ...current.expenses] };
}
export function reviewExpense(current: Store, expenseId: string, decision: "Approved" | "Rejected", reviewer: string, reason?: string): Partial<Store> {
  return { expenses: current.expenses.map((entry) => entry.id !== expenseId ? entry : {
    ...entry, status: decision,
    history: [...entry.history, { action: decision, at: stamp(), by: reviewer, reason }],
  }) };
}

let state: Store = {
  individuals: [
    { id: "INS-0042", name: "Airborne Particle Counter", model: "TSI AeroTrak 9306", serial: "9306-24-1842", category: "Instruments", holder: "Customer", currentWith: "Aster Pharma · Whitefield", opStatus: "In use", rentalCustomer: "Aster Pharma", rentalSiteId: "SITE-07", rentalReturnDue: "2026-09-24", rentalRef: "RENT-0241", calibrationDue: "2026-11-20", last: "15 Sep 2026" },
    { id: "INS-0043", name: "Airborne Particle Counter", model: "Lighthouse ApexZ3", serial: "AZ3-2025-071", category: "Instruments", holder: "Store", currentWith: WAREHOUSE, opStatus: "Available", calibrationDue: "2026-09-11", last: "02 Sep 2026" },
    { id: "INS-0044", name: "Aerosol Photometer", model: "ATI TDA-2i", serial: "TDA2I-39821", category: "Instruments", holder: "Engineer", currentWith: "Nikhil Rao", opStatus: "In use", calibrationDue: "2026-09-16", last: "12 Sep 2026" },
    { id: "INS-0045", name: "Aerosol Generator", model: "ATI TDA-6C", serial: "TDA6C-22108", category: "Instruments", holder: "Calibration/Repair", currentWith: "NABL CalLab Services", opStatus: "Awaiting calibration", calibrationDue: "2026-09-22", last: "01 Sep 2026" },
    { id: "INS-0046", name: "Portable Air Sampler", model: "Merck MAS-100 NT", serial: "MAS100-SPM-2201", category: "Instruments", holder: "Store", currentWith: WAREHOUSE, opStatus: "Available", calibrationDue: "2026-12-01", last: "10 Sep 2026" },
    // Sold and dispatched on ORD-2026-0498 — same shape recordEquipmentSale() produces.
    { id: "INS-0047", name: "Optical Microscope MX-5", model: "MX-5", serial: "MX5-2026-0091", category: "Instruments", holder: "Customer", currentWith: "Arka Diagnostics", opStatus: "Sold", saleRef: "ORD-2026-0498", last: "16 Sep 2026" },
  ],
  quantities: [
    { id: "CN-022", name: "Zero Count Filter", category: "Consumables", unit: "Nos", minimum: 20, balances: [{ location: WAREHOUSE, quantity: 12 }] },
    { id: "SP-017", name: "Isokinetic Probe Set", category: "Spares", unit: "Set", minimum: 4, balances: [{ location: WAREHOUSE, quantity: 12 }] },
    { id: "CN-091", name: "Air Sampler Petri Dish Adaptor", category: "Consumables", unit: "Nos", minimum: 10, balances: [{ location: WAREHOUSE, quantity: 5 }] },
    { id: "SP-033", name: "Vacuum seal kit", category: "Spares", unit: "Set", minimum: 30, balances: [{ location: WAREHOUSE, quantity: 43 }] },
  ],
  moves: [
    { id: "mv-1", date: "2026-08-01", at: "01 Aug 2026 · 10:00", action: "Opening stock", source: "Opening balance", destination: WAREHOUSE, quantity: 12, who: "Priya Shah", document: "OPEN-2026-01", item: "Zero Count Filter" },
    { id: "mv-2", date: "2026-08-01", at: "01 Aug 2026 · 10:05", action: "Opening stock", source: "Opening balance", destination: WAREHOUSE, quantity: 12, who: "Priya Shah", document: "OPEN-2026-01", item: "Isokinetic Probe Set" },
    { id: "mv-3", date: "2026-08-01", at: "01 Aug 2026 · 10:08", action: "Opening stock", source: "Opening balance", destination: WAREHOUSE, quantity: 5, who: "Priya Shah", document: "OPEN-2026-01", item: "Air Sampler Petri Dish Adaptor" },
    { id: "mv-4", date: "2026-09-02", at: "02 Sep 2026 · 11:40", action: "Purchase receipt", source: "Precision Systems India", destination: WAREHOUSE, quantity: 20, who: "Priya Shah", document: "PO-24091", item: "Vacuum seal kit" },
    { id: "mv-5", date: "2026-09-13", at: "13 Sep 2026 · 15:20", action: "Purchase receipt", source: "Precision Systems India", destination: WAREHOUSE, quantity: 25, who: "Priya Shah", document: "PO-24094", item: "Vacuum seal kit" },
    { id: "mv-6", date: "2026-09-05", at: "05 Sep 2026 · 09:20", action: "Send for calibration/repair", source: WAREHOUSE, destination: "NABL CalLab Services", equipmentId: "INS-0045", who: "Arun Kumar", document: "CAL-0918", item: "Aerosol Generator" },
    { id: "mv-7", date: "2026-09-15", at: "15 Sep 2026 · 10:28", action: "Issue on rent", source: WAREHOUSE, destination: "Aster Pharma · Whitefield", equipmentId: "INS-0042", who: "Arun Kumar", document: "RENT-0241", item: "Airborne Particle Counter" },
    { id: "mv-8", date: "2026-09-16", at: "16 Sep 2026 · 11:20", action: "Record Sale", source: WAREHOUSE, destination: "Arka Diagnostics", equipmentId: "INS-0047", who: "Arun Kumar", document: "ORD-2026-0498", item: "Optical Microscope MX-5" },
    { id: "mv-9", date: "2026-09-16", at: "16 Sep 2026 · 11:22", action: "Record Sale", source: WAREHOUSE, destination: "Arka Diagnostics", quantity: 2, who: "Arun Kumar", document: "ORD-2026-0498", item: "Vacuum seal kit" },
  ],
  invoices: seedInvoices,
  leaves: [
    { id: "LV-001", engineer: "Nikhil Rao", kind: "Leave", fromDate: "2026-09-18", toDate: "2026-09-18", reason: "Casual leave", status: "Approved", appliedAt: "15 Sep 2026 · Nikhil Rao", reviewer: "Priya Shah", reviewedAt: "15 Sep 2026" },
    { id: "LV-002", engineer: "Anitha Raj", kind: "Training", fromDate: "2026-09-17", toDate: "2026-09-17", reason: "Product training — new aerosol sampler line", status: "Approved", appliedAt: "10 Sep 2026 · Priya Shah", reviewer: "Priya Shah", reviewedAt: "10 Sep 2026" },
    { id: "LV-003", engineer: "Sandeep Kulkarni", kind: "Leave", fromDate: "2026-09-22", toDate: "2026-09-23", reason: "Family function", status: "Pending", appliedAt: "16 Sep 2026 · Sandeep Kulkarni" },
  ],
  holidays: [
    { id: "HOL-1", date: "2026-10-02", name: "Gandhi Jayanti" },
    { id: "HOL-2", date: "2026-09-25", name: "Company holiday" },
  ],
  attendance: [
    { id: "att-seed-1", engineer: "Nikhil Rao", date: "2026-09-17", kind: "Office check-in", source: "Biometric", at: "2026-09-17T03:20:00.000Z", syncedAt: "2026-09-17T03:20:00.000Z", sourceEventId: "BIO-0917-NR-IN" },
    { id: "att-seed-2", engineer: "Nikhil Rao", date: "2026-09-17", kind: "Office checkout", source: "Biometric", at: "2026-09-17T03:50:00.000Z", syncedAt: "2026-09-17T03:50:00.000Z", sourceEventId: "BIO-0917-NR-OUT" },
    { id: "att-seed-3", engineer: "Nikhil Rao", date: "2026-09-17", kind: "Site check-in", source: "Mobile", at: "2026-09-17T04:45:00.000Z", syncedAt: "2026-09-17T04:47:00.000Z", jobId: "JOB-1042", siteId: "SITE-07", location: { lat: 12.9701, lng: 77.7503, accuracyM: 12 }, siteDistanceM: 35, locationCheck: "Within site area" },
    { id: "att-seed-4", engineer: "Sandeep Kulkarni", date: "2026-09-16", kind: "Office check-in", source: "Biometric", at: "2026-09-16T03:25:00.000Z", syncedAt: "2026-09-16T03:25:00.000Z", sourceEventId: "BIO-0916-SK-IN" },
    { id: "att-seed-5", engineer: "Sandeep Kulkarni", date: "2026-09-16", kind: "Site check-in", source: "Mobile", at: "2026-09-16T04:30:00.000Z", syncedAt: "2026-09-16T04:31:00.000Z", jobId: "JOB-1044", siteId: "SITE-09", location: { lat: 12.9542, lng: 77.6465, accuracyM: 18 }, siteDistanceM: 850, locationCheck: "Outside site area" },
    { id: "att-seed-6", engineer: "Sandeep Kulkarni", date: "2026-09-16", kind: "Site checkout", source: "Mobile", at: "2026-09-16T07:00:00.000Z", syncedAt: "2026-09-16T07:01:00.000Z", jobId: "JOB-1044", siteId: "SITE-09", location: { lat: 12.9542, lng: 77.6465, accuracyM: 16 }, siteDistanceM: 850, locationCheck: "Outside site area" },
    // Occurred 18:40 IST on the 16th but only reached the server the next morning — the sync
    // gap is real; the original event time is preserved rather than shown as when it synced.
    { id: "att-seed-7", engineer: "Anitha Raj", date: "2026-09-16", kind: "Office check-in", source: "Biometric", at: "2026-09-16T13:10:00.000Z", syncedAt: "2026-09-17T02:35:00.000Z", sourceEventId: "BIO-0916-AR-IN-LATE" },
  ],
  corrections: [
    { id: "COR-001", eventId: "att-seed-4", engineer: "Sandeep Kulkarni", requestedChange: "Add missing office checkout at 06:10 PM", reason: "Forgot to badge out before leaving for the site visit.", status: "Pending", requestedBy: "Sandeep Kulkarni", requestedAt: "16 Sep 2026 · Sandeep Kulkarni" },
    { id: "COR-002", eventId: "att-seed-7", engineer: "Anitha Raj", requestedChange: "Confirm the check-in belongs to the 16th, not a duplicate of an earlier device sync.", reason: "Device showed the same badge twice within a few minutes on the offline log.", status: "Rejected", requestedBy: "Priya Shah", requestedAt: "16 Sep 2026 · Priya Shah", reviewer: "Arun Kumar", reviewedAt: "16 Sep 2026 · 5:40 PM", decisionReason: "Checked the device log — only one badge read was recorded. No change needed." },
    { id: "COR-003", eventId: "att-seed-1", engineer: "Nikhil Rao", requestedChange: "Link the 08:50 AM office check-in to JOB-1040, not left unlinked.", reason: "Office check-in that morning was for the urgent Biocon lab job, not a general day start.", status: "Approved", requestedBy: "Nikhil Rao", requestedAt: "17 Sep 2026 · Nikhil Rao", reviewer: "Arun Kumar", reviewedAt: "17 Sep 2026 · 9:05 AM" },
    { id: "COR-004", eventId: "att-seed-5", engineer: "Sandeep Kulkarni", requestedChange: "Confirm the check-in distance is expected — the registered site pin may be outdated.", reason: "Cloudnine's OT entrance is a short walk from where the GPS fix landed; the building pin looks off.", status: "Pending", requestedBy: "Sandeep Kulkarni", requestedAt: "16 Sep 2026 · Sandeep Kulkarni" },
  ],
  instruments: [
    { id: "CI-0101", customer: "Biocon Biologics", siteId: "SITE-08", department: "QC microbiology", name: "Airborne Particle Counter", make: "TSI", model: "AeroTrak 9306", serial: "9306-BC-22041", range: "0.3–10 μm · 28.3 LPM", accuracy: "±10% count accuracy", intervalMonths: 12, procedure: "ISO 14644-1 · SPM-WI-PC-01", custody: "In our lab", receivedAt: "2026-09-15", condition: "Good", notes: "Received for urgent annual calibration; audit copy requested.", status: "Active", history: [{ id: "cr-1", date: "2025-09-14", engineer: "Nikhil Rao", result: "Pass", certificate: "NABL/SPM/2025/0331", jobNumber: "JOB-1018" }] },
    { id: "CI-0102", customer: "Aster Pharma", siteId: "SITE-07", department: "Sterile manufacturing", name: "Airborne Particle Counter", make: "Lighthouse", model: "ApexZ3", serial: "AZ3-AP-08017", range: "0.3–10 μm · 28.3 LPM", accuracy: "±10% count accuracy", intervalMonths: 12, procedure: "ISO 14644-1 · SPM-WI-PC-01", custody: "Customer site", notes: "Grade B filling area.", status: "Active", history: [{ id: "cr-2", date: "2025-09-18", engineer: "Nikhil Rao", result: "Pass", certificate: "NABL/SPM/2025/0342", jobNumber: "JOB-1029" }] },
    { id: "CI-0103", customer: "Aster Pharma", siteId: "SITE-07", department: "Sterile manufacturing", name: "Airborne Particle Counter", make: "TSI", model: "AeroTrak 9310", serial: "9310-AP-11794", range: "0.3–10 μm · 28.3 LPM", accuracy: "±10% count accuracy", intervalMonths: 12, procedure: "ISO 14644-1 · SPM-WI-PC-01", custody: "Customer site", notes: "Grade C corridor.", status: "Active", history: [{ id: "cr-3", date: "2025-09-22", engineer: "Nikhil Rao", result: "Pass", certificate: "NABL/SPM/2025/0358", jobNumber: "JOB-1020" }] },
    { id: "CI-0104", customer: "Aster Pharma", siteId: "SITE-07", department: "Sterile manufacturing", name: "Airborne Particle Counter", make: "Lighthouse", model: "ApexR5", serial: "AR5-AP-09380", range: "0.3–10 μm · 28.3 LPM", accuracy: "±10% count accuracy", intervalMonths: 12, procedure: "ISO 14644-1 · SPM-WI-PC-01", custody: "Customer site", notes: "Grade D utility area.", status: "Active", history: [{ id: "cr-4", date: "2025-09-26", engineer: "Nikhil Rao", result: "Pass", certificate: "NABL/SPM/2025/0360", jobNumber: "JOB-1027" }] },
    { id: "CI-0105", customer: "Aster Pharma", siteId: "SITE-07", department: "HVAC validation", name: "Aerosol Photometer", make: "ATI", model: "TDA-2i", serial: "TDA2I-AP-8122", range: "0.01–100 μg/L", accuracy: "±5% of reading", intervalMonths: 12, procedure: "ISO 14644-3 · SPM-WI-HEPA-02", custody: "Customer site", notes: "HEPA integrity test unit.", status: "Active", history: [{ id: "cr-5", date: "2025-09-28", engineer: "Nikhil Rao", result: "Pass", certificate: "NABL/SPM/2025/0364", jobNumber: "JOB-1019" }] },
    { id: "CI-0106", customer: "Cloudnine Hospitals", siteId: "SITE-09", department: "OT infection control", name: "Portable Air Sampler", make: "Merck", model: "MAS-100 NT", serial: "MAS100-CN-1148", range: "100 LPM", accuracy: "±2.5% flow", intervalMonths: 12, procedure: "ISO 14698 · SPM-WI-AS-01", custody: "In transit", notes: "Pickup scheduled after theatre hours.", status: "Active", history: [{ id: "cr-6", date: "2025-10-10", engineer: "Anitha Raj", result: "Pass", certificate: "NABL/SPM/2025/0362", jobNumber: "JOB-1021" }] },
    { id: "CI-0107", customer: "Biocon Biologics", siteId: "SITE-08", department: "Environmental monitoring", name: "Aerosol Generator", make: "ATI", model: "TDA-6C", serial: "TDA6C-BC-5190", range: "10–100 μg/L", accuracy: "±5% output", intervalMonths: 12, procedure: "ISO 14644-3 · SPM-WI-HEPA-01", custody: "Customer site", notes: "Used with photometer for filter integrity testing.", status: "Active", history: [{ id: "cr-7", date: "2025-10-30", engineer: "Nikhil Rao", result: "Pass", certificate: "NABL/SPM/2025/0351", jobNumber: "JOB-1021" }] },
    { id: "CI-0108", customer: "Aster Pharma", siteId: "SITE-07", department: "Sterile manufacturing", name: "Zero Count Filter", make: "Lighthouse", model: "ZCF-28", serial: "ZCF-AP-4418", range: "0.3 μm zero check", accuracy: "Zero count verification", intervalMonths: 12, procedure: "SPM-WI-PC-02", custody: "Customer site", notes: "With APC fleet.", status: "Active", history: [{ id: "cr-8", date: "2026-04-05", engineer: "Nikhil Rao", result: "Pass", certificate: "NABL/SPM/2026/0176", jobNumber: "JOB-1033" }] },
    { id: "CI-0109", customer: "Nova Instruments", siteId: "SITE-01", department: "Materials lab", name: "Digital Weighing Balance", make: "Sartorius", model: "MSE225P", serial: "", customerAssetId: "NOVA-AST-118", range: "0–220 g", accuracy: "0.01 mg", intervalMonths: 6, procedure: "IS 1747 · SPM-WI-WB-01", custody: "Customer site", notes: "No manufacturer serial plate — identified by SPM internal tag.", status: "Active", history: [], lastCalibrationDate: "2026-04-02", certificateNumber: "EXT/NOVA/2026/041", calibrationProvider: "Outsourced · Precision Cal Labs", calibrationRecorded: true },
    { id: "CI-0110", customer: "Aster Pharma", siteId: "SITE-07", department: "Sterile manufacturing", name: "Non-Viable Airborne Particle Counter — Continuous Monitoring Node 4", make: "Lighthouse", model: "ApexZ50", serial: "AZ50-AP-11029", range: "0.3–25 μm · 50 LPM", accuracy: "±10% count accuracy", intervalMonths: 12, procedure: "ISO 14644-1 · SPM-WI-PC-01", custody: "Customer site", notes: "Networked node feeding the plant BMS.", status: "Active", history: [{ id: "cr-9", date: "2025-08-30", engineer: "Nikhil Rao", result: "Pass", certificate: "NABL/SPM/2025/0300", jobNumber: "JOB-1010" }] },
    { id: "CI-0111", customer: "Biocon Biologics", siteId: "SITE-08", department: "QC microbiology", name: "Microbial Air Sampler", make: "Merck", model: "MAS-100 Eco", serial: "MAS100E-BC-2207", range: "100 LPM", accuracy: "±2.5% flow", intervalMonths: 12, procedure: "ISO 14698 · SPM-WI-AS-01", custody: "Customer site", notes: "", status: "Active", history: [] },
    { id: "CI-0112", customer: "Biocon Biologics", siteId: "SITE-08", department: "Environmental monitoring", name: "Differential Pressure Gauge", make: "Dwyer", model: "Magnehelic 2000", serial: "DPG-BC-4471", range: "0–2000 Pa", accuracy: "±2% full scale", intervalMonths: 6, procedure: "SPM-WI-DP-01", custody: "Customer site", notes: "", status: "Active", history: [{ id: "cr-10", date: "2026-03-11", engineer: "Nikhil Rao", result: "Pass", certificate: "NABL/SPM/2026/0090", jobNumber: "JOB-1035" }] },
    { id: "CI-0113", customer: "Cloudnine Hospitals", siteId: "SITE-09", department: "OT infection control", name: "Fumigation Aerosol Generator", make: "Bioquell", model: "Q-10", serial: "BQ10-CN-3301", range: "35% w/w H2O2", accuracy: "Manufacturer spec", intervalMonths: 12, procedure: "SPM-WI-FUM-01", custody: "Customer site", notes: "", status: "Active", history: [] },
    { id: "CI-0114", customer: "Cloudnine Hospitals", siteId: "SITE-09", department: "OT infection control", name: "Anemometer", make: "Testo", model: "425", serial: "T425-CN-9012", range: "0–20 m/s", accuracy: "±0.03 m/s", intervalMonths: 12, procedure: "SPM-WI-AV-01", custody: "Customer site", notes: "", status: "Active", history: [{ id: "cr-11", date: "2025-07-19", engineer: "Anitha Raj", result: "Pass after adjustment", certificate: "NABL/SPM/2025/0250", jobNumber: "JOB-1005" }] },
    { id: "CI-0115", customer: "Nova Instruments", siteId: "SITE-02", department: "Materials lab", name: "Optical Microscope", make: "Olympus", model: "BX53", serial: "BX53-NV-6610", range: "40x–1000x", accuracy: "Manufacturer spec", intervalMonths: 24, procedure: "SPM-WI-OM-01", custody: "Customer site", notes: "", status: "Active", history: [] },
    { id: "CI-0116", customer: "Nova Instruments", siteId: "SITE-01", department: "QA lab", name: "AFM Probe Station", make: "Bruker", model: "Dimension Icon", serial: "DI-NV-1140", range: "Sub-nanometre", accuracy: "Manufacturer spec", intervalMonths: 12, procedure: "SPM-WI-AFM-01", custody: "Customer site", notes: "Returned to Nova after annual verification, JOB-1045.", status: "Active", history: [{ id: "cr-15", date: "2026-09-15", engineer: "Nikhil Rao", result: "Pass", certificate: "NABL/SPM/2026/0421", jobNumber: "JOB-1045" }, { id: "cr-12", date: "2025-09-05", engineer: "Nikhil Rao", result: "Pass", certificate: "NABL/SPM/2025/0295", jobNumber: "JOB-1009" }] },
    { id: "CI-0117", customer: "Helix Labs", siteId: "SITE-05", department: "Optical bench", name: "LED Ring Light Photometer", make: "ATI", model: "TDA-2i", serial: "TDA2I-HL-7701", range: "0.01–100 μg/L", accuracy: "±5% of reading", intervalMonths: 12, procedure: "ISO 14644-3 · SPM-WI-HEPA-02", custody: "Customer site", notes: "", status: "Active", history: [] },
    { id: "CI-0118", customer: "Helix Labs", siteId: "SITE-05", department: "Optical bench", name: "Digital Micrometer", make: "Mitutoyo", model: "MDC-25PX", serial: "", customerAssetId: "HL-EQ-0091", range: "0–25 mm", accuracy: "±1 μm", intervalMonths: 12, procedure: "SPM-WI-DM-01", custody: "Customer site", notes: "No manufacturer serial visible on the unit.", status: "Active", history: [] },
    { id: "CI-0119", customer: "Tera Research", siteId: "SITE-04", department: "Surface Science Lab", name: "Surface Profilometer", make: "Bruker", model: "Dektak XT", serial: "DXT-TR-2201", range: "±524 μm", accuracy: "±1% of reading", intervalMonths: 12, procedure: "SPM-WI-SP-01", custody: "Customer site", notes: "", status: "Active", history: [{ id: "cr-13", date: "2025-09-10", engineer: "Anitha Raj", result: "Pass", certificate: "NABL/SPM/2025/0310", jobNumber: "JOB-1012" }] },
    { id: "CI-0120", customer: "Tera Research", siteId: "SITE-04", department: "Surface Science Lab", name: "Precision Balance", make: "Mettler Toledo", model: "XPE205", serial: "XPE-TR-3390", range: "0–220 g", accuracy: "0.01 mg", intervalMonths: 6, procedure: "IS 1747 · SPM-WI-WB-01", custody: "Customer site", notes: "", status: "Active", history: [] },
    { id: "CI-0121", customer: "Vector Bio Labs", siteId: "SITE-06", department: "Andheri QC", name: "Digital Temperature Controller", make: "Eurotherm", model: "3216", serial: "ET3216-VB-5541", range: "-200 to 800 °C", accuracy: "±0.25% of reading", intervalMonths: 12, procedure: "SPM-WI-TC-01", custody: "Customer site", notes: "", status: "Active", history: [] },
    { id: "CI-0122", customer: "Vector Bio Labs", siteId: "SITE-06", department: "Andheri QC", name: "Portable pH Meter", make: "Hanna", model: "HI98191", serial: "HI98191-VB-0087", range: "0–14 pH", accuracy: "±0.02 pH", intervalMonths: 6, procedure: "SPM-WI-PH-01", custody: "Customer site", notes: "", status: "Contract ended", history: [{ id: "cr-14", date: "2025-03-02", engineer: "Nikhil Rao", result: "Pass", certificate: "NABL/SPM/2025/0110", jobNumber: "JOB-0987" }] },
    { id: "CI-0123", customer: "Arka Diagnostics", siteId: "SITE-03", department: "Peenya works", name: "Optical Microscope MX-5", make: "SPM", model: "MX-5", serial: "MX5-ARK-0044", range: "40x–1000x", accuracy: "Manufacturer spec", intervalMonths: 12, procedure: "SPM-WI-OM-01", custody: "Customer site", notes: "Sold unit, linked to INS-0043 batch.", status: "Active", history: [] },
    { id: "CI-0124", customer: "Arka Diagnostics", siteId: "SITE-03", department: "Peenya works", name: "Vacuum Sealed Enclosure Leak Tester", make: "ATEQ", model: "F620", serial: "F620-ARK-2214", range: "0–10 mbar/min", accuracy: "±1% full scale", intervalMonths: 12, procedure: "SPM-WI-LT-01", custody: "Customer site", notes: "", status: "Active", history: [] },
    { id: "CI-0125", customer: "Aster Pharma", siteId: "SITE-07", department: "HVAC validation", name: "Airflow Velocity Meter", make: "TSI", model: "VelociCalc 9565", serial: "VC9565-AP-6620", range: "0–50 m/s", accuracy: "±3% of reading", intervalMonths: 12, procedure: "ISO 14644-3 · SPM-WI-HEPA-02", custody: "Customer site", notes: "", status: "Active", history: [] },
    { id: "CI-0126", customer: "Biocon Biologics", siteId: "SITE-08", department: "QC microbiology", name: "Particle Counter — Backup Unit", make: "TSI", model: "AeroTrak 9110", serial: "9110-BC-0021", range: "0.3–10 μm · 2.83 LPM", accuracy: "±10% count accuracy", intervalMonths: 12, procedure: "ISO 14644-1 · SPM-WI-PC-01", custody: "In transit", notes: "Being moved between two QC labs; expected on site within the week.", status: "Active", history: [] },
    // Created automatically by the sale of INS-0047 on ORD-2026-0498 — same shape recordEquipmentSale() produces.
    { id: "CI-0127", customer: "Arka Diagnostics", siteId: "SITE-03", department: "", name: "Optical Microscope MX-5", make: "", model: "MX-5", serial: "MX5-2026-0091", range: "", accuracy: "", intervalMonths: 12, procedure: "", custody: "Customer site", notes: "Created automatically from the sale of INS-0047 (ORD-2026-0498).", status: "Active", history: [], internalEquipmentId: "INS-0047", saleRef: "ORD-2026-0498", calibrationRecorded: false },
  ],
  jobs: [
    { id: "JOB-1041", number: "JOB-1041", type: "Calibration", customer: "Aster Pharma", siteId: "SITE-07", instrumentIds: ["CI-0102", "CI-0103", "CI-0104", "CI-0105"], stockIds: [], description: "One Whitefield visit for three particle counters and one aerosol photometer. Rescheduled after the sterile manufacturing area was mid-batch on the first attempt.", doneAt: "Site visit", scheduledDate: "2026-09-21", plannedStart: "09:30", hours: 7, engineer: "Nikhil Rao", status: "Scheduled", expectedSpares: [{ item: "Zero Count Filter", quantity: 1 }], usedSpares: [], results: [], travelNotes: "Coordinate entry clearance with sterile manufacturing.", photos: 0, activities: [{ title: "Assigned as one site visit", meta: "16 Sep 2026 · Priya Shah", tone: "assigned" }] },
    { id: "JOB-1040", number: "JOB-1040", type: "Calibration", customer: "Biocon Biologics", siteId: "SITE-08", instrumentIds: ["CI-0101"], stockIds: [], description: "Urgent annual calibration of AeroTrak particle counter received in SPM lab.", doneAt: "In-lab", scheduledDate: "2026-09-16", plannedStart: "14:00", hours: 3, engineer: "Nikhil Rao", status: "In progress", expectedSpares: [], usedSpares: [], results: [], travelNotes: "Certificate required for audit file.", photos: 0, startedAt: "2026-09-16", receivedAt: "2026-09-15", receivedCondition: "Good — no visible damage", activities: [{ title: "Started in SPM lab", meta: "16 Sep 2026 · Nikhil Rao", tone: "system" }, { title: "Received from Biocon Biologics — condition: Good — no visible damage", meta: "15 Sep 2026 · Priya Shah", tone: "assigned" }] },
    { id: "JOB-1039", number: "JOB-1039", type: "Calibration", customer: "Cloudnine Hospitals", siteId: "SITE-09", instrumentIds: ["CI-0106"], stockIds: [], description: "Annual flow calibration for portable air sampler.", doneAt: "Site visit", scheduledDate: "2026-09-19", plannedStart: "09:30", hours: 4, status: "Unassigned", expectedSpares: [{ item: "Air Sampler Petri Dish Adaptor", quantity: 1 }], usedSpares: [], results: [], travelNotes: "Theatre access only after 18:00.", photos: 0, activities: [{ title: "Job created", meta: "15 Sep 2026 · Arun Kumar", tone: "system" }] },
    { id: "JOB-1042", number: "JOB-1042", type: "Calibration", customer: "Aster Pharma", siteId: "SITE-07", instrumentIds: [], stockIds: [], description: "Preventive check on cleanroom particle counters ahead of next month's audit.", doneAt: "Site visit", scheduledDate: "2026-09-17", plannedStart: "09:30", hours: 3, engineer: "Nikhil Rao", status: "In progress", startedAt: "2026-09-17", expectedSpares: [], usedSpares: [], results: [], travelNotes: "", photos: 0, checkIn: { at: "2026-09-17T04:45:00.000Z", syncedAt: "2026-09-17T04:47:00.000Z", source: "Mobile", locationCheck: "Within site area", location: { lat: 12.9701, lng: 77.7503, accuracyM: 12 }, siteDistanceM: 35 }, activities: [{ title: "Checked in at Whitefield sterile plant", meta: "17 Sep 2026 · 10:15 AM · Mobile", tone: "system" }, { title: "Assigned to Nikhil Rao", meta: "16 Sep 2026 · Priya Shah", tone: "assigned" }] },
    { id: "JOB-1043", number: "JOB-1043", type: "Calibration", customer: "Biocon Biologics", siteId: "SITE-08", instrumentIds: [], stockIds: [], description: "AMC preventive visit — aerosol generator check.", doneAt: "Site visit", scheduledDate: "2026-09-17", plannedStart: "09:30", hours: 3, engineer: "Sandeep Kulkarni", status: "Scheduled", expectedSpares: [], usedSpares: [], results: [], travelNotes: "", photos: 0, activities: [{ title: "Assigned to Sandeep Kulkarni", meta: "15 Sep 2026 · Priya Shah", tone: "assigned" }] },
    { id: "JOB-1044", number: "JOB-1044", type: "Repair", customer: "Cloudnine Hospitals", siteId: "SITE-09", instrumentIds: [], stockIds: [], description: "Portable air sampler flow fault — repaired on site.", doneAt: "Site visit", scheduledDate: "2026-09-16", plannedStart: "10:00", hours: 3, engineer: "Sandeep Kulkarni", status: "Completed", completedAt: "2026-09-16", expectedSpares: [], usedSpares: [], results: [], travelNotes: "", photos: 0, checkIn: { at: "2026-09-16T04:30:00.000Z", syncedAt: "2026-09-16T04:31:00.000Z", source: "Mobile", locationCheck: "Outside site area", location: { lat: 12.9542, lng: 77.6465, accuracyM: 18 }, siteDistanceM: 850 }, checkOut: { at: "2026-09-16T07:00:00.000Z", syncedAt: "2026-09-16T07:01:00.000Z", source: "Mobile", locationCheck: "Outside site area", location: { lat: 12.9542, lng: 77.6465, accuracyM: 16 }, siteDistanceM: 850 }, outcome: "Work completed", outcomeNote: "Replaced flow sensor; verified against reference standard.", activities: [{ title: "Completed — checked in away from the registered site coordinates", meta: "16 Sep 2026 · Sandeep Kulkarni", tone: "done" }, { title: "Assigned to Sandeep Kulkarni", meta: "14 Sep 2026 · Priya Shah", tone: "assigned" }] },
    // Website lead LD-1048 → QT-2026-0850 → ORD-2026-0502 → this job → certificate on CI-0116 → INV-2026-0119 → part payment RCP-005.
    { id: "JOB-1045", number: "JOB-1045", type: "Calibration", customer: "Nova Instruments", siteId: "SITE-01", instrumentIds: ["CI-0116"], stockIds: [], description: "Annual verification of AFM probe station ahead of the customer's audit.", doneAt: "In-lab", scheduledDate: "2026-09-14", plannedStart: "10:00", hours: 4, engineer: "Nikhil Rao", status: "Completed", startedAt: "2026-09-14", completedAt: "2026-09-15", receivedAt: "2026-09-10", receivedCondition: "Good, minor scuff on enclosure", returnedAt: "2026-09-15", returnDc: "DC-0001", invoiceNumber: "INV-2026-0119", orderRef: "ORD-2026-0502", expectedSpares: [], usedSpares: [], results: [], travelNotes: "", photos: 0, outcome: "Work completed", outcomeNote: "Verified against reference standard; certificate NABL/SPM/2026/0421 issued.", activities: [{ title: "Returned to customer · DC-0001", meta: "15 Sep 2026 · Nikhil Rao", tone: "system" }, { title: "Completed — certificate issued", meta: "15 Sep 2026 · Nikhil Rao", tone: "done" }, { title: "Received from Nova Instruments — condition: Good, minor scuff on enclosure", meta: "10 Sep 2026 · Priya Shah", tone: "assigned" }] },
  ],

  statutoryPaid: {},
  masters: [
    { id: "MST-01", name: "Reference Airborne Particle Counter", serial: "TSI-9310-REF-1124", accuracy: "±5% count accuracy", intervalMonths: 12, lab: "NABL Cleanroom Metrology Lab", lastCalibrated: "2025-09-14", certificate: "NABL/2025/PC-2441" },
    { id: "MST-02", name: "Reference Flow Calibrator", serial: "GIL-4140-6627", accuracy: "±1% of reading", intervalMonths: 12, lab: "NABL Flow Standards Lab", lastCalibrated: "2025-10-18", certificate: "NABL/2025/FL-9126" },
    { id: "MST-03", name: "Aerosol Photometer Reference Standard", serial: "ATI-2I-REF-3312", accuracy: "±3% of reading", intervalMonths: 12, lab: "NABL Cleanroom Metrology Lab", lastCalibrated: "2026-02-20", certificate: "NABL/2026/AP-1077" },
    { id: "MST-04", name: "Aerosol Generator Output Standard", serial: "ATI-6C-REF-5589", accuracy: "±5% output", intervalMonths: 12, lab: "NABL Cleanroom Metrology Lab", lastCalibrated: "2025-10-12", certificate: "NABL/2025/AG-6620" },
  ],
  snoozed: {},
  contracts: [
    { id: "AMC-2026-011", number: "AMC-2026-011", customer: "Nova Instruments", contact: "Rhea Mehta", equipment: ["INS-0042"], startDate: "2026-01-15", endDate: "2027-01-14", frequency: "Quarterly", value: 96000, billing: "Half-yearly in advance", terms: "Covers labour and travel. Spares billed separately at 10% discount.", engineer: "Nikhil Rao", visits: [
      { id: "visit-1", due: "2026-04-15", done: "2026-04-16", engineer: "Nikhil Rao", notes: "Routine check, cleaned optics.", spares: [], proof: "signed" },
      { id: "visit-2", due: "2026-07-15", done: "2026-07-18", engineer: "Nikhil Rao", notes: "Replaced vacuum seal.", spares: [{ item: "Vacuum seal kit", quantity: 1 }], proof: "signed" },
      { id: "visit-3", due: "2026-09-15", engineer: "Nikhil Rao", notes: "", spares: [] },
      { id: "visit-4", due: "2026-12-15", engineer: "Nikhil Rao", notes: "", spares: [] },
    ] },
    { id: "AMC-2026-008", number: "AMC-2026-008", customer: "Tera Research", contact: "Sana Iyer", equipment: ["INS-0038"], startDate: "2025-11-01", endDate: "2026-10-31", frequency: "Half-yearly", value: 72000, billing: "Yearly in advance", terms: "Two preventive visits a year.", engineer: "Nikhil Rao", visits: [
      { id: "visit-1", due: "2026-05-01", done: "2026-05-04", engineer: "Nikhil Rao", notes: "Calibration verified.", spares: [], proof: "photo" },
      { id: "visit-2", due: "2026-11-01", engineer: "Nikhil Rao", notes: "", spares: [] },
    ] },
    { id: "AMC-2025-042", number: "AMC-2025-042", customer: "Helix Labs", contact: "Kiran Rao", equipment: ["INS-0044"], startDate: "2025-09-01", endDate: "2026-08-31", frequency: "Quarterly", value: 60000, billing: "Quarterly in arrears", terms: "Labour only.", engineer: "Nikhil Rao", visits: [
      { id: "visit-1", due: "2025-12-01", done: "2025-12-02", engineer: "Nikhil Rao", notes: "", spares: [], proof: "signed" },
      { id: "visit-2", due: "2026-03-01", done: "2026-03-03", engineer: "Nikhil Rao", notes: "", spares: [], proof: "signed" },
      { id: "visit-3", due: "2026-06-01", done: "2026-06-05", engineer: "Nikhil Rao", notes: "", spares: [], proof: "signed" },
    ] },
  ],
  orders: [
    { id: "PO-24096", number: "PO-24096", vendor: "Bengaluru Lab Spares", contact: "Rakesh Gowda", vendorGstin: "29AAFCB9012L1ZR", vendorState: "Karnataka", vendorAddress: "17, Rajajinagar Industrial Town, Bengaluru, Karnataka 560010", paymentTerms: "Net 30", tdsSection: "194C", tdsRate: 1, orderDate: "2026-09-17", expectedDate: "2026-09-24", status: "Draft", owner: "Priya Shah", deliveryAddress: WAREHOUSE, freightCharges: 0, notes: "Created from the low-stock alert for Air Sampler Petri Dish Adaptor.", linkedOrder: "", items: [{ id: "po96-1", item: "Air Sampler Petri Dish Adaptor", description: "Consumable adaptor for portable air samplers", hsn: "3926", quantity: 30, rate: 145, gst: 18, stockId: "CN-091", received: 0, serials: [] }], receipts: [], activities: [{ title: "Draft created from low-stock alert", meta: "17 Sep 2026 · Priya Shah", tone: "system" }] },
    { id: "PO-24095", number: "PO-24095", vendor: "Bengaluru Lab Spares", contact: "Rakesh Gowda", vendorGstin: "29AAFCB9012L1ZR", vendorState: "Karnataka", vendorAddress: "17, Rajajinagar Industrial Town, Bengaluru, Karnataka 560010", paymentTerms: "Net 30", tdsSection: "194C", tdsRate: 1, orderDate: "2026-09-10", expectedDate: "2026-09-14", status: "Sent", owner: "Priya Shah", deliveryAddress: WAREHOUSE, freightCharges: 0, notes: "", linkedOrder: "", items: [{ id: "po95-1", item: "AFM probe tips — 10 pack", description: "Consumable AFM probe tips, pack of 10", hsn: "9012", quantity: 30, rate: 15800, gst: 18, received: 0, serials: [] }], receipts: [], sentAt: "10 Sep 2026", activities: [{ title: "Sent to Bengaluru Lab Spares", meta: "10 Sep 2026 · Priya Shah", tone: "sent" }] },
    { id: "PO-24094", number: "PO-24094", vendor: "Precision Systems India", contact: "Vikram Joshi", vendorGstin: "27AACCP1234F1Z8", vendorState: "Maharashtra", vendorAddress: "Plot 22, Bhosari MIDC, Pune, Maharashtra 411026", paymentTerms: "Net 30", tdsSection: "194C", tdsRate: 1, orderDate: "2026-09-06", expectedDate: "2026-09-20", status: "Partly received", owner: "Arun Kumar", deliveryAddress: WAREHOUSE, freightCharges: 4500, notes: "", linkedOrder: "ORD-2026-0500", items: [{ id: "po94-1", item: "Vacuum seal kit", description: "Vacuum seal maintenance kit", hsn: "8484", quantity: 40, rate: 9800, gst: 18, stockId: "SP-033", received: 25, serials: [] }, { id: "po94-2", item: "Optical lens cloth", description: "Lint-free optical lens cloth", hsn: "6307", quantity: 20, rate: 340, gst: 12, stockId: "CN-091", received: 0, serials: [] }], receipts: [{ id: "rc-1", date: "2026-09-13", location: WAREHOUSE, challan: "PSI/DC/8841", note: "", lines: [{ lineId: "po94-1", quantity: 25, serials: [] }] }], sentAt: "06 Sep 2026", activities: [{ title: "Received 25 of Vacuum seal kit", meta: "13 Sep 2026 · Priya Shah", tone: "received" }, { title: "Sent to Precision Systems India", meta: "06 Sep 2026 · Arun Kumar", tone: "sent" }] },
    { id: "PO-24093", number: "PO-24093", vendor: "Optika Instruments", contact: "Farah Sheikh", vendorGstin: "24AABCO4455N1ZV", vendorState: "Gujarat", vendorAddress: "9, GIDC Vatva, Ahmedabad, Gujarat 382445", paymentTerms: "Net 45", tdsSection: "194Q", tdsRate: 0.1, orderDate: "2026-09-12", expectedDate: "2026-10-05", status: "Draft", owner: "Priya Shah", deliveryAddress: WAREHOUSE, freightCharges: 0, notes: "Quote confirmed over email on 11 Sep.", linkedOrder: "", items: [{ id: "po93-1", item: "Optical Microscope MX-5", description: "Optical microscope with 5 MP imaging", hsn: "9011", quantity: 2, rate: 168000, gst: 18, tracked: true, received: 0, serials: [] }], receipts: [], activities: [{ title: "Draft created", meta: "12 Sep 2026 · Priya Shah", tone: "system" }] },
    { id: "PO-24092", number: "PO-24092", vendor: "Nanotech Supplies", contact: "Divya Krishnan", vendorGstin: "33AAGCN7781K1ZP", vendorState: "Tamil Nadu", vendorAddress: "5, Ambattur Industrial Estate, Chennai, Tamil Nadu 600058", paymentTerms: "Net 15", tdsSection: "—", tdsRate: 0, orderDate: "2026-09-15", expectedDate: "2026-09-25", status: "Draft", owner: "Arun Kumar", deliveryAddress: WAREHOUSE, freightCharges: 0, notes: "", linkedOrder: "", items: [{ id: "po92-1", item: "O-ring set — 25 pack", description: "Nitrile O-ring assortment, 25 pack", hsn: "4016", quantity: 15, rate: 1450, gst: 18, received: 0, serials: [] }], receipts: [], activities: [{ title: "Draft created", meta: "15 Sep 2026 · Arun Kumar", tone: "system" }] },
    { id: "PO-24091", number: "PO-24091", vendor: "Precision Systems India", contact: "Vikram Joshi", vendorGstin: "27AACCP1234F1Z8", vendorState: "Maharashtra", vendorAddress: "Plot 22, Bhosari MIDC, Pune, Maharashtra 411026", paymentTerms: "Net 30", tdsSection: "194C", tdsRate: 1, orderDate: "2026-08-26", expectedDate: "2026-09-02", status: "Received", owner: "Priya Shah", deliveryAddress: WAREHOUSE, freightCharges: 0, notes: "", linkedOrder: "", items: [{ id: "po91-1", item: "Vacuum seal kit", description: "Vacuum seal maintenance kit", hsn: "8484", quantity: 20, rate: 9800, gst: 18, stockId: "SP-033", received: 20, serials: [] }], receipts: [{ id: "rc-0", date: "2026-09-02", location: WAREHOUSE, challan: "PSI/DC/8790", note: "", lines: [{ lineId: "po91-1", quantity: 20, serials: [] }] }], sentAt: "26 Aug 2026", activities: [{ title: "All items received", meta: "02 Sep 2026 · Priya Shah", tone: "received" }, { title: "Sent to Precision Systems India", meta: "26 Aug 2026 · Priya Shah", tone: "sent" }] },
  ],
  expenses: [
    { id: "EXP-001", engineer: "Nikhil Rao", submittedBy: "Nikhil Rao", expenseDate: "2026-09-12", category: "Travel", amount: 4500, description: "Cab fare and fuel for the Whitefield calibration visit.", billFiles: ["travel_receipt_0912.jpg"], jobId: "JOB-1041", status: "Approved", submittedAt: "12 Sep 2026 · 06:40 PM", history: [{ action: "Submitted", at: "12 Sep 2026 · 06:40 PM", by: "Nikhil Rao" }, { action: "Approved", at: "13 Sep 2026 · 10:05 AM", by: "Arun Kumar" }] },
    { id: "EXP-002", engineer: "Nikhil Rao", submittedBy: "Nikhil Rao", expenseDate: "2026-09-16", category: "Food", amount: 300, description: "Lunch during the Biocon lab visit.", billFiles: ["food_bill_0916.jpg"], status: "Pending Approval", submittedAt: "16 Sep 2026 · 02:15 PM", history: [{ action: "Submitted", at: "16 Sep 2026 · 02:15 PM", by: "Nikhil Rao" }] },
    { id: "EXP-003", engineer: "Sandeep Kulkarni", submittedBy: "Sandeep Kulkarni", expenseDate: "2026-09-14", category: "Parking / Toll", amount: 800, description: "Toll both ways, Pune–Bengaluru for the Aster Pharma rental delivery.", billFiles: ["toll_receipt.jpg"], jobId: "JOB-1038", status: "Approved", submittedAt: "14 Sep 2026 · 07:50 PM", history: [{ action: "Submitted", at: "14 Sep 2026 · 07:50 PM", by: "Sandeep Kulkarni" }, { action: "Approved", at: "15 Sep 2026 · 09:20 AM", by: "Arun Kumar" }] },
    { id: "EXP-004", engineer: "Anitha Raj", submittedBy: "Anitha Raj", expenseDate: "2026-09-08", category: "Accommodation", amount: 2600, description: "One night stay for the two-day Tera Research visit.", billFiles: ["hotel_invoice.pdf"], status: "Approved", submittedAt: "09 Sep 2026 · 08:30 AM", history: [{ action: "Submitted", at: "09 Sep 2026 · 08:30 AM", by: "Anitha Raj" }, { action: "Approved", at: "09 Sep 2026 · 04:10 PM", by: "Arun Kumar" }] },
    { id: "EXP-005", engineer: "Meera Iyer", submittedBy: "Meera Iyer", expenseDate: "2026-09-15", category: "Materials", amount: 450, description: "Cable ties and cleaning solvent bought locally for the site visit.", billFiles: [], billMissingReason: "Vendor is a small local hardware shop and did not issue a printed receipt; paid by UPI.", status: "Pending Approval", submittedAt: "15 Sep 2026 · 05:45 PM", history: [{ action: "Submitted", at: "15 Sep 2026 · 05:45 PM", by: "Meera Iyer" }] },
    { id: "EXP-006", engineer: "Rahul Desai", submittedBy: "Rahul Desai", expenseDate: "2026-09-13", category: "Travel", amount: 1200, description: "Cab from the airport to the customer site.", billFiles: ["cab_receipt.jpg"], status: "Rejected", submittedAt: "13 Sep 2026 · 09:10 PM", history: [{ action: "Submitted", at: "13 Sep 2026 · 09:10 PM", by: "Rahul Desai" }, { action: "Rejected", at: "14 Sep 2026 · 11:00 AM", by: "Priya Shah", reason: "₹1,200 looks high for an airport cab — please confirm the distance or attach a clearer receipt, then submit it as a new expense." }] },
    { id: "EXP-007", engineer: "Kiran Joseph", submittedBy: "Kiran Joseph", expenseDate: "2026-09-16", category: "Food", amount: 550, description: "Team lunch with the customer's QA team.", billFiles: ["lunch_bill_a.jpg"], status: "Pending Approval", submittedAt: "16 Sep 2026 · 01:30 PM", history: [{ action: "Submitted", at: "16 Sep 2026 · 01:30 PM", by: "Kiran Joseph" }] },
    { id: "EXP-008", engineer: "Kiran Joseph", submittedBy: "Kiran Joseph", expenseDate: "2026-09-16", category: "Food", amount: 550, description: "Lunch during the site visit.", billFiles: ["lunch_bill_b.jpg"], status: "Pending Approval", submittedAt: "16 Sep 2026 · 01:35 PM", history: [{ action: "Submitted", at: "16 Sep 2026 · 01:35 PM", by: "Kiran Joseph" }] },
  ],
  advancePayments: [
    { id: "ADV-001", engineer: "Nikhil Rao", type: "Advance Paid", amount: 5000, date: "2026-09-10", mode: "Cash", jobId: undefined, notes: "Advance for the week's Whitefield and Biocon visits.", recordedBy: "Priya Shah", recordedAt: "10 Sep 2026 · 09:00 AM" },
    { id: "ADV-002", engineer: "Anitha Raj", type: "Advance Paid", amount: 2000, date: "2026-09-05", mode: "UPI", reference: "UPI/440210", notes: "Advance for the Tera Research trip.", recordedBy: "Priya Shah", recordedAt: "05 Sep 2026 · 10:15 AM" },
  ],

  customerReceipts: [
    { id: "RCP-001", customer: "Tera Research", date: "2026-09-12", amount: 700000, mode: "Bank", reference: "HDFC/NEFT/99821", allocations: [{ invoiceId: "INV-2026-0116", amount: 700000 }], recordedBy: "Arun Kumar", recordedAt: "12 Sep 2026 · 10:20 AM" },
    { id: "RCP-002", customer: "Helix Labs", date: "2026-09-09", amount: 156600, mode: "UPI", reference: "UPI/442198", allocations: [{ invoiceId: "INV-2026-0115", amount: 156600 }], recordedBy: "Arun Kumar", recordedAt: "09 Sep 2026 · 09:15 AM" },
    // Received more than the one open invoice needed — the extra stays visible as Nova's advance.
    { id: "RCP-003", customer: "Nova Instruments", date: "2026-09-14", amount: 300000, mode: "Bank", reference: "NOVA/NEFT/7724", allocations: [{ invoiceId: "INV-2026-0118", amount: 253700 }], recordedBy: "Priya Shah", recordedAt: "14 Sep 2026 · 03:40 PM" },
    { id: "RCP-004", customer: "Arka Diagnostics", date: "2026-09-16", amount: 87320, mode: "Cheque", reference: "CHQ-004821", allocations: [{ invoiceId: "INV-2026-0117", amount: 87320 }], recordedBy: "Priya Shah", recordedAt: "16 Sep 2026 · 11:05 AM" },
    // Part payment against INV-2026-0119 — the rest stays outstanding.
    { id: "RCP-005", customer: "Nova Instruments", date: "2026-09-17", amount: 25000, mode: "UPI", reference: "UPI/558102", allocations: [{ invoiceId: "INV-2026-0119", amount: 25000 }], recordedBy: "Arun Kumar", recordedAt: "17 Sep 2026 · 11:40 AM" },
  ],
  customerTds: [
    // Invoice ₹1,71,100; ₹1,56,600 received by UPI; ₹14,500 TDS recorded — balance ₹0.
    { id: "TDS-001", invoiceId: "INV-2026-0115", customer: "Helix Labs", amount: 14500, date: "2026-09-09", reference: "Awaiting Form 16A", recordedBy: "Arun Kumar", recordedAt: "09 Sep 2026 · 09:20 AM" },
  ],

  payables: [
    // The vendor bill for PO-24091, created once the vendor's actual invoice arrived, citing
    // PO-24091 for reference and carrying the vendor's TDS rate/section.
    { id: "BILL-PSI", number: "PSI/INV/2026/551", payee: "Precision Systems India", category: "Supplier Purchase", billDate: "2026-09-02", dueDate: "2026-10-02", amount: 231280, description: "Vacuum seal kit, 20 units", poRef: "PO-24091", tdsRate: 1, tdsSection: "194C", createdBy: "Arun Kumar", createdAt: "14 Sep 2026 · 11:00 AM" },
    { id: "BILL-OFC", number: "BLS/INV/2026/220", payee: "Bengaluru Lab Spares", category: "Supplier Purchase", billDate: "2026-09-05", dueDate: "2026-10-05", amount: 35400, description: "Consumables — probe tips and lens cloth", createdBy: "Priya Shah", createdAt: "05 Sep 2026 · 03:10 PM" },
    { id: "BILL-OTH", payee: "Bruker Services", category: "Other", billDate: "2026-09-08", dueDate: "2026-09-30", amount: 42000, description: "Annual AFM probe station service contract", createdBy: "Arun Kumar", createdAt: "08 Sep 2026 · 10:00 AM" },
    { id: "BILL-WORK", payee: "WeWork", category: "Office Expense", billDate: "2026-09-01", dueDate: "2026-09-25", amount: 18000, description: "Shared desk seats, September", createdBy: "Priya Shah", createdAt: "01 Sep 2026 · 09:00 AM" },
    { id: "BILL-MISTAKE", number: "NS/INV/2026/090", payee: "Nanotech Supplies", category: "Supplier Purchase", billDate: "2026-08-28", dueDate: "2026-09-10", amount: 15000, description: "O-ring assortment", createdBy: "Priya Shah", createdAt: "28 Aug 2026 · 02:00 PM" },
    { id: "BILL-EB", payee: "BESCOM", category: "Electricity", billDate: "2026-09-01", dueDate: "2026-09-14", amount: 48200, description: "Electricity bill, September", recurringLabel: "Monthly", createdBy: "Priya Shah", createdAt: "01 Sep 2026 · 09:00 AM" },
    { id: "BILL-RENT", payee: "Indiranagar Properties", category: "Rent", billDate: "2026-09-01", dueDate: "2026-09-20", amount: 185000, description: "Office rent, September", recurringLabel: "Monthly", createdBy: "Arun Kumar", createdAt: "01 Sep 2026 · 09:00 AM" },
    { id: "BILL-NET", payee: "ACT Fibernet", category: "Internet / Phone", billDate: "2026-09-01", dueDate: "2026-09-17", amount: 9400, description: "Internet and leased line, September", recurringLabel: "Monthly", createdBy: "Priya Shah", createdAt: "01 Sep 2026 · 09:00 AM" },
  ],
  supplierPayments: [
    // Marked "Already paid" when the bill was entered — one bill, one linked payment.
    { id: "SP-001", billId: "BILL-OFC", date: "2026-09-05", amount: 35400, mode: "Cash", recordedBy: "Priya Shah", recordedAt: "05 Sep 2026 · 03:10 PM", notes: "Recorded via \"Already paid\" at bill entry." },
    // Partial payment, with a supplier TDS deduction recorded for audit — not a statement that
    // it has been deposited or that the statutory obligation is complete.
    { id: "SP-002", billId: "BILL-OTH", date: "2026-09-12", amount: 20000, mode: "Bank", reference: "BRK/NEFT/331", tds: 2000, recordedBy: "Arun Kumar", recordedAt: "12 Sep 2026 · 04:00 PM" },
  ],

  leads: [
    { id: "LD-1048", name: "Rhea Mehta", company: "Nova Instruments", phone: "+91 98450 22110", email: "rhea@novainstruments.in", city: "Bengaluru", source: "Website", enquiry: "Need an AFM probe station for a new materials lab.", stage: "Won", assigned: "Arun Kumar", auto: true, interestedIn: "AFM probe station", value: "₹ 6.40 L", decision: "2026-09-30", customer: { name: "Nova Instruments", code: "CUS-0004" } },
    { id: "LD-1047", name: "Dev Malhotra", company: "Arka Diagnostics", phone: "+91 98204 81291", email: "dev@arkadiagnostics.in", city: "Mumbai", source: "Phone", enquiry: "Looking for annual calibration support for two instruments.", stage: "Contacted", followUpAt: "2026-09-15T14:00", assigned: "Priya Shah", interestedIn: "Annual calibration support", value: "₹ 1.85 L", decision: "2026-09-22" },
    { id: "LD-1046", name: "Kiran Rao", company: "Helix Labs", phone: "+91 99805 77722", email: "kiran@helixlabs.com", city: "Hyderabad", source: "WhatsApp", enquiry: "Quotation requested for optical microscopy accessories.", stage: "Quoted", followUpAt: "2026-09-13T10:30", assigned: "Arun Kumar", interestedIn: "Optical microscopy accessories", value: "₹ 74,000", decision: "2026-09-18" },
    { id: "LD-1045", name: "Sana Iyer", company: "Tera Research", phone: "+91 97040 10888", email: "sana@teraresearch.com", city: "Chennai", source: "Referral", enquiry: "Surface profilometer demo for semiconductor applications.", stage: "Won", assigned: "Priya Shah", interestedIn: "Surface profilometer", value: "₹ 12.2 L", decision: "2026-09-10", customer: { name: "Tera Research", code: "CUS-2037" } },
  ],
  quotes: initialQuotes,
  customers: customerMaster,
  // Orders exist only for quotations accepted since this feature shipped — but three quotes
  // in the seed were already "Accepted" before that, so their orders are backfilled here with
  // the same shape acceptQuote() produces, rather than leaving Orders empty out of the box.
  customerOrders: [
    { id: "ORD-2026-0498", number: "ORD-2026-0498", customer: "Arka Diagnostics", contact: "Meera Nair", customerGstin: "29AAECA5512M1Z3", customerState: "Karnataka", billingAddress: "44, Peenya Industrial Area, Bengaluru, Karnataka 560058", shippingAddress: "44, Peenya Industrial Area, Bengaluru, Karnataka 560058", fromQuote: "QT-2026-0835 R1", orderDate: "2026-09-12", orderType: "Sale", poNumber: "ARK/PO/2026/077", poDate: "2026-09-12", dispatchedAt: "2026-09-16", items: [{ id: "arka-1", item: "Optical Microscope MX-5", description: "Optical microscope with 5 MP imaging", hsn: "9011", quantity: 1, unit: "Nos", rate: 215000, discount: 0, gst: 18, inStock: true }, { id: "arka-2", item: "Vacuum seal kit", description: "Vacuum seal maintenance kit", hsn: "8484", quantity: 2, unit: "Set", rate: 12400, discount: 0, gst: 18, inStock: true }], status: "Open", activities: [{ title: "Invoice INV-2026-0120 created", meta: "16 Sep 2026 · Arun Kumar", tone: "system" }, { title: "Dispatched · DC-0002", meta: "16 Sep 2026 · Arun Kumar", tone: "system" }, { title: "Order created from QT-2026-0835 R1", meta: "12 Sep 2026 · Arun Kumar", tone: "system" }] },
    // Website lead LD-1048 → QT-2026-0850 → this order → JOB-1045 → certificate on CI-0116 → INV-2026-0119 → part payment RCP-005.
    { id: "ORD-2026-0502", number: "ORD-2026-0502", customer: "Nova Instruments", contact: "Rhea Mehta", customerGstin: "29AABCN4106D1Z7", customerState: "Karnataka", billingAddress: "12, HAL 2nd Stage, Indiranagar, Bengaluru, Karnataka 560038", shippingAddress: "Materials Lab, Nova Instruments, Bengaluru, Karnataka 560038", fromQuote: "QT-2026-0850 R1", orderDate: "2026-09-12", orderType: "Service", poNumber: "NI/PO/2026/402", poDate: "2026-09-12", items: [{ id: "nova-svc-1", item: "AFM Probe Station — Annual verification", description: "Annual verification and certification, in-lab", hsn: "9987", quantity: 1, unit: "Job", rate: 42000, discount: 0, gst: 18, inStock: false }], status: "Open", activities: [{ title: "Invoice INV-2026-0119 created", meta: "16 Sep 2026 · Arun Kumar", tone: "system" }, { title: "Order created from QT-2026-0850 R1", meta: "12 Sep 2026 · Arun Kumar", tone: "system" }] },
    { id: "ORD-2026-0499", number: "ORD-2026-0499", customer: "Helix Labs", contact: "Kiran Rao", customerGstin: "36AABCH2119P1Z5", customerState: "Telangana", billingAddress: "Plot 7, Genome Valley, Hyderabad, Telangana 500078", shippingAddress: "Plot 7, Genome Valley, Hyderabad, Telangana 500078", fromQuote: "QT-2026-0831 R1", orderDate: "2026-09-09", orderType: "Sale", poNumber: "HL/PO/2026/451", poDate: "2026-09-09", items: [{ id: "helix-a-1", item: "AFM probe tips — 10 pack", description: "Consumable AFM probe tips, pack of 10", hsn: "9012", quantity: 6, unit: "Pack", rate: 18500, discount: 0, gst: 18, inStock: true }], status: "Open", activities: [{ title: "Order created from QT-2026-0831 R1", meta: "09 Sep 2026 · Priya Shah", tone: "system" }] },
    { id: "ORD-2026-0500", number: "ORD-2026-0500", customer: "Tera Research", contact: "Sana Iyer", customerGstin: "33AABCT6281H1ZA", customerState: "Tamil Nadu", billingAddress: "21, OMR Road, Thoraipakkam, Chennai, Tamil Nadu 600097", shippingAddress: "Surface Science Lab, OMR Road, Chennai, Tamil Nadu 600097", fromQuote: "QT-2026-0827 R1", orderDate: "2026-09-10", orderType: "Sale", poNumber: "TR/PO/2026/119", poDate: "2026-09-10", installationNeeded: true, items: [{ id: "tera-1", item: "Surface Profilometer", description: "Surface profilometer, standard measurement package", hsn: "9027", quantity: 1, unit: "Nos", rate: 1090000, discount: 0, gst: 18, inStock: false }, { id: "tera-2", item: "On-site commissioning", description: "Installation and commissioning", hsn: "9987", quantity: 1, unit: "Job", rate: 130000, discount: 0, gst: 18, inStock: false }], status: "Open", activities: [{ title: "Order created from QT-2026-0827 R1", meta: "10 Sep 2026 · Priya Shah", tone: "system" }, { title: "Invoice INV-2026-0116 created", meta: "10 Sep 2026 · Priya Shah", tone: "system" }] },
    { id: "ORD-2026-0501", number: "ORD-2026-0501", customer: "Cloudnine Hospitals", contact: "Dr. Nisha Rao", customerGstin: "29AAECC7731K1ZU", customerState: "Karnataka", billingAddress: "Old Airport Road, Bengaluru, Karnataka 560017", shippingAddress: "OT & Infection Control, Cloudnine Hospitals, Bengaluru, Karnataka 560017", fromQuote: "QT-2026-0840 R1", orderDate: "2026-09-15", orderType: "Rental", items: [{ id: "cloudnine-1", item: "Airborne Particle Counter", description: "Airborne particle counter — monthly rental for OT monitoring", hsn: "9027", quantity: 1, unit: "Nos", rate: 6500, discount: 0, gst: 18, inStock: true }], status: "Open", activities: [{ title: "Order created from QT-2026-0840 R1", meta: "15 Sep 2026 · Arun Kumar", tone: "system" }] },
  ],
  deliveryChallans: [
    { id: "dc-seed-2", number: "DC-0002", date: "2026-09-16", customer: "Arka Diagnostics", siteId: "SITE-03", reason: "Sale", reference: "ORD-2026-0498", lines: [{ description: "Optical Microscope MX-5", serial: "MX5-2026-0091", quantity: 1 }, { description: "Vacuum seal kit", quantity: 2 }] },
    { id: "dc-seed-1", number: "DC-0001", date: "2026-09-15", customer: "Nova Instruments", siteId: "SITE-01", reason: "Return", reference: "JOB-1045", lines: [{ description: "AFM Probe Station", serial: "DI-NV-1140", quantity: 1 }] },
  ],
  rentals: [
    { id: "RENT-0241", number: "RENT-0241", orderRef: "", equipmentId: "INS-0042", customer: "Aster Pharma", siteId: "SITE-07", startDate: "2026-08-15", monthlyRate: 18500, expectedReturnDate: "2026-09-24", status: "Active", lastInvoicedThrough: "2026-09-14", activities: [{ title: "Rental invoice INV-2026-0121 created", meta: "01 Sep 2026 · Arun Kumar", tone: "system" }, { title: "Issued to Aster Pharma", meta: "15 Aug 2026 · Arun Kumar", tone: "system" }] },
  ],
};

// Untouched seed snapshot, kept for "Reset demo data" — captured before any persisted data
// is loaded over it, so a reset always returns to the same starting point regardless of
// what has since been saved.
const initialState: Store = structuredClone(state);

const STORAGE_KEY = "spm-erp-store";
function loadPersistedState(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    return { ...initialState, ...JSON.parse(raw) };
  } catch {
    return initialState;
  }
}
state = loadPersistedState();

export function resetStore() {
  state = structuredClone(initialState);
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  listeners.forEach((listener) => listener());
}

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => state;

export function useErpStore() { return useSyncExternalStore(subscribe, snapshot, snapshot); }
export function updateStore(change: (current: Store) => Partial<Store>) {
  state = { ...state, ...change(state) };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  listeners.forEach((listener) => listener());
}

/** Quantity still expected from POs that have been placed but not fully delivered. */
export function onOrderFor(stockId: string, orders: PurchaseOrder[]) {
  return orders
    .filter((order) => order.status === "Sent" || order.status === "Partly received")
    .flatMap((order) => order.items)
    .filter((line) => line.stockId === stockId)
    .reduce((total, line) => total + Math.max(line.quantity - line.received, 0), 0);
}
