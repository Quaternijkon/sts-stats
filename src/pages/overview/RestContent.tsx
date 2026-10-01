import { useMemo, useState } from "react";
import type { analyzeRestSites } from "../../../Engine/domain/restSiteAnalysis";
import { Card, EmptyState, MetricGrid, MetricTile, NumericColumnScale, ObjectNumericCell } from "../../components/UI";
import { signedRestValue } from "./helpers";

export type RestData = ReturnType<typeof analyzeRestSites>;
type RestValue = string | number | null;
interface RestColumn {
  id: string;
  label: string;
  style?: "text" | "number" | "percent" | "coefficient" | "difference";
  help?: string;
}

function RestTable({ title, help, columns, rows }: {
  title: string;
  help: string;
  columns: RestColumn[];
  rows: Record<string, RestValue>[];
}) {
  const [page, setPage] = useState(0);
  const scales = useMemo(() => new Map(columns.map((column) => [column.id, new NumericColumnScale(rows.map((row) => typeof row[column.id] === "number" ? row[column.id] as number : null))] as const)), [rows, columns]);
  const lastPage = Math.max(0, Math.ceil(rows.length / 100) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = rows.slice(currentPage * 100, (currentPage + 1) * 100);
  return <Card title={title} help={help}>
    <div className="table-scroll overview-rest-table"><table>
      <thead><tr>{columns.map((column) => <th key={column.id} title={column.help}>{column.label}</th>)}</tr></thead>
      <tbody>{visible.map((row, index) => <tr key={String(row.key ?? row.id ?? index)}>
        {columns.map((column) => {
          const value = row[column.id];
          const tooltip = [column.help, row[`${column.id}Help`]].filter(Boolean).join("\n");
          const number = typeof value === "number" ? value : null;
          const scale = scales.get(column.id);
          return <td key={column.id}>{column.style === "text" ? <span className="numeric-cell" title={tooltip || String(value ?? "—")}>{value ?? "—"}</span>
            : column.style === "difference" || column.style === "coefficient" ? <span className="numeric-cell" title={tooltip}>{signedRestValue(typeof value === "number" ? value : null, column.style === "difference" ? 1 : 3, column.style === "difference" ? 100 : 1)}</span>
              : <ObjectNumericCell value={number} fill={scale?.fraction(number) ?? 0} heat={scale?.intensity(number) ?? 0} format={column.style === "percent" ? "percent" : "number"} help={tooltip} />}</td>;
        })}
      </tr>)}</tbody>
    </table></div>
    {lastPage > 0 && <div className="overview-table-pagination">
      <button onClick={() => setPage(currentPage - 1)} disabled={currentPage === 0}>上一页</button>
      <span>{currentPage + 1} / {lastPage + 1}</span>
      <button onClick={() => setPage(currentPage + 1)} disabled={currentPage === lastPage}>下一页</button>
    </div>}
  </Card>;
}

export function RestContent({ data, ready }: { data: RestData; ready: boolean }) {
  const choiceHelp = data.notes[1];
  const healthHelp = data.notes[0] + "\n" + data.notes[4];
  const routeHelp = data.notes.slice(2).join("\n");
  const choiceColumns: RestColumn[] = [
    { id: "name", label: "选择", style: "text" },
    { id: "siteRate", label: "选择率", style: "percent", help: choiceHelp },
    { id: "meanHp", label: "平均生命", help: healthHelp },
    { id: "meanHpPercent", label: "平均生命比", style: "percent", help: healthHelp },
    { id: "hpCorrelation", label: "生命相关 r", style: "coefficient", help: healthHelp },
    { id: "hpPercentCorrelation", label: "生命比相关 r", style: "coefficient", help: healthHelp },
    { id: "siteCount", label: "选择节点", help: "至少执行一次该动作的休息处数量。" },
    { id: "hpSamples", label: "生命样本", help: "选择该动作且有可用生命代理的节点数。" },
    { id: "hpPercentSamples", label: "比例样本", help: "选择该动作且当前生命、最大生命均可用的节点数。" },
    { id: "count", label: "执行次数", help: "实际执行的次数，同处重复执行保留。" },
  ];
  const choiceRows = data.choices.map((choice) => ({ ...choice,
    siteRateHelp: `选择节点：${choice.siteCount}；有动作记录节点：${data.recordedChoiceSites}。`,
    meanHpHelp: `该动作生命样本：${choice.hpSamples}。`,
    meanHpPercentHelp: `该动作生命比例样本：${choice.hpPercentSamples}。`,
    hpCorrelationHelp: `相关性全体样本：${data.hpSamples}。`,
    hpPercentCorrelationHelp: `相关性全体样本：${data.hpPercentSamples}。`,
  }));
  const binColumns: RestColumn[] = [
    { id: "label", label: "区间", style: "text" },
    { id: "sample", label: "样本节点", help: choiceHelp },
    ...data.choices.map((choice): RestColumn => ({ id: choice.id, label: choice.name, style: "percent", help: "该生命区间内选择此动作的节点数 ÷ 有动作记录且生命可用的节点数。" + choiceHelp })),
  ];
  const bins = (key: "hpBins" | "hpPercentBins") => data[key].map((bin) => ({ id: bin.id, label: bin.label, sample: bin.sample,
    ...Object.fromEntries(bin.choices.flatMap((choice) => [[choice.id, choice.rate], [`${choice.id}Help`, `选择节点：${choice.count}；区间样本：${bin.sample}。`]])),
  }));
  const routeColumns: RestColumn[] = [
    { id: "event", label: "房间", style: "text" },
    { id: "choice", label: "选择", style: "text" },
    { id: "presentRate", label: "有事件选择率", style: "percent", help: routeHelp },
    { id: "absentRate", label: "无事件选择率", style: "percent", help: routeHelp },
    { id: "rateDifference", label: "差值（百分点）", style: "difference", help: "有该事件时的选择率 − 无该事件时的选择率。" + routeHelp },
    { id: "phi", label: "相关 φ", style: "coefficient", help: routeHelp },
    { id: "presentSamples", label: "有事件样本", help: routeHelp },
    { id: "presentCount", label: "有事件选择", help: "有该事件且选择此动作的休息处节点数。" },
    { id: "absentSamples", label: "无事件样本", help: routeHelp },
    { id: "absentCount", label: "无事件选择", help: "完整区间没有该事件且选择此动作的休息处节点数。" },
  ];
  const routeRows = data.routes.flatMap((route) => route.choices.map((choice) => ({ ...choice,
    key: `${route.id}/${choice.id}`, event: route.name, choice: data.choices.find((item) => item.id === choice.id)?.name ?? choice.id,
    presentSamples: route.presentSamples, absentSamples: route.absentSamples,
    presentRateHelp: `选择节点：${choice.presentCount}；有事件样本：${route.presentSamples}。`,
    absentRateHelp: `选择节点：${choice.absentCount}；无事件样本：${route.absentSamples}。`,
    phiHelp: `有事件样本：${route.presentSamples}；无事件样本：${route.absentSamples}。`,
    rateDifferenceHelp: `有事件样本：${route.presentSamples}；无事件样本：${route.absentSamples}。`,
  })));
  return <div className="overview-page" data-analysis-ready={ready ? "true" : undefined}>
    <MetricGrid>
      <MetricTile label="关联对局" value={data.runCount} help="当前筛选下包含休息处记录的对局数。" />
      <MetricTile label="休息处" value={data.siteCount} help="休息处节点总数，包括未记录动作的节点。" />
      <MetricTile label="有动作记录" value={data.recordedChoiceSites} kind="choice" help={`${choiceHelp}\n多种动作节点：${data.multiChoiceSites}。`} />
      <MetricTile label="生命样本" value={data.hpSamples} kind="health" help={`${healthHelp}\n生命百分比样本：${data.hpPercentSamples}。`} />
      <MetricTile label="完整区间" value={data.completeIntervals} kind="floor" help={routeHelp} />
      <MetricTile label="截尾／不完整" value={`${data.censoredIntervals} / ${data.incompleteIntervals}`} help="左侧为未到达下一休息处的截尾区间；右侧为存在记录缺口等无法完整评估的区间。两者均只统计有动作记录的休息处，均排除在路径有无对比之外。" />
    </MetricGrid>
    {!data.choices.length ? <EmptyState>这些休息处没有可分析的动作记录</EmptyState> : <>
      <RestTable title="选择统计" help={`${choiceHelp}\n${healthHelp}`} columns={choiceColumns} rows={choiceRows} />
      <RestTable title="进入前生命" help={`${healthHelp}\n${choiceHelp}`} columns={binColumns} rows={bins("hpBins")} />
      <RestTable title="进入前生命比例" help={`${healthHelp}\n${choiceHelp}`} columns={binColumns} rows={bins("hpPercentBins")} />
      <RestTable title="后续路线" help={routeHelp} columns={routeColumns} rows={routeRows} />
    </>}
  </div>;
}
