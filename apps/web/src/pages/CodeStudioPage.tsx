import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Braces, Check, Clipboard, Code2, Download, FileSpreadsheet, Link2, LockKeyhole, Play, ShieldCheck, Sparkles, UploadCloud } from 'lucide-react';
import { api, errorMessage, uploadFiles } from '../lib/api';
import { EmptyState, Loading, Notice, PageHeader } from '../components/ui';

type CodeTarget = 'VBA' | 'APPS_SCRIPT' | 'BOTH';
type GeneratedResult = {
  title: string; summary: string; assumptions: string[]; safetyNotes: string[]; setupSteps: string[];
  vbaCode: string; appsScriptCode: string; tests: string[];
};

function downloadText(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  URL.revokeObjectURL(url);
}

function importedIds(payload: any): string[] {
  if (Array.isArray(payload?.sourceFileIds)) return payload.sourceFileIds;
  return Array.isArray(payload?.job?.items) ? payload.job.items.map((item: any) => item.sourceFileId).filter(Boolean) : [];
}

export function CodeStudioPage() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<CodeTarget>('BOTH');
  const [requirement, setRequirement] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [googleUrl, setGoogleUrl] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copied, setCopied] = useState('');
  const [result, setResult] = useState<GeneratedResult | null>(null);

  const capabilities = useQuery({ queryKey: ['code-capabilities'], queryFn: async () => (await api.get('/code-studio/capabilities')).data });
  const files = useQuery({ queryKey: ['code-source-files'], queryFn: async () => (await api.get('/files', { params: { pageSize: 30 } })).data });
  const history = useQuery({ queryKey: ['code-history'], queryFn: async () => (await api.get('/code-studio/history')).data });
  const readyFiles = useMemo(() => (files.data?.items ?? []).filter((item: any) => ['completed', 'awaiting_review'].includes(item.status)), [files.data]);

  const generate = useMutation({
    mutationFn: async () => (await api.post('/code-studio/generate', { target, requirement, sourceFileIds: selected })).data,
    onSuccess: (data) => {
      setResult(data.item.result); setSuccess('程式碼已產生並通過伺服器安全檢查，請先在檔案副本測試。'); setError('');
      queryClient.invalidateQueries({ queryKey: ['code-capabilities'] }); queryClient.invalidateQueries({ queryKey: ['code-history'] });
    },
    onError: (err) => { setError(errorMessage(err)); setSuccess(''); }
  });

  const importExcel = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(''); setSuccess(''); setProgress(0);
    try {
      const nextIds: string[] = [];
      const chosen = Array.from(list).slice(0, Math.max(0, 5 - selected.length));
      for (let index = 0; index < chosen.length; index += 1) {
        const file = chosen[index]!;
        const form = new FormData(); form.append('files', file); form.append('batchName', `智慧程式碼結構分析 ${file.name}`);
        const response = await uploadFiles(form, (value) => setProgress(Math.round(((index + value / 100) / chosen.length) * 100)));
        if (response.rejected?.length) throw new Error(response.rejected.map((item: any) => `${item.name}：${item.error}`).join('；'));
        nextIds.push(...importedIds(response));
      }
      setSelected((current) => [...new Set([...current, ...nextIds])].slice(0, 5));
      await queryClient.invalidateQueries({ queryKey: ['code-source-files'] });
      setSuccess(`已完成 ${chosen.length} 份 Excel 結構辨識，可用於產碼。`);
    } catch (err) { setError(errorMessage(err)); }
    finally { setProgress(0); if (fileInput.current) fileInput.current.value = ''; }
  };

  const importGoogle = useMutation({
    mutationFn: async () => (await api.post('/files/google-sheets', { sheets: [{ url: googleUrl }], batchName: '智慧程式碼 Google Sheet 結構分析' })).data,
    onSuccess: async (data) => {
      if (data.rejected?.length) { setError(data.rejected.map((item: any) => item.error).join('；')); return; }
      setSelected((current) => [...new Set([...current, ...importedIds(data)])].slice(0, 5));
      setGoogleUrl(''); setError(''); setSuccess('Google Sheet 已匯入並完成表頭／欄位語意分析。');
      await queryClient.invalidateQueries({ queryKey: ['code-source-files'] });
    },
    onError: (err) => setError(errorMessage(err))
  });

  const copy = async (kind: string, code: string) => {
    await navigator.clipboard.writeText(code); setCopied(kind); window.setTimeout(() => setCopied(''), 1_500);
  };

  return <>
    <PageHeader title="智慧 VBA／Apps Script 工作台" description="描述工作需求，或先讓系統分析 Excel／Google Sheet 的表頭與欄位語意，再產生可讀、可下載且不會自動執行的程式碼。" />
    {error && <Notice type="error" onClose={() => setError('')}>{error}</Notice>}
    {success && <Notice type="success" onClose={() => setSuccess('')}>{success}</Notice>}

    <section className="mb-6 grid gap-4 lg:grid-cols-3">
      <div className="card p-5 lg:col-span-2"><div className="flex items-start gap-3"><div className="rounded-xl bg-violet-100 p-2.5 text-violet-700"><Sparkles size={20}/></div><div><h2 className="font-black text-ink">Gemini 智慧產碼</h2><p className="mt-1 text-sm text-slate-500">模型：{capabilities.data?.model ?? '讀取中'} · 本月 {capabilities.data?.used ?? 0}／{capabilities.data?.quota ?? '不限'} 次</p></div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-violet-500" style={{ width: capabilities.data?.quota ? `${Math.min(100, capabilities.data.used / capabilities.data.quota * 100)}%` : '0%' }}/></div></div>
      <div className="card p-5"><div className="flex gap-3"><LockKeyhole className="text-brand-600"/><div><h2 className="font-black text-ink">隱私與執行安全</h2><p className="mt-1 text-xs leading-5 text-slate-500">只傳結構、表頭與欄位語意，不傳原始儲存格；程式碼不會在伺服器或您的檔案中自動執行。</p></div></div></div>
    </section>

    <div className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
      <section className="card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-black text-ink"><Braces className="text-brand-600"/>1. 說明要自動化的工作</h2>
        <div className="mt-5 grid grid-cols-3 gap-2">{([['BOTH','兩者'],['VBA','Excel VBA'],['APPS_SCRIPT','Apps Script']] as const).map(([value, label]) => <button key={value} onClick={() => setTarget(value)} className={`rounded-xl border px-3 py-3 text-sm font-bold ${target === value ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-500'}`}>{label}</button>)}</div>
        <label className="mt-5 block text-sm font-bold text-slate-700">需求描述</label>
        <textarea className="input mt-2 min-h-40 resize-y" value={requirement} onChange={(event) => setRequirement(event.target.value)} maxLength={4000} placeholder="例如：依照『訂單編號』去除重複資料，保留『更新時間』最新的一筆；建立摘要頁與月份銷售圖表。"/>
        <p className="mt-1 text-right text-xs text-slate-400">{requirement.length}／4,000</p>

        <h2 className="mt-7 flex items-center gap-2 text-lg font-black text-ink"><FileSpreadsheet className="text-brand-600"/>2. 選擇已分析的資料結構（選填，最多 5 份）</h2>
        <div className="mt-4 max-h-64 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">{files.isLoading ? <Loading label="載入來源檔案"/> : !readyFiles.length ? <p className="py-6 text-center text-sm text-slate-400">尚無完成分析的檔案，可在下方匯入。</p> : readyFiles.map((item: any) => <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50"><input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id].slice(0, 5) : current.filter((id) => id !== item.id))} disabled={!selected.includes(item.id) && selected.length >= 5}/><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-700">{item.name}</p><p className="text-xs text-slate-400">{item.sheets?.length ?? 0} 個工作表 · {item.reportTypeKey ?? '自動語意分析'}</p></div></label>)}</div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button className="btn-secondary justify-center" onClick={() => fileInput.current?.click()} disabled={progress > 0 || selected.length >= 5}><UploadCloud size={17}/>上傳 Excel 並分析</button>
          <input ref={fileInput} type="file" className="hidden" multiple accept=".xlsx,.xlsm,.xls,.csv,.tsv" onChange={(event) => void importExcel(event.target.files)}/>
          <div className="flex gap-2"><input className="input min-w-0" value={googleUrl} onChange={(event) => setGoogleUrl(event.target.value)} placeholder="公開 Google Sheet 連結"/><button className="btn-secondary !px-3" title="匯入 Google Sheet" disabled={!googleUrl || importGoogle.isPending || selected.length >= 5} onClick={() => importGoogle.mutate()}><Link2 size={17}/></button></div>
        </div>
        {progress > 0 && <div className="mt-3"><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand-500" style={{ width: `${progress}%` }}/></div><p className="mt-1 text-xs text-slate-400">逐檔安全上傳與表頭分析 {progress}%</p></div>}
        <button className="btn-primary mt-6 w-full justify-center !py-3" disabled={requirement.trim().length < 10 || generate.isPending || capabilities.data?.enabled === false} onClick={() => generate.mutate()}><Play size={18}/>{generate.isPending ? '正在分析需求與產生安全程式碼…' : '產生專業程式碼'}</button>
        {capabilities.data?.enabled === false && <p className="mt-3 text-center text-xs font-bold text-amber-700">管理員尚未啟用伺服器端 Gemini 金鑰。</p>}
      </section>

      <section className="space-y-6">
        {!result ? <div className="card"><EmptyState icon={<Code2/>} title="等待產生程式碼" description="產生後會顯示摘要、安裝步驟、測試方式、安全注意事項，以及可複製／下載的 .bas 與 .gs 檔。"/></div> : <div className="card overflow-hidden"><div className="border-b border-slate-100 bg-gradient-to-r from-brand-50 to-white p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-brand-600 p-2 text-white"><Check size={19}/></div><div><h2 className="font-black text-ink">{result.title}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{result.summary}</p></div></div></div><div className="space-y-6 p-5">
          <InfoList title="安裝／使用步驟" items={result.setupSteps}/><InfoList title="前提與假設" items={result.assumptions}/><InfoList title="安全注意事項" items={result.safetyNotes} icon={<ShieldCheck size={17} className="text-emerald-600"/>}/>
          {result.vbaCode && <CodeBlock title="Excel VBA (.bas)" code={result.vbaCode} copied={copied === 'vba'} onCopy={() => void copy('vba', result.vbaCode)} onDownload={() => downloadText('ExcelMaster_Automation.bas', result.vbaCode)}/>}
          {result.appsScriptCode && <CodeBlock title="Google Apps Script (.gs)" code={result.appsScriptCode} copied={copied === 'gas'} onCopy={() => void copy('gas', result.appsScriptCode)} onDownload={() => downloadText('ExcelMaster_Automation.gs', result.appsScriptCode)}/>}
          <InfoList title="驗收測試" items={result.tests}/>
        </div></div>}
        <div className="card p-5"><h2 className="font-black text-ink">最近產碼紀錄</h2><div className="mt-3 divide-y divide-slate-100">{history.isLoading ? <Loading/> : !history.data?.items.length ? <p className="py-6 text-center text-sm text-slate-400">尚無紀錄</p> : history.data.items.slice(0, 6).map((item: any) => <button key={item.id} className="w-full py-3 text-left" onClick={() => item.result && setResult(item.result)}><div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-bold text-slate-700">{item.result?.title ?? item.requirement}</p><span className="shrink-0 text-[10px] font-bold text-slate-400">{item.target}</span></div><p className="mt-1 text-xs text-slate-400">{new Date(item.createdAt).toLocaleString('zh-TW')} · {item.status}</p></button>)}</div></div>
      </section>
    </div>
  </>;
}

function InfoList({ title, items, icon }: { title: string; items: string[]; icon?: React.ReactNode }) {
  if (!items?.length) return null;
  return <div><h3 className="flex items-center gap-2 text-sm font-black text-slate-700">{icon}{title}</h3><ol className="mt-2 space-y-2 text-sm leading-6 text-slate-600">{items.map((item, index) => <li key={`${index}-${item}`} className="flex gap-2"><span className="font-bold text-brand-600">{index + 1}.</span><span>{item}</span></li>)}</ol></div>;
}

function CodeBlock({ title, code, copied, onCopy, onDownload }: { title: string; code: string; copied: boolean; onCopy: () => void; onDownload: () => void }) {
  return <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950"><div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5"><span className="text-xs font-black text-slate-200">{title}</span><div className="flex gap-2"><button className="flex items-center gap-1 text-xs font-bold text-slate-300 hover:text-white" onClick={onCopy}>{copied ? <Check size={14}/> : <Clipboard size={14}/>} {copied ? '已複製' : '複製'}</button><button className="flex items-center gap-1 text-xs font-bold text-slate-300 hover:text-white" onClick={onDownload}><Download size={14}/>下載</button></div></div><pre className="max-h-[32rem] overflow-auto p-4 text-xs leading-6 text-emerald-200"><code>{code}</code></pre></div>;
}
