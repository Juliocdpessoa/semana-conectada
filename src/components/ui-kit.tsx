import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/* ---------- PageHeader ---------- */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 border-b border-border pb-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {eyebrow}
          </div>
        )}
        <h1 className="truncate text-[19px] font-semibold leading-tight text-foreground sm:text-xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl truncate text-[13px] text-muted-foreground">
            {description}
          </p>
        )}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
    </header>
  );
}

/* ---------- KPI ---------- */
export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "success" | "warning" | "destructive" | "primary";
}) {
  const iconTone = {
    default: "text-muted-foreground bg-muted",
    success: "text-success bg-success/10",
    warning: "text-warning-foreground bg-warning/15",
    destructive: "text-destructive bg-destructive/10",
    primary: "text-primary bg-primary/10",
  }[tone];

  return (
    <div className="surface-card px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 text-[22px] font-semibold leading-none text-foreground tabular">
            {value}
          </div>
          {hint && <div className="mt-1.5 truncate text-[11px] text-muted-foreground">{hint}</div>}
        </div>
        {icon && (
          <div className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md", iconTone)}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Panel ---------- */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cn("surface-card min-w-0 overflow-hidden", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="truncate text-[13px] font-semibold text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

/* ---------- Empty / Loading ---------- */
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-6 py-10 text-center">
      {icon && <div className="grid h-9 w-9 place-items-center rounded-full bg-muted text-muted-foreground">{icon}</div>}
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description && <div className="max-w-md text-xs text-muted-foreground">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

/* ---------- Status / Sync pills ---------- */
export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    "EXECUTADO": "border-success/40 bg-success/10 text-success",
    "NÃO EXECUTADO": "border-destructive/40 bg-destructive/10 text-destructive",
    "Sem apontamento": "border-border bg-muted text-muted-foreground",
  };
  const dotMap: Record<string, string> = {
    "EXECUTADO": "bg-success",
    "NÃO EXECUTADO": "bg-destructive",
    "Sem apontamento": "bg-muted-foreground/50",
  };
  return (
    <span className={cn("status-pill", map[status] ?? "border-border bg-muted text-muted-foreground")}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dotMap[status] ?? "bg-muted-foreground/50")} />
      {status === "Sem apontamento" ? "Sem apontamento" : status}
    </span>
  );
}

export function SyncPill({ status }: { status: "synced" | "pending" | "error" }) {
  const label = status === "synced" ? "OK" : status === "pending" ? "Pendente" : "Erro";
  const style =
    status === "synced" ? "border-success/40 bg-success/10 text-success"
    : status === "pending" ? "border-warning/40 bg-warning/10 text-warning-foreground"
    : "border-destructive/40 bg-destructive/10 text-destructive";
  return <span className={cn("status-pill", style)}>{label}</span>;
}

/* ---------- Toolbar container ---------- */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("surface-card flex flex-wrap items-center gap-2 px-3 py-2.5", className)}>
      {children}
    </div>
  );
}

/* ---------- Modal ---------- */
export function Modal({
  title,
  description,
  children,
  onClose,
  footer,
  size = "md",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          "flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-xl border border-border bg-card shadow-lg sm:rounded-xl",
          size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/* ---------- Field ---------- */
export function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
