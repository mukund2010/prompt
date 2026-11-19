import { AlertTriangle, Check, CheckCircle2, Copy, FlaskConical, Info, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { ExecutionMode, Severity, Verdict } from "../../../shared/types";
import { useApp } from "../lib/state";

export function Button({
  variant = "default",
  size,
  loading,
  icon,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" | "danger"; size?: "sm" | "lg"; loading?: boolean; icon?: ReactNode }) {
  const cls = ["btn", variant !== "default" && `btn-${variant}`, size && `btn-${size}`, !children && "btn-icon", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" /> : icon}
      {children}
    </button>
  );
}

export function Card({ title, sub, actions, children, className = "", bodyClass = "card-body" }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            {title && <h3>{title}</h3>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function PageHead({ eyebrow, title, desc, actions }: { eyebrow?: ReactNode; title: ReactNode; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

/* ---------- 3D tilt (CSS transforms driven by pointer position) ---------- */

function onTiltMove(e: MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  el.style.setProperty("--rx", `${((0.5 - y) * 9).toFixed(2)}deg`);
  el.style.setProperty("--ry", `${((x - 0.5) * 11).toFixed(2)}deg`);
  el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
  el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
}
function onTiltLeave(e: MouseEvent<HTMLElement>) {
  e.currentTarget.style.setProperty("--rx", "0deg");
  e.currentTarget.style.setProperty("--ry", "0deg");
}
/** Spread onto any element with the `tilt` class. */
export const tiltHandlers = { onMouseMove: onTiltMove, onMouseLeave: onTiltLeave };

/* ---------- Count-up numbers ---------- */

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function AnimatedNumber({ n, decimals, suffix }: { n: number; decimals: number; suffix: string }) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (reducedMotion()) {
      setV(n);
      from.current = n;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 900);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(a + (n - a) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = n;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [n]);
  return (
    <>
      {v.toFixed(decimals)}
      {suffix}
    </>
  );
}

/** Animates plain numbers and "12.5%"-style strings; anything else renders as-is. */
export function CountUp({ value }: { value: ReactNode }) {
  if (typeof value === "number" && Number.isFinite(value)) return <AnimatedNumber n={value} decimals={Number.isInteger(value) ? 0 : 1} suffix="" />;
  if (typeof value === "string") {
    const m = /^(-?\d+(?:\.(\d+))?)(\s?%)?$/.exec(value);
    if (m) return <AnimatedNumber n={Number(m[1])} decimals={m[2]?.length ?? 0} suffix={m[3] ?? ""} />;
  }
  return <>{value}</>;
}

export function Stat({ label, value, foot, icon, accent }: { label: string; value: ReactNode; foot?: ReactNode; icon?: ReactNode; accent?: boolean }) {
  return (
    <div className="card stat tilt" {...tiltHandlers}>
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className={`stat-value ${accent ? "accent" : ""}`}>
        <CountUp value={value} />
      </div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`sev sev-${severity}`}>{severity}</span>;
}

export function VerdictBadge({ verdict }: { verdict: Verdict | "pending" | "running" }) {
  if (verdict === "pass")
    return (
      <span className="badge badge-pass">
        <CheckCircle2 size={12} /> Pass
      </span>
    );
  if (verdict === "fail")
    return (
      <span className="badge badge-fail">
        <XCircle size={12} /> Fail
      </span>
    );
  if (verdict === "error")
    return (
      <span className="badge badge-error">
        <AlertTriangle size={12} /> Error
      </span>
    );
  if (verdict === "running")
    return (
      <span className="badge badge-accent">
        <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Running
      </span>
    );
  return <span className="badge badge-neutral">Not run</span>;
}

export function ModeBadge({ mode }: { mode: ExecutionMode | null | undefined }) {
  if (!mode) return null;
  return mode === "demo" ? (
    <span className="badge badge-demo" title="Simulated: not real model output">
      <FlaskConical size={11} /> Demo data
    </span>
  ) : (
    <span className="badge badge-live" title="Executed against a real model">
      <span className="dot" style={{ background: "currentColor" }} /> Live
    </span>
  );
}

export function Banner({ kind = "info", children, icon }: { kind?: "info" | "demo" | "error"; children: ReactNode; icon?: ReactNode }) {
  const Icon = kind === "error" ? XCircle : kind === "demo" ? FlaskConical : Info;
  return (
    <div className={`banner banner-${kind}`} role={kind === "error" ? "alert" : "note"}>
      {icon ?? <Icon size={16} />}
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty fade-in">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="row mt-8" style={{ justifyContent: "center" }}>{action}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="stack" aria-busy="true" aria-label={label}>
      <div className="skeleton" style={{ height: 34, width: 260 }} />
      <div className="grid g-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 104 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 280 }} />
    </div>
  );
}

/** Three counter-rotating rings in CSS 3D; used as the live-run indicator. */
export function Gyro({ size = 28 }: { size?: number }) {
  return (
    <span className="gyro" style={{ width: size, height: size }} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function Progress({ value, active }: { value: number; active?: boolean }) {
  return (
    <div className={`progress ${active ? "striped" : ""}`} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}

export function CopyButton({ text, label = "Copy", size = "sm" }: { text: string; label?: string; size?: "sm" | "lg" }) {
  const { toast } = useApp();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) return toast("Copy failed. Select the text and copy manually.", "error");
    }
    setDone(true);
    toast("Copied to clipboard.", "success");
    setTimeout(() => setDone(false), 1600);
  };
  return (
    <Button size={size} onClick={copy} icon={done ? <Check size={14} /> : <Copy size={14} />}>
      {done ? "Copied" : label}
    </Button>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head row-between">
          <h3>{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose} icon={<X size={16} />} aria-label="Close" />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmHost() {
  const { confirmState, closeConfirm } = useApp();
  if (!confirmState) return null;
  return (
    <Modal
      open
      onClose={() => closeConfirm(false)}
      title={confirmState.title}
      footer={
        <>
          <Button onClick={() => closeConfirm(false)}>Cancel</Button>
          <Button variant={confirmState.danger ? "danger" : "primary"} onClick={() => closeConfirm(true)} autoFocus>
            {confirmState.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    >
      {confirmState.message}
    </Modal>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.kind === "success" ? CheckCircle2 : t.kind === "error" ? XCircle : Info;
        return (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <Icon size={17} />
            <div>{t.message}</div>
            <Button variant="ghost" size="sm" onClick={() => dismissToast(t.id)} icon={<X size={14} />} aria-label="Dismiss" />
          </div>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ id: T; label: ReactNode; count?: number }> }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <button key={i.id} role="tab" aria-selected={value === i.id} className={value === i.id ? "on" : ""} onClick={() => onChange(i.id)}>
          {i.label}
          {i.count !== undefined && <span className="count">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ id: T; label: ReactNode }> }) {
  return (
    <div className="seg">
      {items.map((i) => (
        <button key={i.id} type="button" className={value === i.id ? "on" : ""} onClick={() => onChange(i.id)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="tag-input">
      {value.map((t) => (
        <span key={t} className="tag">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
            <X size={12} />
          </button>
        </span>
      ))}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={add} placeholder={value.length ? "" : placeholder} />
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error ? <div className="error-text">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function OutputBlock({ text, tall }: { text: string | undefined; tall?: boolean }) {
  return text ? <pre className={`pre ${tall ? "tall" : ""}`}>{text}</pre> : <pre className="pre pre-empty">(empty)</pre>;
}
