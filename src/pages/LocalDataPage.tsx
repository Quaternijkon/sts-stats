import { useEffect, useState } from "react";
import { Download, FolderOpen, RefreshCw } from "lucide-react";
import { useAppStore } from "../state/appStore";
import { useAnalysis } from "../state/useAnalysis";
import { analysisClient } from "../worker/client";
import { platform } from "../services/platform";
import { Card, ErrorState, MetricGrid, MetricTile } from "../components/UI";
import { formatValue } from "../styles/theme";
import { zhCharacter } from "../../Engine/domain/i18n";
import type { StorageSummary } from "../worker/operations";

function progressCount(row: Record<string, unknown>, key: "wins" | "losses") {
  if (Array.isArray(row.recordedFields) && !row.recordedFields.includes(key)) return "—";
  const value = row[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? formatValue(value) : "—";
}

function DataDirectory() {
  const [directory, setDirectory] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    platform.dataDirectory().then((value) => { if (active) setDirectory(value); })
      .catch((reason) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);
  return <>
    <dl className="details"><dt>数据目录</dt><dd>{directory || "—"}</dd></dl>
    <ErrorState error={error} />
    <button onClick={() => void platform.openDataDirectory().catch((reason) => setError(String(reason)))}><FolderOpen size={16} />打开数据文件夹</button>
  </>;
}

export function SaveSyncControls() {
  const { settings, setSettings, busy, sync, syncSource, syncStatus, syncError, lastSyncedAt } = useAppStore();
  return <div className="sync-state">
    <label title={syncSource ? "应用运行时单向归档来源目录，来源删除不会移除已导入历史" : "先选择存档文件夹以启用自动同步"}>
      自动同步<input type="checkbox" checked={settings.autoSync} disabled={!syncSource}
        onChange={(event) => setSettings({ autoSync: event.target.checked })} />
    </label>
    <dl className="details">
      <dt>同步状态</dt><dd role="status">{syncStatus}</dd>
      <dt>同步目录</dt><dd>{syncSource || "—"}</dd>
      <dt>最近同步</dt><dd>{lastSyncedAt == null ? "—" : new Date(lastSyncedAt).toLocaleString()}</dd>
    </dl>
    <ErrorState error={syncError} />
    <button disabled={busy || !syncSource} onClick={() => void sync()}><RefreshCw size={16} />立即同步</button>
  </div>;
}

function ClearDataControls() {
  const { game, busy, clearData } = useAppStore();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setConfirm(false), [game]);
  return confirm ? <div className="action-row">
    <span>清除此游戏的本地记录、归档、缓存和收藏？已从来源删除的历史清除后无法重新导入。</span>
    <button className="danger-button" disabled={busy} onClick={async () => { await clearData(); setConfirm(false); }}>确认清除</button>
    <button disabled={busy} onClick={() => setConfirm(false)}>取消</button>
  </div> : <button className="danger-button" disabled={busy} onClick={() => setConfirm(true)}>清除此游戏数据</button>;
}

export function LocalDataPage() {
  const { dataset, busy, importDirectory, importSingleFiles, importExistingDataset, favorites, game, navigate } = useAppStore();
  const { data, error, loading } = useAnalysis<StorageSummary>({ op: "storageSummary" }, { unfiltered: true });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportDataset = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const text = await analysisClient(game).call<string>({ op: "exportDataset" });
      await platform.exportText(`${game}-dataset.json`, text);
    } catch (reason) { setExportError(String(reason)); }
    finally { setExporting(false); }
  };
  return <div style={{ display: "contents" }} data-analysis-ready={data && !loading ? "true" : undefined}>
    <MetricGrid>
      <MetricTile label="单人记录" value={data?.soloRuns ?? "—"} />
      {game === "sts2" && <MetricTile label="多人记录" value={data?.coopRuns ?? "—"} />}
      <MetricTile label="全部记录" value={data?.totalRuns ?? "—"} />
      <MetricTile label="单人时长" value={formatValue(data?.soloTime, "duration")} kind="time" />
      <MetricTile label="详细记录时长" value={formatValue(data?.totalTime, "duration")} kind="time" help="已导入详细记录的时长合计；与 Steam 游戏运行时长统计范围不同" />
      {game === "sts2" && <MetricTile label="进度累计时长" value={formatValue(data?.progressTime, "duration")} kind="time"
        help="progress.save 累计，可能包含多人和缺失的历史记录，不能与详细记录时长相加" />}
    </MetricGrid>
    <ErrorState error={error} />
    <Card title="存档">
      <div className="action-row">
        <button disabled={busy} onClick={() => void importDirectory()}><FolderOpen size={16} />导入文件夹</button>
        <button disabled={busy} onClick={() => void importSingleFiles()}>导入文件</button>
        <button disabled={busy} onClick={() => void importExistingDataset()}>迁移 dataset.json</button>
        <button disabled={busy || exporting} onClick={() => void exportDataset()}><Download size={16} />导出数据</button>
      </div>
      <ErrorState error={exportError} />
      <dl className="details">
        <dt>来源</dt><dd>{dataset.source || "未导入"}</dd>
        <dt>最近导入</dt><dd>{data && (data.totalRuns > 0 || dataset.progress) ? new Date((dataset.importedAt + 978307200) * 1000).toLocaleString() : "—"}</dd>
        <dt>收藏</dt><dd>{favorites.length}</dd>
        {game === "sts2" && <><dt>多人时长</dt><dd>{formatValue(data?.coopTime, "duration")}</dd>
          <dt>进度累计胜负局数</dt><dd title="来自各角色累计胜利与失败，缺少任一计数时显示 —，不能与详细记录局数相加">{data?.progressRecordedRuns ?? "—"}</dd>
          <dt>进度累计胜负</dt><dd>{dataset.progress?.characterStats?.length
            ? dataset.progress.characterStats.map((row) => `${zhCharacter(row.character)} ${progressCount(row, "wins")} / ${progressCount(row, "losses")}`).join(" · ") : "—"}</dd></>}
      </dl>
    </Card>
    <Card title="自动同步"><SaveSyncControls /></Card>
    <Card title="应用数据"><DataDirectory /><div className="action-row"><button onClick={() => navigate("settings")}>设置</button></div></Card>
    <Card title="清除本地数据"><ClearDataControls /></Card>
  </div>;
}

export function SettingsPage() {
  const { settings, setSettings } = useAppStore();
  return <div style={{ display: "contents" }} data-analysis-ready="true">
    <Card title="偏好"><div className="settings-list">
      <label>外观<select value={settings.theme} onChange={(event) => setSettings({ theme: event.target.value as typeof settings.theme })}>
        <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
      </select></label>
      <label title="样本量低于此值的分组在数据表中隐藏">最低样本量<input type="number" min="1" max="1000" value={settings.minimumSample}
        onChange={(event) => setSettings({ minimumSample: Math.max(1, Math.min(1000, Math.floor(Number(event.target.value) || 1))) })} /></label>
    </div></Card>
    <Card title="自动同步"><SaveSyncControls /></Card>
    <Card title="存储"><DataDirectory /><ClearDataControls /></Card>
  </div>;
}
