import { Component, useEffect, useState, type ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauri } from "@tauri-apps/api/core";
import {
  Home,
  FolderOpen,
  RefreshCw,
  Download,
  Menu,
  ArrowLeft,
  Search,
  Settings,
  BarChart3,
  Layers,
  History,
  Users,
  Trophy,
  Network,
} from "lucide-react";
import { useAppStore } from "./state/appStore";
import { platform } from "./services/platform";
import { zhCharacter } from "../Engine/domain/i18n";
import type { ObjectKind } from "../Engine/domain/objectTypes";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricGrid,
  MetricTile,
} from "./components/UI";
import { OverviewPage, RestAnalysisPage } from "./pages/OverviewPage";
import {
  ObjectListPage,
  ObjectDetailPage,
  ArchetypesPage,
} from "./pages/ObjectPages";
import { RunsPage, RunDetailPage } from "./pages/RunPages";
import { formatValue } from "./styles/theme";

const categories: [string, [ObjectKind, string][]][] = [
  [
    "游戏对象",
    [
      ["card", "卡牌"],
      ["relic", "遗物"],
      ["encounter", "遭遇战"],
      ["ancient", "先古之民"],
      ["potion", "药水"],
      ["event", "事件"],
      ["enemy", "敌人"],
      ["enchantment", "附魔"],
      ["quest", "任务"],
      ["restChoice", "休息处选择"],
      ["location", "地点"],
      ["modifier", "修饰符"],
    ],
  ],
  [
    "进度对象",
    [
      ["badge", "徽章"],
      ["epoch", "纪元"],
      ["achievement", "成就"],
    ],
  ],
  [
    "统计维度",
    [
      ["character", "角色"],
      ["build", "版本"],
      ["ascension", "进阶"],
      ["outcome", "结果"],
      ["party", "队伍"],
      ["gameMode", "模式"],
      ["floor", "楼层"],
      ["act", "章节"],
      ["date", "日期"],
      ["week", "周"],
      ["playerPosition", "玩家位置"],
      ["roomType", "房间类型"],
    ],
  ],
];
const sts2Only = new Set([
  "ancient",
  "enchantment",
  "quest",
  "epoch",
  "badge",
  "party",
  "playerPosition",
]);
const titles: Record<string, string> = {
  dashboard: "全局统计",
  career: "生涯统计",
  archetypes: "卡牌流派",
  runs: "单人记录",
  coop: "多人记录",
  local: "存档管理",
  settings: "设置",
  rest: "休息处分析",
};
for (const [, rows] of categories)
  for (const [kind, label] of rows) titles["objects/" + kind] = label;
class PageBoundary extends Component<
  { children: ReactNode; page: string },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidUpdate(previous: { page: string }) {
    if (previous.page !== this.props.page && this.state.error)
      this.setState({ error: null });
  }
  render() {
    return this.state.error ? (
      <ErrorState error={this.state.error} />
    ) : (
      this.props.children
    );
  }
}
function Filters() {
  const { filter, setFilter, resetFilter, characters, dataset } = useAppStore();
  const [expanded, setExpanded] = useState(false);
  const multiple = (value: string) =>
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const builds = [
    ...new Set(dataset.runs.map((r) => r.buildId).filter(Boolean)),
  ].sort();
  return (
    <div className="filters">
      <div className="filter-primary">
        <label>
          角色
          <select
            value={filter.characters[0] ?? ""}
            onChange={(e) =>
              setFilter({ characters: e.target.value ? [e.target.value] : [] })
            }
          >
            <option value="">全部角色</option>
            {characters.map((c) => (
              <option key={c} value={c}>
                {zhCharacter(c)}
              </option>
            ))}
          </select>
        </label>
        <label>
          进阶
          <select
            value={filter.ascensions[0] ?? ""}
            onChange={(e) =>
              setFilter({
                ascensions:
                  e.target.value === "" ? [] : [Number(e.target.value)],
              })
            }
          >
            <option value="">全部</option>
            {[...new Set(dataset.runs.map((r) => r.ascension))]
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n}>{n}</option>
              ))}
          </select>
        </label>
        <label>
          结果
          <select
            value={filter.outcomes[0] ?? ""}
            onChange={(e) =>
              setFilter({
                outcomes: e.target.value
                  ? [e.target.value as "win" | "loss" | "abandoned"]
                  : [],
              })
            }
          >
            <option value="">全部</option>
            <option value="win">胜利</option>
            <option value="loss">失败</option>
            <option value="abandoned">放弃</option>
          </select>
        </label>
        <label>
          从
          <input
            type="date"
            value={filter.dateFrom ?? ""}
            onChange={(e) => setFilter({ dateFrom: e.target.value || null })}
          />
        </label>
        <label>
          至
          <input
            type="date"
            value={filter.dateTo ?? ""}
            onChange={(e) => setFilter({ dateTo: e.target.value || null })}
          />
        </label>
        <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          <Search size={15} />
          更多
        </button>
        <button onClick={resetFilter}>重置</button>
      </div>
      {expanded && (
        <div className="filter-extra">
          <label>
            版本
            <select
              value={filter.builds[0] ?? ""}
              onChange={(e) =>
                setFilter({ builds: e.target.value ? [e.target.value] : [] })
              }
            >
              <option value="">全部版本</option>
              {builds.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <label>
            模式
            <select
              value={filter.mode[0] ?? ""}
              onChange={(e) =>
                setFilter({ mode: e.target.value ? [e.target.value] : [] })
              }
            >
              <option value="">全部</option>
              {[...new Set(dataset.runs.map((r) => r.gameMode))].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            放弃记录
            <select
              value={filter.abandonPolicy ?? "include"}
              onChange={(e) =>
                setFilter({
                  abandonPolicy: e.target.value as
                    | "include"
                    | "exclude-all"
                    | "exclude-short",
                })
              }
            >
              <option value="include">包含</option>
              <option value="exclude-all">全部排除</option>
              <option value="exclude-short">排除短局</option>
            </select>
          </label>
          <label>
            短局分钟
            <input
              type="number"
              min="0"
              value={filter.shortAbandonMinutes ?? 5}
              onChange={(e) =>
                setFilter({ shortAbandonMinutes: Number(e.target.value) })
              }
            />
          </label>
          <label>
            最短分钟
            <input
              type="number"
              min="0"
              value={filter.minDuration == null ? "" : filter.minDuration / 60}
              onChange={(e) =>
                setFilter({
                  minDuration:
                    e.target.value === "" ? null : Number(e.target.value) * 60,
                })
              }
            />
          </label>
          <label>
            最长分钟
            <input
              type="number"
              min="0"
              value={filter.maxDuration == null ? "" : filter.maxDuration / 60}
              onChange={(e) =>
                setFilter({
                  maxDuration:
                    e.target.value === "" ? null : Number(e.target.value) * 60,
                })
              }
            />
          </label>
          {(
            [
              "includeCards",
              "excludeCards",
              "includeRelics",
              "excludeRelics",
            ] as const
          ).map((key, i) => (
            <label key={key}>
              {["包含卡牌 ID", "排除卡牌 ID", "包含遗物 ID", "排除遗物 ID"][i]}
              <input
                value={filter[key].join(", ")}
                onChange={(e) => setFilter({ [key]: multiple(e.target.value) })}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
function LocalDataPage() {
  const {
    dataset,
    busy,
    importDirectory,
    importSingleFiles,
    importExistingDataset,
    sync,
    clearData,
    game,
  } = useAppStore();
  const [directory, setDirectory] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    platform
      .dataDirectory()
      .then(setDirectory)
      .catch(() => {});
  }, []);
  const solo = dataset.runs.filter(
    (r) => !r.isMultiplayer && r.playerCount <= 1 && r.players.length <= 1,
  );
  const coop = dataset.runs.filter((r) => !solo.includes(r));
  return (
    <>
      <MetricGrid>
        <MetricTile label="单人记录" value={solo.length} />
        <MetricTile label="多人记录" value={coop.length} />
        <MetricTile label="全部记录" value={dataset.runs.length} />
        <MetricTile
          label="单人时长"
          value={formatValue(
            solo.reduce((n, r) => n + r.runTime, 0),
            "duration",
          )}
          kind="time"
        />
        <MetricTile
          label="详细记录时长"
          value={formatValue(
            dataset.runs.reduce((n, r) => n + r.runTime, 0),
            "duration",
          )}
          kind="time"
        />
        <MetricTile
          label="进度累计时长"
          value={formatValue(dataset.progress?.totalPlaytime, "duration")}
          kind="time"
          help="progress.save 累计，可能包含多人和缺失的历史记录，不能与详细记录时长相加"
        />
      </MetricGrid>
      <Card title="存档">
        <div className="action-row">
          <button disabled={busy} onClick={importDirectory}>
            <FolderOpen size={16} />
            导入文件夹
          </button>
          <button disabled={busy} onClick={importSingleFiles}>
            导入文件
          </button>
          <button disabled={busy || !dataset.source} onClick={sync}>
            <RefreshCw size={16} />
            立即同步
          </button>
          <button disabled={busy} onClick={importExistingDataset}>
            迁移 dataset.json
          </button>
          <button
            disabled={busy}
            onClick={() =>
              platform.exportText(
                `${game}-dataset.json`,
                JSON.stringify(dataset),
              )
            }
          >
            <Download size={16} />
            导出数据
          </button>
        </div>
        <dl className="details">
          <dt>来源</dt>
          <dd>{dataset.source || "未导入"}</dd>
          <dt>最近导入</dt>
          <dd>
            {dataset.importedAt
              ? new Date(
                  (dataset.importedAt + 978307200) * 1000,
                ).toLocaleString()
              : "—"}
          </dd>
          <dt>数据目录</dt>
          <dd>{directory}</dd>
          <dt>进度累计胜负</dt>
          <dd>
            {dataset.progress?.characterStats?.length
              ? dataset.progress.characterStats
                  .map(
                    (r) =>
                      `${zhCharacter(r.character)} ${r.wins ?? "—"} / ${r.losses ?? "—"}`,
                  )
                  .join(" · ")
              : "—"}
          </dd>
        </dl>
      </Card>
      <Card title="清除本地数据">
        {confirm ? (
          <div className="action-row">
            <span>清除此游戏的本地记录、归档和收藏？</span>
            <button
              className="danger-button"
              disabled={busy}
              onClick={async () => {
                await clearData();
                setConfirm(false);
              }}
            >
              确认清除
            </button>
            <button onClick={() => setConfirm(false)}>取消</button>
          </div>
        ) : (
          <button
            className="danger-button"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            清除此游戏数据
          </button>
        )}
      </Card>
    </>
  );
}
function SettingsPage() {
  const { settings, setSettings } = useAppStore();
  return (
    <Card title="偏好">
      <div className="settings-list">
        <label>
          外观
          <select
            value={settings.theme}
            onChange={(e) =>
              setSettings({
                theme: e.target.value as "system" | "light" | "dark",
              })
            }
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
        <label>
          最低样本量
          <input
            type="number"
            min="1"
            max="100000"
            value={settings.minimumSample}
            onChange={(e) =>
              setSettings({
                minimumSample: Math.max(1, Number(e.target.value)),
              })
            }
          />
        </label>
        <label>
          自动同步
          <input
            type="checkbox"
            checked={settings.autoSync}
            onChange={(e) => setSettings({ autoSync: e.target.checked })}
            title="每 15 秒检查已授权的目录；单独导入文件不自动同步"
          />
        </label>
      </div>
    </Card>
  );
}
function Page({ page }: { page: string }) {
  if (page === "dashboard") return <OverviewPage />;
  if (page === "career") return <OverviewPage career />;
  if (page === "rest") return <RestAnalysisPage />;
  if (page === "archetypes") return <ArchetypesPage />;
  if (page === "runs" || page === "coop")
    return <RunsPage coop={page === "coop"} />;
  if (page === "local") return <LocalDataPage />;
  if (page === "settings") return <SettingsPage />;
  if (page.startsWith("objects/"))
    return <ObjectListPage kind={page.split("/")[1] as ObjectKind} />;
  if (page.startsWith("object/")) {
    const [, kind, ...ids] = page.split("/");
    return (
      <ObjectDetailPage
        kind={kind as ObjectKind}
        id={decodeURIComponent(ids.join("/"))}
      />
    );
  }
  if (page.startsWith("run/"))
    return <RunDetailPage id={decodeURIComponent(page.slice(4))} />;
  return <EmptyState />;
}
export function App() {
  useEffect(() => {
    const handle = (event: Event) =>
      useAppStore.setState({ error: String((event as CustomEvent).detail) });
    window.addEventListener("sts2stats:error", handle);
    return () => window.removeEventListener("sts2stats:error", handle);
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let canceled = false;
    let stop: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop")
          void useAppStore.getState().importDropped();
      })
      .then((unlisten) => {
        if (canceled) unlisten();
        else stop = unlisten;
      });
    return () => {
      canceled = true;
      stop?.();
    };
  }, []);
  const state = useAppStore();
  const [sidebar, setSidebar] = useState(false);
  useEffect(() => {
    void useAppStore.getState().initialize();
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state.settings.theme]);
  useEffect(() => {
    if (!isTauri() || !state.settings.autoSync || !state.ready) return;
    const timer = setInterval(() => {
      const s = useAppStore.getState();
      if (!s.busy && !s.error && s.page !== "home") void s.sync();
    }, 15000);
    return () => clearInterval(timer);
  }, [state.settings.autoSync, state.ready]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const s = useAppStore.getState();
      if (e.key.toLowerCase() === "o") {
        e.preventDefault();
        void (e.shiftKey ? s.importSingleFiles() : s.importDirectory());
      }
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        void s.sync();
      }
      if (e.key === "0") {
        e.preventDefault();
        s.navigate("home");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const nav = (page: string) => {
    state.navigate(page);
    setSidebar(false);
  };
  if (state.page === "home")
    return (
      <main className="home">
        <h1>尖塔数据终端</h1>
        <div className="game-grid">
          {(["sts1", "sts2"] as const).map((game) => (
            <button
              className="game-card"
              disabled={state.busy}
              key={game}
              onClick={() => void state.selectGame(game)}
            >
              <img src={`/game/${game}.png`} alt="" />
              <strong>{game === "sts1" ? "杀戮尖塔 1" : "杀戮尖塔 2"}</strong>
            </button>
          ))}
        </div>
        <ErrorState error={state.error} />
      </main>
    );
  const simple = Object.entries(titles).filter(
    ([key]) => !key.includes("/") && key !== "settings" && key !== "local",
  );
  const icon: Record<string, typeof Home> = {
    dashboard: BarChart3,
    career: Trophy,
    archetypes: Network,
    runs: History,
    coop: Users,
    rest: Layers,
  };
  return (
    <div className="app-layout">
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <button className="brand" onClick={() => nav("home")}>
          <Home size={18} />
          <span>尖塔数据终端</span>
        </button>
        <div className="game-name">
          {state.game === "sts1" ? "杀戮尖塔 1" : "杀戮尖塔 2"}
        </div>
        <nav>
          {simple
            .filter(([key]) => state.game === "sts2" || key !== "coop")
            .map(([key, label]) => {
              const Icon = icon[key] ?? Layers;
              return (
                <button
                  key={key}
                  className={state.page === key ? "selected" : ""}
                  onClick={() => nav(key)}
                >
                  <Icon size={16} />
                  {label}
                </button>
              );
            })}
          {categories.map(([label, rows]) => (
            <div key={label} className="nav-group">
              <span>{label}</span>
              {rows
                .filter(
                  ([kind]) => state.game === "sts2" || !sts2Only.has(kind),
                )
                .map(([kind, title]) => (
                  <button
                    key={kind}
                    className={
                      state.page === "objects/" + kind ? "selected" : ""
                    }
                    onClick={() => nav("objects/" + kind)}
                  >
                    {title}
                  </button>
                ))}
            </div>
          ))}
          <div className="nav-group">
            <button
              className={state.page === "local" ? "selected" : ""}
              onClick={() => nav("local")}
            >
              <FolderOpen size={16} />
              存档管理
            </button>
            <button
              className={state.page === "settings" ? "selected" : ""}
              onClick={() => nav("settings")}
            >
              <Settings size={16} />
              设置
            </button>
          </div>
        </nav>
      </aside>
      <div className="main-shell">
        <header className="toolbar">
          <button
            className="sidebar-toggle"
            onClick={() => setSidebar(!sidebar)}
            aria-label="切换侧栏"
          >
            <Menu size={18} />
          </button>
          {state.page.startsWith("object/") || state.page.startsWith("run/") ? (
            <button aria-label="返回列表" onClick={state.back}>
              <ArrowLeft size={18} />
            </button>
          ) : null}
          <h1>
            {titles[state.page] ??
              (state.page.startsWith("run/") ? "记录复盘" : "对象详情")}
          </h1>
          <div className="toolbar-actions">
            <button
              disabled={state.busy}
              onClick={state.importDirectory}
              title="导入文件夹 ⌘/Ctrl+O"
            >
              <FolderOpen size={17} />
            </button>
            <button
              disabled={state.busy}
              onClick={state.sync}
              title="立即同步 ⌘/Ctrl+R"
            >
              <RefreshCw size={17} className={state.busy ? "spinning" : ""} />
            </button>
          </div>
        </header>
        <main className="page-content">
          {state.error && (
            <div className="global-error">
              <ErrorState error={state.error} />
              <button onClick={state.dismissError}>关闭</button>
            </div>
          )}
          {!["career", "local", "settings"].includes(state.page) &&
            !state.page.startsWith("run/") && <Filters />}
          {state.busy && (
            <div className="sync-status" role="status">
              正在同步…
            </div>
          )}
          <PageBoundary page={state.page}>
            {state.ready ? <Page page={state.page} /> : <LoadingState />}
          </PageBoundary>
        </main>
      </div>
    </div>
  );
}
