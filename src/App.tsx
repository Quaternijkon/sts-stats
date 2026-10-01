import { Component, useEffect, useState, type ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauri } from "@tauri-apps/api/core";
import {
  Home,
  FolderOpen,
  RefreshCw,
  Menu,
  ArrowLeft,
  Settings,
  BarChart3,
  Layers,
  History,
  Users,
  Trophy,
  Network,
} from "lucide-react";
import { useAppStore } from "./state/appStore";
import type { ObjectKind } from "../Engine/domain/objectTypes";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
} from "./components/UI";
import { OverviewPage, RestAnalysisPage } from "./pages/OverviewPage";
import {
  ObjectListPage,
  ObjectDetailPage,
  ArchetypesPage,
} from "./pages/ObjectPages";
import { RunsPage, RunDetailPage } from "./pages/RunPages";
import { objectColor } from "./styles/theme";
import { AppFilters } from "./components/AppFilters";
import { LocalDataPage, SettingsPage } from "./pages/LocalDataPage";
import { usePageScroll } from "./state/usePageScroll";
import { objectKindLabel } from "./services/objectLabels";

const categoryKinds: [string, ObjectKind[]][] = [
  ["游戏对象", ["card", "relic", "encounter", "ancient", "potion", "event", "enemy", "enchantment", "quest", "restChoice", "location", "modifier"]],
  ["进度对象", ["badge", "epoch", "achievement"]],
  ["统计维度", ["character", "build", "ascension", "outcome", "party", "gameMode", "floor", "act", "date", "week", "playerPosition", "roomType"]],
];
const categories = categoryKinds.map(([title, kinds]): [string, [ObjectKind, string][]] =>
  [title, kinds.map((kind): [ObjectKind, string] => [kind, objectKindLabel(kind)])],
);
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
  gameObjects: "游戏对象",
  progressObjects: "进度对象",
  dimensions: "统计维度",
};
for (const [, rows] of categories)
  for (const [kind, label] of rows) titles["objects/" + kind] = label;
const categoryPages = ["gameObjects", "progressObjects", "dimensions"];

function CategoryPage({ page }: { page: string }) {
  const { game, navigate } = useAppStore();
  const index = categoryPages.indexOf(page);
  return <div style={{ display: "contents" }} data-analysis-ready="true"><Card title={titles[page]}><div className="category-grid">
    {(categories[index]?.[1] ?? []).filter(([kind]) => game === "sts2" || !sts2Only.has(kind)).map(([kind, title]) =>
      <button key={kind} className="category-tile" onClick={() => navigate("objects/" + kind)}>
        <Layers size={24} style={{ color: objectColor(kind) }} /><strong>{title}</strong>
      </button>)}
  </div></Card></div>;
}
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
function Page({ page }: { page: string }) {
  if (categoryPages.includes(page)) return <CategoryPage page={page} />;
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
      })
      .catch((error) => {
        if (!canceled) useAppStore.setState({ error: String(error) });
      });
    return () => {
      canceled = true;
      stop?.();
    };
  }, []);
  const state = useAppStore();
  const [sidebar, setSidebar] = useState(false);
  const pageScroll = usePageScroll(`${state.game}/${state.page}`);
  useEffect(() => {
    void useAppStore.getState().initialize();
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state.settings.theme]);
  useEffect(() => {
    if (!isTauri()) return;
    const timer = setInterval(() => {
      void useAppStore.getState().syncAll(false);
    }, 15000);
    const foreground = () => {
      if (document.visibilityState !== "hidden") void useAppStore.getState().syncAll(true);
    };
    window.addEventListener("focus", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const s = useAppStore.getState();
      if (e.altKey) return;
      if (s.page === "home" && e.key !== "0") return;
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
      const pages: Record<string, string> = { "1": "dashboard", "2": "objects/card", "3": "runs", ",": "settings" };
      if (pages[e.key]) {
        e.preventDefault();
        s.navigate(pages[e.key]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSidebar(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
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
    ([key]) => !key.includes("/") && key !== "settings" && key !== "local" && !categoryPages.includes(key),
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
      {sidebar && <button className="sidebar-backdrop" aria-label="关闭侧栏" onClick={() => setSidebar(false)} />}
      <aside id="app-sidebar" aria-label="导航" className={`sidebar ${sidebar ? "open" : ""}`}>
        <button className="brand" onClick={() => nav("home")}>
          <Home size={18} />
          <span>尖塔数据终端</span>
        </button>
        <div className="game-name">
          {state.game === "sts1" ? "杀戮尖塔 1" : "杀戮尖塔 2"}
        </div>
        <nav aria-label="页面">
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
          {categories.map(([label, rows], index) => (
            <div key={label} className="nav-group">
              <button className={`category-heading ${state.page === categoryPages[index] ? "selected" : ""}`} onClick={() => nav(categoryPages[index])}>{label}</button>
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
            aria-controls="app-sidebar"
            aria-expanded={sidebar}
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
              onClick={() => void state.importDirectory()}
              title="导入文件夹 ⌘/Ctrl+O"
              aria-label="导入文件夹"
            >
              <FolderOpen size={17} />
            </button>
            <button
              disabled={state.busy || !state.syncSource}
              onClick={() => void state.sync()}
              title="立即同步 ⌘/Ctrl+R"
              aria-label="立即同步"
            >
              <RefreshCw size={17} className={state.busy ? "spinning" : ""} />
            </button>
          </div>
        </header>
        <main className="page-content" ref={pageScroll}>
          {state.error && (
            <div className="global-error">
              <ErrorState error={state.error} />
              <button onClick={state.dismissError}>关闭</button>
            </div>
          )}
          {!["career", "local", "settings", ...categoryPages].includes(state.page) &&
            !state.page.startsWith("run/") && <AppFilters />}
          {state.busy && (
            <div className="sync-status" role="status">
              正在同步…
            </div>
          )}
          <PageBoundary page={`${state.game}/${state.revision}/${state.page}`}>
            {state.ready ? <Page page={state.page} /> : state.error
              ? <button disabled={state.busy} onClick={() => void state.selectGame(state.game)}>重新读取本地数据</button>
              : <LoadingState />}
          </PageBoundary>
        </main>
      </div>
    </div>
  );
}
