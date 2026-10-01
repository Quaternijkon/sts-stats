import { useId, type CSSProperties, type ReactNode } from "react";
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
  characterColor,
  characterAccentColor,
  overallCharacterColor,
  metricSemantic,
  type NumericSemantic,
} from "../styles/theme";
import { zhCharacter } from "../../Engine/domain/i18n";

export { NumericColumnScale } from "./numericScales";

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
          {title && <h2 title={help}>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
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
    <div className={`metric-tile metric-${kind}`} title={help ?? label} role="group" aria-label={label}>
      <Icon size={20} aria-hidden="true" />
      <span className="metric-label" title={label}>{label}</span>
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
    <div className="loading-state" role="status" aria-live="polite">
      正在分析…
    </div>
  );
}
export function ObjectNumericCell({
  value,
  fill,
  heat,
  format = "number",
  help,
  semantic,
  metricId,
}: {
  value: number | null;
  fill?: number | null;
  heat?: number | null;
  format?: string;
  help?: string;
  semantic?: NumericSemantic;
  metricId?: string;
}) {
  if (value == null || !Number.isFinite(value))
    return (
      <span className="numeric-cell missing" title={help ?? "没有记录"}>
        —
      </span>
    );
  const percent = format === "percent";
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const width = percent ? clamp(value) : typeof fill === "number" && Number.isFinite(fill) ? clamp(fill) : null;
  const intensity = typeof heat === "number" && Number.isFinite(heat) ? clamp(heat) : width ?? 0;
  const resolvedSemantic = semantic ?? metricSemantic(metricId ?? "");
  const color =
    resolvedSemantic === "rate"
      ? rateColor(value)
      : resolvedSemantic === "preference"
        ? preferenceColor(value)
        : numericColor(intensity);
  const details = [help];
  if (width != null) {
    details.push(percent ? "柱长表示实际比例。" : `柱长表示完整筛选结果中的同列百分位：${formatValue(width, "percent")}；并列值同排名，单值列为 0%。`);
    details.push(resolvedSemantic === "rate"
      ? "颜色使用固定比例：0% 红色、50% 黄色、100% 绿色；不表示安全阈值。"
      : resolvedSemantic === "preference"
        ? "颜色表示选择倾向：低偏好蓝紫、50% 中性、高偏好青绿；不表示优劣。"
        : "颜色按同列数值大小变化：低值偏蓝且较浅，高值偏橙且较深；不表示优劣。");
  }
  return (
    <span className="numeric-cell" title={details.filter(Boolean).join("\n") || formatValue(value, format)}>
      {width != null && width > 0 && <span
        className="numeric-fill"
        aria-hidden="true"
        style={{
          width: `${width * 100}%`,
          background: color,
          "--numeric-heat": resolvedSemantic === "number" ? intensity : 0.5,
        } as CSSProperties}
      />}
      <span>{formatValue(value, format)}</span>
    </span>
  );
}

export function ChartPerspectiveSlider({
  characters,
  selection,
  onChange,
  label = "统计视图",
  id,
}: {
  characters: string[];
  selection: number;
  onChange: (index: number) => void;
  label?: string;
  id?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const index = Number.isFinite(selection) ? Math.min(characters.length, Math.max(0, Math.round(selection))) : 0;
  const character = characters[index - 1];
  const name = character ? zhCharacter(character) : "总体";
  const accent = character ? characterAccentColor(character) : overallCharacterColor(characters);
  return (
    <div className="perspective perspective-slider" style={{
      "--perspective-color": accent,
      "--perspective-fill": `${characters.length ? index / characters.length * 100 : 0}%`,
    } as CSSProperties} title="总体及各角色；仅切换本图角色，保留其他筛选条件。可拖动、点击或使用方向键。">
      <label htmlFor={inputId} title={name} style={{ color: character ? characterColor(character) : "var(--text)" }}>{name}</label>
      <div className="perspective-control">
        <div className="perspective-ticks" aria-hidden="true">
          {Array.from({ length: characters.length + 1 }, (_, tick) => <i key={tick} />)}
        </div>
        <input id={inputId} type="range" min={0} max={characters.length} step={1} value={index}
          disabled={!characters.length} aria-label={label} aria-valuetext={name}
          onChange={(event) => onChange(Number(event.currentTarget.value))} />
      </div>
    </div>
  );
}

export function ChartViewport({
  children,
  loading = false,
  error,
  empty = false,
  emptyText = "没有符合条件的数据",
  height = 245,
  onRetry,
}: {
  children: ReactNode;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyText?: string;
  height?: number;
  onRetry?: () => void;
}) {
  const hidden = !!error || empty;
  return (
    <div className="chart chart-viewport" style={{ height, minHeight: height }} aria-busy={loading}>
      <div className="perspective-plot" aria-hidden={hidden} inert={hidden}
        style={{ opacity: hidden ? 0 : 1 }}>
        {children}
      </div>
      {hidden && <div className="chart-overlay">
        {error ? <div className="chart-error"><ErrorState error={error} />{onRetry && <button onClick={onRetry}>重试</button>}</div> : loading ? <LoadingState /> : <EmptyState>{emptyText}</EmptyState>}
      </div>}
      {loading && !hidden && <span className="chart-loading" role="status" aria-live="polite">正在分析…</span>}
    </div>
  );
}

export function PerspectiveAnalysisCard({
  title, characters, selection, onSelectionChange, children, help, className,
  loading, error, empty, emptyText, height, onRetry,
}: {
  title: string;
  characters: string[];
  selection: number;
  onSelectionChange: (index: number) => void;
  children: ReactNode;
  help?: string;
  className?: string;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyText?: string;
  height?: number;
  onRetry?: () => void;
}) {
  return (
    <Card title={title} help={help} className={className}
      actions={<ChartPerspectiveSlider characters={characters} selection={selection} onChange={onSelectionChange} label={`${title}角色视图`} />}>
      <ChartViewport loading={loading} error={error} empty={empty} emptyText={emptyText} height={height} onRetry={onRetry}>
        {children}
      </ChartViewport>
    </Card>
  );
}
