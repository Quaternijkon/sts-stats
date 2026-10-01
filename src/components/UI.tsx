import type { ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Clock,
  Coins,
  Heart,
  Layers,
  ShieldAlert,
  Sparkles,
  Trophy,
} from "lucide-react";
import {
  formatValue,
  numericColor,
  rateColor,
  preferenceColor,
} from "../styles/theme";

export function Card({
  title,
  children,
  className = "",
  help,
  actions,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  help?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-heading">
          <h2 title={help}>{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="metric-grid">{children}</div>;
}
export function MetricTile({
  label,
  value,
  kind = "sample",
  help,
}: {
  label: string;
  value: ReactNode;
  kind?: string;
  help?: string;
}) {
  const icons: Record<string, typeof Activity> = {
    sample: BarChart3,
    success: Trophy,
    health: Heart,
    damage: ShieldAlert,
    danger: ShieldAlert,
    choice: Sparkles,
    gold: Coins,
    streak: Trophy,
    time: Clock,
    floor: Layers,
  };
  const Icon = icons[kind] ?? Activity;
  return (
    <div className={`metric-tile metric-${kind}`} title={help}>
      <Icon size={20} />
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
export function EmptyState({ children }: { children?: ReactNode }) {
  return <div className="empty-state">{children ?? "没有符合条件的数据"}</div>;
}
export function ErrorState({ error }: { error: string | null }) {
  return error ? (
    <div role="alert" className="error-state">
      {error}
    </div>
  ) : null;
}
export function LoadingState() {
  return (
    <div className="loading-state" role="status">
      正在分析…
    </div>
  );
}
export function ObjectNumericCell({
  value,
  fill = 0,
  heat = fill,
  format = "number",
  help,
  semantic = "number",
}: {
  value: number | null;
  fill?: number;
  heat?: number;
  format?: string;
  help?: string;
  semantic?: "number" | "rate" | "preference";
}) {
  if (value == null || !Number.isFinite(value))
    return (
      <span className="numeric-cell missing" title={help}>
        —
      </span>
    );
  const percent = format === "percent";
  const width = Math.max(0, Math.min(1, percent ? value : fill));
  const color =
    semantic === "rate"
      ? rateColor(value)
      : semantic === "preference"
        ? preferenceColor(value)
        : numericColor(heat);
  return (
    <span className="numeric-cell" title={help}>
      <span
        className="numeric-fill"
        style={{
          width: `${width * 100}%`,
          background: color,
          opacity:
            semantic === "number"
              ? 0.16 + Math.max(0, Math.min(1, heat)) * 0.22
              : 0.28,
        }}
      />
      <span>{formatValue(value, format)}</span>
    </span>
  );
}
