import { useEffect, useState } from "react";
import type { ObjectKind, ObjectListResponse, ObjectDetailResponse } from "../../Engine/domain/objectTypes";
import { zhCharacter } from "../../Engine/domain/i18n";
import { useAnalysis } from "../state/useAnalysis";
import { useAppStore } from "../state/appStore";
import { Card, EmptyState, ErrorState, NumericColumnScale, ObjectNumericCell } from "../components/UI";
import { characterColor, formatValue, metricSemantic, objectColor } from "../styles/theme";
import { analysisClient } from "../worker/client";
import { objectKindLabel } from "../services/objectLabels";
import { ArenaPage } from "./objects/ArenaPage";
import { Metrics, ObjectBreakdownCard, Pager } from "./objects/ObjectTables";
import { exportCsv, exportJson } from "./objects/export";
import { useObjectViewState } from "./objects/viewState";
export { ArchetypesPage } from "./objects/ArchetypesPage";

const sourceNames = { run: "单人记录", career: "生涯累计", discovery: "发现" };
const primaryMetrics: Partial<Record<ObjectKind, string[]>> = {
  card: ["heldRuns", "heldWinRate", "pickedRuns", "pickedWinRate", "pickRate", "acquired"],
  relic: ["runs", "winRate", "offered", "picked", "pickRate", "acquired"],
  potion: ["runs", "winRate", "acquired", "used", "discarded", "held"],
  encounter: ["runs", "fought", "averageDamage", "averageTurns", "deaths", "survivalRate"],
  enemy: ["runs", "fought", "averageDamage", "averageTurns", "deaths", "survivalRate"],
  ancient: ["runs", "winRate", "visited", "selected", "picked", "averageFloor"],
  event: ["runs", "winRate", "visited", "selected", "picked", "averageFloor"],
};
const scopeHelp = "逐局统计仅使用符合筛选的单人记录；生涯累计、解锁和发现来自 progress.save，不受逐局日期和版本筛选影响，不能与单人记录相加。";

function objectColumns(rows: ObjectListResponse["items"]) {
  return [...new Map(rows.flatMap((row) => [
    ...(row.metrics ?? []).map((metric) => ({ ...metric, key: "metrics." + metric.id, source: "run" as const })),
    ...(row.careerMetrics ?? []).map((metric) => ({ ...metric, key: "career." + metric.id, source: "career" as const })),
  ]).map((metric) => [metric.key, metric])).values()];
}

export function ObjectListPage({ kind }: { kind: ObjectKind }) {
  const { characters, settings, openObject, game, filter, revision } = useAppStore();
  const scope = `${game}/${kind}`;
  const [search, setSearch] = useObjectViewState(scope, "search", "");
  const [sort, setSort] = useObjectViewState(scope, "sort", { field: "runs", direction: "desc" as "asc" | "desc" });
  const [perspective, setPerspective] = useObjectViewState(scope, "perspective", "all");
  const [pool, setPool] = useObjectViewState(scope, "pool", "all");
  const [arena, setArena] = useObjectViewState(scope, "arena", false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const filterKey = JSON.stringify(filter);
  const [offset, setOffset] = useObjectViewState(`${scope}/${filterKey}/${revision}/${perspective}/${pool}/${search}/${settings.minimumSample}`, "offset", 0);
  useEffect(() => {
    setExportError(null);
  }, [kind]);
  const request = { op: "objects", kind, search, sort, offset, limit: 100, perspective, cardPool: pool, minimumSample: settings.minimumSample };
  const { data: response, error, loading } = useAnalysis<ObjectListResponse>(request);
  const data = response?.kind === kind ? response : null;
  const columns = data?.columns ?? objectColumns(data?.items ?? []);
  function changeSort(field: string) {
    setOffset(0);
    setSort({ field, direction: sort.field === field && sort.direction === "desc" ? "asc" : "desc" });
  }
  const sortIndicator = (field: string) => sort.field === field || sort.field === field.replace(/^metrics\./, "") ? sort.direction === "desc" ? " ↓" : " ↑" : "";
  async function exportTable(format: "csv" | "json") {
    setExporting(true);
    setExportError(null);
    try {
      const all: ObjectListResponse["items"] = [];
      let page = 0, total = 1;
      let exportedColumns = columns;
      while (page < total) {
        const result = await analysisClient(game).call<ObjectListResponse>({ ...request, offset: page, limit: 500, filter });
        all.push(...result.items);
        exportedColumns = result.columns ?? exportedColumns;
        total = result.total;
        if (!result.items.length) break;
        page += result.items.length;
      }
      if (format === "json") {
        await exportJson(`${game}-${kind}.json`, { kind, perspective, cardPool: pool, filter, scope: data?.scope, columns: exportedColumns, total: all.length, items: all }, game);
      } else {
        const fields = exportedColumns.length ? exportedColumns : objectColumns(all);
        await exportCsv(`${game}-${kind}.csv`,
          ["ID", "名称", ...(kind === "card" ? ["卡池"] : []), "来源", "状态", "发现", ...fields.map((metric) => (metric.source === "career" ? "生涯 · " : "单人 · ") + metric.label)],
          all.map((row) => [row.id, row.label, ...(kind === "card" ? [row.cardPool] : []), row.sources.map((source) => sourceNames[source]).join(" · "), row.careerState, row.discovered == null ? null : row.discovered ? "已发现" : "未发现", ...fields.map((column) => {
            const metric = (column.source === "career" ? row.careerMetrics ?? [] : row.metrics ?? []).find((item) => item.id === column.id);
            return metric?.format === "text" ? metric.text : metric?.value;
          })]), game);
      }
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExporting(false);
    }
  }
  return <>
    <div className="page-tools">
      {kind === "card" && <div className="segmented"><button className={!arena ? "active" : ""} onClick={() => setArena(false)}>卡牌统计</button><button className={arena ? "active" : ""} onClick={() => setArena(true)}>选择竞技场</button></div>}
      {!arena && <>
        <input type="search" aria-label="搜索对象" placeholder="搜索名称或 ID" value={search} onChange={(event) => setSearch(event.target.value)} />
        <label>视角<select value={perspective} onChange={(event) => setPerspective(event.target.value)}><option value="all">总体</option>{characters.map((id) => <option key={id} value={id}>{zhCharacter(id)}</option>)}</select></label>
        {kind === "card" && <label>卡池<select value={pool} onChange={(event) => setPool(event.target.value)}><option value="all">全部</option>{characters.map((id) => <option key={id} value={id}>{zhCharacter(id)}</option>)}<option value="colorless">无色</option><option value="unknown">未归属</option></select></label>}
        <button disabled={exporting || loading || !data} onClick={() => void exportTable("csv")}>{exporting ? "导出中…" : "导出 CSV"}</button><button disabled={exporting || loading || !data} onClick={() => void exportTable("json")}>导出 JSON</button>
      </>}
    </div>
    <ErrorState error={exportError} />
    {kind === "card" && arena ? <ArenaPage /> : error ? <ErrorState error={error} /> : <Card title="对象统计" help={scopeHelp}>
      <div className="table-scroll" aria-busy={loading} data-analysis-ready={data && !loading ? "true" : undefined}><table>
        <thead><tr><th className="sticky-name"><button onClick={() => changeSort("label")}>名称{sortIndicator("label")}</button></th>{kind === "card" && <th>卡池</th>}<th title={scopeHelp}>来源</th><th><button onClick={() => changeSort("careerState")}>状态{sortIndicator("careerState")}</button></th>{columns.map((column) => <th key={column.key} title={(column.source === "career" ? "生涯累计 · " : "单人记录 · ") + (column.help ?? scopeHelp)}><button onClick={() => changeSort(column.key)}>{column.source === "career" ? "生涯 · " : ""}{column.label}{sortIndicator(column.key)}</button></th>)}</tr></thead>
        <tbody>{data?.items.map((row) => <tr key={row.key}>
          <td className="sticky-name"><button className="object-link" style={{ color: objectColor(kind, row.id) }} onClick={() => openObject(kind, row.id)} title={row.id}>{row.label}</button></td>
          {kind === "card" && <td style={{ color: row.cardPool && !["unknown", "colorless"].includes(row.cardPool) ? characterColor(row.cardPool) : undefined }}>{row.cardPool === "unknown" ? "未归属" : row.cardPool === "colorless" ? "无色" : row.cardPool ? zhCharacter(row.cardPool) : "—"}</td>}
          <td title={scopeHelp}>{row.sources.map((source) => sourceNames[source]).join(" · ") || "—"}</td>
          <td className="object-state" title={row.discovered == null ? undefined : row.discovered ? "已发现" : "未发现"}>{row.careerState ?? (row.discovered == null ? "—" : row.discovered ? "已发现" : "未发现")}</td>
          {columns.map((column) => {
            const metric = (column.source === "career" ? row.careerMetrics ?? [] : row.metrics ?? []).find((item) => item.id === column.id);
            return <td key={column.key}>{metric?.format === "text" ? <span title={metric.help}>{metric.text ?? "—"}</span> : <ObjectNumericCell value={metric?.value ?? null} format={metric?.format ?? column.format} fill={row.fills?.[column.key]} heat={row.heat?.[column.key]} semantic={metricSemantic(column.id)} help={metric?.help} />}</td>;
          })}
        </tr>)}</tbody>
      </table>{!data?.items.length && <EmptyState>{loading ? "正在分析…" : "没有符合条件的对象"}</EmptyState>}</div>
      <Pager offset={offset} total={data?.total ?? 0} onChange={setOffset} />
    </Card>}
  </>;
}

export function ObjectDetailPage({ kind, id }: { kind: ObjectKind; id: string }) {
  const { characters, openObject, openRun, game, filter, revision } = useAppStore();
  const scope = `${game}/${kind}/${id}`;
  const [perspective, setPerspective] = useObjectViewState(scope, "perspective", "all");
  const filterKey = JSON.stringify(filter);
  const pagingScope = `${scope}/${perspective}/${filterKey}/${revision}`;
  const [runOffset, setRunOffset] = useObjectViewState(pagingScope, "runOffset", 0);
  const [evidenceOffset, setEvidenceOffset] = useObjectViewState(pagingScope, "evidenceOffset", 0);
  const [relatedOffset, setRelatedOffset] = useObjectViewState(pagingScope, "relatedOffset", 0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const request = { op: "object", kind, id, perspective, runOffset, runLimit: 100, evidenceOffset, evidenceLimit: 100 };
  const { data: response, error, loading } = useAnalysis<ObjectDetailResponse>(request);
  const data = response?.object.kind === kind && response.object.id === id ? response : null;
  useEffect(() => {
    setExportError(null);
  }, [id, kind, perspective, filterKey, revision, game]);
  async function exportDetail() {
    if (!data) return;
    setExporting(true);
    setExportError(null);
    try {
      const result = await analysisClient(game).call<ObjectDetailResponse>({ ...request, filter, runOffset: 0, runLimit: 500, evidenceOffset: 0, evidenceLimit: 500 });
      const runs = [...result.runs], evidence = [...result.evidence];
      for (let page = runs.length; page < result.runTotal;) {
        const next = await analysisClient(game).call<ObjectDetailResponse>({ ...request, filter, runOffset: page, runLimit: 500, evidenceOffset: 0, evidenceLimit: 1 });
        if (!next.runs.length) break;
        runs.push(...next.runs);
        page += next.runs.length;
      }
      for (let page = evidence.length; page < result.evidenceTotal;) {
        const next = await analysisClient(game).call<ObjectDetailResponse>({ ...request, filter, runOffset: 0, runLimit: 1, evidenceOffset: page, evidenceLimit: 500 });
        if (!next.evidence.length) break;
        evidence.push(...next.evidence);
        page += next.evidence.length;
      }
      await exportJson(`${game}-${kind}-detail.json`, { ...result, runs, runOffset: 0, runLimit: runs.length, evidence, evidenceOffset: 0, evidenceLimit: evidence.length }, game);
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExporting(false);
    }
  }
  if (error) return <ErrorState error={error} />;
  if (!data) return <EmptyState>{loading ? "正在分析…" : "未找到对象"}</EmptyState>;
  const preferred = primaryMetrics[kind] ?? ["runs", "winRate", "observations", "averageFloor", "completed", "applied"];
  const primary = preferred.flatMap((metricId) => data.runMetrics.filter((metric) => metric.id === metricId));
  const secondary = data.runMetrics.filter((metric) => !preferred.includes(metric.id));
  const observationScale = new NumericColumnScale(data.relatedObjects.map((object) => object.observations));
  const runScale = new NumericColumnScale(data.relatedObjects.map((object) => object.runs));
  return <div className="analysis-page" data-analysis-ready={!loading ? "true" : undefined} aria-busy={loading}>
    <div className="page-tools"><h2 style={{ color: objectColor(kind, id) }} title={id}>{data.object.label}</h2><label>视角<select value={perspective} onChange={(event) => setPerspective(event.target.value)}><option value="all">总体</option>{characters.map((character) => <option key={character} value={character}>{zhCharacter(character)}</option>)}</select></label><button disabled={exporting || loading} onClick={() => void exportDetail()}>{exporting ? "导出中…" : "导出完整详情"}</button></div>
    <ErrorState error={exportError} />
    {data.object.summary.runs === 0 && !data.career.available && <EmptyState>当前筛选没有记录</EmptyState>}
    {data.object.summary.runs > 0 && <Card title="对局统计" help={scopeHelp}>
      <Metrics metrics={primary.length ? primary : data.runMetrics} />
      {primary.length > 0 && secondary.length > 0 && (kind === "card" ? <details><summary>更多指标 · {secondary.length}</summary><Metrics metrics={secondary} /></details> : <Metrics metrics={secondary} />)}
    </Card>}
    {data.career.available && <Card title="生涯累计" help={scopeHelp}>
      <div className="legend"><span>{data.object.sources.filter((source) => source !== "run").map((source) => sourceNames[source]).join(" · ")}</span>{data.object.discovered != null && <span>{data.object.discovered ? "已发现" : "未发现"}</span>}</div>
      <Metrics metrics={data.career.metrics} />
      <details><summary>累计记录 · {data.career.records.length}</summary><div className="table-scroll"><table><thead><tr><th>角色</th><th>来源</th><th>状态</th><th>发现</th><th>获得日期</th><th>累计</th></tr></thead><tbody>{data.career.records.map((record) => <tr key={record.id}><td>{record.character ? <button className="object-link" style={{ color: characterColor(record.character) }} onClick={() => openObject("character", record.character!)}>{zhCharacter(record.character)}</button> : "总体"}</td><td>{sourceNames[record.source]}</td><td>{record.state ?? "—"}</td><td>{record.discovered == null ? "—" : record.discovered ? "是" : "否"}</td><td>{formatValue(record.obtainedAt, "date")}</td><td>{record.metrics.map((metric) => `${metric.label} ${metric.text ?? formatValue(metric.value, metric.format)}`).join(" · ")}</td></tr>)}</tbody></table></div></details>
    </Card>}
    {data.breakdowns.map((breakdown) => <ObjectBreakdownCard key={`${id}:${kind}:${perspective}:${filterKey}:${revision}:${breakdown.id}`} breakdown={breakdown} />)}
    {data.relatedObjects.length > 0 && <Card title="关联对象">
      <div className="table-scroll"><table><thead><tr><th className="sticky-name">对象</th><th>类型</th><th>观测数</th><th>对局数</th></tr></thead><tbody>{data.relatedObjects.slice(relatedOffset, relatedOffset + 100).map((object) => <tr key={object.key}><td className="sticky-name"><button className="object-link" style={{ color: objectColor(object.kind, object.id) }} onClick={() => openObject(object.kind, object.id)}>{object.label}</button></td><td>{objectKindLabel(object.kind)}</td><td><ObjectNumericCell value={object.observations} fill={observationScale.fraction(object.observations)} heat={observationScale.intensity(object.observations)} /></td><td><ObjectNumericCell value={object.runs} fill={runScale.fraction(object.runs)} heat={runScale.intensity(object.runs)} /></td></tr>)}</tbody></table></div>
      {data.relatedObjects.length > 100 && <Pager offset={relatedOffset} total={data.relatedObjects.length} onChange={setRelatedOffset} />}
    </Card>}
    {data.runTotal > 0 && <Card title="关联单人记录"><div className="table-scroll"><table><thead><tr><th>日期</th><th>角色</th><th>结果</th><th>楼层</th></tr></thead><tbody>{data.runs.map((run) => <tr key={run.id}><td><button className="object-link" onClick={() => openRun(run.id)}>{formatValue(run.startTime, "date")}</button></td><td><button className="object-link" style={{ color: characterColor(run.character) }} onClick={() => openObject("character", run.character)}>{zhCharacter(run.character)}</button></td><td style={{ color: run.status === "win" ? "var(--success)" : run.status === "loss" ? "var(--danger)" : "var(--secondary)" }}>{run.status === "win" ? "胜利" : run.status === "loss" ? "失败" : "放弃"}</td><td>{run.floor}</td></tr>)}</tbody></table></div><Pager offset={data.runOffset} total={data.runTotal} limit={data.runLimit} onChange={setRunOffset} /></Card>}
    {data.evidenceTotal > 0 && <Card title="统计证据" help="行为和来源为存档实际记录；同一行为的重叠来源已合并，不将缺失记录视为未发生。">
      <div className="table-scroll" aria-busy={loading}><table><thead><tr><th>行为</th><th>来源</th><th>角色</th><th>玩家位置</th><th>楼层</th><th>对局</th></tr></thead><tbody>{data.evidence.map((entry) => <tr key={entry.id} data-evidence-id={entry.id}><td>{entry.event}</td><td>{entry.source}</td><td style={{ color: characterColor(entry.character) }}>{zhCharacter(entry.character)}</td><td>{entry.playerIndex + 1}</td><td>{entry.floor ?? "—"}</td><td><button className="object-link" onClick={() => openRun(entry.runId)}>查看</button></td></tr>)}</tbody></table></div>
      <Pager offset={data.evidenceOffset} total={data.evidenceTotal} limit={data.evidenceLimit} onChange={setEvidenceOffset} />
    </Card>}
    {kind === "card" && <ArenaPage focusItemId={id} initialPerspective={perspective} />}
    {kind === "ancient" && <ArenaPage ancientId={id} initialPerspective={perspective} />}
  </div>;
}
