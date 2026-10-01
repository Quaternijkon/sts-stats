import { useMemo, useState } from "react";
import { Card, EmptyState, PerspectiveAnalysisCard } from "../../components/UI";
import { useAnalysis } from "../../state/useAnalysis";
import { useAppStore } from "../../state/appStore";
import { zhCharacter } from "../../../Engine/domain/i18n";
import { characterColor, formatValue, rateColor } from "../../styles/theme";
import { ActivityCalendar, useLocalToday } from "./ActivityCalendar";
import { activityDays, floorRates, localDateKey, type CharacterSummary, type OverviewData } from "./helpers";

export function RateBars({ rows, xTitle = "", completionEndpoint = false }: {
  rows: { label: string; value: number | null; help?: string }[];
  xTitle?: string;
  completionEndpoint?: boolean;
}) {
  return <div className="overview-rates">
    <div className="rate-chart">
      <div className="rate-axis" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>
      <div className="bar-chart" aria-label={xTitle}>
        {rows.map((row, index) => {
          const value = row.value != null && Number.isFinite(row.value) ? row.value : null;
          const help = `${row.label}：${formatValue(value, "percent")}${row.help ? "\n" + row.help : ""}`;
          const showTick = completionEndpoint ? index === 0 || index === rows.length - 1 || (index + 1) % 10 === 0
            : rows.length < 12 || index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / 6) === 0;
          return <div className="bar-column" key={row.label} title={help} tabIndex={0} role="img" aria-label={help}>
            {value != null && <span style={{ height: `${Math.max(0, Math.min(1, value)) * 100}%`, background: rateColor(value) }} />}
            {showTick && <small>{row.label}</small>}
          </div>;
        })}
      </div>
    </div>
    <div className="overview-rate-legend" aria-label="比例色阶：0% 红色，50% 黄色，100% 绿色。">
      <span>{xTitle}</span><span>0%</span><i style={{ background: `linear-gradient(to right, ${rateColor(0)}, ${rateColor(0.5)}, ${rateColor(1)})` }} /><span>100%</span>
    </div>
  </div>;
}

export function PerspectiveCard({ title, kind }: { title: string; kind: "rolling" | "survival" | "playtime" }) {
  const characters = useAppStore((state) => state.characters);
  const [selectedCharacter, setSelectedCharacter] = useState("all");
  const [year, setYear] = useState(0);
  const today = useLocalToday();
  const date = localDateKey(today);
  const days = useMemo(() => activityDays(new Date(`${date}T00:00:00`), year), [date, year]);
  const selection = selectedCharacter === "all" ? 0 : Math.max(0, characters.indexOf(selectedCharacter) + 1);
  const character = characters[selection - 1];
  const { data, loading, error, reload } = useAnalysis<OverviewData>({
    op: "dashboard",
    filter: { characters: character ? [character] : [] },
    ...(kind === "playtime" ? { activityDays: days } : {}),
  });
  const empty = !data || (kind === "playtime" ? !data.summary.total : !data.summary.completed);
  return <PerspectiveAnalysisCard title={title} characters={characters} selection={selection}
    onSelectionChange={(index) => setSelectedCharacter(characters[index - 1] ?? "all")}
    className={kind === "playtime" ? "overview-perspective chart-wide" : "overview-perspective"}
    help={kind === "survival" ? "1–49：到达该层的非放弃局数 ÷ 非放弃局数。50 · 通关：胜利局数 ÷ 非放弃局数，不使用真实第 50 层。"
      : kind === "rolling" ? "按时间排列非放弃记录，每根柱统计截至该局最近 10 局的胜率；不足 10 局时使用已有记录。"
        : "按本地自然日拆分对局时长；跨午夜的对局分配到对应日期。颜色表示有游戏时间日期的百分位。"}
    loading={loading} error={error} empty={empty} emptyText={kind === "playtime" ? "没有匹配的单人记录" : "没有已完成对局"} height={280} onRetry={reload}>
    {kind === "playtime" ? <ActivityCalendar playtime={data?.playtime} days={days} today={today} year={year} onYearChange={setYear} />
      : <RateBars rows={kind === "rolling" ? (data?.rolling ?? []).map((row) => ({ label: String(row.index), value: row.value, help: formatValue(row.timestamp, "date") }))
        : data?.summary.completed ? floorRates(data) : Array.from({ length: 50 }, (_, index) => ({ label: index === 49 ? "50 · 通关" : String(index + 1), value: null }))} xTitle={kind === "rolling" ? "完成局序号" : "楼层"} completionEndpoint={kind === "survival"} />}
  </PerspectiveAnalysisCard>;
}

export function CharacterComparison({ rows, rate = false }: { rows: CharacterSummary[]; rate?: boolean }) {
  const visible = rows.filter((row) => row.total > 0 && (!rate || row.completed > 0));
  const maximum = Math.max(1, ...visible.map((row) => row.maxWinStreak));
  return <Card title={rate ? "角色胜率" : "角色最高连胜"}
    help={rate ? "胜利局数 ÷ 非放弃局数；未完成的角色样本不绘制胜率。" : "按时间排列每个角色的单人记录，失败和放弃都会中断连胜。"}>
    <div className="chart">
      {!visible.length ? <EmptyState>暂无可绘制数据</EmptyState> : <div className="character-bars">
        {visible.map((row) => {
          const value = rate ? row.winRate : row.maxWinStreak;
          const help = `${zhCharacter(row.character)}：${formatValue(value, rate ? "percent" : "number")}\n${row.wins} 胜 / ${row.completed} 局 · ${row.abandoned} 弃`;
          return <div key={row.character}>
            <span title={zhCharacter(row.character)} style={{ color: characterColor(row.character) }}>{zhCharacter(row.character)}</span>
            <div title={help} tabIndex={0} role="img" aria-label={help}>
              <i style={{ width: `${Math.max(0, Math.min(1, rate ? value : value / maximum)) * 100}%`, background: characterColor(row.character) }} />
            </div>
            <strong title={help}>{formatValue(value, rate ? "percent" : "number")}</strong>
          </div>;
        })}
      </div>}
    </div>
  </Card>;
}
