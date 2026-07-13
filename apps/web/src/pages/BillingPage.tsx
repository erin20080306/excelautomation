import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BadgeDollarSign, Check, CheckCircle2, Copy, CreditCard, Download, KeyRound, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { EmptyState, Loading, Modal, Notice, PageHeader, StatusBadge } from '../components/ui';

const money = (value: number) => `NT$${value.toLocaleString('zh-TW')}`;

export function BillingPage() {
  const { session } = useAuth();
  const [interval, setInterval] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [downloadTicket, setDownloadTicket] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const plans = useQuery({ queryKey: ['billing-plans'], queryFn: async () => (await api.get('/billing/plans')).data });
  const orders = useQuery({ queryKey: ['billing-orders'], queryFn: async () => (await api.get('/billing/orders')).data });
  const releases = useQuery({ queryKey: ['releases'], queryFn: async () => (await api.get('/downloads/releases')).data });
  const usage = useQuery({ queryKey: ['download-usage'], queryFn: async () => (await api.get('/downloads/usage')).data });
  const checkout = useMutation({
    mutationFn: async (plan: string) => (await api.post('/billing/checkout', { plan, billingInterval: interval })).data,
    onSuccess: (data) => {
      if (data.checkoutUrl) { window.location.assign(data.checkoutUrl); return; }
      const form = document.createElement('form'); form.method = 'POST'; form.action = data.checkoutForm.action;
      for (const [name, value] of Object.entries(data.checkoutForm.fields)) { const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = String(value); form.appendChild(input); }
      document.body.appendChild(form); form.submit();
    }
  });
  const download = useMutation({ mutationFn: async (releaseId: string) => (await api.post('/downloads/request', { releaseId })).data, onSuccess: (data) => { setCopied(false); setDownloadTicket(data); } });
  const subscription = session?.workspace.subscription;
  const endsAt = subscription?.endsAt ? new Date(subscription.endsAt).toLocaleString('zh-TW') : '尚未啟用';

  const copyCode = async () => {
    await navigator.clipboard.writeText(downloadTicket.activationCode);
    setCopied(true);
  };

  return <>
    <PageHeader title="方案、訂閱與安裝包" description="先選擇合適的訂閱方案；訂閱生效後才能產生 Windows／macOS 一次性下載與裝置啟用碼。" />
    {!subscription?.active && session?.workspace.purchasedPlan !== 'TRIAL' && <Notice type="error">原購買方案為 {session?.workspace.purchasedPlan}，但訂閱已到期或停用，目前已自動降為 TRIAL 權益，安裝版也會停止驗證。</Notice>}
    <section className="overflow-hidden rounded-3xl bg-ink p-6 text-white shadow-xl shadow-emerald-950/10 md:p-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center"><div><p className="text-xs font-black uppercase tracking-[.2em] text-emerald-300">Current entitlement</p><h2 className="mt-3 text-2xl font-black">目前可用方案：{session?.workspace.plan}</h2><p className="mt-2 text-sm text-slate-300">訂閱狀態：{subscription?.status ?? 'TRIALING'} · 到期時間：{endsAt}</p><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">付費方案到期後，伺服器會停止新的安裝包下載與已安裝裝置驗證；單純修改電腦日期不會延長伺服器端訂閱。</p></div><div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm"><ShieldCheck className="mb-2 text-emerald-300"/><p className="font-bold">伺服器授權控管</p><p className="mt-1 text-slate-300">一次性下載 · 裝置綁定 · 到期／撤銷停用</p></div></div>
    </section>

    <div className="my-6 flex items-center justify-between gap-4"><div><h2 className="text-xl font-black text-ink">建議訂閱售價</h2><p className="mt-1 text-sm text-slate-500">年繳約等於十個月費用，適合穩定使用者。</p></div><div className="flex rounded-xl border border-slate-200 bg-white p-1"><button className={`rounded-lg px-4 py-2 text-sm font-bold ${interval === 'MONTHLY' ? 'bg-ink text-white' : 'text-slate-500'}`} onClick={() => setInterval('MONTHLY')}>月繳</button><button className={`rounded-lg px-4 py-2 text-sm font-bold ${interval === 'YEARLY' ? 'bg-ink text-white' : 'text-slate-500'}`} onClick={() => setInterval('YEARLY')}>年繳省約 2 個月</button></div></div>
    {checkout.error && <Notice type="error">{errorMessage(checkout.error)}</Notice>}
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">{plans.isLoading ? <Loading /> : plans.data?.items.filter((plan: any) => plan.key !== 'TRIAL').map((plan: any) => {
      const current = session?.workspace.purchasedPlan === plan.key;
      const price = interval === 'YEARLY' ? plan.annualPriceTwd : plan.monthlyPriceTwd;
      return <article key={plan.key} className={`card relative overflow-hidden p-5 ${plan.key === 'PROFESSIONAL' ? 'ring-2 ring-brand-500' : ''}`}>
        {plan.key === 'PROFESSIONAL' && <div className="absolute right-0 top-0 rounded-bl-xl bg-brand-600 px-3 py-1.5 text-[10px] font-black text-white">建議方案</div>}
        <p className="text-xs font-black tracking-widest text-brand-600">{plan.key}</p><h3 className="mt-2 text-xl font-black text-ink">{plan.name}</h3><p className="mt-1 min-h-10 text-sm text-slate-500">{plan.tagline}</p>
        <p className="mt-4 text-3xl font-black text-ink">{money(price)}</p><p className="mt-1 text-xs text-slate-400">／{interval === 'YEARLY' ? '年' : '月'}，建議售價，未稅</p>
        <div className="mt-5 space-y-2.5 text-sm text-slate-600">{plan.features.map((feature: string) => <p key={feature} className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-brand-600" />{feature}</p>)}</div>
        <p className="mt-5 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">{plan.seats} 位使用者 · {plan.devices} 台裝置 · 每期 {plan.downloadQuota} 次下載</p>
        <button className="btn-primary mt-4 w-full" disabled={!plans.data?.checkoutEnabled || checkout.isPending} onClick={() => checkout.mutate(plan.key)}><CreditCard size={16}/>{plans.data?.checkoutEnabled ? current ? '續訂目前方案' : '前往安全付款' : '付款連結準備中'}</button>
      </article>;
    })}</div>
    {!plans.isLoading && !plans.data?.checkoutEnabled && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>付款尚未開放：</strong>{plans.data?.paymentNotice} 價格與功能可以先確認，未串接付款前不會建立假的成功訂單或開放下載。</div>}

    <section className="card mt-7 overflow-hidden"><div className="border-b border-slate-100 px-5 py-4"><h2 className="flex items-center gap-2 font-bold text-ink"><Download size={18}/>Windows／macOS 一鍵安裝包</h2><p className="mt-1 text-xs leading-5 text-slate-400">本期下載額度：{usage.data?.quota == null ? 'SUPERADMIN 測試不受下載次數限制' : `${usage.data?.used ?? 0} / ${usage.data?.quota ?? 0}`}。ZIP 內含安裝說明、版本清單與授權檢查。</p></div>
      {download.error && <div className="p-4"><Notice type="error">{errorMessage(download.error)}</Notice></div>}
      {releases.isLoading ? <Loading /> : !releases.data?.items.length ? <EmptyState icon={<Download/>} title="尚未發布安裝包" description="管理員完成 Windows／macOS 打包驗證並發布後，符合方案且訂閱有效的使用者才會看到下載按鈕。"/> : <div className="table-wrap"><table className="table"><thead><tr><th>平台</th><th>版本</th><th>最低方案</th><th>大小</th><th>SHA-256</th><th></th></tr></thead><tbody>{releases.data.items.map((release: any) => <tr key={release.id}><td>{release.platform}</td><td>{release.version}</td><td>{release.minimumPlan}</td><td>{(Number(release.size)/1024/1024).toFixed(2)} MB</td><td><code className="text-[10px]">{release.sha256.slice(0,20)}…</code></td><td><button className="btn-secondary !px-3 !py-2" disabled={!release.eligible || download.isPending} title={release.reason ?? ''} onClick={() => download.mutate(release.id)}><KeyRound size={15}/>{release.eligible ? '產生下載與啟用碼' : release.reason ?? '方案不足'}</button></td></tr>)}</tbody></table></div>}
    </section>

    <section className="card mt-7 overflow-hidden"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-ink">付款與訂閱紀錄</h2></div>{orders.isLoading ? <Loading/> : !orders.data?.items.length ? <EmptyState icon={<BadgeDollarSign/>} title="尚無付款紀錄" description="付款連結啟用後，只有經過簽章驗證的金流 Webhook 才會更新訂閱期間。"/> : <div className="table-wrap"><table className="table"><thead><tr><th>方案</th><th>期間</th><th>金額</th><th>狀態</th><th>建立時間</th></tr></thead><tbody>{orders.data.items.map((order: any) => <tr key={order.id}><td>{order.plan}</td><td>{order.billingInterval}</td><td>{money(order.amountTwd)}</td><td><StatusBadge status={order.status}/></td><td>{new Date(order.createdAt).toLocaleString('zh-TW')}</td></tr>)}</tbody></table></div>}</section>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500"><p className="flex items-center gap-2"><Sparkles size={17} className="text-brand-600"/>訂閱代表可使用期間，不是永久買斷；匯出完成的 Excel／GAS 檔案仍屬您的資料。</p><div className="flex gap-4"><Link className="font-bold text-brand-700" to="/privacy">隱私權政策</Link><Link className="font-bold text-brand-700" to="/security">安全政策</Link></div></div>

    {downloadTicket && <Modal title="保存啟用碼後下載" onClose={() => setDownloadTicket(null)} wide><div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>啟用碼只顯示這一次。</strong>安裝程式會要求輸入並綁定一台裝置。請勿以截圖或訊息分享給他人。</div><label className="label mt-5">裝置啟用碼</label><div className="flex flex-col gap-2 sm:flex-row"><code className="flex-1 break-all rounded-xl bg-slate-950 p-4 text-sm text-emerald-300">{downloadTicket.activationCode}</code><button className="btn-secondary" onClick={copyCode}>{copied ? <Check size={17}/> : <Copy size={17}/>} {copied ? '已複製' : '複製'}</button></div><div className="mt-5 rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-500"><p>檔名：{downloadTicket.name}</p><p className="break-all">SHA-256：{downloadTicket.sha256}</p><p>連結有效時間：{Math.floor(downloadTicket.expiresIn / 60)} 分鐘，僅能使用一次</p></div><a className="btn-primary mt-5 w-full" href={downloadTicket.url} onClick={() => setTimeout(() => setDownloadTicket(null), 1000)}><Download size={17}/>我已保存啟用碼，開始下載 ZIP</a></Modal>}
  </>;
}
