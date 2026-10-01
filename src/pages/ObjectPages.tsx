import { preferenceTextColor } from "../styles/theme";
import { useEffect, useState } from "react";
import type {
  ObjectKind,
  ObjectListResponse,
  ObjectDetailResponse,
  ObjectMetric,
} from "../../Engine/domain/objectTypes";
import type { PreferenceArenaResult } from "../../Engine/domain/preferenceArena";
import type { CardArchetypeAnalysisResult } from "../../Engine/domain/cardArchetypes";
import { zhCharacter, zhEntity } from "../../Engine/domain/i18n";
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
import { characterColor, formatValue, preferenceColor } from "../styles/theme";
import { platform } from "../services/platform";
import { analysisClient } from "../worker/client";

const csv = (values: unknown[]) =>
  values
    .map((v) => '"' + String(v ?? "").replaceAll('"', '""') + '"')
    .join(",");
const semantic = (id: string): "number" | "rate" | "preference" =>
  /winRate|survivalRate|WinRate/i.test(id)
    ? "rate"
    : /pickRate/i.test(id)
      ? "preference"
      : "number";
function Metrics({ metrics }: { metrics: ObjectMetric[] }) {
  return (
    <MetricGrid>
      {metrics.map((m) => (
        <MetricTile
          key={m.id}
          label={m.label}
          value={m.text ?? formatValue(m.value, m.format)}
          help={m.help}
          kind={
            /win|survival/i.test(m.id)
              ? "success"
              : /gold/i.test(m.id)
                ? "gold"
                : /duration/i.test(m.id)
                  ? "time"
                  : /damage|deaths/i.test(m.id)
                    ? "damage"
                    : /pick|offer|acqui|held/i.test(m.id)
                      ? "choice"
                      : "sample"
          }
        />
      ))}
    </MetricGrid>
  );
}
function Pager({
  offset,
  total,
  onChange,
  limit = 100,
}: {
  offset: number;
  total: number;
  onChange: (offset: number) => void;
  limit?: number;
}) {
  return (
    <div className="pagination">
      <span>
        {total
          ? `${offset + 1}–${Math.min(total, offset + limit)} / ${total}`
          : "0"}
      </span>
      <button
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        上一页
      </button>
      <button
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        下一页
      </button>
    </div>
  );
}
function objectColumns(rows: ObjectListResponse["items"]) {
  return [
    ...new Map(
      rows
        .flatMap((row) => [
          ...(row.metrics ?? []).map((metric) => ({
            ...metric,
            key: "metrics." + metric.id,
            source: "run" as const,
          })),
          ...(row.careerMetrics ?? []).map((metric) => ({
            ...metric,
            key: "career." + metric.id,
            source: "career" as const,
          })),
        ])
        .map((metric) => [metric.key, metric]),
    ).values(),
  ];
}
export function ObjectListPage({ kind }: { kind: ObjectKind }) {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState({
    field: "runs",
    direction: "desc" as "asc" | "desc",
  });
  const [perspective, setPerspective] = useState("all");
  const [pool, setPool] = useState("all");
  const [arena, setArena] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { characters, settings, openObject, game, filter } = useAppStore();
  useEffect(() => {
    setOffset(0);
    setSearch("");
    setArena(false);
  }, [kind]);
  const request = {
    op: "objects",
    kind,
    search,
    sort,
    offset,
    limit: 100,
    perspective,
    cardPool: pool,
    minimumSample: settings.minimumSample,
  };
  const { data, error, loading } = useAnalysis<ObjectListResponse>(request);
  const cols = data?.columns ?? objectColumns(data?.items ?? []);
  const changeSort = (field: string) => {
    setOffset(0);
    setSort({
      field,
      direction:
        sort.field === field && sort.direction === "desc" ? "asc" : "desc",
    });
  };
  async function exportTable() {
    setExporting(true);
    try {
      const all = [];
      let page = 0,
        total = 1;
      while (page < total) {
        const value = await analysisClient(game).call<ObjectListResponse>({
          ...request,
          offset: page,
          limit: 500,
          filter,
        });
        all.push(...value.items);
        total = value.total;
        page += 500;
      }
      const columns = objectColumns(all);
      await platform.exportText(
        `${game}-${kind}.csv`,
        "\uFEFF" +
          [
            csv([
              "ID",
              "名称",
              ...columns.map(
                (m) =>
                  (m.source === "career" ? "生涯 · " : "单人 · ") + m.label,
              ),
            ]),
            ...all.map((r) =>
              csv([
                r.id,
                r.label,
                ...columns.map(
                  (c) =>
                    (c.source === "career"
                      ? (r.careerMetrics ?? [])
                      : (r.metrics ?? [])
                    ).find((m) => m.id === c.id)?.value,
                ),
              ]),
            ),
          ].join("\n"),
      );
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <div className="page-tools">
        {kind === "card" && (
          <div className="segmented">
            <button
              className={!arena ? "active" : ""}
              onClick={() => setArena(false)}
            >
              卡牌统计
            </button>
            <button
              className={arena ? "active" : ""}
              onClick={() => setArena(true)}
            >
              选择竞技场
            </button>
          </div>
        )}
        {!arena && (
          <>
            <input
              type="search"
              aria-label="搜索对象"
              placeholder="搜索名称或 ID"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
            <label>
              视角
              <select
                value={perspective}
                onChange={(e) => {
                  setPerspective(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="all">总体</option>
                {characters.map((c) => (
                  <option key={c} value={c}>
                    {zhCharacter(c)}
                  </option>
                ))}
              </select>
            </label>
            {kind === "card" && (
              <label>
                卡池
                <select
                  value={pool}
                  onChange={(e) => {
                    setPool(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="all">全部</option>
                  {characters.map((c) => (
                    <option key={c} value={c}>
                      {zhCharacter(c)}
                    </option>
                  ))}
                  <option value="colorless">无色</option>
                  <option value="unknown">未归属</option>
                </select>
              </label>
            )}
            <button disabled={exporting} onClick={() => void exportTable()}>
              {exporting ? "导出中…" : "导出 CSV"}
            </button>
          </>
        )}
      </div>
      {arena ? (
        <ArenaPage />
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        <Card>
          <div className="table-scroll" aria-busy={loading}>
            <table>
              <thead>
                <tr>
                  <th className="sticky-name">
                    <button onClick={() => changeSort("label")}>
                      名称{" "}
                      {sort.field === "label"
                        ? sort.direction === "desc"
                          ? "↓"
                          : "↑"
                        : ""}
                    </button>
                  </th>
                  {kind === "card" && <th>卡池</th>}
                  <th>状态</th>
                  {cols.map((c) => (
                    <th
                      key={c.key}
                      title={
                        (c.source === "career"
                          ? "生涯累计 · "
                          : "单人记录 · ") + (c.help ?? "")
                      }
                    >
                      <button onClick={() => changeSort(c.key)}>
                        {c.source === "career" ? "生涯 · " : ""}
                        {c.label}{" "}
                        {sort.field === c.key
                          ? sort.direction === "desc"
                            ? "↓"
                            : "↑"
                          : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.items.map((r) => (
                  <tr key={r.key}>
                    <td className="sticky-name">
                      <button
                        className="object-link"
                        style={
                          kind === "character"
                            ? { color: characterColor(r.id) }
                            : kind === "relic"
                              ? { color: "var(--gold)" }
                              : {}
                        }
                        onClick={() => openObject(kind, r.id)}
                        title={r.id}
                      >
                        {r.label}
                      </button>
                    </td>
                    {kind === "card" && (
                      <td style={{ color: characterColor(r.cardPool ?? "") }}>
                        {r.cardPool === "unknown"
                          ? "未归属"
                          : r.cardPool === "colorless"
                            ? "无色"
                            : zhCharacter(r.cardPool ?? "")}
                      </td>
                    )}
                    <td title={r.sources.join(", ")}>
                      {r.careerState ??
                        (r.discovered === true
                          ? "已发现"
                          : r.discovered === false
                            ? "未发现"
                            : "—")}
                    </td>
                    {cols.map((c) => {
                      const m = (
                        c.source === "career"
                          ? (r.careerMetrics ?? [])
                          : (r.metrics ?? [])
                      ).find((m) => m.id === c.id);
                      return (
                        <td key={c.key}>
                          {m?.format === "text" ? (
                            (m.text ?? "—")
                          ) : (
                            <ObjectNumericCell
                              value={m?.value ?? null}
                              format={m?.format ?? c.format}
                              fill={r.fills?.[c.key]}
                              heat={r.heat?.[c.key]}
                              semantic={semantic(c.id)}
                              help={m?.help}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {!data?.items.length && (
              <EmptyState>
                {loading ? "正在分析…" : "没有符合条件的对象"}
              </EmptyState>
            )}
          </div>
          <Pager
            offset={offset}
            total={data?.total ?? 0}
            onChange={setOffset}
          />
        </Card>
      )}
    </>
  );
}
export function ObjectDetailPage({
  kind,
  id,
}: {
  kind: ObjectKind;
  id: string;
}) {
  const [perspective, setPerspective] = useState("all");
  const [runOffset, setRunOffset] = useState(0);
  const { characters, openObject, openRun } = useAppStore();
  const { data, error, loading } = useAnalysis<ObjectDetailResponse>({
    op: "object",
    kind,
    id,
    perspective,
    runOffset,
    runLimit: 100,
  });
  useEffect(() => {
    setRunOffset(0);
  }, [id, kind, perspective]);
  if (error) return <ErrorState error={error} />;
  if (!data)
    return <EmptyState>{loading ? "正在分析…" : "未找到对象"}</EmptyState>;
  return (
    <>
      <div className="page-tools">
        <h2
          style={{
            color:
              kind === "character"
                ? characterColor(id)
                : kind === "relic"
                  ? "var(--gold)"
                  : "var(--choice)",
          }}
          title={id}
        >
          {data.object.label}
        </h2>
        <label>
          视角
          <select
            value={perspective}
            onChange={(e) => setPerspective(e.target.value)}
          >
            <option value="all">总体</option>
            {characters.map((c) => (
              <option key={c} value={c}>
                {zhCharacter(c)}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() =>
            platform.exportText(
              `${kind}-detail.json`,
              JSON.stringify(data, null, 2),
            )
          }
        >
          导出详情
        </button>
      </div>
      <Metrics metrics={data.runMetrics} />
      {kind === "ancient" && <ArenaPage ancientId={id} />}
      {data.career.available && (
        <Card
          title="生涯累计"
          help="来自 progress.save 的累计、解锁和发现；不受逐局日期和版本筛选影响，不能与单人逐局记录相加。"
        >
          <Metrics metrics={data.career.metrics} />
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>角色</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>发现</th>
                  <th>获得日期</th>
                  <th>累计</th>
                </tr>
              </thead>
              <tbody>
                {data.career.records.map((r) => (
                  <tr key={r.id}>
                    <td
                      style={{
                        color: r.character
                          ? characterColor(r.character)
                          : undefined,
                      }}
                    >
                      {r.character ? zhCharacter(r.character) : "总体"}
                    </td>
                    <td>{r.source === "career" ? "生涯" : "发现"}</td>
                    <td>{r.state ?? "—"}</td>
                    <td>
                      {r.discovered == null ? "—" : r.discovered ? "是" : "否"}
                    </td>
                    <td>{formatValue(r.obtainedAt, "date")}</td>
                    <td>
                      {r.metrics
                        .map(
                          (m) =>
                            `${m.label} ${m.text ?? formatValue(m.value, m.format)}`,
                        )
                        .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {data.breakdowns.map((b) => (
        <Card key={b.id} title={b.label} help={b.help}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{b.label}</th>
                  {b.columns.map((c) => (
                    <th key={c.id} title={c.help}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.object ? (
                        <button
                          className="object-link"
                          onClick={() =>
                            openObject(r.object!.kind, r.object!.id)
                          }
                        >
                          {r.object.label}
                        </button>
                      ) : (
                        r.label
                      )}
                    </td>
                    {b.columns.map((c) => (
                      <td key={c.id}>
                        {typeof r.values[c.id] === "number" ? (
                          <ObjectNumericCell
                            value={r.values[c.id] as number}
                            fill={r.fills?.[c.id]}
                            heat={r.heat?.[c.id]}
                            format={c.format}
                            semantic={semantic(c.id)}
                          />
                        ) : (
                          (r.values[c.id] ?? "—")
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      {data.relatedObjects.length > 0 && (
        <Card title="关联对象">
          <div className="inventory">
            {data.relatedObjects.map((r) => (
              <button
                key={r.key}
                onClick={() => openObject(r.kind, r.id)}
                title={`${r.observations} 次 · ${r.runs} 局`}
              >
                {r.label} ×{r.observations}
              </button>
            ))}
          </div>
        </Card>
      )}
      <Card title="关联单人记录">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>角色</th>
                <th>结果</th>
                <th>楼层</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r.id} onClick={() => openRun(r.id)}>
                  <td>
                    <button
                      className="object-link"
                      onClick={() => openRun(r.id)}
                    >
                      {formatValue(r.startTime, "date")}
                    </button>
                  </td>
                  <td style={{ color: characterColor(r.character) }}>
                    {zhCharacter(r.character)}
                  </td>
                  <td>
                    {r.status === "win"
                      ? "胜利"
                      : r.status === "loss"
                        ? "失败"
                        : "放弃"}
                  </td>
                  <td>{r.floor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager
          offset={runOffset}
          total={data.runTotal}
          onChange={setRunOffset}
        />
      </Card>
      <Card title={`记录证据 ${data.evidence.length} / ${data.evidenceTotal}`}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>行为</th>
                <th>来源</th>
                <th>角色</th>
                <th>楼层</th>
                <th>对局</th>
              </tr>
            </thead>
            <tbody>
              {data.evidence.map((e) => (
                <tr key={e.id}>
                  <td>{e.event}</td>
                  <td>{e.source}</td>
                  <td>{zhCharacter(e.character)}</td>
                  <td>{e.floor ?? "—"}</td>
                  <td>
                    <button
                      className="object-link"
                      onClick={() => openRun(e.runId)}
                    >
                      {e.runId}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
function ArenaPage({ ancientId }: { ancientId?: string } = {}) {
  const { characters, openObject, game } = useAppStore();
  const [category, setCategory] = useState("all");
  const [ordering, setOrdering] = useState<
    "adaptive" | "arena" | "choiceRate" | "slotMean"
  >("adaptive");
  const [rowPage, setRowPage] = useState(0);
  const [colPage, setColPage] = useState(0);
  const [selectedPair, setSelectedPair] = useState<string | null>(null);
  const { data, error, loading } = useAnalysis<PreferenceArenaResult>({
    op: "arena",
    scope: ancientId
      ? {
          source: "ancient",
          ancientId,
          playerCharacter: category === "all" ? undefined : category,
        }
      : { source: "card", cardCategory: category },
  });
  if (error) return <ErrorState error={error} />;
  if (!data)
    return <EmptyState>{loading ? "正在分析…" : "没有选择记录"}</EmptyState>;
  const order = data.orderings[ordering] ?? data.ordering;
  const rows = order.slice(rowPage, rowPage + 40);
  const cols = order.slice(colPage, colPage + 40);
  const label = (id: string) => zhEntity(id, data.itemCategory, id);
  async function exportArena() {
    await platform.exportText(
      `${game}-arena.csv`,
      "\uFEFF" +
        [
          csv([
            "行 ID",
            "列 ID",
            "偏好",
            "区间下限",
            "区间上限",
            "证据",
            "共同出现次数",
          ]),
          ...Object.values(data!.pairs).map((p) =>
            csv([
              p.rowId,
              p.columnId,
              p.pref,
              p.prefCi?.[0],
              p.prefCi?.[1],
              p.relation,
              p.cooccurN,
            ]),
          ),
        ].join("\n"),
    );
  }
  return (
    <>
      <div className="page-tools">
        <label>
          {ancientId ? "角色" : "卡池"}
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setRowPage(0);
              setColPage(0);
            }}
          >
            <option value="all">全部</option>
            {characters.map((c) => (
              <option key={c} value={c}>
                {zhCharacter(c)}
              </option>
            ))}
            {!ancientId && <option value="colorless">无色</option>}
          </select>
        </label>
        <label>
          顺序
          <select
            value={ordering}
            onChange={(e) => setOrdering(e.target.value as typeof ordering)}
          >
            <option value="adaptive">自适应</option>
            <option value="arena">竞技场排名</option>
            <option value="choiceRate">选择率</option>
            <option value="slotMean">槽位</option>
          </select>
        </label>
        <button onClick={() => void exportArena()}>导出矩阵 CSV</button>
        <button
          onClick={async () => {
            const svg = await analysisClient(game).call<string>({
              op: "arenaSvg",
              result: data,
              order,
            });
            await platform.exportText(`${game}-arena.svg`, svg);
          }}
        >
          导出 SVG
        </button>
      </div>
      <Card
        title="选择偏好"
        help="行相对于列的选择偏好；50% 为中性。实线为直接证据，虚线为间接推断，— 为不可比较，· 为自身。"
      >
        <div className="legend">
          <span>
            <i style={{ background: preferenceColor(0) }} />
            低偏好
          </span>
          <span>
            <i style={{ background: preferenceColor(0.5) }} />
            50% 中性
          </span>
          <span>
            <i style={{ background: preferenceColor(1) }} />
            高偏好
          </span>
          <span>实线：直接 · 虚线：间接 · —：不可比较 · ·：自身</span>
        </div>
        <div className="table-scroll arena-matrix">
          <table>
            <thead>
              <tr>
                <th className="sticky-name">行 / 列</th>
                {cols.map((id, i) => (
                  <th key={id} title={label(id)}>
                    {colPage + i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((id, i) => (
                <tr key={id}>
                  <th className="sticky-name">
                    <button
                      className="object-link"
                      onClick={() =>
                        openObject(
                          data.itemCategory === "relics" ? "relic" : "card",
                          id,
                        )
                      }
                    >
                      {rowPage + i + 1} · {label(id)}
                    </button>
                  </th>
                  {cols.map((other) => {
                    const p = data.pairs[`${id}¦${other}`];
                    const self = id === other;
                    return (
                      <td
                        key={other}
                        title={`${label(id)} / ${label(other)}\n${p?.relation ?? "自身"} · ${formatValue(p?.pref, "percent")}\n区间 ${p?.prefCi?.map((v) => formatValue(v, "percent")).join("–") ?? "—"}\n共同出现 ${p?.cooccurN ?? 0}`}
                      >
                        <span
                          className={`arena-cell ${p?.relation ?? "na"}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedPair(`${id}¦${other}`)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedPair(`${id}¦${other}`);
                            }
                          }}
                          style={{
                            background:
                              p?.pref != null
                                ? preferenceColor(p.pref)
                                : undefined,
                            color:
                              p?.pref == null
                                ? "var(--text)"
                                : preferenceTextColor(p.pref),
                          }}
                        >
                          {self
                            ? "·"
                            : p?.pref == null
                              ? "—"
                              : formatValue(p.pref, "percent")}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="action-row">
          <span>行</span>
          <Pager
            offset={rowPage}
            total={order.length}
            onChange={setRowPage}
            limit={40}
          />
          <span>列</span>
          <Pager
            offset={colPage}
            total={order.length}
            onChange={setColPage}
            limit={40}
          />
        </div>
      </Card>
      {selectedPair && data.pairs[selectedPair] && (
        <Card title="比较证据">
          <dl className="details">
            {Object.entries(data.pairs[selectedPair]).map(([key, value]) => (
              <div className="diagnostic" key={key}>
                <strong>{key}</strong> ·{" "}
                {Array.isArray(value)
                  ? value.map((v) => formatValue(v)).join("–")
                  : formatValue(value)}
              </div>
            ))}
          </dl>
        </Card>
      )}
      <Card title="排名">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{data.itemCategory === "relics" ? "遗物" : "卡牌"}</th>
                <th>排名</th>
                <th>排名区间</th>
                <th>可选</th>
                <th>已选</th>
                <th>选择率</th>
                <th>获胜率</th>
                <th>强度</th>
                <th>强度区间</th>
              </tr>
            </thead>
            <tbody>
              {order.slice(rowPage, rowPage + 100).map((id) => {
                const r = data.items[id];
                return (
                  <tr key={id}>
                    <td>
                      <button
                        className="object-link"
                        onClick={() =>
                          openObject(
                            data.itemCategory === "relics" ? "relic" : "card",
                            id,
                          )
                        }
                      >
                        {label(id)}
                      </button>
                    </td>
                    <td>{r.rank}</td>
                    <td>{r.rankCi.join("–")}</td>
                    <td>{r.offered}</td>
                    <td>{r.chosen}</td>
                    <td>
                      <ObjectNumericCell
                        value={r.choiceRate}
                        format="percent"
                        semantic="preference"
                      />
                    </td>
                    <td>
                      <ObjectNumericCell
                        value={r.winRate}
                        format="percent"
                        semantic="rate"
                      />
                    </td>
                    <td>{formatValue(r.theta)}</td>
                    <td>{r.thetaCi.map((v) => formatValue(v)).join("–")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card
        title="模型诊断"
        help={[...data.warnings, ...data.parseReport.warnings].join("\n")}
      >
        <dl className="details">
          <dt>模型</dt>
          <dd>Plackett–Luce / Laplace</dd>
          <dt>有效选择</dt>
          <dd>
            {data.parseReport.eventsValid} / {data.parseReport.eventsTotal}
          </dd>
          <dt>关联对局</dt>
          <dd>{data.temporalMetadata.numRuns}</dd>
          <dt>状态</dt>
          <dd>{data.status}</dd>
          {data.diagnostics.map((d) => (
            <div className="diagnostic" key={d.componentId}>
              分量 {d.componentId} · {d.itemCount} 项 · {d.eventCount} 次 ·{" "}
              {d.converged ? "已收敛" : "未收敛"} · 损失{" "}
              {formatValue(d.meanLogLoss)}
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}
export function ArchetypesPage() {
  const { characters, openObject, openRun } = useAppStore();
  const [character, setCharacter] = useState(characters[0]);
  const [offset, setOffset] = useState(0);
  const { data, error, loading } = useAnalysis<CardArchetypeAnalysisResult>({
    op: "archetypes",
    character,
    filter: { characters: [character] },
  });
  if (error) return <ErrorState error={error} />;
  const label = (id: string) => zhEntity(id, "cards", id);
  return (
    <>
      <div className="page-tools">
        <label>
          角色
          <select
            value={character}
            onChange={(e) => {
              setCharacter(e.target.value);
              setOffset(0);
            }}
          >
            {characters.map((c) => (
              <option key={c} value={c}>
                {zhCharacter(c)}
              </option>
            ))}
          </select>
        </label>
        {data && (
          <button
            onClick={() =>
              platform.exportText(
                "card-archetypes.json",
                JSON.stringify(data, null, 2),
              )
            }
          >
            导出模型
          </button>
        )}
      </div>
      {!data ? (
        <EmptyState>{loading ? "正在分析…" : "没有数据"}</EmptyState>
      ) : (
        <>
          <MetricGrid>
            <MetricTile
              label="单人对局"
              value={data.diagnostics.perspectiveRuns}
            />
            <MetricTile
              label="选择记录"
              value={data.diagnostics.choiceEvents}
              kind="choice"
            />
            <MetricTile
              label="分析卡牌"
              value={data.diagnostics.analyzedCards}
              kind="choice"
            />
            <MetricTile
              label="流派"
              value={data.communities.length}
              kind="choice"
            />
          </MetricGrid>
          <Card title="构筑结构">
            <svg
              viewBox="0 0 800 420"
              className="archetype-graph"
              role="img"
              aria-label="卡牌关联网络"
            >
              {data.visibleEdges.map((id) => {
                const p = data.pairs[id],
                  a = data.cards[p.left],
                  b = data.cards[p.right];
                return a && b ? (
                  <line
                    key={id}
                    x1={40 + a.x * 720}
                    y1={20 + a.y * 380}
                    x2={40 + b.x * 720}
                    y2={20 + b.y * 380}
                    stroke="var(--choice)"
                    opacity={0.25}
                  />
                ) : null;
              })}
              {data.cardOrder.map((id) => {
                const r = data.cards[id];
                return (
                  <g
                    key={id}
                    className="graph-node"
                    onClick={() => openObject("card", id)}
                  >
                    <title>
                      {label(id)} · {r.dominantArchetype ?? "未归属"}
                    </title>
                    <circle
                      cx={40 + r.x * 720}
                      cy={20 + r.y * 380}
                      r={5}
                      fill={characterColor(character)}
                    />
                    <text
                      x={48 + r.x * 720}
                      y={24 + r.y * 380}
                      fill="var(--text)"
                      fontSize="10"
                    >
                      {label(id)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </Card>
          {data.communities.map((c) => (
            <Card
              key={c.id}
              title={c.id}
              help={`稳定性 ${formatValue(c.stability, "percent")} · 内聚度 ${formatValue(c.cohesion, "percent")} · 样本 ${c.totalEvidence}`}
            >
              <div className="inventory">
                {c.members.map((id) => (
                  <button
                    key={id}
                    className={c.coreCards.includes(id) ? "core-card" : ""}
                    onClick={() => openObject("card", id)}
                    title={
                      c.coreCards.includes(id)
                        ? "核心卡牌"
                        : c.bridgeCards.includes(id)
                          ? "桥接卡牌"
                          : "成员"
                    }
                  >
                    {label(id)}
                  </button>
                ))}
              </div>
            </Card>
          ))}
          <Card title="卡牌归属">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>卡牌</th>
                    <th>主流派</th>
                    <th>可选</th>
                    <th>选取</th>
                    <th>基础选取率</th>
                    <th>专属性</th>
                    <th>桥接分数</th>
                    <th>核心分数</th>
                    <th>证据</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...data.cardOrder,
                    ...data.insufficientCards,
                    ...data.starterCards,
                  ]
                    .filter((id, i, a) => a.indexOf(id) === i)
                    .slice(offset, offset + 100)
                    .map((id) => {
                      const r = data.cards[id];
                      return r ? (
                        <tr key={id}>
                          <td>
                            <button
                              className="object-link"
                              onClick={() => openObject("card", id)}
                            >
                              {label(id)}
                            </button>
                          </td>
                          <td>{r.dominantArchetype ?? "—"}</td>
                          <td>{r.offers ?? "—"}</td>
                          <td>{r.picks}</td>
                          <td>{formatValue(r.baselinePickRate, "percent")}</td>
                          <td>{formatValue(r.specialization)}</td>
                          <td>{formatValue(r.bridgeScore)}</td>
                          <td>{formatValue(r.coreScore)}</td>
                          <td>{r.evidenceStatus}</td>
                        </tr>
                      ) : null;
                    })}
                </tbody>
              </table>
            </div>
            <Pager
              offset={offset}
              total={
                new Set([
                  ...data.cardOrder,
                  ...data.insufficientCards,
                  ...data.starterCards,
                ]).size
              }
              onChange={setOffset}
            />
          </Card>
          <Card title="对局构成">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>主流派</th>
                    <th>分析卡牌</th>
                    <th>归属</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runComposition.slice(offset, offset + 100).map((r) => (
                    <tr key={r.runId}>
                      <td>
                        <button
                          className="object-link"
                          onClick={() => openRun(r.originalRunId)}
                        >
                          {formatValue(r.timestamp, "date")}
                        </button>
                      </td>
                      <td>{r.dominantArchetype ?? "—"}</td>
                      <td>{r.analyzedCards}</td>
                      <td>
                        {Object.entries(r.membership)
                          .map(([k, v]) => `${k}: ${formatValue(v, "percent")}`)
                          .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="模型诊断" help={data.diagnostics.warnings.join("\n")}>
            <dl className="details">
              <dt>状态</dt>
              <dd>{data.status}</dd>
              <dt>证据模式</dt>
              <dd>{data.evidenceMode}</dd>
              <dt>版本漂移</dt>
              <dd>
                {data.diagnostics.versionDriftCompared
                  ? `${data.diagnostics.changedPairCount} 个变化关系`
                  : "未比较"}
              </dd>
              <dt>参数</dt>
              <dd>
                {Object.entries(data.config)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" · ")}
              </dd>
            </dl>
          </Card>
        </>
      )}
    </>
  );
}
