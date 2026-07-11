import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle, X } from 'lucide-react';

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>{description && <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>}</div>{action}</div>;
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center"><div className="mb-4 rounded-2xl bg-brand-50 p-4 text-brand-600">{icon}</div><h3 className="font-bold text-slate-800">{title}</h3><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

export function Loading({ label = '載入中' }: { label?: string }) { return <div className="flex min-h-52 items-center justify-center gap-3 text-sm text-slate-500"><LoaderCircle className="animate-spin text-brand-600" size={20} />{label}</div>; }

export function Notice({ type, children, onClose }: { type: 'success' | 'error'; children: ReactNode; onClose?: () => void }) {
  const Icon = type === 'success' ? CheckCircle2 : AlertCircle;
  return <div className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}><Icon className="mt-0.5 shrink-0" size={18} /><div className="flex-1">{children}</div>{onClose && <button onClick={onClose} aria-label="關閉"><X size={17} /></button>}</div>;
}

const tones: Record<string, string> = {
  queued: 'bg-slate-100 text-slate-600', downloading: 'bg-blue-50 text-blue-700', validating: 'bg-cyan-50 text-cyan-700', analyzing: 'bg-indigo-50 text-indigo-700',
  classifying: 'bg-violet-50 text-violet-700', parsing: 'bg-violet-50 text-violet-700', mapping: 'bg-amber-50 text-amber-700', cleaning: 'bg-lime-50 text-lime-700',
  awaiting_review: 'bg-amber-100 text-amber-800', exporting: 'bg-blue-50 text-blue-700', completed: 'bg-emerald-50 text-emerald-700', failed: 'bg-rose-50 text-rose-700', cancelled: 'bg-slate-100 text-slate-500',
  OPEN: 'bg-amber-100 text-amber-800', RESOLVED: 'bg-emerald-50 text-emerald-700', IGNORED: 'bg-slate-100 text-slate-600', PROCESSING: 'bg-blue-50 text-blue-700', COMPLETED: 'bg-emerald-50 text-emerald-700', FAILED: 'bg-rose-50 text-rose-700', QUEUED: 'bg-slate-100 text-slate-600'
};
const labels: Record<string, string> = { queued: '排隊中', downloading: '下載中', validating: '驗證中', analyzing: '分析中', classifying: '分類中', parsing: '解析中', mapping: '欄位對應', cleaning: '資料清洗', awaiting_review: '待確認', exporting: '匯出中', completed: '已完成', failed: '失敗', cancelled: '已取消', OPEN: '待確認', RESOLVED: '已完成', IGNORED: '已忽略', QUEUED: '排隊中', PROCESSING: '產生中', COMPLETED: '已完成', FAILED: '失敗' };

export function StatusBadge({ status }: { status: string }) { return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${tones[status] ?? 'bg-slate-100 text-slate-600'}`}>{labels[status] ?? status}</span>; }

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="fixed inset-0 z-[70] flex items-center justify-center p-4"><button className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" aria-label="關閉" onClick={onClose} /><div className={`relative max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-white shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}><div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4"><h2 className="text-lg font-bold text-ink">{title}</h2><button className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onClose} aria-label="關閉"><X size={20} /></button></div><div className="p-6">{children}</div></div></div>;
}

export function Confidence({ value }: { value?: number | null }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  const color = value >= .8 ? 'bg-emerald-500' : value >= .6 ? 'bg-amber-500' : 'bg-rose-500';
  return <div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${color}`} style={{ width: `${Math.round(value * 100)}%` }} /></div><span className="text-xs font-semibold text-slate-600">{Math.round(value * 100)}%</span></div>;
}
