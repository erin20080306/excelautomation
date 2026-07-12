import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { FileSpreadsheet, LockKeyhole, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { z } from 'zod';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/api';
import { Notice } from '../components/ui';

export function LoginPage() {
  const { session, login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [pending, setPending] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ email: '', password: '', name: '', workspaceName: '', mfaCode: '' });
  if (session) return <Navigate to="/dashboard" replace />;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setPending(true);
    try {
      z.object({ email: z.string().email('請輸入有效 Email'), password: z.string().min(10, '密碼至少 10 個字元') }).parse(form);
      if (mode === 'login') {
        const result = await login(form.email, form.password, form.mfaCode || undefined);
        setMfaRequired(result.mfaRequired);
      } else {
        z.object({ name: z.string().min(2), workspaceName: z.string().min(2) }).parse(form);
        const result = await register({ ...form, captchaToken: import.meta.env.PROD ? 'turnstile-required' : 'development-bypass' });
        setSuccess(result.message);
      }
    } catch (err) { setError(err instanceof z.ZodError ? err.issues[0]?.message ?? '輸入資料不完整' : errorMessage(err)); }
    finally { setPending(false); }
  };
  return <div className="min-h-screen bg-[#F3F8F6] p-4 sm:p-8"><div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-6xl overflow-hidden rounded-[2rem] bg-white shadow-2xl shadow-emerald-950/10 lg:grid-cols-[1.08fr_.92fr] sm:min-h-[calc(100vh-4rem)]">
    <div className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between"><div className="absolute -right-36 -top-32 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" /><div className="absolute -bottom-40 -left-28 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" /><div className="relative"><div className="flex items-center gap-3"><div className="rounded-xl bg-brand-500 p-2.5"><FileSpreadsheet size={25} /></div><div><p className="text-lg font-black">ExcelMaster</p><p className="text-[10px] font-bold uppercase tracking-[.22em] text-emerald-200">Automation Cloud</p></div></div><div className="mt-24 max-w-xl"><p className="mb-5 text-sm font-bold uppercase tracking-[.2em] text-emerald-300">Data integration, redesigned.</p><h1 className="text-5xl font-black leading-[1.08] tracking-tight">不同格式的 Excel，<br /><span className="text-emerald-300">交給同一套流程。</span></h1><p className="mt-7 max-w-lg text-base leading-8 text-slate-300">自動辨識表頭、分類報表、對應欄位並留下完整處理軌跡。低信心度資料會交給人確認，而不是猜測。</p></div></div><div className="relative grid grid-cols-3 gap-3">{[[Sparkles, '規則優先', 'AI 僅補充'], [Workflow, '批次處理', '背景佇列'], [ShieldCheck, '租戶隔離', '全程稽核']].map(([Icon, title, text]: any) => <div key={title} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur"><Icon className="mb-3 text-emerald-300" size={20} /><p className="text-sm font-bold">{title}</p><p className="mt-1 text-xs text-slate-400">{text}</p></div>)}</div></div>
    <div className="flex items-center justify-center px-6 py-10 sm:px-12"><div className="w-full max-w-md"><div className="mb-8 lg:hidden"><div className="flex items-center gap-3"><div className="rounded-xl bg-brand-600 p-2 text-white"><FileSpreadsheet /></div><span className="text-xl font-black text-ink">ExcelMaster</span></div></div><p className="text-sm font-bold uppercase tracking-[.18em] text-brand-600">{mode === 'login' ? 'Welcome back' : 'Create workspace'}</p><h2 className="mt-3 text-3xl font-black tracking-tight text-ink">{mode === 'login' ? '登入您的工作區' : '建立安全的資料空間'}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{mode === 'login' ? '使用已註冊的企業帳號繼續。' : '第一位使用者會成為工作區擁有者。'}</p>
      <div className="mt-8">{success && <Notice type="success" onClose={() => setSuccess('')}>{success}</Notice>}{error && <Notice type="error" onClose={() => setError('')}>{error}</Notice>}<form className="space-y-4" onSubmit={submit}>{mode === 'register' && <><div><label className="label">顯示名稱</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" required /></div><div><label className="label">工作區名稱</label><input className="input" value={form.workspaceName} onChange={(e) => setForm({ ...form, workspaceName: e.target.value })} required /></div></>}<div><label className="label">電子郵件</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" required /></div><div><label className="label">密碼</label><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={10} required /><p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400"><LockKeyhole size={13} />至少 10 個字元，密碼只會以雜湊儲存。</p></div>{mfaRequired && <div><label className="label">MFA 六位驗證碼</label><input className="input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={form.mfaCode} onChange={(e) => setForm({ ...form, mfaCode: e.target.value.replace(/\D/g, '') })} required /></div>}<button className="btn-primary mt-2 w-full py-3" disabled={pending}>{pending ? '處理中…' : mode === 'login' ? mfaRequired ? '驗證並登入' : '安全登入' : '建立 TRIAL 工作區'}</button></form><div className="mt-7 border-t border-slate-100 pt-6 text-center text-sm text-slate-500">{mode === 'login' ? '還沒有工作區？' : '已經有帳號？'}<button className="ml-1 font-bold text-brand-700 hover:underline" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setMfaRequired(false); }}>{mode === 'login' ? '立即建立' : '返回登入'}</button></div></div>
    </div></div>
  </div></div>;
}
