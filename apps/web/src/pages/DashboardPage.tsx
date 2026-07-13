import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, ClipboardCheck, FileSpreadsheet, FolderKanban, Layers3, UploadCloud } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DashboardSummary } from '@excelmaster/shared';
import { api } from '../lib/api';
import { EmptyState, Loading, PageHeader, StatusBadge } from '../components/ui';

export function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: async () => (await api.get<DashboardSummary>('/dashboard')).data, refetchInterval: 15_000 });
  if (isLoading || !data) return <Loading label="載入工作區總覽" />;
  const cards = [
    { label: '來源檔案', value: data.files, icon: FileSpreadsheet, tone: 'bg-blue-50 text-blue-700' },
    { label: '本月批次', value: data.jobsThisMonth, icon: Layers3, tone: 'bg-violet-50 text-violet-700' },
    { label: '完成批次', value: data.completedJobs, icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700' },
    { label: '待人工確認', value: data.reviewTasks, icon: ClipboardCheck, tone: 'bg-amber-50 text-amber-700' }
  ];
  return <><PageHeader title="首頁" description="把多份 Excel 或 Google Sheets 放進整合工作台，系統會自動辨識、合併並建立新檔。" action={<Link className="btn-primary" to="/analysis"><UploadCloud size={17} />開始整合</Link>} /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, icon: Icon, tone }) => <div className="card p-5" key={label}><div className="flex items-start justify-between"><div><p className="text-sm font-semibold text-slate-500">{label}</p><p className="mt-3 text-3xl font-black tracking-tight text-ink">{value.toLocaleString()}</p></div><div className={`rounded-xl p-3 ${tone}`}><Icon size={21} /></div></div></div>)}</div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_.9fr]"><section className="card overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-bold text-ink">最近處理批次</h2><p className="mt-1 text-xs text-slate-400">狀態每 15 秒更新</p></div><Link className="text-sm font-bold text-brand-700" to="/queue">查看全部</Link></div>{data.recentJobs.length ? <div className="divide-y divide-slate-100">{data.recentJobs.map((job) => <div key={job.id} className="px-5 py-4"><div className="flex items-center justify-between gap-4"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-800">{job.name}</p><p className="mt-1 text-xs text-slate-400">{new Date(job.createdAt).toLocaleString('zh-TW')}</p></div><StatusBadge status={job.status} /></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${job.progress}%` }} /></div></div>)}</div> : <EmptyState icon={<Layers3 />} title="尚無處理批次" description="上傳 Excel、CSV 或 ZIP 後，分析工作會出現在這裡。" />}</section>
      <section className="card p-5"><h2 className="font-bold text-ink">常用工作</h2><div className="mt-4 space-y-3">{[{ to: '/analysis', icon: UploadCloud, title: '整合多份試算表', text: 'Excel、CSV 與 Google Sheets 可混合' }, { to: '/exports', icon: FolderKanban, title: '下載整合結果', text: 'Excel 新檔、專業報告與 GAS 腳本' }, { to: '/reviews', icon: ClipboardCheck, title: '確認不確定項目', text: '只需處理低信心度表頭或欄位' }].map(({ to, icon: Icon, title, text }) => <Link key={to} to={to} className="group flex items-center gap-3 rounded-xl border border-slate-100 p-3.5 transition hover:border-brand-200 hover:bg-brand-50"><div className="rounded-lg bg-slate-50 p-2 text-slate-500 group-hover:bg-white group-hover:text-brand-700"><Icon size={18} /></div><div className="min-w-0 flex-1"><p className="text-sm font-bold text-slate-800">{title}</p><p className="truncate text-xs text-slate-400">{text}</p></div><ArrowRight className="text-slate-300 group-hover:text-brand-600" size={16} /></Link>)}</div></section></div>
  </>;
}
