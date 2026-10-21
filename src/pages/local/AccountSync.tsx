import { useState } from "react";
import { Cloud, RefreshCw } from "lucide-react";
import { Card, ErrorState } from "../../components/UI";
import { useAccountStore } from "../../state/accountStore";
import { useAppStore } from "../../state/appStore";

export function AccountSync() {
  const account = useAccountStore();
  const sync = useAppStore((state) => state.accountSync);
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [manage, setManage] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  return <Card title="账户与多端同步" help="启用后将两款游戏当前的数据集及收藏保存到本站私有账户，供电脑和 Android 浏览器同步。解析和统计仍在设备本地完成。目录权限、路径、筛选和外观留在本机。">
    <ErrorState error={account.error} />
    {!account.user ? <form className="account-form" onSubmit={async (event) => {
      event.preventDefault();
      if (await account.authenticate(register ? "register" : "login", username, password, invite)) { setRegister(false); setPassword(""); setInvite(""); }
    }}>
      <label>用户名<input name="username" autoCapitalize="none" autoCorrect="off" autoComplete="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
      <label>密码<input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={12} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {register && <label>邀请码<input name="invite" autoComplete="off" required value={invite} onChange={(event) => setInvite(event.target.value)} /></label>}
      <div className="action-row"><button disabled={account.busy || !account.ready} type="submit">{register ? "注册账户" : "登录"}</button>
        <button type="button" disabled={account.busy} onClick={() => { setRegister(!register); setPassword(""); }}>{register ? "已有账户" : "使用邀请码注册"}</button></div>
    </form> : <>
      <dl className="details"><dt>账户</dt><dd>{account.user.username}</dd><dt>账户同步</dt><dd role="status">{account.status}</dd>
        <dt>最近同步</dt><dd>{Math.max(...Object.values(sync.games).map((value) => value?.updated ?? 0), 0) ? new Date(Math.max(...Object.values(sync.games).map((value) => value?.updated ?? 0))).toLocaleString() : "—"}</dd></dl>
      <div className="action-row">
        <button disabled={account.busy} title="同步两款游戏当前的数据集和收藏。首次启用将上传本机数据，或下载已有云端数据；两端均有不同数据时需要选择。" onClick={() => void account.setEnabled(!sync.enabled)}><Cloud size={16} />{sync.enabled ? "暂停账户同步" : "启用账户同步"}</button>
        <button disabled={account.busy || !sync.enabled} onClick={() => void account.sync()}><RefreshCw size={16} />同步账户数据</button>
        <button disabled={account.busy} onClick={() => { setManage(!manage); setPassword(""); setNewPassword(""); setDeleteConfirm(false); }}>管理账户</button>
        <button disabled={account.busy} onClick={() => void account.logout()}>退出登录</button>
      </div>
      {account.conflicts.map((conflict) => <div className="sync-conflict" key={conflict.game}>
        <strong>{conflict.game === "sts1" ? "杀戮尖塔 1" : "杀戮尖塔 2"}同步冲突</strong>
        <dl className="details"><dt>本机记录</dt><dd>{conflict.localRuns}</dd><dt>云端记录</dt><dd>{conflict.remoteRuns}</dd></dl>
        <div className="action-row"><button disabled={account.busy} title="将当前本机数据上传，替换云端版本。其他设备的未提交修改仍会提示冲突。" onClick={() => void account.sync({ ...conflict, choice: "local" })}>使用本机并上传</button>
          <button disabled={account.busy} title="本机当前数据先保存为来源归档，再载入云端数据。" onClick={() => void account.sync({ ...conflict, choice: "remote" })}>备份本机并使用云端</button></div>
      </div>)}
      {manage && <form className="account-form" onSubmit={async (event) => { event.preventDefault(); if (await account.changePassword(password, newPassword)) { setPassword(""); setNewPassword(""); } }}>
        <label>当前密码<input type="password" autoComplete="current-password" required minLength={12} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        <div className="action-row"><button disabled={account.busy} type="submit">修改密码</button>
          {!deleteConfirm ? <button className="danger-button" type="button" disabled={account.busy} onClick={() => setDeleteConfirm(true)}>删除账户</button> : <button className="danger-button" type="button" disabled={account.busy || !password} title="永久删除此账户、所有会话及服务器上的同步数据。本机数据保留。服务器私有备份按保留周期到期删除。" onClick={async () => { if (await account.deleteAccount(password)) { setPassword(""); setNewPassword(""); setManage(false); } }}>确认删除账户和云端数据</button>}</div>
      </form>}
    </>}
  </Card>;
}
