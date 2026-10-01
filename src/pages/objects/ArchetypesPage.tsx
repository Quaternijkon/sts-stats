import { useEffect, useMemo } from "react";
import type { CardArchetypeAnalysisResult, ArchetypeCardStat, ArchetypePairAffinity } from "../../../Engine/domain/cardArchetypes";
import { zhCharacter, zhEntity } from "../../../Engine/domain/i18n";
import { Card, EmptyState, ErrorState, MetricGrid, MetricTile, NumericColumnScale, ObjectNumericCell } from "../../components/UI";
import { useAnalysis } from "../../state/useAnalysis";
import { useAppStore } from "../../state/appStore";
import { formatValue, numericColor, objectColor } from "../../styles/theme";
import { exportCsv, exportJson } from "./export";
import { Pager } from "./ObjectTables";
import { useObjectViewState } from "./viewState";

const affinityId = (left: string, right: string) => [left, right].sort().join("¦");
const interval = (values: [number, number] | null) => values ? values.map((value) => formatValue(value)).join("–") : "—";
const statuses = { analyzed: "已分析", insufficient: "样本不足", starter: "初始牌组" };
const modes = { conditional_pick: "条件选择", acquisition_sequence: "获得顺序", co_deck: "最终牌组共现" };

function PairEvidence({ pair, label }: { pair: ArchetypePairAffinity; label: (id: string) => string }) {
  return <Card title={`${label(pair.left)} / ${label(pair.right)}`} help="亲和描述统计关联；相关性不代表因果。方向项比较持有来源卡牌时与未持有时目标卡牌的选择；替代证据模式使用获得顺序或最终牌组共现。">
    <dl className="details pair-evidence">
      <dt>亲和系数</dt><dd>{formatValue(pair.affinity)}</dd><dt>区间</dt><dd>{interval(pair.affinityCi)}</dd>
      <dt>方向差异</dt><dd>{formatValue(pair.directionalDifference)}</dd><dt>有效支持</dt><dd>{pair.effectiveSupport}</dd>
      <dt>正向 / 负向支持</dt><dd>{formatValue(pair.positiveSupport)} / {formatValue(pair.negativeSupport)}</dd>
      <dt>显示连线 / 参与聚类</dt><dd>{pair.edgeVisible ? "是" : "否"} / {pair.clusterEligible ? "是" : "否"}</dd>
    </dl>
    <div className="table-scroll"><table><thead><tr>{["方向", "已持有时可选", "未持有时可选", "已持有时选择", "未持有时选择", "亲和", "区间", "正向概率", "负向概率", "后验标准差", "状态"].map((title) => <th key={title}>{title}</th>)}</tr></thead>
      <tbody>{[pair.leftToRight, pair.rightToLeft].map((direction) => <tr key={direction.source}>
        <td>{label(direction.source)} → {label(direction.target)}</td><td>{direction.sourcePresentTargetOffers}</td><td>{direction.sourceAbsentTargetOffers}</td><td>{direction.sourcePresentTargetPicks}</td><td>{direction.sourceAbsentTargetPicks}</td><td>{formatValue(direction.affinity)}</td><td>{interval(direction.affinityCi)}</td><td>{formatValue(direction.probPositive, "percent")}</td><td>{formatValue(direction.probNegative, "percent")}</td><td>{formatValue(direction.posteriorSd)}</td><td>{{ available: "可用", insufficient_contrast: "对照不足", co_deck: "牌组共现" }[direction.status]}</td>
      </tr>)}</tbody>
    </table></div>
  </Card>;
}

export function ArchetypesPage() {
  const { characters, openObject, openRun, game, filter, revision } = useAppStore();
  const [character, setCharacter] = useObjectViewState(`${game}/archetypes`, "character", characters[0] ?? "Ironclad");
  const filterKey = JSON.stringify(filter);
  const scope = `${game}/archetypes/${character}/${filterKey}/${revision}`;
  const [search, setSearch] = useObjectViewState(scope, "search", "");
  const [evidence, setEvidence] = useObjectViewState(scope, "evidence", "all");
  const [selectedCard, setSelectedCard] = useObjectViewState(scope, "selectedCard", "");
  const [selectedPair, setSelectedPair] = useObjectViewState(scope, "selectedPair", "");
  const [sort, setSort] = useObjectViewState(scope, "sort", { field: "label", direction: "asc" as "asc" | "desc" });
  const [cardOffset, setCardOffset] = useObjectViewState(`${scope}/${search}/${evidence}/${sort.field}/${sort.direction}`, "cardOffset", 0);
  const [runOffset, setRunOffset] = useObjectViewState(scope, "runOffset", 0);
  const [matrixRow, setMatrixRow] = useObjectViewState(scope, "matrixRow", 0);
  const [matrixColumn, setMatrixColumn] = useObjectViewState(scope, "matrixColumn", 0);
  useEffect(() => {
    if (!characters.includes(character)) setCharacter(characters[0] ?? "Ironclad");
  }, [characters, character]);
  const { data: response, error, loading } = useAnalysis<CardArchetypeAnalysisResult>({ op: "archetypes", character });
  const data = response?.characterId === character ? response : null;
  const label = (id: string) => zhEntity(id, "cards", id);
  const communityName = (id: string | null) => {
    const index = data?.communities.findIndex((community) => community.id === id) ?? -1;
    return index < 0 ? "未分类" : `流派 ${index + 1}`;
  };
  const allCards = [...new Set([...(data?.cardOrder ?? []), ...(data?.insufficientCards ?? []), ...(data?.starterCards ?? [])])];
  const filteredCards = useMemo(() => {
    const ids = [...new Set([...(data?.cardOrder ?? []), ...(data?.insufficientCards ?? []), ...(data?.starterCards ?? [])])].filter((id) => data?.cards[id] && (evidence === "all" || data.cards[id].evidenceStatus === evidence) && `${zhEntity(id, "cards", id)} ${id}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    return ids.sort((left, right) => {
      const a = sort.field === "label" ? zhEntity(left, "cards", left) : data!.cards[left][sort.field as keyof ArchetypeCardStat];
      const b = sort.field === "label" ? zhEntity(right, "cards", right) : data!.cards[right][sort.field as keyof ArchetypeCardStat];
      if (a == null || b == null) return a === b ? 0 : a == null ? 1 : -1;
      const value = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "zh-CN");
      return value * (sort.direction === "asc" ? 1 : -1);
    });
  }, [data, evidence, search, sort]);
  const scales = useMemo(() => Object.fromEntries(["offers", "picks", "runsPresent", "copiesAcquired", "specialization", "bridgeScore", "coreScore"].map((field) => [field, new NumericColumnScale(filteredCards.map((id) => {
    const value = data!.cards[id][field as keyof ArchetypeCardStat];
    return typeof value === "number" ? value : null;
  }))])), [filteredCards, data]);
  const matrixOrder = data?.matrixOrder ?? [];
  const matrixRows = matrixOrder.slice(matrixRow, matrixRow + 24);
  const matrixColumns = matrixOrder.slice(matrixColumn, matrixColumn + 24);
  const pairScale = useMemo(() => new NumericColumnScale(Object.values(data?.pairs ?? {}).map((pair) => pair.affinity)), [data]);
  const selected = selectedCard ? data?.cards[selectedCard] : null;
  const pair = selectedPair ? data?.pairs[selectedPair] : null;
  async function exportCards() {
    if (!data) return;
    const fields = ["offers", "picks", "baselinePickRate", "runsPresent", "copiesAcquired", "dominantArchetype", "specialization", "bridgeScore", "coreScore", "evidenceStatus"] as const;
    await exportCsv(`${game}-${character}-archetype-cards.csv`, ["ID", "名称", "可选", "选取", "基础选取率", "持有对局", "获得张数", "主流派", "专属性", "桥接分数", "核心分数", "证据", "软归属"], filteredCards.map((id) => [id, label(id), ...fields.map((field) => data.cards[id][field]), data.cards[id].membership]), game);
  }
  function changeSort(field: string) {
    setSort({ field, direction: sort.field === field && sort.direction === "desc" ? "asc" : "desc" });
    setCardOffset(0);
  }
  return <>
    <div className="page-tools"><label>角色<select value={character} onChange={(event) => setCharacter(event.target.value)}>{characters.map((id) => <option key={id} value={id}>{zhCharacter(id)}</option>)}</select></label>{data && <button disabled={loading} onClick={() => void exportJson(`${game}-${character}-card-archetypes.json`, data, game)}>导出模型 JSON</button>}</div>
    <ErrorState error={error} />
    {!data ? <EmptyState>{loading ? "正在分析…" : "没有数据"}</EmptyState> : <div className="analysis-page" aria-busy={loading} data-analysis-ready={!loading ? "true" : undefined}>
      {data.status !== "available" && <EmptyState>{data.status === "no_structure" ? "未发现稳定流派结构" : "样本不足"}</EmptyState>}
      <MetricGrid>
        <MetricTile label="单人对局" value={data.diagnostics.perspectiveRuns} />
        <MetricTile label="选择记录" value={data.diagnostics.choiceEvents} kind="choice" help={`拒绝记录 ${data.diagnostics.rejectedChoiceEvents}`} />
        <MetricTile label="获得记录" value={data.diagnostics.acquisitionEvents} kind="choice" />
        <MetricTile label="分析卡牌" value={data.diagnostics.analyzedCards} kind="choice" help={`样本不足 ${data.diagnostics.insufficientCards}`} />
        <MetricTile label="流派" value={data.communities.length} />
        <MetricTile label="证据模式" value={modes[data.evidenceMode]} kind="choice" />
      </MetricGrid>
      {data.cardOrder.length > 0 && <Card title="构筑结构" help="点的大小表示持有局数，颜色表示主导流派，坐标为模型布局。选择节点查看统计，关联不代表因果。">
        <svg viewBox="0 0 800 420" className="archetype-graph" role="img" aria-label="卡牌关联网络">
          {data.visibleEdges.map((id) => {
            const relationship = data.pairs[id];
            if (!relationship) return null;
            const a = data.cards[relationship.left], b = data.cards[relationship.right];
            return a && b ? <line key={id} x1={40 + a.x * 720} y1={20 + a.y * 380} x2={40 + b.x * 720} y2={20 + b.y * 380} stroke="var(--choice)" opacity={0.25}><title>{label(a.id)} / {label(b.id)} · 亲和 {formatValue(relationship.affinity)}</title></line> : null;
          })}
          {data.cardOrder.map((id) => {
            const card = data.cards[id];
            if (!card || !Number.isFinite(card.x) || !Number.isFinite(card.y)) return null;
            const x = 40 + card.x * 720, y = 20 + card.y * 380;
            return <g key={id} className="graph-node" role="button" tabIndex={0} aria-label={`${label(id)} · ${communityName(card.dominantArchetype)} · 持有 ${card.runsPresent} 局`} aria-pressed={selectedCard === id} onClick={() => setSelectedCard(id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedCard(id); } }}>
              <title>{label(id)} · {communityName(card.dominantArchetype)} · 持有 {card.runsPresent} 局 · 选择率 {formatValue(card.baselinePickRate, "percent")}</title>
              <circle cx={x} cy={y} r={Math.sqrt(Math.max(24, Math.min(180, card.runsPresent * 3)) / Math.PI)} fill={card.dominantArchetype ? objectColor("archetype", card.dominantArchetype) : "var(--secondary)"} stroke={selectedCard === id ? "var(--text)" : "transparent"} strokeWidth={2} />
              {selectedCard === id && <text x={Math.min(650, x + 10)} y={Math.max(15, y - 10)} fill="var(--text)" fontSize="12">{label(id)}</text>}
            </g>;
          })}
        </svg>
        <div className="legend">{data.communities.map((community) => <span key={community.id}><i style={{ background: objectColor("archetype", community.id) }} />{communityName(community.id)}</span>)}<span><i style={{ background: "var(--secondary)" }} />未分类</span></div>
        <label>查看卡牌<select value={selectedCard} onChange={(event) => setSelectedCard(event.target.value)}><option value="">选择卡牌</option>{data.cardOrder.map((id) => <option key={id} value={id}>{label(id)}</option>)}</select></label>
        {selected && <div className="archetype-selected"><button className="object-link" style={{ color: objectColor("card", selected.id) }} onClick={() => openObject("card", selected.id)}>{label(selected.id)}</button><span style={{ color: selected.dominantArchetype ? objectColor("archetype", selected.dominantArchetype) : undefined }}>{communityName(selected.dominantArchetype)}</span><span>持有 {selected.runsPresent} 局</span><span>选择率 {formatValue(selected.baselinePickRate, "percent")}</span><span title={JSON.stringify(selected.membership)}>{Object.entries(selected.membership).map(([id, value]) => `${communityName(id)} ${formatValue(value, "percent")}`).join(" · ") || "—"}</span></div>}
      </Card>}
      {data.communities.map((community) => <Card key={community.id} title={<span style={{ color: objectColor("archetype", community.id) }}>{communityName(community.id)}</span>} help={`稳定性 ${formatValue(community.stability, "percent")} · 内聚度 ${formatValue(community.cohesion, "percent")} · 支持 ${community.totalEvidence}`}>
        <div className="legend"><span>{community.members.length} 张卡牌</span><span>主导对局 {community.dominantRunCount}</span><span>历史胜率 {formatValue(community.historicalWinRate, "percent")}</span><span>稳定性 {formatValue(community.stability, "percent")}</span><span>内聚度 {formatValue(community.cohesion, "percent")}</span></div>
        <div className="inventory">{community.members.map((id) => <button key={id} className={community.coreCards.includes(id) ? "core-card" : ""} style={{ color: objectColor("card", id) }} onClick={() => openObject("card", id)} title={community.coreCards.includes(id) ? "核心卡牌" : community.bridgeCards.includes(id) ? "桥接卡牌" : "成员"}>{label(id)}{community.coreCards.includes(id) ? " · 核心" : community.bridgeCards.includes(id) ? " · 桥接" : ""}</button>)}</div>
      </Card>)}
      {matrixOrder.length > 0 && <Card title="卡牌亲和" help="行列代表卡牌，数值为模型亲和系数，蓝→青→橙仅表示数值大小；不表示胜率或安全性。· 为自身，— 为无法评估。点击查看方向证据。">
        <div className="table-scroll arena-matrix archetype-affinity-matrix"><table><thead><tr><th className="sticky-name">行 / 列</th>{matrixColumns.map((id, index) => <th key={id} title={label(id)}>{matrixColumn + index + 1}</th>)}</tr></thead><tbody>{matrixRows.map((id, index) => <tr key={id}><th className="sticky-name"><button className="object-link" onClick={() => openObject("card", id)}>{matrixRow + index + 1} · {label(id)}</button></th>{matrixColumns.map((other) => {
          const relationship = data.pairs[affinityId(id, other)];
          const value = relationship?.affinity;
          return <td key={other} title={`${label(id)} / ${label(other)} · ${formatValue(value)}\n区间 ${interval(relationship?.affinityCi ?? null)}`}><button disabled={id === other || !relationship} className="arena-cell" aria-pressed={selectedPair === affinityId(id, other)} style={{ background: value == null || id === other ? undefined : numericColor(pairScale.intensity(value) ?? 0), color: value == null || id === other ? "var(--text)" : "#000" }} onClick={() => setSelectedPair(affinityId(id, other))}>{id === other ? "·" : formatValue(value)}</button></td>;
        })}</tr>)}</tbody></table></div>
        <div className="action-row"><span>行</span><Pager offset={matrixRow} total={matrixOrder.length} limit={24} onChange={setMatrixRow} /><span>列</span><Pager offset={matrixColumn} total={matrixOrder.length} limit={24} onChange={setMatrixColumn} /></div>
      </Card>}
      {pair && <PairEvidence pair={pair} label={label} />}
      <Card title="卡牌归属" actions={<button disabled={!filteredCards.length} onClick={() => void exportCards()}>导出 CSV</button>}>
        <div className="page-tools"><input type="search" aria-label="搜索流派卡牌" placeholder="搜索名称或 ID" value={search} onChange={(event) => { setSearch(event.target.value); setCardOffset(0); }} /><label>证据<select value={evidence} onChange={(event) => { setEvidence(event.target.value); setCardOffset(0); }}><option value="all">全部</option>{Object.entries(statuses).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
        <div className="table-scroll"><table><thead><tr>{[["label", "卡牌"], ["dominantArchetype", "主流派"], ["offers", "可选"], ["picks", "选取"], ["baselinePickRate", "基础选取率"], ["runsPresent", "持有对局"], ["copiesAcquired", "获得张数"], ["specialization", "专属性"], ["bridgeScore", "桥接分数"], ["coreScore", "核心分数"], ["evidenceStatus", "证据"]].map(([field, title]) => <th key={field}><button onClick={() => changeSort(field)}>{title}{sort.field === field ? sort.direction === "desc" ? " ↓" : " ↑" : ""}</button></th>)}<th>软归属</th></tr></thead><tbody>{filteredCards.slice(cardOffset, cardOffset + 100).map((id) => {
          const card = data.cards[id];
          return <tr key={id}><td className="sticky-name"><button className="object-link" style={{ color: objectColor("card", id) }} onClick={() => openObject("card", id)}>{label(id)}</button></td><td style={{ color: card.dominantArchetype ? objectColor("archetype", card.dominantArchetype) : undefined }}>{communityName(card.dominantArchetype)}</td>{["offers", "picks", "baselinePickRate", "runsPresent", "copiesAcquired", "specialization", "bridgeScore", "coreScore"].map((field) => {
            const value = card[field as keyof typeof card];
            return <td key={field}><ObjectNumericCell value={typeof value === "number" ? value : null} format={field === "baselinePickRate" ? "percent" : "number"} semantic={field === "baselinePickRate" ? "preference" : "number"} fill={typeof value === "number" ? scales[field]?.fraction(value) : null} heat={typeof value === "number" ? scales[field]?.intensity(value) : null} /></td>;
          })}<td>{statuses[card.evidenceStatus]}</td><td>{Object.entries(card.membership).map(([community, value]) => `${communityName(community)} ${formatValue(value, "percent")}`).join(" · ") || "—"}</td></tr>;
        })}</tbody></table>{!filteredCards.length && <EmptyState>没有符合条件的卡牌</EmptyState>}</div>
        <Pager offset={cardOffset} total={filteredCards.length} onChange={setCardOffset} />
      </Card>
      <Card title="对局构成" actions={<button disabled={loading || !data.runComposition.length} onClick={() => void exportCsv(`${game}-${character}-archetype-runs.csv`, ["对局 ID", "日期", "版本", "结果", "楼层", "主流派", "分析卡牌", "归属"], data.runComposition.map((run) => [run.originalRunId, run.timestamp, run.buildId, run.status, run.floor, run.dominantArchetype, run.analyzedCards, run.membership]), game)}>导出 CSV</button>}>
        <div className="table-scroll"><table><thead><tr>{["日期", "版本", "结果", "楼层", "主流派", "分析卡牌", "归属"].map((title) => <th key={title}>{title}</th>)}</tr></thead><tbody>{data.runComposition.slice(runOffset, runOffset + 100).map((run) => <tr key={run.runId}><td><button className="object-link" onClick={() => openRun(run.originalRunId)}>{formatValue(run.timestamp, "date")}</button></td><td>{run.buildId || "—"}</td><td>{{ win: "胜利", loss: "失败", abandoned: "放弃" }[run.status]}</td><td>{run.floor}</td><td style={{ color: run.dominantArchetype ? objectColor("archetype", run.dominantArchetype) : undefined }}>{communityName(run.dominantArchetype)}</td><td>{run.analyzedCards}</td><td>{Object.entries(run.membership).map(([id, value]) => `${communityName(id)} ${formatValue(value, "percent")}`).join(" · ") || "—"}</td></tr>)}</tbody></table>{!data.runComposition.length && <EmptyState>没有可分析的对局组成</EmptyState>}</div>
        <Pager offset={runOffset} total={data.runComposition.length} onChange={setRunOffset} />
      </Card>
      <Card title="模型诊断" help={data.diagnostics.warnings.join("\n")}>
        <dl className="details model-diagnostics"><dt>状态</dt><dd>{{ available: "可用", no_structure: "未发现稳定结构", insufficient_data: "样本不足" }[data.status]}</dd><dt>证据模式</dt><dd>{modes[data.evidenceMode]}</dd><dt>版本</dt><dd>{data.diagnostics.builds.join(" · ") || "—"}</dd><dt>版本漂移</dt><dd>{data.diagnostics.versionDriftCompared ? `${data.diagnostics.changedPairCount} 个变化关系` : "未比较"}</dd><dt>卡牌范围</dt><dd>{allCards.length} 项 · 已分析 {data.cardOrder.length} · 样本不足 {data.insufficientCards.length} · 初始牌组 {data.starterCards.length}</dd></dl>
        {data.diagnostics.warnings.length > 0 && <details><summary>数据提示 · {data.diagnostics.warnings.length}</summary><ul>{data.diagnostics.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
        <details><summary>参数与统计证据</summary><pre>{JSON.stringify({ config: data.config, diagnostics: data.diagnostics }, null, 2)}</pre></details>
      </Card>
    </div>}
  </>;
}
