import { useMemo, useState } from "react";
import type { TimelinePoint } from "../../../Engine/domain/types";
import { Card } from "../../components/UI";
import { formatValue } from "../../styles/theme";
import { curvePath, recordedSegments, recordedValue } from "./replay";

export type ReplaySeries = { id: string; label: string; color: string; field: string };

export function TimelineChart({ points, series, selected, onSelect, title }: {
  points: TimelinePoint[];
  series: ReplaySeries[];
  selected: number;
  onSelect: (index: number) => void;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [focusedMetric, setFocusedMetric] = useState<string | null>(null);
  const visible = useMemo(() => focusedMetric
    ? series.filter((item) => item.id === focusedMetric)
    : series, [series, focusedMetric]);
  const paths = useMemo(() => {
    const values = points.flatMap((point) => visible.flatMap((item) => {
      const value = recordedValue(point, item.field);
      return value == null ? [] : [value];
    }));
    const max = Math.max(1, ...values);
    const min = Math.min(0, ...values);
    const lower = points.length ? Math.min(...points.map((point) => point.floor)) : 0;
    const upper = Math.max(lower + 1, ...points.map((point) => point.floor));
    const x = (index: number) => 45 + (points[index].floor - lower) / (upper - lower) * 700;
    const y = (value: number) => 180 - (value - min) / (max - min) * 160;
    return {
      max, min, lower, upper, x, y,
      items: visible.map((item) => ({
        ...item,
        segments: recordedSegments(points, item.field).map((indices) => {
          const line = curvePath(indices.map((index) => ({
            x: x(index), y: y(recordedValue(points[index], item.field)!),
          })));
          return {
            line,
            area: `${line} L${x(indices.at(-1)!)},${y(0)} L${x(indices[0])},${y(0)} Z`,
          };
        }),
      })),
    };
  }, [points, visible]);
  const focus = Math.min(hover ?? selected, Math.max(0, points.length - 1));
  const point = points[focus];
  const change = (field: string) => {
    const before = focus > 0 ? recordedValue(points[focus - 1], field) : null;
    const value = point ? recordedValue(point, field) : null;
    return before != null && before > 0 && value != null &&
      point.floor === points[focus - 1].floor + 1 ? (value - before) / before : null;
  };
  const focused = series.find((item) => item.id === focusedMetric);
  return (
    <Card title={focused?.label ?? title}
      help="按存档实际记录绘制；缺失节点与未记录楼层断开。悬停查看节点，点击选择；焦点内可用方向键切换。点击图例可单独查看指标。">
      <div className="timeline-chart">
        <svg viewBox="0 0 780 220" aria-label={`${title}随楼层变化`} role="img"
          onMouseLeave={() => setHover(null)}>
          {[0, 0.5, 1].map((ratio) => {
            const value = paths.min + (paths.max - paths.min) * ratio;
            return <g key={ratio}>
              <line x1="45" x2="745" y1={paths.y(value)} y2={paths.y(value)}
                stroke="var(--border)" strokeDasharray={ratio ? "2 4" : undefined} />
              <text x="38" y={paths.y(value) + 4} textAnchor="end"
                fill="var(--muted)" fontSize="10">{formatValue(value)}</text>
            </g>;
          })}
          {paths.items.map((item) => <g key={item.id}>
            {item.segments.map((segment, index) => <g key={index}>
              <path d={segment.area} fill={item.color} fillOpacity=".14" />
              <path d={segment.line} fill="none" stroke={item.color} strokeWidth="1.5" />
            </g>)}
            {points.map((sample, index) => {
              const value = recordedValue(sample, item.field);
              return value == null ? null : <circle key={index} cx={paths.x(index)}
                cy={paths.y(value)} r={3} fill={item.color}
                opacity={focus === index ? 1 : .65}
                stroke={focus === index ? "var(--text)" : "none"} strokeWidth={1} />;
            })}
          </g>)}
          {point && <line x1={paths.x(focus)} x2={paths.x(focus)} y1="15" y2="180"
            stroke="var(--muted)" strokeDasharray="3 3" />}
          {points.map((sample, index) => {
            const left = index ? (paths.x(index - 1) + paths.x(index)) / 2 : 45;
            const right = index + 1 < points.length ?
              (paths.x(index) + paths.x(index + 1)) / 2 : 745;
            return <rect key={index} x={left} y="10" width={Math.max(1, right - left)}
              height="180" fill="transparent" tabIndex={0} role="button"
              aria-label={`${sample.floor} 层 ${sample.label}`}
              aria-pressed={selected === index}
              onFocus={() => setHover(index)} onBlur={() => setHover(null)}
              onMouseEnter={() => setHover(index)} onClick={() => onSelect(index)}
              onKeyDown={(event) => {
                const target = event.key === "ArrowLeft" ? Math.max(0, index - 1) :
                  event.key === "ArrowRight" ? Math.min(points.length - 1, index + 1) :
                    event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 :
                      event.key === "Enter" || event.key === " " ? index : null;
                if (target == null) return;
                event.preventDefault();
                onSelect(target);
                setHover(target);
                const next = event.currentTarget.parentElement?.querySelectorAll<SVGRectElement>("rect[role=button]")[target];
                next?.focus();
              }}>
              <title>{`${sample.floor} · ${sample.label}\n${visible.map((item) =>
                `${item.label} ${formatValue(recordedValue(sample, item.field))}`).join("\n")}`}</title>
            </rect>;
          })}
          {[0, .25, .5, .75, 1].map((ratio) => <text key={ratio}
            x={45 + 700 * ratio} y="208" textAnchor="middle" fill="var(--muted)" fontSize="10">
            {Math.round(paths.lower + (paths.upper - paths.lower) * ratio)} F
          </text>)}
        </svg>
        {hover != null && point && <div className="timeline-tooltip" role="status">
          <strong>{point.floor} · {point.label}</strong>
          {visible.map((item) => <span key={item.id} style={{ color: item.color }}>
            {item.label} {formatValue(recordedValue(point, item.field))}
            {change(item.field) != null ? ` · ${change(item.field)! > 0 ? "+" : ""}${formatValue(change(item.field), "percent")}` : ""}
          </span>)}
        </div>}
      </div>
      <div className="legend timeline-legend">
        {series.map((item) => <button key={item.id} type="button"
          aria-pressed={focusedMetric === item.id}
          title={`${item.label}：${point ? formatValue(recordedValue(point, item.field)) : "—"}。点击单独查看，再次点击恢复全部。`}
          onClick={() => setFocusedMetric(focusedMetric === item.id ? null : item.id)}
          style={{ opacity: focusedMetric && focusedMetric !== item.id ? .45 : 1 }}>
          <i style={{ background: item.color }} />
          {item.label} {point ? formatValue(recordedValue(point, item.field)) : "—"}
        </button>)}
        <span>{point ? `${point.floor} · ${point.label}` : "没有已记录节点"}</span>
      </div>
    </Card>
  );
}
