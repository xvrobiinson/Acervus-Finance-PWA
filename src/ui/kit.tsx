// The app's building blocks (the desktop kit's roles, for touch): buttons,
// cards, stats, rows, pills, fields, sheets, toasts. Screens use these and
// the CSS tokens, never raw colors.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { useT } from "../lib/i18n";
import { Icon, type IconName } from "./icons";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";

export function Button({
  variant = "secondary",
  size,
  icon,
  loading,
  block,
  children,
  className,
  ...rest
}: {
  variant?: Variant;
  size?: "small";
  icon?: IconName;
  loading?: boolean;
  block?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ["btn", variant === "secondary" ? "" : variant, size, !children ? "icon" : "", block ? "block" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={cls} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function LinkButton({ to, variant = "secondary", icon, children, size }: { to: string; variant?: Variant; icon?: IconName; children?: ReactNode; size?: "small" }) {
  return (
    <Link to={to} className={["btn", variant === "secondary" ? "" : variant, size, !children ? "icon" : ""].filter(Boolean).join(" ")}>
      {icon && <Icon name={icon} />}
      {children}
    </Link>
  );
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {(title || action) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export type Hue = "accent" | "info" | "pos" | "warn" | "neg" | "neutral";

/** One figure on its own card. With `icon`, the icon sits in a colored
 *  square (`hue`) and the label reads in ink beside it. */
export function Stat({
  label,
  value,
  caption,
  lead,
  tone,
  icon,
  hue = "accent",
}: {
  label: string;
  value: string;
  caption?: ReactNode;
  lead?: boolean;
  tone?: "pos" | "neg" | "warn";
  icon?: IconName;
  hue?: Hue;
}) {
  return (
    <div className={`stat ${lead ? "lead" : ""}`}>
      {icon ? (
        <div className="label squared">
          <span className={`square ${hue}`} aria-hidden="true">
            <Icon name={icon} />
          </span>
          {label}
        </div>
      ) : (
        <div className="label">{label}</div>
      )}
      <div className={`value num-left ${tone ?? ""}`} style={{ textAlign: "left" }}>
        {value}
      </div>
      {caption && <div className="caption">{caption}</div>}
    </div>
  );
}

export function Pill({ tone, children }: { tone?: "pos" | "warn" | "neg" | "accent"; children: ReactNode }) {
  return <span className={`pill ${tone ?? ""}`}>{children}</span>;
}

export function Avatar({ name }: { name: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return <span className="avatar" aria-hidden="true">{letters || "·"}</span>;
}

export function Row({
  to,
  onClick,
  lead,
  title,
  sub,
  trail,
  muted,
}: {
  to?: string;
  onClick?: () => void;
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  trail?: ReactNode;
  muted?: boolean;
}) {
  const body = (
    <>
      {lead}
      <div className="grow">
        <div className="title">{title}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {trail && <div className="trail">{trail}</div>}
    </>
  );
  const cls = `list-row ${muted ? "muted" : ""}`;
  return (
    <li>
      {to ? (
        <Link to={to} className={cls}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" className={cls} onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

export function Empty({ icon = "search", children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <p>{children}</p>
    </div>
  );
}

export function Banner({ tone, icon, children, action }: { tone: "offline" | "warn" | "error" | "info"; icon: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`banner ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={icon} />
      <div className="grow">{children}</div>
      {action}
    </div>
  );
}

export function Field({ label, hint, error, children, id }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      {children(fid)}
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="hint">{hint}</div>
      ) : null}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** A form or detail over the page: a bottom sheet on phones, a dialog on
 *  wide screens. Escape and the backdrop close it. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.sheet-close)")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} ref={ref}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <Button variant="ghost" icon="close" className="sheet-close" aria-label={t("Close", "Cerrar")} onClick={onClose} />
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Asks before something that can't be undone. */
export function Confirm({
  title,
  children,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
  needsReason,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  needsReason?: boolean;
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel", "Cancelar")}</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(reason);
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div>{children}</div>
        {needsReason && (
          <Field label={t("Reason (kept in the history)", "Motivo (queda en el historial)")}>
            {(id) => <textarea id={id} className="input" value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        )}
        {error && <div className="banner error">{error}</div>}
      </div>
    </Sheet>
  );
}

// ----- toasts ----------------------------------------------------------

interface Toast {
  id: number;
  text: string;
  error?: boolean;
}
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, error?: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, text, error }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), error ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.error ? "error" : ""}`}>
            <Icon name={x.error ? "alert" : "check"} width={18} height={18} />
            <span>{x.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
