import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeDollarSign, Ban, Download, HardDrive, PackageCheck, RefreshCcw, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Loading, Notice, PageHeader, StatusBadge } from '../components/ui';

const plans = ['TRIAL', 'STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE'];
const money = (value: number) => `NT$${value.toLocaleString('zh-TW')}`;

function useAdminQuery(key: string, url: string, enabled: boolean) {
  return useQuery({ queryKey: [key], queryFn: async () => (await api.get(url)).data, enabled });
}

export function AdminPage() {
  const { session } = useAuth();
  const client = useQueryClient();
  const [releaseForm, setReleaseForm] = useState<{ version: string; platform: 'WINDOWS'|'MACOS'; minimumPlan: string; file: File | null }>({ version: '1.0.0', platform: 'WINDOWS', minimumPlan: 'STARTER', file: null });
  const enabled = session?.user.platformRole === 'SUPERADMIN';
  const overview = useAdminQuery('admin-overview', '/admin/overview', enabled);
  const users = useAdminQuery('admin-users', '/admin/users', enabled);
  const workspaces = useAdminQuery('admin-workspaces', '/admin/workspaces', enabled);
  const payments = useAdminQuery('admin-payments', '/admin/payments', enabled);
  const downloads = useAdminQuery('admin-downloads', '/admin/downloads', enabled);
  const licenses = useAdminQuery('admin-licenses', '/admin/licenses', enabled);
  const audit = useAdminQuery('admin-audit', '/admin/audit', enabled);
  const releases = useAdminQuery('admin-releases', '/admin/releases', enabled);
  const refreshAdmin = () => Promise.all(['admin-overview','admin-users','admin-workspaces','admin-payments','admin-downloads','admin-licenses','admin-audit','admin-releases'].map((key) => client.invalidateQueries({ queryKey: [key] })));
  const updateUser = useMutation({ mutationFn: ({ id, body }: any) => api.patch(`/admin/users/${id}`, body), onSuccess: refreshAdmin });
  const updateWorkspace = useMutation({ mutationFn: ({ id, body }: any) => api.patch(`/admin/workspaces/${id}`, body), onSuccess: refreshAdmin });
  const updateLicense = useMutation({ mutationFn: ({ id, revoked }: any) => api.patch(`/admin/licenses/${id}`, { revoked }), onSuccess: refreshAdmin });
  const publishRelease = useMutation({ mutationFn: async () => { const form = new FormData(); form.append('version', releaseForm.version); form.append('platform', releaseForm.platform); form.append('minimumPlan', releaseForm.minimumPlan); if (releaseForm.file) form.append('file', releaseForm.file); return api.post('/admin/releases', form); }, onSuccess: refreshAdmin });
  if (!enabled) return <Notice type="error">需要平台 SUPERADMIN 權限。</Notice>;
  if (overview.isLoading) return <Loading label="載入平台後台"/>;
  const errors = [updateUser.error, updateWorkspace.error, updateLicense.error, publishRelease.error].filter(Boolean);
  const cards = [
    ['訂閱者', overview.data.activeSubscriptions, BadgeDollarSign], ['已啟用裝置', overview.data.activeDevices, HardDrive],
    ['完成下載', overview.data.downloads, Download], ['停權帳號', overview.data.suspendedUsers, Ban]
  ] as const;
  const extendThirtyDays = (workspace: any) => {
    const current = workspace.subscriptionEndsAt ? new Date(workspace.subscriptionEndsAt) : new Date();
    const start = current > new Date() ? current : new Date();
    updateWorkspace.mutate({ id: workspace.id, body: { subscriptionStatus: 'ACTIVE', subscriptionInterval: 'MANUAL', subscriptionEndsAt: new Date(start.getTime() + 30 * 24 * 60 * 60_000).toISOString() } });
  };

  return <>
    <PageHeader title="訂閱、下載與平台管理" description="完整追蹤訂閱期間、付款訂單、安裝包下載、裝置啟用與最後驗證；撤銷後安裝版會在下次驗證停止。" action={<button className="btn-secondary" onClick={refreshAdmin}><RefreshCcw size={16}/>重新整理</button>}/>
    {errors.map((error, index) => <Notice key={index} type="error">{errorMessage(error)}</Notice>)}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,value,Icon]) => <div className="card p-5" key={label}><Icon className="text-brand-600"/><p className="mt-4 text-sm text-slate-500">{label}</p><p className="mt-1 text-3xl font-black text-ink">{value}</p></div>)}</div>

    <section className="card mt-6 overflow-hidden"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold">訂閱者與有效期間</h2><p className="mt-1 text-xs text-slate-400">人工調整適合付款連結上線前測試；每次異動都寫入平台稽核。</p></div><div className="table-wrap"><table className="table"><thead><tr><th>工作區／擁有者</th><th>方案</th><th>狀態</th><th>到期時間</th><th>紀錄</th><th>操作</th></tr></thead><tbody>{workspaces.data?.items.map((workspace: any) => <tr key={workspace.id}><td><p className="font-bold">{workspace.name}</p><p className="text-xs text-slate-400">{workspace.members[0]?.user.email ?? '—'}</p></td><td><select className="input min-w-40" value={workspace.plan} onChange={(event) => updateWorkspace.mutate({ id: workspace.id, body: { plan: event.target.value } })}>{plans.map((plan) => <option key={plan}>{plan}</option>)}</select></td><td><StatusBadge status={workspace.entitlement.status}/><p className="mt-1 text-[11px] text-slate-400">有效權益：{workspace.entitlement.effectivePlan}</p></td><td>{workspace.subscriptionEndsAt ? new Date(workspace.subscriptionEndsAt).toLocaleString('zh-TW') : '—'}</td><td className="text-xs">{workspace._count.paymentOrders} 付款<br/>{workspace._count.packageDownloads} 下載<br/>{workspace._count.licenseActivations} 啟用碼</td><td><div className="flex flex-wrap gap-2"><button className="btn-secondary !px-3 !py-2" disabled={workspace.plan === 'TRIAL'} onClick={() => extendThirtyDays(workspace)}>延長 30 天</button><button className="btn-secondary !px-3 !py-2" disabled={workspace.plan === 'TRIAL'} onClick={() => updateWorkspace.mutate({ id: workspace.id, body: { subscriptionStatus: 'EXPIRED', subscriptionEndsAt: new Date().toISOString() } })}>立即到期</button><button className="btn-secondary !px-3 !py-2" onClick={() => updateWorkspace.mutate({ id: workspace.id, body: { suspended: !workspace.suspendedAt } })}>{workspace.suspendedAt ? '恢復工作區' : '停用工作區'}</button></div></td></tr>)}</tbody></table></div></section>

    <section className="card mt-6 overflow-hidden"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold">安裝裝置與授權</h2><p className="mt-1 text-xs text-slate-400">只顯示啟用碼末四碼，不保存可讀取的完整啟用碼。</p></div><div className="table-wrap"><table className="table"><thead><tr><th>訂閱者</th><th>平台／版本</th><th>啟用碼</th><th>裝置</th><th>最後驗證</th><th>狀態</th><th></th></tr></thead><tbody>{licenses.data?.items.map((item: any) => <tr key={item.id}><td><p className="font-bold">{item.workspace.name}</p><p className="text-xs text-slate-400">{item.user.email}</p></td><td>{item.platform}<br/><span className="text-xs text-slate-400">v{item.download.release.version}</span></td><td>•••• {item.codeLast4}</td><td>{item.deviceName ?? '尚未綁定'}</td><td>{item.lastSeenAt ? new Date(item.lastSeenAt).toLocaleString('zh-TW') : '—'}</td><td><StatusBadge status={item.status}/><p className="mt-1 text-[11px] text-slate-400">訂閱至 {item.workspace.subscriptionEndsAt ? new Date(item.workspace.subscriptionEndsAt).toLocaleDateString('zh-TW') : '—'}</p></td><td><button className="btn-secondary !px-3 !py-2" onClick={() => updateLicense.mutate({ id: item.id, revoked: item.status !== 'REVOKED' })}>{item.status === 'REVOKED' ? '重設為待啟用' : '撤銷裝置'}</button></td></tr>)}</tbody></table></div></section>

    <section className="card mt-6 overflow-hidden"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold">安裝包下載紀錄</h2></div><div className="table-wrap"><table className="table"><thead><tr><th>訂閱者</th><th>平台／版本</th><th>提出時間</th><th>實際下載</th><th>來源</th></tr></thead><tbody>{downloads.data?.items.map((item: any) => <tr key={item.id}><td>{item.workspace.name}<p className="text-xs text-slate-400">{item.user.email}</p></td><td>{item.release.platform} v{item.release.version}</td><td>{new Date(item.requestedAt).toLocaleString('zh-TW')}</td><td>{item.usedAt ? new Date(item.usedAt).toLocaleString('zh-TW') : '未使用／已過期'}</td><td className="max-w-xs truncate text-xs">{item.ipAddress ?? '—'}<br/>{item.userAgent ?? '—'}</td></tr>)}</tbody></table></div></section>

    <section className="card mt-6 overflow-hidden"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold">帳號管理</h2></div><div className="table-wrap"><table className="table"><thead><tr><th>帳號</th><th>平台角色</th><th>狀態</th><th>驗證</th><th></th></tr></thead><tbody>{users.data?.items.map((user: any) => <tr key={user.id}><td><p className="font-bold">{user.name}</p><p className="text-xs text-slate-400">{user.email}</p></td><td>{user.platformRole}</td><td><StatusBadge status={user.status}/></td><td>{user.emailVerifiedAt ? '已驗證' : '未驗證'}</td><td>{user.id !== session?.user.id && <button className="btn-secondary !px-3 !py-2" onClick={() => updateUser.mutate({ id: user.id, body: { status: user.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' } })}>{user.status === 'SUSPENDED' ? '恢復' : '停權'}</button>}</td></tr>)}</tbody></table></div></section>

    <section className="card mt-6 overflow-hidden"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold">付款訂單</h2></div><div className="table-wrap"><table className="table"><thead><tr><th>帳號</th><th>工作區</th><th>方案／期間</th><th>金額</th><th>狀態</th><th>付款時間</th></tr></thead><tbody>{payments.data?.items.slice(0,100).map((item: any) => <tr key={item.id}><td>{item.user.email}</td><td>{item.workspace.name}</td><td>{item.plan}／{item.billingInterval}</td><td>{money(item.amountTwd)}</td><td><StatusBadge status={item.status}/></td><td>{item.paidAt ? new Date(item.paidAt).toLocaleString('zh-TW') : '—'}</td></tr>)}</tbody></table></div></section>

    <section className="card mt-6 p-5"><h2 className="flex items-center gap-2 font-bold"><PackageCheck size={19}/>發布已驗證的一鍵安裝包</h2><p className="mt-1 text-xs leading-5 text-slate-400">先執行 Windows／macOS 打包與完整性驗證，再上傳 ZIP。系統會重新計算 SHA-256 並私有保存。</p><div className="mt-4 grid gap-3 md:grid-cols-4"><input className="input" value={releaseForm.version} onChange={(event) => setReleaseForm({ ...releaseForm, version: event.target.value })} placeholder="1.0.0"/><select className="input" value={releaseForm.platform} onChange={(event) => setReleaseForm({ ...releaseForm, platform: event.target.value as 'WINDOWS'|'MACOS' })}><option>WINDOWS</option><option>MACOS</option></select><select className="input" value={releaseForm.minimumPlan} onChange={(event) => setReleaseForm({ ...releaseForm, minimumPlan: event.target.value })}>{plans.slice(1).map((plan) => <option key={plan}>{plan}</option>)}</select><input className="input" type="file" accept=".zip" onChange={(event) => setReleaseForm({ ...releaseForm, file: event.target.files?.[0] ?? null })}/></div><button className="btn-primary mt-4" disabled={!releaseForm.file || publishRelease.isPending} onClick={() => publishRelease.mutate()}><PackageCheck size={16}/>發布 Release</button><div className="mt-5 divide-y divide-slate-100">{releases.data?.items.map((release: any) => <div className="flex flex-wrap justify-between gap-2 py-3 text-sm" key={release.id}><span className="font-bold">{release.platform} v{release.version} · {release.minimumPlan}</span><code className="text-xs text-slate-400">{release.sha256}</code></div>)}</div></section>

    <section className="card mt-6 overflow-hidden"><div className="border-b border-slate-100 px-5 py-4"><h2 className="flex items-center gap-2 font-bold"><ShieldCheck size={18}/>平台稽核</h2></div><div className="divide-y divide-slate-100">{audit.data?.items.slice(0,80).map((item: any) => <div key={item.id} className="px-5 py-3 text-sm"><span className="font-mono font-bold">{item.action}</span><span className="ml-3 text-slate-400">{item.actor?.email ?? 'System'} · {new Date(item.createdAt).toLocaleString('zh-TW')}</span></div>)}</div></section>
  </>;
}
