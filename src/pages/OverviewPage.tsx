import { useMemo } from "react";
import { useAnalysis } from "../state/useAnalysis";
import { useAppStore } from "../state/appStore";
import { Card, MetricGrid, MetricTile, EmptyState, ErrorState } from "../components/UI";
import { formatValue } from "../styles/theme";
import { CharacterRecords } from "./overview/CharacterRecords";
import { CharacterComparison, PerspectiveCard, RateBars } from "./overview/OverviewCharts";
import { OutcomeHistory } from "./overview/OutcomeHistory";
import type { OverviewData } from "./overview/helpers";
import { RestContent, type RestData } from "./overview/RestContent";
import "./overview/overview.css";

export function OverviewPage({ career = false }: { career?: boolean }) {
  const { data, loading, error, reload, isCurrent } = useAnalysis<OverviewData>(
    { op: career ? "career" : "dashboard" },
    { unfiltered: career },
  );
  const game = useAppStore((state) => state.game);
  const ready = useAppStore((state) => state.ready);
  const runs = useAppStore((state) => state.dataset.runs);
  const resetFilter = useAppStore((state) => state.resetFilter);
  const navigate = useAppStore((state) => state.navigate);
  const hasSoloRecords = useMemo(() => runs.some((run) => !run.isMultiplayer && run.playerCount <= 1 && run.players.length <= 1), [runs]);
  if (error) return <Card><ErrorState error={error} /><button onClick={reload}>重试</button></Card>;
  if (!ready || !data) return <EmptyState>{loading ? "正在分析…" : "没有数据"}</EmptyState>;
  const summary = data.summary;
  const rows = data.characterStats ?? data.characters ?? [];
  if (!summary.total) return <div className="overview-page" data-analysis-ready={isCurrent && !loading ? "true" : undefined}><Card>
    <EmptyState>{career ? "没有单人记录" : hasSoloRecords ? "没有匹配的单人记录" : "尚未导入单人记录"}</EmptyState>
    <div className="overview-empty-actions">
      {!career && hasSoloRecords && <button onClick={resetFilter}>重置筛选</button>}
      {!hasSoloRecords && game === "sts2" && runs.length > 0 && <button onClick={() => navigate("coop")}>查看多人记录</button>}
      {!runs.length && <button onClick={() => navigate("local")}>导入存档</button>}
    </div>
  </Card></div>;
  return <div className="overview-page" data-analysis-ready={isCurrent && !loading ? "true" : undefined}>
    <MetricGrid>
      <MetricTile label="单人对局" value={summary.total} help={career ? "已导入的全部单人记录，包含放弃局；不受页面筛选影响。" : "当前筛选下的单人记录，包含放弃局。"} />
      <MetricTile label="胜率" value={summary.completed ? formatValue(summary.winRate, "percent") : "—"} kind="success" help={`胜利局数 ÷ 非放弃局数：${summary.wins} 胜 / ${summary.completed} 局。`} />
      <MetricTile label={career ? "单人记录时长" : "平均每局承伤"} value={formatValue(career ? data.totalPlaytime : summary.avgDamageTaken, career ? "duration" : "number")} kind={career ? "time" : "damage"}
        help={career ? "已导入全部单人记录的时长合计；存档累计时长可在存档管理中查看。" : "当前筛选下全部单人记录的承伤总和 ÷ 单人记录数，包含放弃局和零承伤局。"} />
      <MetricTile label="最高连胜" value={summary.maxWinStreak} kind="streak" help="按时间排列单人记录，失败和放弃都会中断连胜。" />
      <MetricTile label={career ? "累计楼层" : "胜利最少卡牌数"} value={formatValue(career ? data.floorsClimbed : summary.minWinningDeckSize)} kind={career ? "floor" : "choice"}
        help={career ? "已导入全部单人记录的最终楼层合计。" : "当前筛选下胜利记录最终牌组的最少卡牌数，包含升级及重复卡牌。"} />
      <MetricTile label={career ? "最高进阶" : "胜利最多卡牌数"} value={formatValue(career ? summary.highestAscension : summary.maxWinningDeckSize)} kind={career ? "floor" : "choice"}
        help={career ? "已导入全部单人记录的最高进阶。" : "当前筛选下胜利记录最终牌组的最多卡牌数，包含升级及重复卡牌。"} />
    </MetricGrid>
    {!career && <OutcomeHistory history={data.history} />}
    {!career && <PerspectiveCard title="游戏投入时间" kind="playtime" />}
    <div className="chart-grid">
      <CharacterComparison rows={rows} rate />
      <CharacterComparison rows={rows} />
      {!career && <>
        <PerspectiveCard title="滚动胜率" kind="rolling" />
        <PerspectiveCard title="楼层到达率" kind="survival" />
        <Card title="进阶胜率" help="各进阶胜利局数 ÷ 非放弃局数。">
          <div className="chart"><RateBars rows={(data.ascensions ?? []).map((row) => ({ label: String(row.ascension), value: row.completed ? row.winRate : null, help: `${row.wins} 胜 / ${row.completed} 局 · ${row.abandoned} 弃` }))} xTitle="进阶" /></div>
        </Card>
      </>}
    </div>
    <CharacterRecords rows={rows} career={career} />
  </div>;
}
export function RestAnalysisPage() {
  const { data, error, loading, reload, isCurrent } = useAnalysis<RestData>({ op: "restAnalysis" });
  if (error) return <Card><ErrorState error={error} /><button onClick={reload}>重试</button></Card>;
  if (!data) return <EmptyState>{loading ? "正在分析…" : "没有记录"}</EmptyState>;
  if (!data.siteCount) return <div data-analysis-ready={isCurrent && !loading ? "true" : undefined}><EmptyState>当前筛选没有休息处记录</EmptyState></div>;
  return <RestContent data={data} ready={isCurrent && !loading} />;
}
