import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, FileCheck2, FileSpreadsheet, FolderOpen, RefreshCw, UploadCloud } from 'lucide-react';
import { api, errorMessage, uploadFiles } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Confidence, EmptyState, Loading, Notice, PageHeader, StatusBadge } from '../components/ui';

const TRIAL_MAX_FILES = 5;
const TRIAL_MAX_TOTAL_BYTES = 3 * 1024 * 1024;

export function AnalysisPage() {
  const { session } = useAuth();
  const hasUnlimitedAccess = session?.workspace.role === 'OWNER' || session?.workspace.role === 'ADMIN';
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File[]>([]);
  const [batchName, setBatchName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const files = useQuery({ queryKey: ['files'], queryFn: async () => (await api.get('/files')).data, refetchInterval: 15_000 });
  const projects = useQuery({ queryKey: ['projects'], queryFn: async () => (await api.get('/projects', { params: { pageSize: 100 } })).data });
  const addFiles = (list: FileList | null) => { if (!list) return; setSelected((current) => [...current, ...Array.from(list)].filter((file, index, all) => all.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size) === index)); };
  const upload = async () => {
    if (!selected.length) return; setNotice(null); setProgress(0);
    if (!hasUnlimitedAccess && selected.length > TRIAL_MAX_FILES) { setNotice({ type: 'error', text: `Vercel 試用版單批最多 ${TRIAL_MAX_FILES} 份檔案；完整版請使用下載包。` }); setProgress(null); return; }
    const totalBytes = selected.reduce((sum, file) => sum + file.size, 0);
    if (!hasUnlimitedAccess && totalBytes > TRIAL_MAX_TOTAL_BYTES) { setNotice({ type: 'error', text: 'Vercel 試用版單批總上傳量上限為 3 MB；完整版請使用下載包。' }); setProgress(null); return; }
    const form = new FormData(); selected.forEach((file) => form.append('files', file, (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name));
    if (batchName.trim()) form.append('batchName', batchName.trim()); if (projectId) form.append('projectId', projectId);
    try { const result = await uploadFiles(form, setProgress); const processingFailed = result.processingErrors?.length ?? 0; setNotice({ type: processingFailed ? 'error' : 'success', text: processingFailed ? `已接收 ${result.accepted} 份，但有 ${processingFailed} 份分析失敗；請查看處理紀錄。` : `即時分析完成：接受 ${result.accepted} 份、略過重複 ${result.duplicates} 份${result.rejected.length ? `、拒絕 ${result.rejected.length} 份` : ''}。` }); setSelected([]); setBatchName(''); await queryClient.invalidateQueries({ queryKey: ['files'] }); }
    catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); }
    finally { setProgress(null); }
  };
  return <><PageHeader title="智慧分析" description={hasUnlimitedAccess ? '管理員模式不套用試用版配額；單次請求仍受 Vercel 平台大小與執行時間上限約束。' : 'Vercel 試用版會即時解析活頁簿；單批最多 5 份、總量 3 MB。大量批次與背景處理請使用下載包。'} />{notice && <Notice type={notice.type} onClose={() => setNotice(null)}>{notice.text}</Notice>}
    <section className="card overflow-hidden"><div className="grid lg:grid-cols-[1.2fr_.8fr]"><div className="border-b border-slate-100 p-6 lg:border-b-0 lg:border-r"><button type="button" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }} onClick={() => fileRef.current?.click()} className="flex min-h-52 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/50 px-6 text-center transition hover:border-brand-400 hover:bg-brand-50"><div className="rounded-2xl bg-white p-4 text-brand-600 shadow-sm"><UploadCloud size={28} /></div><p className="mt-4 font-bold text-ink">拖曳 Excel、CSV 或 ZIP 到這裡</p><p className="mt-2 text-sm text-slate-500">支援多檔與最多 5,000 份試算表的安全 ZIP 批次</p></button><input ref={fileRef} type="file" hidden multiple accept=".xlsx,.xlsm,.xls,.csv,.tsv,.zip" onChange={(e) => addFiles(e.target.files)} /><input ref={folderRef} type="file" hidden multiple {...({ webkitdirectory: '', directory: '' } as any)} onChange={(e) => addFiles(e.target.files)} /><div className="mt-3 flex flex-wrap gap-2"><button className="btn-secondary" onClick={() => fileRef.current?.click()}><FileSpreadsheet size={16} />選擇多檔</button><button className="btn-secondary" onClick={() => folderRef.current?.click()}><FolderOpen size={16} />選擇資料夾</button></div></div>
      <div className="p-6"><h2 className="font-bold text-ink">批次設定</h2><div className="mt-4 space-y-4"><div><label className="label">批次名稱</label><input className="input" value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="留白會自動使用日期時間" /></div><div><label className="label">套用整合專案</label><select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">僅分析，稍後再選</option>{projects.data?.items.map((project: any) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div><div className="rounded-xl bg-slate-50 p-3"><div className="flex items-center justify-between text-sm"><span className="font-semibold text-slate-600">已選檔案</span><span className="font-black text-ink">{selected.length} / {hasUnlimitedAccess ? '不限試用配額' : TRIAL_MAX_FILES}</span></div>{selected.length > 0 && <div className="mt-2 max-h-24 overflow-y-auto text-xs text-slate-500">{selected.slice(0, 8).map((file) => <p className="truncate py-0.5" key={`${file.name}-${file.size}`}>{file.name}</p>)}</div>}<p className="mt-2 text-[11px] text-slate-400">合計 {(selected.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(2)} MB{hasUnlimitedAccess ? '（受 Vercel 單次請求上限約束）' : ' / 3 MB'}</p></div>{progress != null && <div><div className="mb-1 flex justify-between text-xs text-slate-500"><span>{progress < 100 ? '上傳中' : 'Vercel 即時分析中'}</span><span>{progress}%</span></div><div className="h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${progress}%` }} /></div></div>}<button className="btn-primary w-full" onClick={upload} disabled={!selected.length || progress != null}><FileCheck2 size={17} />{hasUnlimitedAccess ? '立即分析（管理員）' : '立即分析試用'}</button></div></div></div></section>
    <section className="card mt-6 overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-bold text-ink">分析結果</h2><p className="mt-1 text-xs text-slate-400">分類與欄位信心度低於門檻時會送往待確認中心</p></div><button className="btn-secondary !px-3 !py-2" onClick={() => files.refetch()}><RefreshCw size={15} />更新</button></div>{files.isLoading ? <Loading /> : !files.data?.items.length ? <EmptyState icon={<Archive />} title="尚無來源檔案" description="上傳第一批試算表後，結構分析結果會顯示在這裡。" /> : <div className="table-wrap"><table className="table"><thead><tr><th>來源檔案</th><th>系統分類</th><th>信心度</th><th>工作表 / 資料量</th><th>狀態</th><th>分析警示</th></tr></thead><tbody>{files.data.items.map((file: any) => { const analysis = file.analyses[0]?.result; return <tr key={file.id}><td><p className="max-w-xs truncate font-bold text-slate-800">{file.name}</p><p className="mt-1 text-xs text-slate-400">{Number(file.size).toLocaleString()} bytes · {new Date(file.createdAt).toLocaleDateString('zh-TW')}</p></td><td>{file.reportTypeKey ?? '尚未辨識'}</td><td><Confidence value={file.confidence} /></td><td>{file.sheets.length} 張 · {file.sheets.reduce((sum: number, sheet: any) => sum + sheet.maxRow, 0).toLocaleString()} 列</td><td><StatusBadge status={file.status} /></td><td>{analysis?.warnings?.length ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle size={14} />{analysis.warnings.length} 項</span> : <span className="text-xs text-slate-400">無</span>}</td></tr>; })}</tbody></table></div>}</section>
  </>;
}
