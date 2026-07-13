import { useCallback, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { FileSpreadsheet, LockKeyhole, ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { api, errorMessage } from '../lib/api';
import { Notice } from '../components/ui';
import { Turnstile } from '../components/Turnstile';

type Mode = 'login' | 'register' | 'forgot';

export function LoginPage() {
  const { session, login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login'); const [pending, setPending] = useState(false); const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [captchaToken, setCaptchaToken] = useState('');
  const [form, setForm] = useState({ email: '', password: '', name: '', workspaceName: '', mfaCode: '' });
  const capabilities = useQuery({ queryKey: ['auth-capabilities'], queryFn: async () => (await api.get('/auth/capabilities')).data });
  const receiveCaptcha = useCallback((token: string) => setCaptchaToken(token), []);
  if (session) return <Navigate to="/dashboard" replace />;
  const switchMode = (next: Mode) => { setMode(next); setError(''); setSuccess(''); setMfaRequired(false); setCaptchaToken(''); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setSuccess(''); setPending(true);
    try {
      z.string().email('請輸入有效 Email').parse(form.email);
      if (mode === 'login') {
        z.string().min(10, '密碼至少 10 個字元').parse(form.password);
        const result = await login(form.email, form.password, form.mfaCode || undefined); setMfaRequired(result.mfaRequired);
      } else if (mode === 'register') {
        if (!captchaToken) throw new Error('請完成人機驗證');
        const result = await register({ email: form.email, password: form.password, name: form.name, workspaceName: form.workspaceName, captchaToken }); setSuccess(result.message);
      } else {
        if (!captchaToken) throw new Error('請完成人機驗證');
        const { data } = await api.post('/auth/forgot-password', { email: form.email, captchaToken }); setSuccess(data.message);
      }
    } catch (err) { setError(err instanceof z.ZodError ? err.issues[0]?.message ?? '輸入資料不完整' : errorMessage(err)); }
    finally { setPending(false); }
  };
  return <div className="min-h-screen bg-[#F3F8F6] p-4 sm:p-8"><div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-5xl overflow-hidden rounded-[2rem] bg-white shadow-2xl shadow-emerald-950/10 lg:grid-cols-[.9fr_1.1fr]">
    <aside className="hidden bg-ink p-10 text-white lg:flex lg:flex-col lg:justify-between"><div><div className="flex items-center gap-3"><div className="rounded-xl bg-brand-500 p-2.5"><FileSpreadsheet /></div><p className="text-lg font-black">ExcelMaster</p></div><h1 className="mt-24 text-4xl font-black leading-tight">Excel 自動化，<br/><span className="text-emerald-300">權限與方案分開管理。</span></h1><p className="mt-6 leading-7 text-slate-300">公開註冊固定為 TRIAL；只有付款 Webhook 或 SUPERADMIN 能變更產品權益。</p></div><div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300"><ShieldCheck className="mb-3 text-emerald-300"/>Email 驗證、Turnstile、登入鎖定與 MFA 共同保護帳號。</div></aside>
    <main className="flex items-center justify-center px-6 py-10 sm:px-12"><div className="w-full max-w-md"><p className="text-sm font-bold uppercase tracking-[.18em] text-brand-600">{mode === 'login' ? 'Secure sign in' : mode === 'register' ? 'Trial registration' : 'Account recovery'}</p><h2 className="mt-3 text-3xl font-black text-ink">{mode === 'login' ? '登入工作區' : mode === 'register' ? '建立 TRIAL 工作區' : '重設密碼'}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{mode === 'register' ? '工作區 OWNER 是管理權，不代表付費或無限方案。' : mode === 'forgot' ? '若帳號存在，系統會寄出 30 分鐘有效的重設連結。' : '使用已驗證的企業帳號繼續。'}</p>
      <div className="mt-8">{success && <Notice type="success" onClose={() => setSuccess('')}>{success}</Notice>}{error && <Notice type="error" onClose={() => setError('')}>{error}</Notice>}<form className="space-y-4" onSubmit={submit}>{mode === 'register' && <><div><label className="label">顯示名稱</label><input className="input" minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></div><div><label className="label">工作區名稱</label><input className="input" minLength={2} value={form.workspaceName} onChange={(event) => setForm({ ...form, workspaceName: event.target.value })} required /></div></>}<div><label className="label">電子郵件</label><input className="input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></div>{mode !== 'forgot' && <div><label className="label">密碼</label><input className="input" type="password" minLength={10} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /><p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400"><LockKeyhole size={13}/>至少 10 個字元，伺服器只保存 bcrypt 雜湊。</p></div>}{mfaRequired && <div><label className="label">Authenticator 六位驗證碼</label><input className="input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={form.mfaCode} onChange={(event) => setForm({ ...form, mfaCode: event.target.value.replace(/\D/g, '') })} required /></div>}{mode !== 'login' && <Turnstile onToken={receiveCaptcha}/>}<button className="btn-primary w-full py-3" disabled={pending || (mode === 'register' && capabilities.data && !capabilities.data.registrationEnabled)}>{pending ? '處理中…' : mode === 'login' ? mfaRequired ? '驗證並登入' : '安全登入' : mode === 'register' ? '寄送驗證信' : '寄送重設信'}</button></form>
        <div className="mt-6 flex flex-wrap justify-center gap-3 text-sm"><button className="font-bold text-brand-700" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? '建立 TRIAL 帳號' : '返回登入'}</button>{mode === 'login' && <button className="text-slate-500" onClick={() => switchMode('forgot')}>忘記密碼</button>}</div><div className="mt-8 flex justify-center gap-4 border-t border-slate-100 pt-5 text-xs"><Link className="font-semibold text-slate-500 hover:text-brand-700" to="/privacy">隱私權政策</Link><Link className="font-semibold text-slate-500 hover:text-brand-700" to="/security">安全政策</Link></div></div>
    </div></main></div></div>;
}
