import { useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import type { NormalizedRunV2, TimelinePoint } from "../../Engine/domain/types";
import {
  zhCharacter,
  zhEntity,
  zhMapType,
  zhRef,
} from "../../Engine/domain/i18n";
import { decisionTimeline } from "../../Engine/domain/analytics";
import { useAnalysis } from "../state/useAnalysis";
import { useAppStore } from "../state/appStore";
import {
  Card,
  EmptyState,
  ErrorState,
  MetricGrid,
  MetricTile,
  ObjectNumericCell,
} from "../components/UI";
import { characterColor, formatValue } from "../styles/theme";
import { platform } from "../services/platform";

const statusLabel = (s: string) =>
  s === "win" ? "胜利" : s === "loss" ? "失败" : "放弃";
export function RunsPage({ coop = false }: { coop?: boolean }) {
  const { favorites, toggleFavorite, openRun } = useAppStore();
  const [search, setSearch] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState({ field: "startTime", direction: "desc" });
  const { data, error, loading } = useAnalysis<{
    runs: NormalizedRunV2[];
    total: number;
    compositions?: any[];
  }>({
    op: "runPage",
    coop,
    search,
    offset,
    limit: 100,
    sort,
    favorites: onlyFavorites ? favorites : null,
  });
  useEffect(() => {
    setOffset(0);
  }, [coop, search, onlyFavorites, sort]);
  if (error) return <ErrorState error={error} />;
  function column(field: string, label: string) {
    return (
      <th>
        <button
          onClick={() =>
            setSort({
              field,
              direction:
                sort.field === field && sort.direction === "desc"
                  ? "asc"
                  : "desc",
            })
          }
        >
          {label}{" "}
          {sort.field === field ? (sort.direction === "desc" ? "↓" : "↑") : ""}
        </button>
      </th>
    );
  }
  return (
    <>
      <div className="page-tools">
        <input
          type="search"
          aria-label="搜索记录"
          placeholder="搜索日期、角色、种子或版本"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={onlyFavorites}
            onChange={(e) => setOnlyFavorites(e.target.checked)}
          />
          仅收藏
        </label>
      </div>
      {coop && data?.compositions && (
        <Card title="队伍组合">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>组合</th>
                  <th>对局</th>
                  <th>胜率</th>
                </tr>
              </thead>
              <tbody>
                {data.compositions.map((r) => (
                  <tr key={r.id}>
                    <td>{r.label}</td>
                    <td>{r.sample}</td>
                    <td>
                      <ObjectNumericCell
                        value={r.winRate}
                        format="percent"
                        semantic="rate"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Card>
        <div className="table-scroll" aria-busy={loading}>
          <table>
            <thead>
              <tr>
                <th>收藏</th>
                {column("startTime", "日期")}
                {column("character", coop ? "玩家" : "角色")}
                {column("ascension", "进阶")}
                {column("status", "结果")}
                {column("floor", "楼层")}
                {column("runTime", "时长")}
                {column("deckSize", "卡牌")}
                {column("relicCount", "遗物")}
                <th>版本</th>
                <th>种子</th>
              </tr>
            </thead>
            <tbody>
              {data?.runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      className="favorite-button"
                      aria-label={
                        favorites.includes(r.id) ? "取消收藏" : "收藏记录"
                      }
                      onClick={() => toggleFavorite(r.id)}
                    >
                      <Star
                        size={15}
                        fill={favorites.includes(r.id) ? "var(--gold)" : "none"}
                        color={
                          favorites.includes(r.id)
                            ? "var(--gold)"
                            : "var(--muted)"
                        }
                      />
                    </button>
                  </td>
                  <td>
                    <button
                      className="object-link"
                      onClick={() => openRun(r.id)}
                    >
                      {formatValue(r.startTime, "date")}
                    </button>
                  </td>
                  <td>
                    {(coop
                      ? r.players.map((p) => p.character)
                      : [r.character]
                    ).map((c, i) => (
                      <span key={c + i} style={{ color: characterColor(c) }}>
                        {i ? " + " : ""}
                        {zhCharacter(c)}
                      </span>
                    ))}
                  </td>
                  <td>{r.ascension}</td>
                  <td
                    style={{
                      color:
                        r.status === "win"
                          ? "var(--success)"
                          : r.status === "loss"
                            ? "var(--damage)"
                            : "var(--muted)",
                    }}
                  >
                    {statusLabel(r.status)}
                  </td>
                  <td>{r.floor}</td>
                  <td>{formatValue(r.runTime, "duration")}</td>
                  <td>{r.deckSize}</td>
                  <td>{r.relicCount}</td>
                  <td>{r.buildId || "—"}</td>
                  <td>{r.seed || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.runs.length && (
            <EmptyState>
              {loading ? "正在分析…" : "没有符合条件的记录"}
            </EmptyState>
          )}
        </div>
        <div className="pagination">
          <span>{data?.total ?? 0} 局</span>
          <button
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            上一页
          </button>
          <span>{Math.floor(offset / 100) + 1}</span>
          <button
            disabled={offset + 100 >= (data?.total ?? 0)}
            onClick={() => setOffset(offset + 100)}
          >
            下一页
          </button>
        </div>
      </Card>
    </>
  );
}
type Series = { id: string; label: string; color: string; field: string };
function recorded(p: TimelinePoint, field: string): number | null {
  const v = p[field];
  return p.recordedFields?.includes(field) &&
    typeof v === "number" &&
    Number.isFinite(v)
    ? v
    : null;
}
function TimelineChart({
  points,
  series,
  selected,
  onSelect,
  title,
}: {
  points: TimelinePoint[];
  series: Series[];
  selected: number;
  onSelect: (n: number) => void;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const paths = useMemo(() => {
    const values = points.flatMap((p) =>
      series.flatMap((s) => {
        const v = recorded(p, s.field);
        return v == null ? [] : [v];
      }),
    );
    const max = Math.max(1, ...values);
    const min = Math.min(0, ...values);
    const y = (v: number) => 180 - ((v - min) / (max - min)) * 155;
    const x = (i: number) => 35 + (i / Math.max(1, points.length - 1)) * 710;
    return {
      max,
      min,
      x,
      y,
      items: series.map((s) => {
        const segments: string[] = [];
        let segment: number[] = [];
        const close = () => {
          if (segment.length) {
            const line = segment
              .map(
                (i, j) =>
                  `${j ? "L" : "M"}${x(i)},${y(recorded(points[i], s.field)!)}`,
              )
              .join(" ");
            const first = segment[0],
              last = segment[segment.length - 1];
            segments.push(line + ` L${x(last)},${y(0)} L${x(first)},${y(0)} Z`);
            segment = [];
          }
        };
        points.forEach((p, i) => {
          if (recorded(p, s.field) == null) {
            close();
            return;
          }
          if (i && p.floor !== points[i - 1].floor + 1) close();
          segment.push(i);
        });
        close();
        return { ...s, segments };
      }),
    };
  }, [points, series]);
  const focus = hover ?? selected;
  const point = points[focus];
  return (
    <Card title={title}>
      <div className="timeline-chart">
        <svg
          viewBox="0 0 780 210"
          aria-label={title}
          role="img"
          onMouseLeave={() => setHover(null)}
        >
          <line x1="35" y1="180" x2="745" y2="180" stroke="var(--border)" />
          <text x="0" y="25" fill="var(--muted)" fontSize="10">
            {formatValue(paths.max)}
          </text>
          <text x="0" y="184" fill="var(--muted)" fontSize="10">
            {formatValue(paths.min)}
          </text>
          {paths.items.map((s) => (
            <g key={s.id}>
              {s.segments.map((path, i) => (
                <path
                  key={i}
                  d={path}
                  fill={s.color}
                  fillOpacity=".10"
                  stroke={s.color}
                  strokeWidth="1.5"
                />
              ))}
              {points.map((p, i) => {
                const v = recorded(p, s.field);
                return v != null ? (
                  <circle
                    key={i}
                    cx={paths.x(i)}
                    cy={paths.y(v)}
                    r={3}
                    fill={s.color}
                    opacity={focus === i ? 1 : 0.7}
                    stroke={focus === i ? "var(--text)" : "none"}
                    strokeWidth={1}
                  />
                ) : null;
              })}
            </g>
          ))}
          {point && (
            <line
              x1={paths.x(focus)}
              x2={paths.x(focus)}
              y1="15"
              y2="180"
              stroke="var(--muted)"
              strokeDasharray="3 3"
            />
          )}
          {points.map((p, i) => (
            <rect
              key={i}
              x={paths.x(i) - 710 / Math.max(1, points.length - 1) / 2}
              y="10"
              width={Math.max(12, 710 / Math.max(1, points.length - 1))}
              height="180"
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${p.floor} 层 ${p.label}`}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(i);
                }
              }}
              onMouseEnter={() => setHover(i)}
              onClick={() => onSelect(i)}
            >
              <title>
                {p.floor} · {p.label}\n
                {series
                  .map((s) => `${s.label} ${formatValue(recorded(p, s.field))}`)
                  .join("\n")}
              </title>
            </rect>
          ))}
        </svg>
      </div>
      <div className="legend">
        {series.map((s) => (
          <span key={s.id}>
            <i style={{ background: s.color }} />
            {s.label} {point ? formatValue(recorded(point, s.field)) : "—"}
          </span>
        ))}
        <span>
          {point ? `${point.floor} · ${point.label}` : "没有已记录节点"}
        </span>
      </div>
    </Card>
  );
}
const hpSeries: Series[] = [
  { id: "hp", label: "当前生命", field: "hp", color: "var(--success)" },
  { id: "maxHp", label: "最大生命", field: "maxHp", color: "var(--choice)" },
];
const changeSeries: Series[] = [
  {
    id: "hpLoss",
    label: "生命净减少",
    field: "hpLoss",
    color: "var(--damage)",
  },
  {
    id: "hpGain",
    label: "生命净增加",
    field: "hpGain",
    color: "var(--sample)",
  },
];
const damageSeries: Series[] = [
  {
    id: "damageTaken",
    label: "承伤",
    field: "damageTaken",
    color: "var(--damage)",
  },
  { id: "hpHealed", label: "回复", field: "hpHealed", color: "var(--sample)" },
];
const goldSeries: Series[] = [
  { id: "gold", label: "金币", field: "gold", color: "var(--gold)" },
  {
    id: "goldSpent",
    label: "金币花费",
    field: "goldSpent",
    color: "var(--spent)",
  },
];
const turnsSeries: Series[] = [
  { id: "turns", label: "战斗回合", field: "turns", color: "var(--choice)" },
];
export function RunDetailPage({ id }: { id: string }) {
  const { favorites, toggleFavorite, openObject } = useAppStore();
  const [player, setPlayer] = useState(0);
  const [selected, setSelected] = useState(0);
  const { data, error, loading } = useAnalysis<NormalizedRunV2>(
    { op: "run", id, player },
    { unfiltered: true },
  );
  useEffect(() => {
    setPlayer(0);
    setSelected(0);
  }, [id]);
  const points = useMemo(() => {
    const input = data?.timeline ?? [];
    return input.map((p, i) => {
      const current = recorded(p, "hp"),
        previous = i ? recorded(input[i - 1], "hp") : null;
      if (
        current == null ||
        previous == null ||
        p.floor !== input[i - 1].floor + 1
      )
        return p;
      return {
        ...p,
        hpLoss: Math.max(0, previous - current),
        hpGain: Math.max(0, current - previous),
        recordedFields: [...(p.recordedFields ?? []), "hpLoss", "hpGain"],
      };
    });
  }, [data]);
  if (error) return <ErrorState error={error} />;
  if (!data)
    return <EmptyState>{loading ? "正在分析…" : "未找到记录"}</EmptyState>;
  const active = data.players[player] ?? data.players[0];
  const point = points[Math.min(selected, Math.max(0, points.length - 1))];
  const deck = new Map<
    string,
    { id: string; upgrade: number; count: number; label: string }
  >();
  for (const c of active.deck) {
    const key = c.id + ":" + c.upgradeLevel;
    const prev = deck.get(key);
    deck.set(key, {
      id: c.id,
      upgrade: c.upgradeLevel,
      count: (prev?.count ?? 0) + 1,
      label: zhEntity(c.id, "cards", c.id),
    });
  }
  const relics = new Map<string, number>();
  for (const r of active.relics) relics.set(r.id, (relics.get(r.id) ?? 0) + 1);
  const events = decisionTimeline(data.timeline) as {
    floor: number;
    type: string;
    title: string;
    detail: string;
  }[];
  return (
    <>
      <div className="page-tools">
        <span style={{ color: characterColor(active.character) }}>
          {zhCharacter(active.character)}
        </span>
        <span>
          {formatValue(data.startTime, "date")} · {statusLabel(data.status)}
        </span>
        <button onClick={() => toggleFavorite(id)}>
          <Star
            size={15}
            fill={favorites.includes(id) ? "var(--gold)" : "none"}
          />
          {favorites.includes(id) ? "已收藏" : "收藏"}
        </button>
        {data.players.length > 1 && (
          <label>
            玩家
            <select
              value={player}
              onChange={(e) => {
                setPlayer(Number(e.target.value));
                setSelected(0);
              }}
            >
              {data.players.map((p, i) => (
                <option key={i} value={i}>
                  {i + 1} · {zhCharacter(p.character)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          onClick={() =>
            platform.exportText(
              "run-detail.json",
              JSON.stringify(data, null, 2),
            )
          }
        >
          导出记录
        </button>
      </div>
      <MetricGrid>
        <MetricTile label="进阶" value={data.ascension} kind="floor" />
        <MetricTile label="楼层" value={data.floor} kind="floor" />
        <MetricTile
          label="时长"
          value={formatValue(data.runTime, "duration")}
          kind="time"
        />
        <MetricTile
          label="最终生命"
          value={
            player === 0
              ? `${data.finalHp} / ${data.maxHp}`
              : points.length
                ? `${points.at(-1)!.hp} / ${points.at(-1)!.maxHp}`
                : "—"
          }
          kind="health"
        />
        <MetricTile label="最终卡牌" value={active.deck.length} kind="choice" />
        <MetricTile label="最终遗物" value={active.relics.length} kind="gold" />
      </MetricGrid>
      <div className="chart-grid">
        {[hpSeries, changeSeries, damageSeries, goldSeries, turnsSeries].map(
          (series, i) =>
            points.some((p) =>
              series.some((s) => recorded(p, s.field) != null),
            ) ? (
              <TimelineChart
                key={i}
                points={points}
                series={series}
                selected={selected}
                onSelect={setSelected}
                title={
                  ["生命", "生命变化", "承伤与回复", "金币", "战斗回合"][i]
                }
              />
            ) : null,
        )}
      </div>
      {point && (
        <Card title={`${point.floor} · ${point.label}`}>
          <div className="action-row">
            <button
              disabled={!selected}
              onClick={() => setSelected(Math.max(0, selected - 1))}
            >
              上一节点
            </button>
            <select
              value={selected}
              onChange={(e) => setSelected(Number(e.target.value))}
              aria-label="复盘节点"
            >
              {points.map((p, i) => (
                <option key={i} value={i}>
                  {p.floor} · {p.label}
                </option>
              ))}
            </select>
            <button
              disabled={selected >= points.length - 1}
              onClick={() => setSelected(selected + 1)}
            >
              下一节点
            </button>
          </div>
          <dl className="details">
            <dt>房间</dt>
            <dd>{zhMapType(point.type)}</dd>
            <dt>节点指标</dt>
            <dd>
              {[
                ["hp", "生命"],
                ["maxHp", "最大生命"],
                ["gold", "金币"],
                ["damageTaken", "承伤"],
                ["hpHealed", "回复"],
                ["goldGained", "获得金币"],
                ["goldSpent", "花费金币"],
                ["turns", "回合"],
              ]
                .filter(([key]) => recorded(point, key) != null)
                .map(
                  ([key, label]) =>
                    `${label} ${formatValue(recorded(point, key))}`,
                )
                .join(" · ") || "—"}
            </dd>
            <dt>选择</dt>
            <dd>
              <div className="inventory">
                {(
                  ["cardChoices", "relicChoices", "potionChoices"] as const
                ).flatMap((key, idx) =>
                  (point[key] ?? []).map((c) => (
                    <button
                      key={key + c.id}
                      onClick={() =>
                        openObject(
                          (["card", "relic", "potion"] as const)[idx],
                          c.id,
                        )
                      }
                      title={c.picked ? "选取" : "跳过"}
                      className={c.picked ? "picked-choice" : ""}
                    >
                      {zhEntity(
                        c.id,
                        ["cards", "relics", "potions"][idx],
                        c.id,
                      )}{" "}
                      · {c.picked ? "选取" : "跳过"}
                    </button>
                  )),
                )}
              </div>
              {(point.eventChoices ?? []).map((c, i) => (
                <span key={i}>{zhRef(c.title)} </span>
              ))}
              {(point.ancientChoices ?? [])
                .filter((c) => c.chosen)
                .map((c, i) => (
                  <span key={i}>{zhRef(c.title)} </span>
                ))}
            </dd>
            <dt>节点记录</dt>
            <dd>
              {events
                .filter((e) => e.floor === point.floor)
                .map((e, i) => (
                  <p key={i}>
                    {e.title} · {e.detail}
                  </p>
                ))}
            </dd>
          </dl>
        </Card>
      )}
      <Card title={`最终牌组 ${active.deck.length}`}>
        <div className="inventory">
          {[...deck.values()].map((c) => (
            <button
              key={c.id + ":" + c.upgrade}
              style={{ color: "var(--choice)" }}
              onClick={() => openObject("card", c.id)}
            >
              {c.label}
              {c.upgrade ? ` +${c.upgrade}` : ""}
              {c.count > 1 ? ` ×${c.count}` : ""}
            </button>
          ))}
        </div>
      </Card>
      <Card title={`最终遗物 ${active.relics.length}`}>
        <div className="inventory">
          {[...relics].map(([id, count]) => (
            <button
              key={id}
              style={{ color: "var(--gold)" }}
              onClick={() => openObject("relic", id)}
            >
              {zhEntity(id, "relics", id)}
              {count > 1 ? ` ×${count}` : ""}
            </button>
          ))}
        </div>
      </Card>
      {active.potions.length > 0 && (
        <Card title="最终药水">
          <div className="inventory">
            {active.potions.map((id, i) => (
              <button key={id + i} onClick={() => openObject("potion", id)}>
                {zhEntity(id, "potions", id)}
              </button>
            ))}
          </div>
        </Card>
      )}
      <Card title="对局信息">
        <dl className="details">
          <dt>种子</dt>
          <dd>{data.seed || "—"}</dd>
          <dt>版本</dt>
          <dd>{data.buildId || "—"}</dd>
          <dt>模式</dt>
          <dd>{data.gameMode}</dd>
          <dt>击败者</dt>
          <dd>
            {data.killedBy
              ? zhEntity(data.killedBy, "monsters", data.killedBy)
              : "—"}
          </dd>
          <dt>来源文件</dt>
          <dd>{data.fileName}</dd>
        </dl>
      </Card>
    </>
  );
}
