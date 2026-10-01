import { useEffect, useMemo, useRef, useState } from "react";
import type { PreferenceArenaResult } from "../../../Engine/domain/preferenceArena";
import { zhCharacter, zhEntity } from "../../../Engine/domain/i18n";
import { Card, EmptyState, ErrorState, MetricGrid, MetricTile, ObjectNumericCell, NumericColumnScale } from "../../components/UI";
import { useAnalysis } from "../../state/useAnalysis";
import { useAppStore } from "../../state/appStore";
import { objectColor, formatValue, preferenceColor, preferenceTextColor } from "../../styles/theme";
import { platform } from "../../services/platform";
import { analysisClient } from "../../worker/client";
import { exportJson, exportSvgPng, printArena } from "./export";
import { Pager } from "./ObjectTables";
import { useObjectViewState } from "./viewState";

const relations = { direct: "直接证据", indirect: "间接推断", na: "不可比较" };
const interval = (values: [number, number] | null, format = "number") =>
  values ? values.map((value) => formatValue(value, format)).join("–") : "—";

export function ArenaPage({ ancientId, focusItemId, initialPerspective = "all" }: {
  ancientId?: string;
  focusItemId?: string;
  initialPerspective?: string;
} = {}) {
  const { characters, openObject, game, filter, revision } = useAppStore();
  const scope = `${game}/arena/${ancientId ?? "card"}/${focusItemId ?? ""}`;
  const [category, setCategory] = useObjectViewState(scope, "category", "all");
  const [perspective, setPerspective] = useObjectViewState(scope, "perspective", initialPerspective);
  const [ordering, setOrdering] = useObjectViewState<keyof PreferenceArenaResult["orderings"]>(scope, "ordering", "adaptive");
  const [selectedPair, setSelectedPair] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const filterKey = JSON.stringify(filter);
  const pagingScope = `${scope}/${category}/${perspective}/${ordering}/${filterKey}/${revision}`;
  const [rowPage, setRowPage] = useObjectViewState(pagingScope, "rowPage", 0);
  const [colPage, setColPage] = useObjectViewState(pagingScope, "colPage", 0);
  const [rankPage, setRankPage] = useObjectViewState(pagingScope, "rankPage", 0);
  const previousPerspective = useRef(initialPerspective);
  useEffect(() => {
    if (previousPerspective.current !== initialPerspective) {
      previousPerspective.current = initialPerspective;
      setPerspective(initialPerspective);
      if (!["all", "colorless", initialPerspective].includes(category)) setCategory("all");
    }
  }, [initialPerspective]);
  useEffect(() => {
    setSelectedPair(null);
  }, [category, perspective, ancientId, focusItemId, ordering, revision, filterKey, game]);
  const { data, error, loading } = useAnalysis<PreferenceArenaResult>({
    op: "arena",
    scope: {
      source: ancientId ? "ancient" : "card",
      ...(ancientId ? { ancientId } : { cardCategory: category }),
      ...(focusItemId ? { focusItemId } : {}),
      playerCharacter: perspective === "all" ? undefined : perspective,
    },
  });
  const order = data?.orderings[ordering] ?? data?.ordering ?? [];
  const rows = order.slice(rowPage, rowPage + 40);
  const cols = order.slice(colPage, colPage + 40);
  const objectKind = data?.itemCategory === "relics" ? "relic" : "card";
  const label = (id: string) => zhEntity(id, data?.itemCategory ?? "cards", id);
  const pair = selectedPair ? data?.pairs[selectedPair] : null;
  const warnings = [...new Set([...(data?.warnings ?? []), ...(data?.parseReport.warnings ?? []), ...(data?.capability.warnings ?? [])])];
  const offeredScale = useMemo(() => new NumericColumnScale(order.map((id) => data!.items[id].offered)), [data, order]);
  const chosenScale = useMemo(() => new NumericColumnScale(order.map((id) => data!.items[id].chosen)), [data, order]);
  async function exportArena(format: "csv" | "json" | "svg" | "png") {
    if (!data) return;
    setExporting(true);
    setExportError(null);
    try {
      const name = `${game}-${ancientId ? "ancient" : "card"}-arena`;
      if (format === "json") {
        await exportJson(`${name}.json`, data, game);
      } else if (format === "csv") {
        const text = await analysisClient(game).call<string>({ op: "arenaCsv", result: data, order });
        await platform.exportText(`${name}.csv`, text);
      } else {
        const svg = await analysisClient(game).call<string>({ op: "arenaSvg", result: data, order });
        if (format === "png") await exportSvgPng(`${name}.png`, svg);
        else await platform.exportText(`${name}.svg`, svg);
      }
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExporting(false);
    }
  }
  return <>
    <div className="page-tools">
      {!ancientId && <label title="按实际提供卡牌的角色划分选择目录；无色目录使用引擎识别。角色目录与角色视角保持一致。">选择目录<select value={category} onChange={(event) => {
        const next = event.target.value;
        setCategory(next);
        if (!["all", "colorless", perspective].includes(next)) setPerspective("all");
      }}>
        <option value="all">全部</option>
        {characters.map((id) => <option key={id} value={id}>{zhCharacter(id)}</option>)}
        <option value="colorless">无色</option>
      </select></label>}
      <label>视角<select value={perspective} onChange={(event) => setPerspective(event.target.value)}>
        <option value="all">总体</option>
        {characters.map((id) => <option key={id} value={id} disabled={!ancientId && !["all", "colorless", id].includes(category)}>{zhCharacter(id)}</option>)}
      </select></label>
      <label>顺序<select value={ordering} onChange={(event) => setOrdering(event.target.value as typeof ordering)}>
        <option value="adaptive">自适应栏位</option>
        <option value="arena">竞技排名</option>
        <option value="choiceRate">选择率</option>
        <option value="slotMean">平均栏位</option>
      </select></label>
      {(["csv", "json", "svg", "png"] as const).map((format) => <button key={format} disabled={!data || loading || exporting} onClick={() => void exportArena(format)}>导出 {format.toUpperCase()}</button>)}
      <button disabled={!data || loading || !order.length || exporting} onClick={printArena}>打印 / PDF</button>
    </div>
    <ErrorState error={exportError ?? error} />
    {!data ? <EmptyState>{loading ? "正在分析…" : "没有选择记录"}</EmptyState> : !order.length ? <div data-analysis-ready={!loading ? "true" : undefined}><EmptyState>暂无可比较的选择</EmptyState></div> : <div className="print-arena" aria-busy={loading} data-analysis-ready={!loading ? "true" : undefined}>
      <section className="arena-print-summary">
        <h2>选择偏好竞技场</h2>
        <p>{order.length} 个对象 · {data.parseReport.eventsValid} 次选择 · {data.components.length} 个连通分量</p>
        <table><thead><tr><th>对象</th><th>分量</th><th>排名</th><th>排名区间</th><th>提供</th><th>选择</th><th>选择率</th><th>选择率区间</th><th>选择后胜率</th><th>胜率区间</th></tr></thead><tbody>{order.map((id) => {
          const item = data.items[id];
          return <tr key={id}><td>{label(id)}</td><td>{item.componentId}</td><td>{item.rank}</td><td>{interval(item.rankCi)}</td><td>{item.offered}</td><td>{item.chosen}</td><td>{formatValue(item.choiceRate, "percent")}</td><td>{interval(item.choiceCi, "percent")}</td><td>{formatValue(item.winRate, "percent")}</td><td>{interval(item.winCi, "percent")}</td></tr>;
        })}</tbody></table>
      </section>
      <MetricGrid>
        <MetricTile label="有效选择" value={data.parseReport.eventsValid} kind="choice" help={`全部 ${data.parseReport.eventsTotal} · 拒绝 ${data.parseReport.eventsRejected}`} />
        <MetricTile label="比较对象" value={order.length} kind="choice" />
        <MetricTile label="关联对局" value={data.temporalMetadata.numRuns} />
        <MetricTile label="连通分量" value={data.components.length} help="不同连通分量之间不可比较；排名在各分量内计算。" />
      </MetricGrid>
      <Card title="选择偏好" help="行相对于列的选择偏好；50% 为中性。实线为直接证据，虚线为间接推断，— 为不可比较，· 为自身。">
        <div className="legend">
          <span><i style={{ background: preferenceColor(0) }} />低偏好</span>
          <span><i style={{ background: preferenceColor(0.5) }} />50% 中性</span>
          <span><i style={{ background: preferenceColor(1) }} />高偏好</span>
          <span>实线：直接 · 虚线：间接 · —：不可比较 · ·：自身</span>
        </div>
        <div className="table-scroll arena-matrix">
          <table>
            <thead><tr><th className="sticky-name">行 / 列</th>{cols.map((id, index) => <th key={id} title={label(id)}>{colPage + index + 1}</th>)}</tr></thead>
            <tbody>{rows.map((id, index) => <tr key={id}>
              <th className="sticky-name"><button className="object-link" style={{ color: objectColor(objectKind, id) }} onClick={() => openObject(objectKind, id)}>{rowPage + index + 1} · {label(id)}</button></th>
              {cols.map((other) => {
                const value = data.pairs[`${id}¦${other}`];
                const self = id === other;
                return <td key={other} title={`${label(id)} / ${label(other)}\n${self ? "自身" : value ? relations[value.relation] : "不可比较"} · ${formatValue(value?.pref, "percent")}\n区间 ${interval(value?.prefCi ?? null, "percent")}\n共同出现 ${value?.cooccurN ?? 0}`}>
                  <button className={`arena-cell ${value?.relation ?? "na"}`} aria-pressed={selectedPair === `${id}¦${other}`} disabled={self || !value} onClick={() => setSelectedPair(`${id}¦${other}`)} style={{ background: value?.pref != null && !self ? preferenceColor(value.pref) : undefined, color: value?.pref != null && !self ? preferenceTextColor(value.pref) : "var(--text)" }}>{self ? "·" : formatValue(value?.pref, "percent")}</button>
                </td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
        <div className="action-row"><span>行</span><Pager offset={rowPage} total={order.length} onChange={setRowPage} limit={40} /><span>列</span><Pager offset={colPage} total={order.length} onChange={setColPage} limit={40} /></div>
      </Card>
      {pair && <Card title={`${label(pair.rowId)} / ${label(pair.columnId)}`} help="偏好是模型推断；共同出现时的原始选择份额与模型偏好口径不同。间接推断没有两项直接同现证据。">
        <dl className="details pair-evidence">
          <dt>证据</dt><dd>{relations[pair.relation]}</dd>
          <dt>行偏好</dt><dd>{formatValue(pair.pref, "percent")}</dd>
          <dt>偏好区间</dt><dd>{interval(pair.prefCi, "percent")}</dd>
          <dt>方向置信度</dt><dd>{formatValue(pair.directionConfidence, "percent")}</dd>
          <dt>共同出现</dt><dd>{pair.cooccurN}</dd>
          <dt>行选择 / 份额</dt><dd>{formatValue(pair.rowChoiceCount)} / {formatValue(pair.rowShare, "percent")}</dd>
          <dt>列选择 / 份额</dt><dd>{formatValue(pair.columnChoiceCount)} / {formatValue(pair.columnShare, "percent")}</dd>
          <dt>第三项选择 / 份额</dt><dd>{formatValue(pair.thirdChoiceCount)} / {formatValue(pair.thirdShare, "percent")}</dd>
          <dt>其他选择 / 份额</dt><dd>{formatValue(pair.otherChoiceCount)} / {formatValue(pair.otherShare, "percent")}</dd>
          <dt>共同邻居</dt><dd>{pair.commonNeighbors}</dd>
          <dt>最短路径</dt><dd>{formatValue(pair.shortestPath)}</dd>
          <dt>连通分量</dt><dd>{formatValue(pair.componentId)}</dd>
        </dl>
      </Card>}
      <Card title="排名" help="排名和强度在连通分量内比较。选择后胜率只包括有胜负结果的被选择事件，不代表选择的因果收益。">
        <div className="table-scroll"><table>
          <thead><tr>{[data.itemCategory === "relics" ? "遗物" : "卡牌", "分量", "排名", "排名区间", "可选", "已选", "选择率", "选择率区间", "有结果选择", "胜利选择", "选择后胜率", "胜率区间", "强度", "强度区间", "平均栏位", "栏位状态"].map((title) => <th key={title}>{title}</th>)}</tr></thead>
          <tbody>{order.slice(rankPage, rankPage + 100).map((id) => {
            const item = data.items[id];
            return <tr key={id}>
              <td className="sticky-name"><button className="object-link" style={{ color: objectColor(objectKind, id) }} onClick={() => openObject(objectKind, id)}>{label(id)}</button></td>
              <td>{item.componentId}</td><td>{item.rank}</td><td>{interval(item.rankCi)}</td>
              <td><ObjectNumericCell value={item.offered} fill={offeredScale.fraction(item.offered)} heat={offeredScale.intensity(item.offered)} /></td>
              <td><ObjectNumericCell value={item.chosen} fill={chosenScale.fraction(item.chosen)} heat={chosenScale.intensity(item.chosen)} /></td>
              <td><ObjectNumericCell value={item.choiceRate} format="percent" semantic="preference" /></td><td>{interval(item.choiceCi, "percent")}</td>
              <td>{item.outcomeChosen}</td><td>{item.chosenWins}</td><td><ObjectNumericCell value={item.winRate} format="percent" semantic="rate" /></td><td>{interval(item.winCi, "percent")}</td>
              <td>{formatValue(item.theta)}</td><td>{interval(item.thetaCi)}</td><td title={`栏位 ${data.slotLabels.join(" / ")}\n次数 ${item.slotCounts.join(" / ")}\n占比 ${item.slotProfile.map((value) => formatValue(value, "percent")).join(" / ")}`}>{formatValue(item.slotMean)}</td><td>{{ stable: "稳定", nonstationary: "分布变化", insufficient: "样本不足" }[item.slotProfileStatus]}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <Pager offset={rankPage} total={order.length} onChange={setRankPage} />
      </Card>
      <Card title="模型诊断" help={warnings.join("\n")}>
        <dl className="details model-diagnostics">
          <dt>模型</dt><dd>Plackett–Luce / Laplace</dd>
          <dt>状态</dt><dd>{{ available: "可用", unstable: "不稳定", history_not_available: "缺少选择历史" }[data.status]}</dd>
          <dt>解析器</dt><dd>{data.parseReport.parser} · {data.parseReport.parserVersion}</dd>
          <dt>有效 / 全部 / 拒绝</dt><dd>{data.parseReport.eventsValid} / {data.parseReport.eventsTotal} / {data.parseReport.eventsRejected}</dd>
          <dt>选择集大小</dt><dd>{Object.entries(data.parseReport.choiceSetSizes).map(([size, count]) => `${size} 项：${count}`).join(" · ")}</dd>
          <dt>日期范围</dt><dd>{formatValue(data.temporalMetadata.firstEvent, "date")} – {formatValue(data.temporalMetadata.lastEvent, "date")}</dd>
          <dt>版本</dt><dd>{data.temporalMetadata.gameVersions.join(" · ") || "—"}</dd>
          <dt>可用字段</dt><dd>{[["对局", data.capability.hasRunId], ["时间", data.capability.hasTimestamp], ["结果", data.capability.hasOutcome], ["栏位", data.capability.hasSlotInformation], ["版本", data.capability.hasGameVersion]].map(([name, available]) => `${name}：${available ? "有" : "无"}`).join(" · ")}</dd>
        </dl>
        <div className="table-scroll"><table><thead><tr>{["分量", "对象", "选择", "收敛", "迭代", "协方差稳定", "后验抽样", "平均损失", "栏位 p", "栏位效应 V", "栏位结构"].map((name) => <th key={name}>{name}</th>)}</tr></thead>
          <tbody>{data.diagnostics.map((item) => {
            const slot = data.slotStructure[String(item.componentId)];
            return <tr key={item.componentId}><td>{item.componentId}</td><td>{item.itemCount}</td><td>{item.eventCount}</td><td>{item.converged ? "是" : "否"}</td><td>{item.iterations}</td><td>{item.covarianceStable ? "是" : "否"}</td><td>{item.posteriorDraws}</td><td>{formatValue(item.meanLogLoss)}</td><td>{formatValue(slot?.pValue)}</td><td>{formatValue(slot?.cramersV)}</td><td title={slot ? `${slot.testMethod} · ${slot.permutations} 次置换 · ${slot.orderingMethod}` : undefined}>{slot?.topologyEnabled ? "启用" : "排名回退"}</td></tr>;
          })}</tbody>
        </table></div>
        {warnings.length > 0 && <details><summary>数据提示 · {warnings.length}</summary><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
        <details><summary>完整统计证据</summary><pre>{JSON.stringify({ capability: data.capability, parseReport: data.parseReport, slotStructure: data.slotStructure, axisOrdering: data.axisOrdering, diagnostics: data.diagnostics }, null, 2)}</pre></details>
      </Card>
    </div>}
  </>;
}
