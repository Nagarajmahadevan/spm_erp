import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export function ActionMenu({ label = "Actions", ariaLabel, items }: { label?: string; ariaLabel?: string; items: { label: string; onSelect: () => void; disabled?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = menu.current!.offsetWidth;
      const height = menu.current!.offsetHeight;
      setPosition({ left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), top: rect.bottom + height + 8 < window.innerHeight - 12 ? rect.bottom + 6 : Math.max(12, rect.top - height - 6) });
    };
    place();
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); document.removeEventListener("pointerdown", outside); };
  }, [open]);
  return <span className="erp-menu-anchor" onClick={(event) => event.stopPropagation()}>
    <button ref={trigger} className="erp-menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={ariaLabel} onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}>{label} <span aria-hidden="true">⌄</span></button>
    {open && createPortal(<div id={id} ref={menu} className="erp-action-menu" role="menu" aria-label={ariaLabel ?? label} style={position} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      const buttons = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "Tab") setOpen(false);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
    }}>{items.map((item) => <button role="menuitem" key={item.label} disabled={item.disabled} onClick={() => { close(); item.onSelect(); }}>{item.label}</button>)}</div>, document.body)}
  </span>;
}

const overlayStack: symbol[] = [];
let priorOverflow = "";
export function Overlay({ children, onClose, label, className = "stock-modal-backdrop" }: { children: ReactNode; onClose: () => void; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const token = Symbol();
    const previous = document.activeElement as HTMLElement | null;
    if (!overlayStack.length) { priorOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    overlayStack.push(token);
    const focusable = () => Array.from(ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter((node) => node.getClientRects().length);
    (focusable()[0] ?? ref.current)?.focus({ preventScroll: true });
    const keys = (event: KeyboardEvent) => {
      if (overlayStack.at(-1) !== token || (event.target as HTMLElement).closest('[role="menu"]')) return;
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key === "Tab") {
        const nodes = focusable();
        const first = nodes[0]; const last = nodes.at(-1);
        if (!first) { event.preventDefault(); ref.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      overlayStack.splice(overlayStack.indexOf(token), 1);
      if (!overlayStack.length) document.body.style.overflow = priorOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<div ref={ref} className={`${className} erp-overlay`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>{children}</div>, document.body);
}

export function useTablePage<T>(rows: T[], resetKey: string, pageSize = 10) {
  const [state, setState] = useState({ key: resetKey, page: 1 });
  const page = state.key === resetKey ? Math.min(state.page, Math.max(1, Math.ceil(rows.length / pageSize))) : 1;
  const setPage = (value: number) => setState({ key: resetKey, page: value });
  return { pageRows: rows.slice((page - 1) * pageSize, page * pageSize), page, setPage };
}

export function Pagination({ total, page, onPage, pageSize = 10 }: { total: number; page: number; onPage: (page: number) => void; pageSize?: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="erp-pagination"><span role="status">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 results"}</span><div><button aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></div></div>;
}

/** A small interactive OpenStreetMap view for a recorded GPS point, with an optional second
 *  reference point (e.g. the site the check-in was expected at) joined by a dashed line. Uses
 *  plain circle markers rather than Leaflet's default pin icons, which need extra bundler
 *  configuration to load their image assets correctly. */
export function LocationMap({ point, site, height = 180 }: { point: { lat: number; lng: number; accuracyM?: number }; site?: { lat: number; lng: number; name?: string }; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false, scrollWheelZoom: false }).setView([point.lat, point.lng], 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }).addTo(map);
    L.circleMarker([point.lat, point.lng], { radius: 8, color: "#137fa9", weight: 2, fillColor: "#1aa8dc", fillOpacity: 0.9 }).addTo(map).bindTooltip("Recorded location");
    if (point.accuracyM) L.circle([point.lat, point.lng], { radius: point.accuracyM, color: "#1aa8dc", weight: 1, fillOpacity: 0.08 }).addTo(map);
    let bounds = L.latLngBounds([[point.lat, point.lng]]);
    if (site) {
      L.circleMarker([site.lat, site.lng], { radius: 8, color: "#a94b59", weight: 2, fillColor: "#e2707d", fillOpacity: 0.9 }).addTo(map).bindTooltip(site.name ?? "Site");
      L.polyline([[point.lat, point.lng], [site.lat, site.lng]], { color: "#8796a4", weight: 2, dashArray: "4 6" }).addTo(map);
      bounds = bounds.extend([site.lat, site.lng]);
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 17 });
    }
    return () => { map.remove(); };
  }, [point.lat, point.lng, point.accuracyM, site?.lat, site?.lng, site?.name]);
  return <div ref={containerRef} className="erp-location-map" style={{ height }} role="img" aria-label="Recorded location on a map" />;
}

export default ActionMenu;
