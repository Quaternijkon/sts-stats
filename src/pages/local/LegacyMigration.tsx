import { useEffect, useState } from "react";
import { Card, ErrorState, EmptyState } from "../../components/UI";
import { useAppStore } from "../../state/appStore";
import { platform, sourceLabel } from "../../services/platform";
import type { ArchiveSummary, GameVersion, LegacySelection } from "../../services/models";
import { Pager } from "../objects/ObjectTables";

export function LegacyMigration() {
  const { busy, migrateLegacy, migrationStatus } = useAppStore();
  const [selection, setSelection] = useState<LegacySelection | null>(null);
  const [ids, setIDs] = useState<string[]>([]);
  const [active, setActive] = useState<Partial<Record<GameVersion, string>>>({});
  const [includePreferences, setIncludePreferences] = useState(true);
  const [usePreferences, setUsePreferences] = useState(true);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  async function choose() {
    setChoosing(true); setError(null);
    try {
      const selected = await platform.chooseLegacyData(includePreferences);
      if (!selected) return;
      setSelection(selected);
      setIDs(selected.sources.map((source) => source.id));
      setOffset(0);
      setUsePreferences(!!selected.preferences);
      const next: Partial<Record<GameVersion, string>> = {};
      for (const game of ["sts1", "sts2"] as const) {
        const snapshot = await platform.openDataset(game);
        if (!snapshot.dataset.runs.length && !snapshot.dataset.progress) {
          const source = selected.sources.find((source) => source.game === game && source.active)
            ?? selected.sources.find((source) => source.game === game);
          if (source) next[game] = source.id;
        }
      }
      setActive(next);
    } catch (reason) { setError(String(reason)); }
    finally { setChoosing(false); }
  }
  async function cancel() {
    if (!selection) return;
    try { await platform.cancelLegacyMigration(selection.token); setSelection(null); }
    catch (reason) { setError(String(reason)); }
  }
  const locked = busy || choosing;
  return <Card title="原应用迁移" help="选择旧 STS2Stats 数据目录，读取 dataset.json 和全部 save-archive-v1 来源。旧文件只读；所选来源全部校验成功后提交，并保留已有记录与收藏。同步目录需通过新应用的目录选择器重新授权。">
    <div className="action-row">
      <label><input type="checkbox" checked={includePreferences} disabled={locked} onChange={(event) => setIncludePreferences(event.target.checked)} />选择旧收藏与偏好</label>
      <button disabled={locked} onClick={() => void choose()}>{choosing ? "正在读取迁移预览…" : selection ? "重新选择旧应用数据" : "选择旧应用数据"}</button>
    </div>
    <ErrorState error={error} />
    {selection && <>
      <div className="table-scroll"><table>
        <thead><tr><th>迁移</th><th>游戏</th><th>来源</th><th>对局</th><th>历史版本</th></tr></thead>
        <tbody>{selection.sources.slice(offset, offset + 100).map((source) => <tr key={source.id}>
          <td><input type="checkbox" aria-label={`迁移来源 ${source.source}`} checked={ids.includes(source.id)} disabled={locked} onChange={(event) => {
            setIDs(event.target.checked ? [...ids, source.id] : ids.filter((id) => id !== source.id));
            if (!event.target.checked && active[source.game] === source.id) setActive({ ...active, [source.game]: undefined });
          }} /></td><td>{source.game === "sts1" ? "杀戮尖塔 1" : "杀戮尖塔 2"}</td>
          <td title={source.source}>{source.source}{source.active ? " · 旧当前来源" : ""}</td><td>{source.runs}</td><td>{source.revisions}</td>
        </tr>)}</tbody>
      </table></div>
      {selection.sources.length > 100 && <Pager offset={offset} total={selection.sources.length} onChange={setOffset} />}
      {!selection.sources.length && <EmptyState>仅迁移旧收藏与偏好</EmptyState>}
      <div className="settings-list">
        {(["sts1", "sts2"] as const).filter((game) => selection.sources.some((source) => source.game === game)).map((game) => <label key={game}>
          {game === "sts1" ? "一代" : "二代"}迁移后来源<select disabled={locked} value={active[game] ?? ""} onChange={(event) => setActive({ ...active, [game]: event.target.value || undefined })}>
            <option value="">保留当前来源</option>{selection.sources.filter((source) => source.game === game && ids.includes(source.id)).map((source) => <option key={source.id} value={source.id}>{source.source}</option>)}
          </select>
        </label>)}
        <label title="合并旧收藏，采用旧主题、最低样本量及四组筛选；旧书签不授予新应用读取权限。">
          <input type="checkbox" checked={usePreferences} disabled={locked || !selection.preferences} onChange={(event) => setUsePreferences(event.target.checked)} />采用旧应用偏好
        </label>
      </div>
      <div className="action-row">
        <button disabled={locked || (!ids.length && !(usePreferences && selection.preferences))} onClick={async () => {
          const completed = await migrateLegacy(selection, ids, active, usePreferences);
          if (completed) setSelection(null);
        }}>迁移所选来源与偏好</button>
        <button disabled={locked} onClick={() => void cancel()}>取消迁移</button>
        {migrationStatus && <span role="status">{migrationStatus}</span>}
      </div>
    </>}
  </Card>;
}

export function SourceArchives() {
  const { game, revision, archiveRevision, dataset, busy, restoreArchive } = useAppStore();
  const [sources, setSources] = useState<ArchiveSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setSources([]); setError(null); setOffset(0);
    platform.listArchives(game).then((sources) => { if (active) setSources(sources); })
      .catch((reason) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [game, revision, archiveRevision, retry]);
  return <Card title="来源归档" help="应用保存的独立来源，可在游戏原目录已不存在时打开。切换归档会暂停当前来源的自动同步；重新选择原目录后可继续同步。">
    <ErrorState error={error} />
    {error && <button onClick={() => setRetry((value) => value + 1)}>重新读取归档</button>}
    {!sources.length ? <EmptyState>没有来源归档</EmptyState> : <>
      <div className="table-scroll"><table><thead><tr><th>来源</th><th>对局</th><th>操作</th></tr></thead><tbody>
        {sources.slice(offset, offset + 100).map((source) => <tr key={source.source}><td title={sourceLabel(source.source)}>{sourceLabel(source.source) || "未指定来源"}</td><td>{source.runs}</td><td>
          <button disabled={busy || dataset.source === source.source} onClick={() => void restoreArchive(source.source)}>{dataset.source === source.source ? "当前来源" : "使用此归档"}</button>
        </td></tr>)}
      </tbody></table></div>
      {sources.length > 100 && <Pager offset={offset} total={sources.length} onChange={setOffset} />}
    </>}
  </Card>;
}
