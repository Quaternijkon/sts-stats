import { useMemo, useState, type CSSProperties } from "react";
import { useAnalysis } from "../state/useAnalysis";
import { useAppStore } from "../state/appStore";
import {
  Card,
  MetricGrid,
  MetricTile,
  EmptyState,
  ErrorState,
  ObjectNumericCell,
} from "../components/UI";
import { zhCharacter } from "../../Engine/domain/i18n";
import {
  characterColor,
  characterAccentColor,
  overallCharacterColor,
  rateColor,
  numericColor,
  formatValue,
} from "../styles/theme";

function activityDays() {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 364);
  return Array.from({ length: 365 }, (_, i) => {
    const a = new Date(start);
    a.setDate(a.getDate() + i);
    const b = new Date(a);
    b.setDate(b.getDate() + 1);
    return {
      date: `${a.getFullYear()}-${String(a.getMonth() + 1).padStart(2, "0")}-${String(a.getDate()).padStart(2, "0")}`,
      startTime: a.valueOf() / 1000,
      endTime: b.valueOf() / 1000,
    };
  });
}
function RateBars({
  rows,
}: {
  rows: { label: string; value: number | null; help?: string }[];
}) {
  return (
    <div className="rate-chart">
      <div className="rate-axis">
        <span>100%</span>
        <span>50%</span>
        <span>0%</span>
      </div>
      <div className="bar-chart">
        {rows.map((r, i) => (
          <div
            className="bar-column"
            key={i}
            title={`${r.label}：${formatValue(r.value, "percent")}${r.help ? "\n" + r.help : ""}`}
          >
            <span
              style={{
                height: `${Math.max(0, Math.min(1, r.value ?? 0)) * 100}%`,
                background: rateColor(r.value ?? 0),
              }}
            />
            {(i === 0 ||
              i === rows.length - 1 ||
              rows.length < 12 ||
              i % 10 === 9) && <small>{r.label}</small>}
          </div>
        ))}
      </div>
    </div>
  );
}
function PerspectiveCard({
  title,
  kind,
}: {
  title: string;
  kind: "rolling" | "survival" | "playtime";
}) {
  const characters = useAppStore((s) => s.characters);
  const [selectedCharacter, setSelectedCharacter] = useState("all");
  const index =
    selectedCharacter === "all"
      ? 0
      : Math.max(0, characters.indexOf(selectedCharacter) + 1);
  const days = useMemo(activityDays, []);
  const character = characters[index - 1];
  const { data, loading, error } = useAnalysis<any>({
    op: "dashboard",
    filter: { characters: character ? [character] : [] },
    activityDays: days,
  });
  const color = character
    ? characterAccentColor(character)
    : overallCharacterColor(characters);
  return (
    <Card
      title={title}
      className={kind === "playtime" ? "chart-wide" : ""}
      help={
        kind === "survival"
          ? "1–49 为实际楼层到达率；50 · 通关为胜利局数 ÷ 非放弃局数。"
          : kind === "rolling"
            ? "最近 10 局已完成单人记录的滚动胜率，放弃记录不进入分母。"
            : "最近一年，按本地日期拆分对局时长。"
      }
      actions={
        <div
          className="perspective"
          style={{ "--perspective-color": color } as CSSProperties}
        >
          <label
            htmlFor={`perspective-${kind}`}
            title={character ? zhCharacter(character) : "总体"}
          >
            {character ? zhCharacter(character) : "总体"}
          </label>
          <input
            id={`perspective-${kind}`}
            type="range"
            min="0"
            max={characters.length}
            step="1"
            value={index}
            onChange={(e) =>
              setSelectedCharacter(
                characters[Number(e.target.value) - 1] ?? "all",
              )
            }
            aria-label={`${title}角色视角`}
          />
        </div>
      }
    >
      <div className="chart" aria-busy={loading}>
        <div
          className="perspective-plot"
          aria-hidden={
            !!error ||
            !data ||
            (kind !== "playtime" && !data?.summary?.completed)
          }
          style={{
            opacity:
              error ||
              !data ||
              (kind !== "playtime" && !data?.summary?.completed)
                ? 0
                : 1,
          }}
        >
          {kind === "playtime" ? (
            <div className="activity">
              <div className="activity-grid">
                {(
                  data?.playtime?.days ??
                  days.map((d) => ({ ...d, seconds: 0, level: 0 }))
                ).map((d: any) => (
                  <div
                    key={d.date}
                    title={`${d.date}\n${formatValue(d.seconds, "duration")}\n${d.runCount ?? 0} 局`}
                    style={{
                      background: d.seconds
                        ? numericColor(d.percentile ?? 0)
                        : "var(--inset)",
                      opacity: d.seconds ? 0.45 + (d.level ?? 1) * 0.13 : 1,
                    }}
                  />
                ))}
              </div>
              <div className="activity-summary">
                <span>
                  {formatValue(data?.playtime?.totalSeconds, "duration")}
                </span>
                <span>{data?.playtime?.activeDays ?? 0} 个活跃日</span>
              </div>
            </div>
          ) : (
            <RateBars
              rows={
                kind === "rolling"
                  ? (data?.rolling ?? []).map((r: any) => ({
                      label: String(r.index),
                      value: r.value,
                      help: formatValue(r.timestamp, "date"),
                    }))
                  : [
                      ...(
                        data?.survival ??
                        Array.from({ length: 49 }, (_, i) => ({
                          floor: i + 1,
                          value: null,
                        }))
                      ).map((r: any) => ({
                        label: String(r.floor),
                        value: r.value,
                      })),
                      {
                        label: "50 · 通关",
                        value: data?.summary?.completed
                          ? data.summary.wins / data.summary.completed
                          : null,
                      },
                    ]
              }
            />
          )}
        </div>
        {(error ||
          !data ||
          (kind !== "playtime" && !data?.summary?.completed)) && (
          <div className="chart-overlay">
            {error ? (
              <ErrorState error={error} />
            ) : (
              <EmptyState>
                {loading ? "正在分析…" : "没有已完成对局"}
              </EmptyState>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
export function OverviewPage({ career = false }: { career?: boolean }) {
  const { data, loading, error } = useAnalysis<any>(
    { op: career ? "career" : "dashboard" },
    { unfiltered: career },
  );
  const characters = useAppStore((s) => s.characters);
  const openRun = useAppStore((s) => s.openRun);
  if (error) return <ErrorState error={error} />;
  if (!data)
    return <EmptyState>{loading ? "正在分析…" : "没有数据"}</EmptyState>;
  const summary = data.summary;
  const rows = data.characterStats ?? data.characters ?? [];
  return (
    <>
      <MetricGrid>
        <MetricTile
          label="单人对局"
          value={summary.total}
          help="仅已导入的单人详细记录"
        />
        <MetricTile
          label="胜率"
          value={
            summary.completed ? formatValue(summary.winRate, "percent") : "—"
          }
          kind="success"
          help="胜利局数 ÷ 非放弃局数"
        />
        <MetricTile
          label={career ? "游戏时长" : "平均承伤"}
          value={formatValue(
            career ? data.totalPlaytime : summary.avgDamageTaken,
            career ? "duration" : "number",
          )}
          kind={career ? "time" : "damage"}
        />
        <MetricTile
          label="最高连胜"
          value={summary.maxWinStreak}
          kind="streak"
        />
        <MetricTile
          label={career ? "累计楼层" : "胜利牌组下限"}
          value={formatValue(
            career ? data.floorsClimbed : summary.minWinningDeckSize,
          )}
          kind={career ? "floor" : "choice"}
        />
        <MetricTile
          label={career ? "最高进阶" : "胜利牌组上限"}
          value={formatValue(
            career ? summary.highestAscension : summary.maxWinningDeckSize,
          )}
          kind={career ? "floor" : "choice"}
        />
      </MetricGrid>
      {!career && (
        <Card title="胜负记录">
          <div className="history-groups">
            {[data.history.overall, ...data.history.characters].map(
              (g: any) => (
                <div className="history-group" key={g.id}>
                  <h3
                    style={{
                      color:
                        g.id === "all" ? "var(--text)" : characterColor(g.id),
                    }}
                  >
                    {g.id === "all" ? "总体" : zhCharacter(g.id)}{" "}
                    <span className="muted">{g.total}</span>
                  </h3>
                  <div className="history-grid">
                    {g.items.map((r: any) => (
                      <button
                        key={r.id}
                        onClick={() => openRun(r.id)}
                        aria-label={`${zhCharacter(r.character)} ${r.status === "win" ? "胜利" : r.status === "loss" ? "失败" : "放弃"} ${formatValue(r.startTime, "date")}`}
                        title={`${formatValue(r.startTime, "date")} · ${zhCharacter(r.character)}\n${r.status === "win" ? "胜利" : r.status === "loss" ? "失败" : "放弃"} · 进阶 ${r.ascension}`}
                        style={{
                          background:
                            r.status === "win"
                              ? "var(--success)"
                              : r.status === "loss"
                                ? "var(--damage)"
                                : "var(--muted)",
                        }}
                      />
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        </Card>
      )}
      <div className="chart-grid">
        <Card title="角色胜率">
          <div className="chart">
            <div className="character-bars">
              {characters.map((id) => {
                const r = rows.find((r: any) => r.character === id);
                return (
                  <div key={id}>
                    <span style={{ color: characterColor(id) }}>
                      {zhCharacter(id)}
                    </span>
                    <div
                      title={`${zhCharacter(id)}：${r?.completed ? formatValue(r.winRate, "percent") : "—"} · ${r?.total ?? 0} 局`}
                    >
                      <i
                        style={{
                          width: `${(r?.winRate ?? 0) * 100}%`,
                          background: characterColor(id),
                        }}
                      />
                    </div>
                    <strong>
                      {r?.completed ? formatValue(r.winRate, "percent") : "—"}
                    </strong>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
        <Card title="角色最高连胜">
          <div className="chart">
            <div className="character-bars">
              {characters.map((id) => {
                const r = rows.find((r: any) => r.character === id);
                const max = Math.max(
                  1,
                  ...rows.map((r: any) => r.maxWinStreak),
                );
                return (
                  <div key={id}>
                    <span style={{ color: characterColor(id) }}>
                      {zhCharacter(id)}
                    </span>
                    <div title={`${zhCharacter(id)}：${r?.maxWinStreak ?? 0}`}>
                      <i
                        style={{
                          width: `${((r?.maxWinStreak ?? 0) / max) * 100}%`,
                          background: characterColor(id),
                        }}
                      />
                    </div>
                    <strong>{r?.maxWinStreak ?? 0}</strong>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
        {!career && (
          <>
            <PerspectiveCard title="游戏投入时间" kind="playtime" />
            <PerspectiveCard title="滚动胜率" kind="rolling" />
            <PerspectiveCard title="楼层到达率" kind="survival" />
            <Card title="进阶胜率">
              <div className="chart">
                <RateBars
                  rows={(data.ascensions ?? []).map((r: any) => ({
                    label: String(r.ascension),
                    value: r.completed ? r.winRate : null,
                    help: `${r.total} 局`,
                  }))}
                />
              </div>
            </Card>
          </>
        )}
      </div>
      <Card title="角色统计">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>角色</th>
                <th>对局</th>
                <th>胜利</th>
                <th>失败</th>
                <th>放弃</th>
                <th>胜率</th>
                <th>最高连胜</th>
                <th>平均楼层</th>
                <th>平均时长</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.character}>
                  <td style={{ color: characterColor(r.character) }}>
                    {zhCharacter(r.character)}
                  </td>
                  <td>{r.total}</td>
                  <td>{r.wins}</td>
                  <td>{r.losses}</td>
                  <td>{r.abandoned}</td>
                  <td>
                    <ObjectNumericCell
                      value={r.completed ? r.winRate : null}
                      semantic="rate"
                      format="percent"
                    />
                  </td>
                  <td>{r.maxWinStreak}</td>
                  <td>{formatValue(r.avgFloor)}</td>
                  <td>{formatValue(r.avgTime, "duration")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
export function RestAnalysisPage() {
  const { data, error, loading } = useAnalysis<any>({ op: "restAnalysis" });
  if (error) return <ErrorState error={error} />;
  if (!data)
    return <EmptyState>{loading ? "正在分析…" : "没有记录"}</EmptyState>;
  return (
    <>
      <MetricGrid>
        {[
          ["关联对局", data.runCount],
          ["休息处", data.siteCount],
          ["记录选择", data.recordedChoiceSites],
          ["生命样本", data.hpSamples],
          ["完整区间", data.completeIntervals],
          ["截尾区间", data.censoredIntervals],
        ].map(([label, value]) => (
          <MetricTile
            key={label}
            label={String(label)}
            value={String(value)}
            kind="floor"
          />
        ))}
      </MetricGrid>
      <Card title="选择统计" help={data.notes.join("\n")}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>选择</th>
                <th>次数</th>
                <th>选择率</th>
                <th>平均生命</th>
                <th>生命比例</th>
                <th>生命相关</th>
                <th>生命比例相关</th>
              </tr>
            </thead>
            <tbody>
              {data.choices.map((r: any) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.count}</td>
                  <td>
                    <ObjectNumericCell value={r.siteRate} format="percent" />
                  </td>
                  <td>{formatValue(r.meanHp)}</td>
                  <td>{formatValue(r.meanHpPercent, "percent")}</td>
                  <td>{formatValue(r.hpCorrelation)}</td>
                  <td>{formatValue(r.hpPercentCorrelation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {[
        ["进入前生命", data.hpBins],
        ["进入前生命比例", data.hpPercentBins],
      ].map(([title, bins]) => (
        <Card key={String(title)} title={String(title)} help={data.notes[0]}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>区间</th>
                  <th>样本</th>
                  {data.choices.map((c: any) => (
                    <th key={c.id}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(bins as any[]).map((b) => (
                  <tr key={b.id}>
                    <td>{b.label}</td>
                    <td>{b.sample}</td>
                    {b.choices.map((c: any) => (
                      <td key={c.id}>
                        <ObjectNumericCell
                          value={c.rate}
                          format="percent"
                          help={`${c.count} / ${b.sample}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      <Card title="后续路线" help={data.notes.slice(2).join("\n")}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>房间</th>
                <th>选择</th>
                <th>经过样本</th>
                <th>未经过样本</th>
                <th>经过选择率</th>
                <th>未经过选择率</th>
                <th>差值</th>
                <th>φ</th>
              </tr>
            </thead>
            <tbody>
              {data.routes.flatMap((r: any) =>
                r.choices.map((c: any) => (
                  <tr key={r.id + c.id}>
                    <td>{r.name}</td>
                    <td>
                      {data.choices.find((s: any) => s.id === c.id)?.name ??
                        c.id}
                    </td>
                    <td>{r.presentSamples}</td>
                    <td>{r.absentSamples}</td>
                    <td>{formatValue(c.presentRate, "percent")}</td>
                    <td>{formatValue(c.absentRate, "percent")}</td>
                    <td>{formatValue(c.rateDifference, "percent")}</td>
                    <td>{formatValue(c.phi)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
