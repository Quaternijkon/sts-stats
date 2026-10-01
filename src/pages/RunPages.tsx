import { useEffect, useMemo, useRef, useState } from "react";
import { Star } from "lucide-react";
import type { AnalysisResult, NormalizedRunV2 } from "../../Engine/domain/types";
import type { RunPageResponse } from "../../Engine/domain/runPages";
import { EMPTY_FILTER } from "../../Engine/domain/schemas";
import { zhCharacter, zhEntity, zhGameMode, zhStatus } from "../../Engine/domain/i18n";
import { useAnalysis } from "../state/useAnalysis";
import { useAppStore } from "../state/appStore";
import { Card, EmptyState, ErrorState, MetricGrid, MetricTile, ObjectNumericCell } from "../components/UI";
import { characterColor, formatValue } from "../styles/theme";
import { platform } from "../services/platform";
import { analysisClient } from "../worker/client";
import type { GameVersion } from "../services/models";
import { InventoryCards, InventoryIds, NodeDetails } from "./runs/NodeDetails";
import { TimelineChart, type ReplaySeries } from "./runs/TimelineChart";
import { finalHealth, isCoopRun, rawExportName, recordedTotal, recordedValue, withHealthChanges } from "./runs/replay";

const PAGE_SIZE = 100;
type RunListState = {
  search: string;
  onlyFavorites: boolean;
  offset: number;
  sort: { field: string; direction: string };
  filterKey: string;
  revision: number;
};
// Exactly four runtime views: two games, each with a solo and a coop list.
const runListStates = new Map<string, RunListState>();
export function RunsPage({ coop = false }: { coop?: boolean }) {
  const game = useAppStore((state) => state.game);
  return <RunListPage key={`${game}/${coop}`} coop={coop} game={game} />;
}

function RunListPage({ coop, game }: { coop: boolean; game: GameVersion }) {
  const { favorites, toggleFavorite, openRun, filter, revision } = useAppStore();
  const filterKey = JSON.stringify(filter);
  const viewKey = `${game}/${coop}`;
  const saved = runListStates.get(viewKey);
  const [search, setSearch] = useState(saved?.search ?? "");
  const [onlyFavorites, setOnlyFavorites] = useState(saved?.onlyFavorites ?? false);
  const [offset, setOffset] = useState(saved?.filterKey === filterKey && saved?.revision === revision ? saved.offset : 0);
  const [sort, setSort] = useState(saved?.sort ?? { field: "startTime", direction: "desc" });
  const scope = useRef({ filterKey, revision });
  const { data, error, loading } = useAnalysis<RunPageResponse>({
    op: "runPage", coop, search, offset, limit: PAGE_SIZE, sort,
    favorites: onlyFavorites ? favorites : null,
  });
  useEffect(() => {
    if (scope.current.filterKey !== filterKey || scope.current.revision !== revision) setOffset(0);
    scope.current = { filterKey, revision };
  }, [filterKey, revision]);
  useEffect(() => {
    runListStates.set(viewKey, { search, onlyFavorites, offset, sort, filterKey, revision });
  }, [viewKey, search, onlyFavorites, offset, sort, filterKey, revision]);
  useEffect(() => {
    if (!loading && data && offset >= data.total && offset > 0)
      setOffset(Math.max(0, Math.ceil(data.total / PAGE_SIZE) - 1) * PAGE_SIZE);
  }, [data, loading, offset]);
  function column(field: string, label: string) {
    return <th aria-sort={sort.field === field ? sort.direction === "desc" ? "descending" : "ascending" : "none"}>
      <button onClick={() => {
        setOffset(0);
        setSort({ field, direction: sort.field === field && sort.direction === "desc" ? "asc" : "desc" });
      }}>{label} {sort.field === field ? sort.direction === "desc" ? "↓" : "↑" : ""}</button>
    </th>;
  }
  function numeric(run: NormalizedRunV2, field: string, format = "number") {
    const value = run[field];
    return <ObjectNumericCell value={typeof value === "number" ? value : null} format={format}
      fill={data?.fills[run.id]?.[field]} heat={data?.heat[run.id]?.[field]}
      help="柱长表示完整筛选结果内同列百分位；颜色只表示数值大小。" />;
  }
  const currentOffset = data?.offset ?? offset;
  return <>
    <div className="page-tools" data-analysis-ready={data && !loading ? "true" : undefined}>
      <input type="search" aria-label="搜索记录" placeholder="搜索日期、角色、版本、种子或文件名"
        value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />
      <label><input type="checkbox" checked={onlyFavorites}
        onChange={(event) => { setOnlyFavorites(event.target.checked); setOffset(0); }} />仅收藏</label>
      {(search || onlyFavorites) && <button onClick={() => {
        setSearch(""); setOnlyFavorites(false); setOffset(0);
      }}>清除筛选</button>}
    </div>
    {error && <ErrorState error={error} />}
    <Card>
      <div className="table-scroll run-table" aria-busy={loading}>
        <table>
          <thead><tr><th>收藏</th>{column("startTime", "日期")}
            {column("character", coop ? "队伍" : "角色")}{column("ascension", "进阶")}
            {column("status", "结果")}{column("floor", "楼层")}{column("runTime", "时长")}
            {column("playerCount", "玩家")}{column("deckSize", "卡牌")}{column("relicCount", "遗物")}
            {column("buildId", "版本")}{column("seed", "种子")}{column("fileName", "文件名")}
          </tr></thead>
          <tbody>{data?.runs.map((run) => <tr key={run.id}>
            <td><button className="favorite-button" aria-label={favorites.includes(run.id) ? "取消收藏" : "收藏记录"}
              aria-pressed={favorites.includes(run.id)} onClick={() => toggleFavorite(run.id)}>
              <Star size={15} fill={favorites.includes(run.id) ? "var(--gold)" : "none"}
                color={favorites.includes(run.id) ? "var(--gold)" : "var(--muted)"} />
            </button></td>
            <td><button className="object-link" onClick={() => openRun(run.id)}>
              {formatValue(run.startTime, "date")}</button></td>
            <td><button className="object-link" onClick={() => openRun(run.id)}>
              {(coop ? run.players.map((player) => player.character) : [run.character]).map((character, index) =>
                <span key={`${character}/${index}`} style={{ color: characterColor(character) }}>
                  {index ? " + " : ""}{zhCharacter(character)}</span>)}
            </button></td>
            <td>{numeric(run, "ascension")}</td>
            <td title={zhStatus(run.status)} style={{ color: run.status === "win" ? "var(--success)" :
              run.status === "loss" ? "var(--damage)" : "var(--muted)" }}>{zhStatus(run.status)}</td>
            <td>{numeric(run, "floor")}</td><td>{numeric(run, "runTime", "duration")}</td>
            <td>{numeric(run, "playerCount")}</td><td>{numeric(run, "deckSize")}</td>
            <td>{numeric(run, "relicCount")}</td><td title={run.buildId}>{run.buildId || "—"}</td>
            <td title={run.seed}>{run.seed || "—"}</td><td title={run.fileName}>{run.fileName || "—"}</td>
          </tr>)}</tbody>
        </table>
        {!data?.runs.length && <EmptyState>{loading ? "正在分析…" : "没有符合条件的记录"}</EmptyState>}
      </div>
      <div className="pagination">
        <span>{data?.total ?? 0} 局</span>
        <button disabled={loading || !currentOffset} onClick={() => setOffset(Math.max(0, currentOffset - PAGE_SIZE))}>上一页</button>
        <span>{data?.total ? Math.floor(currentOffset / PAGE_SIZE) + 1 : 0} / {Math.ceil((data?.total ?? 0) / PAGE_SIZE)}</span>
        <button disabled={loading || currentOffset + PAGE_SIZE >= (data?.total ?? 0)}
          onClick={() => setOffset(currentOffset + PAGE_SIZE)}>下一页</button>
      </div>
    </Card>
    {coop && !!data?.compositions?.length && <Card title="队伍组合" help="按完整筛选结果汇总；胜率为胜利局数 ÷ 非放弃局数。">
      <div className="table-scroll run-table"><table>
        <thead><tr><th>组合</th><th>对局</th><th>已完成</th><th>胜率</th></tr></thead>
        <tbody>{data.compositions.map((row) => <tr key={row.id}><td>{row.label}</td>
          <td><ObjectNumericCell value={row.sample} fill={row.fills?.sample} heat={row.heat?.sample} /></td>
          <td>{formatValue(row.completed)}</td><td><ObjectNumericCell value={row.winRate}
            format="percent" semantic="rate" help="胜利局数 ÷ 非放弃局数；没有已完成对局时为—。" /></td>
        </tr>)}</tbody>
      </table></div>
    </Card>}
    {coop && !!data?.telemetry?.length && <Card title="玩家记录"
      help="显示当前页对局的所有玩家。低生命节点为已记录生命 ÷ 最大生命 < 25%；未知指标显示—。承伤与回复为已记录节点之和。">
      <div className="table-scroll run-table"><table>
        <thead><tr><th>对局</th><th>玩家</th><th>角色</th><th>节点</th><th>承伤</th><th>回复</th><th>低生命节点</th></tr></thead>
        <tbody>{data.telemetry.map((row) => <tr key={row.id}>
          <td><button className="object-link" onClick={() => openRun(row.runId)}>{row.runId}</button></td>
          <td>{row.position}</td><td style={{ color: characterColor(row.characterId) }}>{row.character}</td>
          {(["nodes", "damage", "healed", "lowHpNodes"] as const).map((field) => <td key={field}>
            <ObjectNumericCell value={row[field]} fill={row.fills?.[field]} heat={row.heat?.[field]}
              help={field === "lowHpNodes" ? `生命比例低于25%的已记录节点；${row.hpSamples}个节点可评估。` :
                field === "damage" ? `${row.damageSamples}个节点记录了承伤。` : field === "healed" ?
                  `${row.healedSamples}个节点记录了回复。` : "存档实际记录的节点数。"} />
          </td>)}
        </tr>)}</tbody>
      </table></div>
    </Card>}
  </>;
}

const hpSeries: ReplaySeries[] = [
  { id: "hp", label: "当前生命", field: "hp", color: "var(--success)" },
  { id: "maxHp", label: "最大生命", field: "maxHp", color: "var(--choice)" },
];
const charts: { title: string; series: ReplaySeries[] }[] = [
  { title: "生命", series: hpSeries },
  { title: "生命变化", series: [
    { id: "hpLoss", label: "生命净减少", field: "hpLoss", color: "var(--damage)" },
    { id: "hpGain", label: "生命净增加", field: "hpGain", color: "var(--sample)" },
  ] },
  { title: "金币", series: [{ id: "gold", label: "金币", field: "gold", color: "var(--gold)" }] },
  { title: "承伤", series: [{ id: "damageTaken", label: "承伤", field: "damageTaken", color: "var(--damage)" }] },
  { title: "回复", series: [{ id: "hpHealed", label: "回复", field: "hpHealed", color: "var(--sample)" }] },
  { title: "获得金币", series: [{ id: "goldGained", label: "获得金币", field: "goldGained", color: "var(--gold)" }] },
  { title: "金币花费", series: [{ id: "goldSpent", label: "金币花费", field: "goldSpent", color: "var(--spent)" }] },
  { title: "战斗回合", series: [{ id: "turns", label: "战斗回合", field: "turns", color: "var(--choice)" }] },
];

function RunBaseline({ run }: { run: NormalizedRunV2 }) {
  const { data, loading, error } = useAnalysis<AnalysisResult>({
    op: "query", filter: { characters: [run.character], ascensions: [run.ascension] },
    query: { id: "run-baseline", dataSource: "runs", metricIds: ["sample", "win_rate", "avg_floor", "avg_duration"],
      dimensionIds: [], filter: EMPTY_FILTER, sort: [], limit: 1, visualization: "table" },
  });
  const row = data?.rows[0];
  const value = (field: string) => typeof row?.values[field] === "number" ? row.values[field] as number : null;
  return <Card title="同角色、同进阶基准"
    help="保留当前日期、版本、模式及其他筛选条件，限定为同角色同进阶的单人记录。胜率不计放弃局。">
    {error ? <ErrorState error={error} /> : !row ? <EmptyState>{loading ? "正在分析…" : "没有符合条件的记录"}</EmptyState> :
      <div className="table-scroll" aria-busy={loading}><table>
        <thead><tr><th>角色</th><th>进阶</th><th>对局</th><th>胜率</th><th>平均到达层</th><th>平均局时</th></tr></thead>
        <tbody><tr><td style={{ color: characterColor(run.character) }}>{zhCharacter(run.character)}</td><td>A{run.ascension}</td>
          <td>{formatValue(value("sample"))}</td><td><ObjectNumericCell value={value("win_rate")} format="percent" semantic="rate" /></td>
          <td>{formatValue(value("avg_floor"))}</td><td>{formatValue(value("avg_duration"), "duration")}</td>
        </tr></tbody>
      </table></div>}
  </Card>;
}

function RawJsonCard({ id }: { id: string }) {
  const { data, error, loading } = useAnalysis<string>(
    { op: "runText", id, format: "raw" }, { unfiltered: true },
  );
  return <Card title="原始 JSON" className="run-raw-json">
    {error ? <ErrorState error={error} /> : data == null ?
      <EmptyState>{loading ? "正在读取…" : "没有原始记录"}</EmptyState> : <pre>{data}</pre>}
  </Card>;
}

export function RunDetailPage({ id }: { id: string }) {
  const { favorites, toggleFavorite, game } = useAppStore();
  const [player, setPlayer] = useState(0);
  const [selected, setSelected] = useState(0);
  const [rawVisible, setRawVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const { data, error, loading } = useAnalysis<NormalizedRunV2>({ op: "run", id, player }, { unfiltered: true });
  useEffect(() => { setPlayer(0); setSelected(0); setRawVisible(false); setExportError(null); }, [id]);
  const points = useMemo(() => withHealthChanges(data?.timeline ?? []), [data]);
  async function exportRun(format: "raw" | "normalized", fileName: string) {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const text = await analysisClient(game).call<string>({ op: "runText", id, player, format });
      await platform.exportText(fileName, text);
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setExporting(false);
    }
  }
  if (error) return <ErrorState error={error} />;
  if (!data || data.id !== id || (typeof data.replayPlayer === "number" && data.replayPlayer !== player))
    return <EmptyState>{loading ? "正在分析…" : "未找到记录"}</EmptyState>;
  const active = data.players[player] ?? data.players[0];
  if (!active) return <EmptyState>没有玩家记录</EmptyState>;
  const coop = isCoopRun(data);
  const health = finalHealth(data, player);
  const point = points[Math.min(selected, Math.max(0, points.length - 1))];
  const damage = recordedTotal(points, "damageTaken");
  return <>
    <div className="page-tools" data-analysis-ready={!loading ? "true" : undefined}>
      <span style={{ color: characterColor(active.character) }}>{zhCharacter(active.character)} · A{data.ascension}</span>
      <span>{formatValue(data.startTime, "date")} · {zhStatus(data.status)}</span>
      <button aria-pressed={favorites.includes(id)} onClick={() => toggleFavorite(id)}>
        <Star size={15} fill={favorites.includes(id) ? "var(--gold)" : "none"} />{favorites.includes(id) ? "已收藏" : "收藏"}
      </button>
      {data.players.length > 1 && <label>玩家视角<select aria-label="玩家视角" value={player} onChange={(event) => {
        setPlayer(Number(event.target.value)); setSelected(0);
      }}>{data.players.map((item, index) => <option key={`${item.id}/${index}`} value={index}>
        玩家 {index + 1} · {zhCharacter(item.character)}</option>)}</select></label>}
      <button aria-expanded={rawVisible} onClick={() => setRawVisible(!rawVisible)}>原始 JSON</button>
      <button disabled={exporting} onClick={() => void exportRun("raw", rawExportName(data.fileName))}>导出原始存档</button>
      <button disabled={exporting} onClick={() => void exportRun("normalized", "run-detail.json")}>导出记录</button>
    </div>
    {exportError && <ErrorState error={exportError} />}
    <MetricGrid>
      <MetricTile label="结局" value={zhStatus(data.status)} kind={data.status === "win" ? "success" : data.status === "loss" ? "damage" : "sample"} />
      <MetricTile label="楼层" value={data.floor} kind="floor" />
      <MetricTile label="时长" value={formatValue(data.runTime, "duration")} kind="time" />
      <MetricTile label="承伤" value={formatValue(damage)} kind="damage" help="当前玩家已记录节点的承伤总量；没有记录时为—。" />
      <MetricTile label="最终生命" value={`${formatValue(health.hp)} / ${formatValue(health.maxHp)}`} kind="health" />
      <MetricTile label="最终卡牌" value={active.deck.length} kind="choice" />
    </MetricGrid>
    <div className="chart-grid">
      {charts.filter((chart) => points.some((sample) => chart.series.some((series) => recordedValue(sample, series.field) != null)))
        .map((chart) => <TimelineChart key={chart.title} title={chart.title} series={chart.series}
          points={points} selected={selected} onSelect={setSelected} />)}
    </div>
    {!points.length && <Card title="复盘"><EmptyState>存档没有节点记录</EmptyState></Card>}
    {point && <NodeDetails point={point} allowsAnalysis={!coop} />}
    <Card title={`最终牌组 ${active.deck.length}`}><InventoryCards cards={active.deck} allowsAnalysis={!coop} /></Card>
    <Card title={`最终遗物 ${active.relics.length}`}><InventoryIds ids={active.relics.map((relic) => relic.id)} kind="relic" allowsAnalysis={!coop} /></Card>
    {!!active.potions.length && <Card title={`最终药水 ${active.potions.length}`}><InventoryIds ids={active.potions} kind="potion" allowsAnalysis={!coop} /></Card>}
    {!coop && <RunBaseline run={data} />}
    <Card title="对局信息"><dl className="details">
      <dt>种子</dt><dd>{data.seed || "—"}</dd><dt>版本</dt><dd>{data.buildId || "—"}</dd>
      <dt>模式</dt><dd>{zhGameMode(data.gameMode) || "—"}</dd><dt>玩家</dt><dd>{data.players.length}</dd>
      <dt>击败者</dt><dd>{data.killedBy ? zhEntity(data.killedBy, null, data.killedBy) : "—"}</dd>
      {!!data.acts?.length && <><dt>路线</dt><dd>{data.acts.map((act) => zhEntity(act, "acts", act)).join(" · ")}</dd></>}
      {!!data.modifiers?.length && <><dt>调整项</dt><dd>{data.modifiers.map((modifier) => zhEntity(modifier, "modifiers", modifier)).join(" · ")}</dd></>}
      {!!active.badges.length && <><dt>徽章</dt><dd>{active.badges.map((badge) => zhEntity(badge, "badges", badge)).join(" · ")}</dd></>}
      <dt>来源文件</dt><dd>{data.fileName}</dd>
    </dl></Card>
    {rawVisible && <RawJsonCard id={id} />}
  </>;
}
