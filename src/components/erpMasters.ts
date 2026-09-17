// Shared masters and money helpers. Quotations and Invoices both read from here so a
// customer, stock item or accepted quotation looks identical in either module.

export type QuoteStatus = "Draft" | "Sent" | "Accepted" | "Rejected";
export type QuoteLine = { id: string; item: string; description: string; hsn: string; quantity: number; unit: string; rate: number; discount: number; gst: number; inStock: boolean };
export type QuoteActivity = { title: string; meta: string; tone?: "sent" | "accepted" | "rejected" | "system" };
export type Quote = {
  id: string;
  number: string;
  revision: number;
  superseded?: boolean;
  customer: string;
  contact: string;
  customerGstin: string;
  customerState: string;
  billingAddress: string;
  shippingAddress: string;
  paymentTerms: string;
  quoteDate: string;
  validUntil: string;
  lead?: string;
  owner: string;
  subject: string;
  status: QuoteStatus;
  sentAt?: string;
  acceptedPo?: string;
  acceptedDate?: string;
  orderRef?: string;
  rejectionReason?: string;
  items: QuoteLine[];
  terms: string;
  deliveryPeriod: string;
  warranty: string;
  overallDiscount?: number;
  freightCharges?: number;
  activities?: QuoteActivity[];
};
export type Customer = { id: string; name: string; contact: string; gstin: string; state: string; city: string; billing: string; shipping: string; paymentTerms: string };
export type StockOption = { name: string; description: string; hsn: string; unit: string; rate: number; gst: number; inStock: boolean; code?: string };

export const COMPANY = { name: "SPM Lab Solutions Pvt. Ltd.", gstin: "29AAJCS2441N1ZK", state: "Karnataka", address: "Indiranagar, Bengaluru, Karnataka 560038", bank: "HDFC Bank · 50200012345678 · HDFC0000123" };
export const DEFAULT_TERMS = "Payment due within the agreed credit period. Prices are exclusive of freight unless stated otherwise.";
export const INDIAN_STATES = ["Andaman & Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh", "Dadra & Nagar Haveli and Daman & Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu & Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"];

export const customerMaster: Customer[] = [
  { id: "CUS-0001", name: "Aster Pharma", contact: "Divya Menon", gstin: "29AAMCA4820G1ZJ", state: "Karnataka", city: "Bengaluru", billing: "Whitefield Industrial Area, Bengaluru, Karnataka 560066", shipping: "Sterile Manufacturing Block, Aster Pharma, Bengaluru, Karnataka 560066", paymentTerms: "Net 30" },
  { id: "CUS-0002", name: "Biocon Biologics", contact: "Vivek Iyer", gstin: "29AACCB1456R1ZL", state: "Karnataka", city: "Bengaluru", billing: "Electronic City Phase II, Bengaluru, Karnataka 560100", shipping: "QC Microbiology Lab, Biocon Biologics, Bengaluru, Karnataka 560100", paymentTerms: "Net 30" },
  { id: "CUS-0003", name: "Cloudnine Hospitals", contact: "Dr. Nisha Rao", gstin: "29AAECC7731K1ZU", state: "Karnataka", city: "Bengaluru", billing: "Old Airport Road, Bengaluru, Karnataka 560017", shipping: "OT & Infection Control, Cloudnine Hospitals, Bengaluru, Karnataka 560017", paymentTerms: "Net 15" },
  { id: "CUS-0004", name: "Nova Instruments", contact: "Rhea Mehta", gstin: "29AABCN4106D1Z7", state: "Karnataka", city: "Bengaluru", billing: "12, HAL 2nd Stage, Indiranagar, Bengaluru, Karnataka 560038", shipping: "Materials Lab, Nova Instruments, Bengaluru, Karnataka 560038", paymentTerms: "Net 30" },
  { id: "CUS-0005", name: "Helix Labs", contact: "Kiran Rao", gstin: "36AABCH2119P1Z5", state: "Telangana", city: "Hyderabad", billing: "Plot 7, Genome Valley, Hyderabad, Telangana 500078", shipping: "Plot 7, Genome Valley, Hyderabad, Telangana 500078", paymentTerms: "Net 15" },
  { id: "CUS-0006", name: "Tera Research", contact: "Sana Iyer", gstin: "33AABCT6281H1ZA", state: "Tamil Nadu", city: "Chennai", billing: "21, OMR Road, Thoraipakkam, Chennai, Tamil Nadu 600097", shipping: "Surface Science Lab, OMR Road, Chennai, Tamil Nadu 600097", paymentTerms: "Net 30" },
  { id: "CUS-0007", name: "Vector Bio Labs", contact: "Nikhil Arora", gstin: "27AABCV8041G1ZQ", state: "Maharashtra", city: "Mumbai", billing: "88, MIDC Andheri East, Mumbai, Maharashtra 400093", shipping: "88, MIDC Andheri East, Mumbai, Maharashtra 400093", paymentTerms: "Net 45" },
  { id: "CUS-0008", name: "Arka Diagnostics", contact: "Meera Nair", gstin: "29AAECA5512M1Z3", state: "Karnataka", city: "Bengaluru", billing: "44, Peenya Industrial Area, Bengaluru, Karnataka 560058", shipping: "44, Peenya Industrial Area, Bengaluru, Karnataka 560058", paymentTerms: "Net 30" },
];

export const stockCatalog: StockOption[] = [
  { name: "Airborne Particle Counter", description: "Portable 0.3 μm airborne particle counter for cleanroom monitoring", hsn: "9027", unit: "Nos", rate: 685000, gst: 18, inStock: false },
  { name: "Portable Air Sampler", description: "100 LPM microbial air sampler for cleanroom environmental monitoring", hsn: "9027", unit: "Nos", rate: 248000, gst: 18, inStock: false },
  { name: "Aerosol Photometer", description: "HEPA filter integrity test aerosol photometer", hsn: "9027", unit: "Nos", rate: 410000, gst: 18, inStock: true, code: "INS-0044" },
  { name: "Aerosol Generator", description: "Thermal aerosol generator for filter integrity testing", hsn: "9027", unit: "Nos", rate: 295000, gst: 18, inStock: true, code: "INS-0045" },
  { name: "Zero Count Filter", description: "Zero-count filter for particle counter zero checks", hsn: "8421", unit: "Nos", rate: 18500, gst: 18, inStock: true, code: "CN-022" },
];

export const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
export const initials = (name: string) => name.split(" ").map((part) => part[0]).join("");
export const dateIso = (date = new Date()) => {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
};
export const plusDays = (days: number) => { const date = new Date(`${dateIso()}T12:00:00`); date.setDate(date.getDate() + days); return dateIso(date); };

export function dayDifference(value: string) {
  const target = new Date(`${value}T12:00`); const today = new Date(`${dateIso()}T12:00:00`);
  target.setHours(0, 0, 0, 0); today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
export function prettyDate(value: string) { if (!value) return "Not scheduled"; return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00`)); }

// IST time display. Attendance and job-visit timestamps are stored as full ISO instants;
// every screen renders them in IST regardless of the viewer's own timezone.
export const nowIso = () => new Date().toISOString();
export function istTime(iso: string) { return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(iso)); }
export function istDate(iso: string) { return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso)); }
export function istStamp(iso: string) { return `${istDate(iso)} · ${istTime(iso)}`; }
/** yyyy-mm-dd calendar date an instant falls on in IST — the day an attendance event counts toward. */
export function isoDateInIst(iso: string) { return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(iso)); }
export const stamp = () => `${istStamp(nowIso())} · Arun Kumar`;

// 24h/12h time helpers, used for visit windows and attendance.
export const timeToMinutes = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
export const minutesToTime = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
export function label12h(time: string) { const [h, m] = time.split(":").map(Number); const period = h >= 12 ? "PM" : "AM"; const hour12 = h % 12 === 0 ? 12 : h % 12; return `${String(hour12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`; }

// Working-hours and demo-only thresholds. Site radius and late-grace are explicitly flagged as
// demonstration defaults in the UI — SPM has not confirmed either policy.
export const ATTENDANCE_SETTINGS = { workStart: "09:30", workEnd: "18:30", weeklyOff: [0] as number[], siteRadiusMetersDemo: 200, lateGraceMinutesDemo: 15 };
export const isWeeklyOff = (dateIsoValue: string) => ATTENDANCE_SETTINGS.weeklyOff.includes(new Date(`${dateIsoValue}T12:00`).getDay());

export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000; const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}
export function lineValue(line: { quantity: number; rate: number; discount?: number }) { return line.quantity * line.rate * (1 - (line.discount ?? 0) / 100); }

export function totalsFor(items: { quantity: number; rate: number; discount?: number; gst: number }[], localTax: boolean, overallDiscount = 0, freightCharges = 0) {
  const lineSubtotal = items.reduce((total, line) => total + lineValue(line), 0);
  const discountAmount = lineSubtotal * overallDiscount / 100;
  const taxable = lineSubtotal - discountAmount;
  const gst = items.reduce((total, line) => total + lineValue(line) * line.gst / 100, 0);
  const adjustedGst = gst * (lineSubtotal ? taxable / lineSubtotal : 0);
  const unrounded = taxable + adjustedGst + freightCharges; const grandTotal = Math.round(unrounded);
  return { lineSubtotal, discountAmount, taxable, gst: adjustedGst, cgst: localTax ? adjustedGst / 2 : 0, sgst: localTax ? adjustedGst / 2 : 0, igst: localTax ? 0 : adjustedGst, freightCharges, roundOff: grandTotal - unrounded, grandTotal };
}

export function numberWords(value: number) {
  const small = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const belowThousand = (number: number): string => { if (!number) return ""; if (number < 20) return small[number]; if (number < 100) return `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${small[number % 10]}` : ""}`; return `${small[Math.floor(number / 100)]} Hundred${number % 100 ? ` ${belowThousand(number % 100)}` : ""}`; };
  if (!value) return "Zero Rupees only";
  const crore = Math.floor(value / 10_000_000); const lakh = Math.floor(value % 10_000_000 / 100_000); const thousand = Math.floor(value % 100_000 / 1000); const rest = value % 1000;
  return `${[crore && `${belowThousand(crore)} Crore`, lakh && `${belowThousand(lakh)} Lakh`, thousand && `${belowThousand(thousand)} Thousand`, rest && belowThousand(rest)].filter(Boolean).join(" ")} Rupees only`;
}

// Quotation seed. Invoices reads the accepted ones to offer "start from a quotation".
export const initialQuotes: Quote[] = [
  { id: "QT-2026-0844-R1", number: "QT-2026-0844", revision: 1, superseded: true, customer: "Nova Instruments", contact: "Rhea Mehta", customerGstin: "29AABCN4106D1Z7", customerState: "Karnataka", billingAddress: "12, HAL 2nd Stage, Indiranagar, Bengaluru, Karnataka 560038", shippingAddress: "Materials Lab, Nova Instruments, Bengaluru, Karnataka 560038", paymentTerms: "Net 30", quoteDate: "2026-09-11", validUntil: "2026-09-25", lead: "LD-1048", owner: "Arun Kumar", subject: "AFM probe station", status: "Sent", sentAt: "11 Sep 2026", items: [{ id: "nova-r1-1", item: "AFM Probe Station", description: "AFM probe station with vibration isolation base", hsn: "9012", quantity: 1, unit: "Nos", rate: 540000, discount: 0, gst: 18, inStock: false }, { id: "nova-r1-2", item: "Installation & training", description: "On-site installation and application training", hsn: "9987", quantity: 1, unit: "Job", rate: 80000, discount: 0, gst: 18, inStock: false }], terms: DEFAULT_TERMS, deliveryPeriod: "6–8 weeks from PO", warranty: "12 months from commissioning" },
  { id: "QT-2026-0844-R2", number: "QT-2026-0844", revision: 2, customer: "Nova Instruments", contact: "Rhea Mehta", customerGstin: "29AABCN4106D1Z7", customerState: "Karnataka", billingAddress: "12, HAL 2nd Stage, Indiranagar, Bengaluru, Karnataka 560038", shippingAddress: "Materials Lab, Nova Instruments, Bengaluru, Karnataka 560038", paymentTerms: "Net 30", quoteDate: "2026-09-16", validUntil: "2026-09-30", lead: "LD-1048", owner: "Arun Kumar", subject: "AFM probe station", status: "Draft", items: [{ id: "nova-1", item: "AFM Probe Station", description: "AFM probe station with vibration isolation base", hsn: "9012", quantity: 1, unit: "Nos", rate: 560000, discount: 0, gst: 18, inStock: false }, { id: "nova-2", item: "Installation & training", description: "On-site installation and application training", hsn: "9987", quantity: 1, unit: "Job", rate: 80000, discount: 0, gst: 18, inStock: false }], terms: DEFAULT_TERMS, deliveryPeriod: "6–8 weeks from PO", warranty: "12 months from commissioning" },
  { id: "QT-2026-0841-R1", number: "QT-2026-0841", revision: 1, customer: "Helix Labs", contact: "Kiran Rao", customerGstin: "36AABCH2119P1Z5", customerState: "Telangana", billingAddress: "Plot 7, Genome Valley, Hyderabad, Telangana 500078", shippingAddress: "Plot 7, Genome Valley, Hyderabad, Telangana 500078", paymentTerms: "Net 15", quoteDate: "2026-09-13", validUntil: "2026-09-18", lead: "LD-1046", owner: "Arun Kumar", subject: "Optical microscopy accessories", status: "Sent", sentAt: "13 Sep 2026", items: [{ id: "helix-1", item: "LED ring light", description: "LED ring light for optical microscope", hsn: "9405", quantity: 1, unit: "Nos", rate: 28000, discount: 0, gst: 18, inStock: false }, { id: "helix-2", item: "Camera adapter", description: "C-mount camera adapter", hsn: "9002", quantity: 1, unit: "Nos", rate: 46000, discount: 0, gst: 18, inStock: false }], terms: DEFAULT_TERMS, deliveryPeriod: "2 weeks", warranty: "6 months" },
  { id: "QT-2026-0838-R1", number: "QT-2026-0838", revision: 1, customer: "Vector Bio Labs", contact: "Nikhil Arora", customerGstin: "27AABCV8041G1ZQ", customerState: "Maharashtra", billingAddress: "88, MIDC Andheri East, Mumbai, Maharashtra 400093", shippingAddress: "88, MIDC Andheri East, Mumbai, Maharashtra 400093", paymentTerms: "Net 45", quoteDate: "2026-09-12", validUntil: "2026-09-21", owner: "Priya Shah", subject: "Temperature controller", status: "Sent", sentAt: "12 Sep 2026", items: [{ id: "vector-1", item: "Digital temperature controller", description: "PID digital temperature controller", hsn: "9032", quantity: 1, unit: "Nos", rate: 128500, discount: 0, gst: 18, inStock: false }], terms: DEFAULT_TERMS, deliveryPeriod: "3 weeks", warranty: "12 months" },
  { id: "QT-2026-0835-R1", number: "QT-2026-0835", revision: 1, customer: "Arka Diagnostics", contact: "Meera Nair", customerGstin: "29AAECA5512M1Z3", customerState: "Karnataka", billingAddress: "44, Peenya Industrial Area, Bengaluru, Karnataka 560058", shippingAddress: "44, Peenya Industrial Area, Bengaluru, Karnataka 560058", paymentTerms: "Net 30", quoteDate: "2026-09-08", validUntil: "2026-09-22", owner: "Arun Kumar", subject: "Optical microscope MX-5", status: "Accepted", sentAt: "08 Sep 2026", acceptedPo: "ARK/PO/2026/077", acceptedDate: "12 Sep 2026", items: [{ id: "arka-1", item: "Optical Microscope MX-5", description: "Optical microscope with 5 MP imaging", hsn: "9011", quantity: 1, unit: "Nos", rate: 215000, discount: 0, gst: 18, inStock: true }, { id: "arka-2", item: "Vacuum seal kit", description: "Vacuum seal maintenance kit", hsn: "8484", quantity: 2, unit: "Set", rate: 12400, discount: 0, gst: 18, inStock: true }], terms: DEFAULT_TERMS, deliveryPeriod: "1 week", warranty: "12 months" },
  { id: "QT-2026-0831-R1", number: "QT-2026-0831", revision: 1, customer: "Helix Labs", contact: "Kiran Rao", customerGstin: "36AABCH2119P1Z5", customerState: "Telangana", billingAddress: "Plot 7, Genome Valley, Hyderabad, Telangana 500078", shippingAddress: "Plot 7, Genome Valley, Hyderabad, Telangana 500078", paymentTerms: "Net 15", quoteDate: "2026-09-05", validUntil: "2026-09-19", owner: "Priya Shah", subject: "AFM probe tips — annual supply", status: "Accepted", sentAt: "05 Sep 2026", acceptedPo: "HL/PO/2026/451", acceptedDate: "09 Sep 2026", items: [{ id: "helix-a-1", item: "AFM probe tips — 10 pack", description: "Consumable AFM probe tips, pack of 10", hsn: "9012", quantity: 6, unit: "Pack", rate: 18500, discount: 0, gst: 18, inStock: true }], terms: DEFAULT_TERMS, deliveryPeriod: "1 week", warranty: "6 months" },
  { id: "QT-2026-0827-R1", number: "QT-2026-0827", revision: 1, customer: "Tera Research", contact: "Sana Iyer", customerGstin: "33AABCT6281H1ZA", customerState: "Tamil Nadu", billingAddress: "21, OMR Road, Thoraipakkam, Chennai, Tamil Nadu 600097", shippingAddress: "Surface Science Lab, OMR Road, Chennai, Tamil Nadu 600097", paymentTerms: "Net 30", quoteDate: "2026-09-04", validUntil: "2026-09-10", lead: "LD-1045", owner: "Priya Shah", subject: "Surface profilometer", status: "Accepted", sentAt: "04 Sep 2026", acceptedPo: "TR/PO/2026/119", acceptedDate: "10 Sep 2026", items: [{ id: "tera-1", item: "Surface Profilometer", description: "Surface profilometer, standard measurement package", hsn: "9027", quantity: 1, unit: "Nos", rate: 1090000, discount: 0, gst: 18, inStock: false }, { id: "tera-2", item: "On-site commissioning", description: "Installation and commissioning", hsn: "9987", quantity: 1, unit: "Job", rate: 130000, discount: 0, gst: 18, inStock: false }], terms: DEFAULT_TERMS, deliveryPeriod: "8 weeks", warranty: "12 months" },
];

// Vendor master and purchase settings. In the real product these come from Settings →
// Vendors and Settings → Approvals; the PO module reads them the same way either way.
export type Vendor = { name: string; contact: string; gstin: string; state: string; address: string; paymentTerms: string; tdsSection: string; tdsRate: number };

export const WAREHOUSE = "Central Warehouse";
export const STOCK_LOCATIONS = [WAREHOUSE, "Warehouse 2 · Peenya"];
export const APPROVER = "Arun Kumar";
export const STOCK_UNITS = ["Nos", "Set", "Pack", "Box", "Metre", "Litre"];
// SPM has not confirmed whether calibration is done in-house, outsourced, or both — keep this
// list open-ended rather than assuming an accredited in-house lab.
export const CALIBRATION_PROVIDERS = ["Internal · SPM Lab Solutions", "Outsourced · NABL Cleanroom Metrology Lab", "Outsourced · Precision Cal Labs", "Not decided yet"];
export const CALIBRATION_LABS = ["NABL CalLab Services", "NABL Cleanroom Metrology Lab", "Precision Cal Labs"];

export const vendorMaster: Vendor[] = [
  { name: "Precision Systems India", contact: "Vikram Joshi", gstin: "27AACCP1234F1Z8", state: "Maharashtra", address: "Plot 22, Bhosari MIDC, Pune, Maharashtra 411026", paymentTerms: "Net 30", tdsSection: "194C", tdsRate: 1 },
  { name: "Nanotech Supplies", contact: "Divya Krishnan", gstin: "33AAGCN7781K1ZP", state: "Tamil Nadu", address: "5, Ambattur Industrial Estate, Chennai, Tamil Nadu 600058", paymentTerms: "Net 15", tdsSection: "—", tdsRate: 0 },
  { name: "Bengaluru Lab Spares", contact: "Rakesh Gowda", gstin: "29AAFCB9012L1ZR", state: "Karnataka", address: "17, Rajajinagar Industrial Town, Bengaluru, Karnataka 560010", paymentTerms: "Net 30", tdsSection: "194C", tdsRate: 1 },
  { name: "Optika Instruments", contact: "Farah Sheikh", gstin: "24AABCO4455N1ZV", state: "Gujarat", address: "9, GIDC Vatva, Ahmedabad, Gujarat 382445", paymentTerms: "Net 45", tdsSection: "194Q", tdsRate: 0.1 },
];

// Settings → Alerts. Due Dates reads these; it never offers its own copy of them.
export const ALERT_SETTINGS = {
  leadDays: { Calibration: 21, Rental: 7, AMC: 14, Renewal: 60, Payment: 7, Bill: 7, Master: 90, Statutory: 20 } as Record<string, number>,
  channel: { Calibration: "Email", Rental: "WhatsApp", AMC: "Email", Payment: "Email + WhatsApp", Bill: "Email" } as Record<string, string>,
  template: { Calibration: "Calibration reminder", Rental: "Rental return reminder", AMC: "Service visit reminder", Payment: "Payment reminder", Bill: "—" } as Record<string, string>,
  repeatOverdueDaily: true,
};
export const ENGINEER = "Nikhil Rao";
export const CAL_LAB = "CalLab Services";

export type EngineerSkill = "Calibration" | "Preventive service" | "Repair" | "Installation" | "Logistics";

// Field team and the sites we visit. Cities drive trip clustering, so they matter.
export type Engineer = { name: string; base: string; phone: string; initials: string; skills: EngineerSkill[] };
export const engineers: Engineer[] = [
  { name: "Nikhil Rao", base: "Bengaluru", phone: "+91 98450 11223", initials: "NR", skills: ["Calibration", "Preventive service", "Repair", "Installation", "Logistics"] },
  { name: "Sandeep Kulkarni", base: "Pune", phone: "+91 98220 44556", initials: "SK", skills: ["Preventive service", "Repair", "Logistics"] },
  { name: "Anitha Raj", base: "Chennai", phone: "+91 98400 77889", initials: "AR", skills: ["Calibration", "Preventive service", "Installation", "Logistics"] },
];

// Additional demo staff exercise the planner at ordinary office volumes.
engineers.push(...[
  ["Meera Iyer", "Bengaluru"], ["Rahul Desai", "Bengaluru"], ["Kavya Menon", "Chennai"],
  ["Vikram Patil", "Pune"], ["Priya Nair", "Bengaluru"], ["Arjun Shah", "Mumbai"],
  ["Divya Rao", "Hyderabad"], ["Kiran Joseph", "Bengaluru"], ["Sneha Reddy", "Hyderabad"],
  ["Rohit Verma", "Bengaluru"], ["Lakshmi Kumar", "Chennai"], ["Aditya Joshi", "Pune"],
].map(([name, base], index): Engineer => ({ name, base, phone: "", initials: initials(name), skills: index % 2 ? ["Repair", "Preventive service", "Logistics"] : ["Calibration", "Installation", "Preventive service"] })));

export type CustomerSite = { id: string; customer: string; name: string; address: string; city: string; contact: string; phone: string; lat?: number; lng?: number };
export const customerSites: CustomerSite[] = [
  { id: "SITE-07", customer: "Aster Pharma", name: "Whitefield sterile plant", address: "Whitefield Industrial Area, Bengaluru", city: "Bengaluru", contact: "Divya Menon", phone: "+91 98451 48220", lat: 12.9698, lng: 77.75 },
  { id: "SITE-08", customer: "Biocon Biologics", name: "Electronic City · Biologics Quality Control & Environmental Monitoring Centre", address: "Electronic City Phase II, Bengaluru", city: "Bengaluru", contact: "Vivek Iyer", phone: "+91 99001 14560", lat: 12.8452, lng: 77.6602 },
  { id: "SITE-09", customer: "Cloudnine Hospitals", name: "Old Airport Road OT", address: "Old Airport Road, Bengaluru", city: "Bengaluru", contact: "Dr. Nisha Rao", phone: "+91 98450 77310", lat: 12.9611, lng: 77.6387 },
  { id: "SITE-01", customer: "Nova Instruments", name: "Indiranagar lab", address: "12, HAL 2nd Stage, Indiranagar", city: "Bengaluru", contact: "Rhea Mehta", phone: "+91 98860 12345", lat: 12.9716, lng: 77.6412 },
  { id: "SITE-02", customer: "Nova Instruments", name: "Whitefield plant", address: "44, EPIP Zone, Whitefield", city: "Bengaluru", contact: "Arvind Shetty", phone: "+91 98860 54321", lat: 12.988, lng: 77.7297 },
  { id: "SITE-03", customer: "Arka Diagnostics", name: "Peenya works", address: "44, Peenya Industrial Area", city: "Bengaluru", contact: "Meera Nair", phone: "+91 99010 22334", lat: 13.0284, lng: 77.5199 },
  { id: "SITE-04", customer: "Tera Research", name: "OMR campus", address: "21, OMR Road, Thoraipakkam", city: "Chennai", contact: "Sana Iyer", phone: "+91 98410 33445", lat: 12.901, lng: 80.2279 },
  { id: "SITE-05", customer: "Helix Labs", name: "Genome Valley", address: "Plot 7, Genome Valley", city: "Hyderabad", contact: "Kiran Rao", phone: "+91 90000 55667", lat: 17.5321, lng: 78.3809 },
  { id: "SITE-06", customer: "Vector Bio Labs", name: "Andheri unit", address: "88, MIDC Andheri East", city: "Mumbai", contact: "Nikhil Arora", phone: "+91 98200 66778", lat: 19.1197, lng: 72.8697 },
];
export const CITIES = ["Bengaluru", "Chennai", "Hyderabad", "Mumbai", "Pune"];
export const siteById = (id: string) => customerSites.find((site) => site.id === id);

// Settings → Operations. The scheduling screens read these; they never offer their own copy.
export const JOB_SETTINGS = {
  defaultCalibrationMonths: 12,
  unassignedAlertTo: ["Arun Kumar", "Priya Shah"],
};
export const JOB_TYPES = ["Calibration", "Repair", "Validation/Testing", "Install"] as const;

export const addMonths = (from: string, months: number) => { const date = new Date(`${from}T12:00`); date.setMonth(date.getMonth() + months); return dateIso(date); };
export const addDaysIso = (from: string, days: number) => { const date = new Date(`${from}T12:00`); date.setDate(date.getDate() + days); return dateIso(date); };
export const weekStart = (from: string) => { const date = new Date(`${from}T12:00`); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return dateIso(date); };
export const shortDay = (iso: string) => new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric" }).format(new Date(`${iso}T12:00`));
