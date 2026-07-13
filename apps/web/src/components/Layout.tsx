import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, BadgeDollarSign, ChevronRight, CircleHelp, ClipboardCheck, Database, Download, FileClock, FileSpreadsheet,
  FolderKanban, LayoutDashboard, LogOut, Menu, Network, Search, Settings, ShieldCheck, X
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { EmptyState, Loading, Modal } from './ui';

const navGroups = [
  { label: '開始使用', items: [
    { path: '/dashboard', label: '首頁', icon: LayoutDashboard },
    { path: '/analysis', label: '整合工作台', icon: FileSpreadsheet },
    { path: '/exports', label: '結果與下載', icon: FileClock }
  ] },
  { label: '檢查進度', items: [
    { path: '/reviews', label: '需要確認', icon: ClipboardCheck },
    { path: '/queue', label: '處理進度', icon: Activity }
  ] },
  { label: '需要時再設定', items: [
    { path: '/projects', label: '自動化流程', icon: FolderKanban },
    { path: '/sources', label: 'Google／資料來源', icon: Database },
    { path: '/rules', label: '進階整合規則', icon: Network }
  ] },
  { label: '管理', items: [
    { path: '/audit', label: '操作紀錄', icon: ShieldCheck },
    { path: '/settings', label: '設定', icon: Settings },
    { path: '/billing', label: '方案與授權', icon: BadgeDollarSign }
  ] }
];

const navItems = navGroups.flatMap((group) => group.items);
const mobileItems = navItems.filter((item) => ['/dashboard', '/analysis', '/exports', '/reviews'].includes(item.path));

export function Layout() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const visibleNavGroups = session?.user.platformRole === 'SUPERADMIN'
    ? navGroups.map((group) => group.label === '管理' ? { ...group, items: [...group.items, { path: '/admin', label: '平台管理', icon: ShieldCheck }] } : group)
    : navGroups;
  const search = useQuery({ queryKey: ['search', query], queryFn: async () => (await api.get('/search', { params: { q: query } })).data, enabled: query.trim().length >= 2 });
  const closeAndNavigate = (path: string) => { setMobileOpen(false); navigate(path); };

  const Navigation = ({ mobile = false }: { mobile?: boolean }) => <nav className="space-y-5">{visibleNavGroups.map((group) => <section key={group.label}><p className="mb-1.5 px-3 text-[10px] font-black uppercase tracking-[.16em] text-slate-300">{group.label}</p><div className="space-y-1">{group.items.map(({ path, label, icon: Icon }) => <NavLink key={path} to={path} onClick={() => mobile && setMobileOpen(false)} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}><Icon size={18} /><span>{label}</span></NavLink>)}</div></section>)}</nav>;

  return <div className="min-h-screen bg-[#F6F9F8]">
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-slate-200/80 bg-white md:flex md:flex-col">
      <div className="flex h-20 items-center gap-3 px-6"><div className="rounded-xl bg-brand-600 p-2.5 text-white"><FileSpreadsheet size={24} /></div><div><div className="font-black tracking-tight text-ink">ExcelMaster</div><div className="text-[10px] font-bold uppercase tracking-[.18em] text-brand-600">Automation Cloud</div></div></div>
      <div className="mx-4 mb-4 rounded-xl border border-brand-100 bg-brand-50/70 p-3"><p className="truncate text-xs font-bold text-brand-900">{session?.workspace.name}</p><p className="mt-1 text-[11px] text-brand-700">{session?.workspace.role} · {session?.workspace.plan}</p></div>
      <div className="flex-1 overflow-y-auto px-3 pb-4"><Navigation /></div>
      <div className="border-t border-slate-100 p-4"><div className="mb-3 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">{session?.user.name.slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800">{session?.user.name}</p><p className="truncate text-xs text-slate-400">{session?.user.email}</p></div></div><button className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-600" onClick={logout}><LogOut size={17} />安全登出</button></div>
    </aside>

    <div className="min-h-screen md:pl-64">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-xl sm:px-6 md:h-20"><button className="rounded-xl p-2 text-slate-600 md:hidden" onClick={() => setMobileOpen(true)} aria-label="開啟選單"><Menu /></button><div className="hidden md:block"><p className="text-xs font-semibold uppercase tracking-[.18em] text-brand-600">ExcelMaster 智慧整合</p><p className="mt-1 text-sm text-slate-400">Excel／Google Sheets 多檔合併、分析與新檔輸出</p></div><div className="flex items-center gap-2"><Link to="/analysis" className="hidden items-center gap-2 rounded-xl bg-ink px-3 py-2 text-sm font-bold text-white sm:flex"><FileSpreadsheet size={17} />開始整合</Link><button onClick={() => setSearchOpen(true)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400 transition hover:border-brand-200 hover:text-brand-700"><Search size={18} /><span className="hidden sm:inline">搜尋檔案、專案與批次</span></button><button className="rounded-xl p-2 text-slate-400 hover:bg-slate-100" title="說明" onClick={() => navigate('/settings')}><CircleHelp size={20} /></button></div></header>
      <main className="mx-auto max-w-[1500px] px-4 py-6 pb-28 sm:px-6 lg:px-8 md:pb-8"><Outlet /></main>
    </div>

    <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-slate-200 bg-white px-1 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 md:hidden">{mobileItems.map(({ path, label, icon: Icon }) => <NavLink key={path} to={path} className={({ isActive }) => `flex min-w-16 flex-col items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold ${isActive ? 'text-brand-700' : 'text-slate-400'}`}><Icon size={19} />{label.replace('系統', '').replace('智慧', '')}</NavLink>)}<button onClick={() => setMobileOpen(true)} className="flex min-w-16 flex-col items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-slate-400"><Menu size={19} />更多</button></div>

    {mobileOpen && <div className="fixed inset-0 z-[60] md:hidden"><button className="absolute inset-0 bg-slate-950/40" onClick={() => setMobileOpen(false)} aria-label="關閉選單" /><div className="absolute inset-y-0 left-0 w-[84%] max-w-sm overflow-y-auto bg-white p-4 shadow-2xl"><div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-3"><div className="rounded-xl bg-brand-600 p-2 text-white"><FileSpreadsheet /></div><span className="font-black text-ink">ExcelMaster</span></div><button onClick={() => setMobileOpen(false)} className="p-2"><X /></button></div><Navigation mobile /><Link to="/billing" onClick={() => setMobileOpen(false)} className="mt-6 flex w-full items-center gap-2 rounded-xl bg-ink px-3 py-2.5 text-sm font-bold text-white"><Download size={17} />購買／下載安裝包</Link><button className="mt-3 flex w-full items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-500" onClick={logout}><LogOut size={17} />安全登出</button></div></div>}

    {searchOpen && <Modal title="全站搜尋" onClose={() => { setSearchOpen(false); setQuery(''); }} wide><input autoFocus className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="至少輸入 2 個字…" />{search.isFetching ? <Loading label="搜尋中" /> : query.length < 2 ? <p className="py-12 text-center text-sm text-slate-400">可搜尋來源檔案、整合專案與處理批次</p> : !search.data ? null : [...search.data.files, ...search.data.projects, ...search.data.jobs].length === 0 ? <EmptyState icon={<Search />} title="沒有符合結果" description="請調整關鍵字後再試一次。" /> : <div className="mt-4 divide-y divide-slate-100">{search.data.files.map((item: any) => <button key={`f-${item.id}`} className="flex w-full items-center justify-between py-3 text-left" onClick={() => closeAndNavigate('/analysis')}><div><p className="text-sm font-bold text-slate-800">{item.name}</p><p className="text-xs text-slate-400">來源檔案</p></div><ChevronRight size={17} /></button>)}{search.data.projects.map((item: any) => <button key={`p-${item.id}`} className="flex w-full items-center justify-between py-3 text-left" onClick={() => closeAndNavigate('/projects')}><div><p className="text-sm font-bold text-slate-800">{item.name}</p><p className="text-xs text-slate-400">整合專案</p></div><ChevronRight size={17} /></button>)}{search.data.jobs.map((item: any) => <button key={`j-${item.id}`} className="flex w-full items-center justify-between py-3 text-left" onClick={() => closeAndNavigate('/queue')}><div><p className="text-sm font-bold text-slate-800">{item.name}</p><p className="text-xs text-slate-400">處理批次</p></div><ChevronRight size={17} /></button>)}</div>}</Modal>}
  </div>;
}
