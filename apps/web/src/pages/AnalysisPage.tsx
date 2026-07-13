import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Archive, CheckCircle2, Download, FileCheck2, FileSpreadsheet, FolderOpen, Link2,
  RefreshCw, Sparkles, UploadCloud
} from 'lucide-react';
import { api, errorMessage, uploadFiles } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Confidence, EmptyState, Loading, Notice, PageHeader, StatusBadge } from '../components/ui';

type SourceMode = 'files' | 'google';

function defaultOutputName(): string {
  const now = new Date();
  return `整合結果_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

function parseGoogleSheets(value: string): Array<{ url: string; name?: string }> {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split('|').map((part) => part.trim());
    return parts.length > 1 ? { name: parts[0], url: parts.slice(1).join('|') } : { url: line };
  });
}

export function AnalysisPage() {
  const { session } = useAuth();
  const hasUnlimitedAccess = session?.user.platformRole === 'SUPERADMIN';
  const fileQuota = session?.workspace.fileQuota ?? 5;
  const totalMbQuota = session?.workspace.totalMbQuota ?? 3;
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>('files');
  const [selected, setSelected] = useState<File[]>([]);
  const [googleLinks, setGoogleLinks] = useState('');
  const [batchName, setBatchName] = useState('');
  const [outputName, setOutputName] = useState(defaultOutputName);
  const [projectId, setProjectId] = useState('');
  const [keepSourceSheets, setKeepSourceSheets] = useState(false);
  const [includeGasReport, setIncludeGasReport] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const files = useQuery({ queryKey: ['files'], queryFn: async () => (await api.get('/files')).data, refetchInterval: 15_000 });
  const projects = useQuery({ queryKey: ['projects'], queryFn: async () => (await api.get('/projects', { params: { pageSize: 100 } })).data });
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setSelected((current) => [...current, ...Array.from(list)].filter((file, index, all) => all.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size) === index));
  };

  const createOutput = async (job: any) => {
    if (!job?.id) throw new Error('沒有可輸出的分析批次');
    if (!['completed', 'awaiting_review'].includes(job.status)) {
      setNotice({ type: 'success', text: '檔案已送入處理進度；完成後可在「結果與下載」建立整合檔。' });
      return;
    }
    setProgress(100);
    const { data: exportJob } = await api.post('/exports', {
      processingJobId: job.id,
      name: outputName.trim() || defaultOutputName(),
      config: {
        separateFiles: false,
        separateSourceSheets: keepSourceSheets,
        mergeAll: true,
        mergeByType: false,
        includeAllDetails: true,
        includeProfessionalReport: true,
        includeGasReport,
        includeOverview: true,
        includeStatistics: true,
        preserveRaw: false,
        includeExceptions: true,
        includeMappings: true,
        includeAudit: true
      }
    });
    await queryClient.invalidateQueries({ queryKey: ['exports'] });
    const excelFile = exportJob.files?.find((file: any) => String(file.name).toLowerCase().endsWith('.xlsx'));
    if (excelFile) {
      const { data } = await api.post(`/exports/${excelFile.id}/sign`);
      window.location.assign(data.url);
    }
    setNotice({ type: 'success', text: includeGasReport ? '整合完成：已建立 Excel 新檔、專業分析報告與可在 Google Sheets 執行的 GAS 報告工具。' : '整合完成：已建立 Excel 新檔與專業分析報告。' });
  };

  const run = async () => {
    const googleSheets = parseGoogleSheets(googleLinks);
    const sourceCount = sourceMode === 'files' ? selected.length : googleSheets.length;
    if (!sourceCount) return;
    setNotice(null);
    setProgress(0);
    if (!hasUnlimitedAccess && sourceCount > fileQuota) {
      setNotice({ type: 'error', text: `目前方案單批最多 ${fileQuota} 份試算表。` });
      setProgress(null);
      return;
    }
    try {
      let result: any;
      if (sourceMode === 'files') {
        const totalBytes = selected.reduce((sum, file) => sum + file.size, 0);
        if (!hasUnlimitedAccess && totalBytes > totalMbQuota * 1024 * 1024) throw new Error(`目前方案單批總上傳量上限為 ${totalMbQuota} MB。`);
        const form = new FormData();
        selected.forEach((file) => form.append('files', file, (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name));
        if (batchName.trim()) form.append('batchName', batchName.trim());
        if (projectId) form.append('projectId', projectId);
        result = await uploadFiles(form, setProgress);
      } else {
        result = (await api.post('/files/google-sheets', { sheets: googleSheets, batchName: batchName.trim() || undefined, projectId: projectId || undefined })).data;
        setProgress(90);
      }
      if (!result.job) {
        const details = result.rejected?.map((item: any) => `${item.name}：${item.error}`).join('；');
        throw new Error(details || '沒有可處理的試算表');
      }
      if (result.processingErrors?.length) throw new Error(`有 ${result.processingErrors.length} 份分析失敗，請查看處理進度。`);
      await createOutput(result.job);
      setSelected([]);
      setGoogleLinks('');
      setBatchName('');
      setOutputName(defaultOutputName());
      await queryClient.invalidateQueries({ queryKey: ['files'] });
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    } finally {
      setProgress(null);
    }
  };

  const sourceCount = sourceMode === 'files' ? selected.length : parseGoogleSheets(googleLinks).length;
  return <>
    <PageHeader title="整合工作台" description="一次放入多份 Excel、CSV 或 Google Sheets；系統自動找表頭、理解欄位、合併資料並建立新檔。無需先做固定模板。" />
    {notice && <Notice type={notice.type} onClose={() => setNotice(null)}>{notice.text}</Notice>}

    <div className="mb-5 grid gap-3 sm:grid-cols-3">
      {[['1', '加入資料', '多份 Excel 或 Google Sheets'], ['2', '智慧辨識', '自動表頭、欄位與型態'], ['3', '取得新檔', '整合總表、分析與 GAS']].map(([step, title, text]) => <div key={step} className="card flex items-center gap-3 p-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-black text-white">{step}</span><div><p className="text-sm font-bold text-ink">{title}</p><p className="mt-0.5 text-xs text-slate-400">{text}</p></div></div>)}
    </div>

    <section className="card overflow-hidden">
      <div className="border-b border-slate-100 p-5">
        <h2 className="font-bold text-ink">1. 選擇資料來源</h2>
        <div className="mt-4 inline-flex rounded-xl bg-slate-100 p-1">
          <button className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold ${sourceMode === 'files' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`} onClick={() => setSourceMode('files')}><FileSpreadsheet size={16} />Excel／CSV</button>
          <button className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold ${sourceMode === 'google' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`} onClick={() => setSourceMode('google')}><Link2 size={16} />Google Sheets</button>
        </div>
      </div>
      <div className="grid lg:grid-cols-[1.2fr_.8fr]">
        <div className="border-b border-slate-100 p-6 lg:border-b-0 lg:border-r">
          {sourceMode === 'files' ? <>
            <button type="button" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }} onClick={() => fileRef.current?.click()} className="flex min-h-52 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/50 px-6 text-center transition hover:border-brand-400 hover:bg-brand-50"><div className="rounded-2xl bg-white p-4 text-brand-600 shadow-sm"><UploadCloud size={28} /></div><p className="mt-4 font-bold text-ink">拖曳多份 Excel、CSV 或 ZIP</p><p className="mt-2 text-sm text-slate-500">可混合不同檔名、工作表名稱與表頭位置</p></button>
            <input ref={fileRef} type="file" hidden multiple accept=".xlsx,.xlsm,.xls,.csv,.tsv,.zip" onChange={(event) => addFiles(event.target.files)} />
            <input ref={folderRef} type="file" hidden multiple {...({ webkitdirectory: '', directory: '' } as any)} onChange={(event) => addFiles(event.target.files)} />
            <div className="mt-3 flex flex-wrap gap-2"><button className="btn-secondary" onClick={() => fileRef.current?.click()}><FileSpreadsheet size={16} />選擇多檔</button><button className="btn-secondary" onClick={() => folderRef.current?.click()}><FolderOpen size={16} />選擇資料夾</button></div>
          </> : <div>
            <label className="label">Google Sheets 分享連結（每行一份）</label>
            <textarea className="input min-h-52 font-mono text-xs leading-6" value={googleLinks} onChange={(event) => setGoogleLinks(event.target.value)} placeholder={'https://docs.google.com/spreadsheets/d/...\n月報 | https://docs.google.com/spreadsheets/d/...'} />
            <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800"><p className="font-bold">可直接整合公開分享連結</p><p className="mt-1">Google Sheet 請設為「知道連結的任何人可檢視」。私人雲端檔案仍需由管理員配置 Google OAuth。</p></div>
          </div>}
        </div>

        <div className="p-6">
          <h2 className="font-bold text-ink">2. 新檔設定</h2>
          <div className="mt-4 space-y-4">
            <div><label className="label">新檔名稱</label><input className="input" value={outputName} onChange={(event) => setOutputName(event.target.value)} /></div>
            <div><label className="label">批次名稱（選填）</label><input className="input" value={batchName} onChange={(event) => setBatchName(event.target.value)} placeholder="例如：7 月銷售整合" /></div>
            <div><label className="label">自動化流程（選填）</label><select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">智慧合併，不套固定模板</option>{projects.data?.items.map((project: any) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-600"><input className="mt-1" type="checkbox" checked={keepSourceSheets} onChange={(event) => setKeepSourceSheets(event.target.checked)} /><span><span className="block font-bold text-slate-700">另外保留每張來源工作表</span><span className="mt-1 block text-xs text-slate-400">預設只產生乾淨的整合總表與分析頁，避免新檔過於雜亂。</span></span></label>
            <label className="flex items-start gap-3 rounded-xl border-2 border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><input className="mt-1 accent-blue-600" type="checkbox" checked={includeGasReport} onChange={(event) => setIncludeGasReport(event.target.checked)} /><span><span className="block font-black">同時產生專業 GAS 圖文報告（預設開啟）</span><span className="mt-1 block text-xs leading-5 text-blue-700">輸出可下載的 <strong>.gs</strong> 檔；可一鍵建立新 Google Sheet、專業分析儀表板、統計圖表、圖片欄位預覽，並可加入封面圖或 Logo。</span></span></label>
            <div className="rounded-xl bg-slate-50 p-3"><div className="flex items-center justify-between text-sm"><span className="font-semibold text-slate-600">已加入</span><span className="font-black text-ink">{sourceCount} / {hasUnlimitedAccess ? '無產品配額' : fileQuota}</span></div>{sourceMode === 'files' && selected.length > 0 && <div className="mt-2 max-h-20 overflow-y-auto text-xs text-slate-500">{selected.slice(0, 8).map((file) => <p className="truncate py-0.5" key={`${file.name}-${file.size}`}>{file.name}</p>)}</div>}</div>
            {progress != null && <div><div className="mb-1 flex justify-between text-xs text-slate-500"><span>{progress < 90 ? '匯入中' : '正在建立新檔與報告'}</span><span>{progress}%</span></div><div className="h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} /></div></div>}
            <button className="btn-primary w-full" onClick={run} disabled={!sourceCount || progress != null}><Sparkles size={17} />開始智慧整合並建立新檔</button>
            <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-slate-500"><span className="rounded-lg bg-emerald-50 p-2"><CheckCircle2 className="mx-auto mb-1 text-emerald-600" size={15} />整合 Excel</span><span className="rounded-lg bg-emerald-50 p-2"><Download className="mx-auto mb-1 text-emerald-600" size={15} />專業分析</span><span className={`rounded-lg p-2 ${includeGasReport ? 'bg-blue-50 font-bold text-blue-700' : 'bg-slate-50 text-slate-300'}`}><FileCheck2 className="mx-auto mb-1" size={15} />GAS 報告</span></div>
          </div>
        </div>
      </div>
    </section>

    <section className="card mt-6 overflow-hidden border-blue-100">
      <div className="border-b border-blue-100 bg-blue-50 px-5 py-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-blue-600 p-2.5 text-white"><FileCheck2 size={20} /></div><div><h2 className="font-black text-blue-950">GAS 報告功能</h2><p className="mt-1 text-xs text-blue-700">不是只有說明文件；每次整合都會產生可實際執行的 Google Apps Script。</p></div></div></div>
      <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-100 p-4"><p className="text-xs font-black text-blue-600">01 · 建立新檔</p><p className="mt-2 text-sm font-bold text-ink">自動新增 Google Sheet</p><p className="mt-1 text-xs leading-5 text-slate-500">以日期時間命名新檔，不會覆蓋原始資料。</p></div>
        <div className="rounded-xl border border-slate-100 p-4"><p className="text-xs font-black text-blue-600">02 · 智慧合併</p><p className="mt-2 text-sm font-bold text-ink">再次自動辨識表頭</p><p className="mt-1 text-xs leading-5 text-slate-500">統一常見欄位語意並排除總計、小計與空白列。</p></div>
        <div className="rounded-xl border border-slate-100 p-4"><p className="text-xs font-black text-blue-600">03 · 專業報告</p><p className="mt-2 text-sm font-bold text-ink">建立 GAS_專業分析頁</p><p className="mt-1 text-xs leading-5 text-slate-500">顯示工作表、表頭列、欄位數、資料筆數與分析摘要。</p></div>
        <div className="rounded-xl border border-slate-100 p-4"><p className="text-xs font-black text-blue-600">04 · 圖片功能</p><p className="mt-2 text-sm font-bold text-ink">圖片預覽、圖表與 Logo</p><p className="mt-1 text-xs leading-5 text-slate-500">辨識圖片網址欄位並顯示縮圖；報告可插入封面圖或公司 Logo。</p></div>
      </div>
      <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">完成後前往「結果與下載」→ 點選「下載 GAS」→ 在 Google Sheets 的「擴充功能 → Apps Script」貼上並執行。</div>
    </section>

    <section className="card mt-6 overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-bold text-ink">最近辨識結果</h2><p className="mt-1 text-xs text-slate-400">顯示系統實際找到的表頭列與欄位，不要求先建立模板</p></div><button className="btn-secondary !px-3 !py-2" onClick={() => files.refetch()}><RefreshCw size={15} />更新</button></div>{files.isLoading ? <Loading /> : !files.data?.items.length ? <EmptyState icon={<Archive />} title="尚無來源檔案" description="加入第一批 Excel 或 Google Sheets 後，辨識結果會顯示在這裡。" /> : <div className="table-wrap"><table className="table"><thead><tr><th>來源檔案</th><th>自動辨識表頭</th><th>欄位</th><th>信心度</th><th>資料量</th><th>狀態</th><th>警示</th></tr></thead><tbody>{files.data.items.map((file: any) => { const analysis = file.analyses[0]?.result; const headerSummary = file.sheets.map((sheet: any) => `${sheet.name}：第 ${sheet.metadata?.headerRow ?? 1} 列`).join('、'); const fieldCount = file.sheets.reduce((sum: number, sheet: any) => sum + (sheet._count?.fields ?? 0), 0); return <tr key={file.id}><td><p className="max-w-xs truncate font-bold text-slate-800">{file.name}</p><p className="mt-1 text-xs text-slate-400">{file.originalPath?.startsWith('https://docs.google.com') ? 'Google Sheets' : 'Excel／試算表'} · {new Date(file.createdAt).toLocaleDateString('zh-TW')}</p></td><td><p className="max-w-xs text-xs leading-5 text-slate-600">{headerSummary || '分析中'}</p></td><td>{fieldCount} 欄</td><td><Confidence value={file.confidence} /></td><td>{file.sheets.reduce((sum: number, sheet: any) => sum + Number(sheet.metadata?.dataRowCount ?? sheet.maxRow), 0).toLocaleString()} 筆</td><td><StatusBadge status={file.status} /></td><td>{analysis?.warnings?.length ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle size={14} />{analysis.warnings.length} 項</span> : <span className="text-xs text-slate-400">無</span>}</td></tr>; })}</tbody></table></div>}</section>
  </>;
}
