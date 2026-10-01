import { useMemo, useState } from "react";
import type { ObjectBreakdown, ObjectMetric } from "../../../Engine/domain/objectTypes";
import { Card, EmptyState, MetricGrid, MetricTile, ObjectNumericCell } from "../../components/UI";
import { useAppStore } from "../../state/appStore";
import { formatValue, metricSemantic, objectColor } from "../../styles/theme";
import { exportCsv } from "./export";

export function Pager({ offset, total, onChange, limit = 100 }: {
  offset: number;
  total: number;
  onChange: (offset: number) => void;
  limit?: number;
}) {
  return <div className="pagination">
    <span>{total ? `${offset + 1}–${Math.min(total, offset + limit)} / ${total}` : "0"}</span>
    <button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>上一页</button>
    <button disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>下一页</button>
  </div>;
}

export function metricKind(id: string): string {
  if (/win|survival|completed/i.test(id)) return "success";
  if (/hp|health/i.test(id)) return "health";
  if (/gold|offered/i.test(id)) return "gold";
  if (/duration|time|acquired|held$/i.test(id)) return "time";
  if (/damage|death|discard|removed/i.test(id)) return "damage";
  if (/floor|reached/i.test(id)) return "floor";
  if (/pick|selected|applied/i.test(id)) return "choice";
  return "sample";
}

export function Metrics({ metrics }: { metrics: ObjectMetric[] }) {
  return <MetricGrid>{metrics.map((metric) => <MetricTile key={metric.id} label={metric.label} value={metric.text ?? formatValue(metric.value, metric.format)} help={metric.help} kind={metricKind(metric.id)} />)}</MetricGrid>;
}

export function ObjectBreakdownCard({ breakdown }: { breakdown: ObjectBreakdown }) {
  const { openObject, game } = useAppStore();
  const [offset, setOffset] = useState(0);
  const [chartOffset, setChartOffset] = useState(0);
  const [sort, setSort] = useState({ field: "", direction: "desc" as "asc" | "desc" });
  const rows = useMemo(() => {
    if (!sort.field) return breakdown.rows;
    return [...breakdown.rows].sort((left, right) => {
      const a = sort.field === "label" ? left.label : left.values[sort.field];
      const b = sort.field === "label" ? right.label : right.values[sort.field];
      if (a == null || b == null) return a === b ? 0 : a == null ? 1 : -1;
      const value = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "zh-CN");
      return value * (sort.direction === "asc" ? 1 : -1);
    });
  }, [breakdown.rows, sort]);
  const chartColumn = breakdown.columns.find((column) => column.format === "number");
  const chartRows = rows.slice(chartOffset, chartOffset + 30);
  const max = chartColumn ? rows.reduce((maximum, row) => Math.max(maximum, Number(row.values[chartColumn.id]) || 0), 0) : 0;
  function changeSort(field: string) {
    setSort({ field, direction: sort.field === field && sort.direction === "desc" ? "asc" : "desc" });
    setOffset(0);
    setChartOffset(0);
  }
  const sortIndicator = (field: string) => sort.field === field ? sort.direction === "desc" ? " ↓" : " ↑" : "";
  async function exportTable() {
    await exportCsv(`${breakdown.id}.csv`, ["ID", "名称", ...breakdown.columns.map((column) => column.label)], rows.map((row) => [row.id, row.label, ...breakdown.columns.map((column) => row.values[column.id])]), game);
  }
  return <Card title={breakdown.label} help={breakdown.help} actions={<button disabled={!rows.length} onClick={() => void exportTable()}>导出 CSV</button>}>
    {!rows.length ? <EmptyState>{breakdown.id === "cardCopyCount" ? "当前筛选没有最终持有记录" : ["cardUpgradeState", "deckUpgradeShare"].includes(breakdown.id) ? "当前筛选没有可评估的升级记录" : "当前筛选没有可用记录"}</EmptyState> : <>
      {chartColumn && rows.length > 1 && !["cardCopyCount", "cardUpgradeState", "deckUpgradeShare"].includes(breakdown.id) && <>
        <div className="object-breakdown-chart" role="img" aria-label={`${breakdown.label} · ${chartColumn.label}`}>
          {chartRows.map((row) => {
            const value = row.values[chartColumn.id];
            return <div className="breakdown-bar-row" key={row.id} title={`${row.label} · ${chartColumn.label} ${formatValue(value)}`}>
              <span>{row.label}</span><span className="breakdown-bar-track">{typeof value === "number" && <span className="breakdown-bar" style={{ width: `${max > 0 ? Math.max(0, value) / max * 100 : 0}%` }} />}</span><strong>{formatValue(value)}</strong>
            </div>;
          })}
        </div>
        {rows.length > 30 && <Pager offset={chartOffset} total={rows.length} onChange={setChartOffset} limit={30} />}
      </>}
      <div className="table-scroll"><table>
        <thead><tr><th className="sticky-name"><button onClick={() => changeSort("label")}>{breakdown.label}{sortIndicator("label")}</button></th>{breakdown.columns.map((column) => <th key={column.id} title={column.help}><button onClick={() => changeSort(column.id)}>{column.label}{sortIndicator(column.id)}</button></th>)}</tr></thead>
        <tbody>{rows.slice(offset, offset + 100).map((row) => <tr key={row.id}>
          <td className="sticky-name">{row.object ? <button className="object-link" style={{ color: objectColor(row.object.kind, row.object.id) }} onClick={() => openObject(row.object!.kind, row.object!.id)}>{row.label}</button> : <span title={row.label}>{row.label}</span>}</td>
          {breakdown.columns.map((column) => <td key={column.id}>{typeof row.values[column.id] === "number" ? <ObjectNumericCell value={row.values[column.id] as number} fill={row.fills?.[column.id]} heat={row.heat?.[column.id]} format={column.format} semantic={metricSemantic(column.id)} help={column.help} /> : <span title={column.help}>{row.values[column.id] ?? "—"}</span>}</td>)}
        </tr>)}</tbody>
      </table></div>
      {rows.length > 100 && <Pager offset={offset} total={rows.length} onChange={setOffset} />}
    </>}
  </Card>;
}
