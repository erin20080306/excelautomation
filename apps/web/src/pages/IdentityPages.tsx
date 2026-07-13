import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { Notice } from '../components/ui';

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-[#F3F8F6] p-4"><div className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-xl">{children}</div></div>;
}

export function VerifyEmailPage() {
  const [params] = useSearchParams(); const [status, setStatus] = useState<'pending'|'ok'|'error'>('pending'); const [message, setMessage] = useState('正在驗證 Email…');
  useEffect(() => { const token = params.get('token'); if (!token) { setStatus('error'); setMessage('缺少驗證 token'); return; } api.post('/auth/verify-email', { token }).then(() => { setStatus('ok'); setMessage('Email 驗證完成，現在可以登入。'); }).catch((error) => { setStatus('error'); setMessage(errorMessage(error)); }); }, [params]);
  return <Shell><h1 className="text-2xl font-black text-ink">Email 驗證</h1><div className="mt-5"><Notice type={status === 'error' ? 'error' : 'success'}>{message}</Notice></div>{status !== 'pending' && <Link className="btn-primary mt-5 w-full" to="/login">前往登入</Link>}</Shell>;
}

export function ResetPasswordPage() {
  const [params] = useSearchParams(); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setError(''); if (password.length < 12) { setError('新密碼至少 12 個字元'); return; } if (password !== confirm) { setError('兩次密碼不一致'); return; } try { await api.post('/auth/reset-password', { token: params.get('token'), password }); setMessage('密碼已更新，請重新登入。'); } catch (err) { setError(errorMessage(err)); } };
  return <Shell><h1 className="text-2xl font-black text-ink">設定新密碼</h1>{message && <div className="mt-5"><Notice type="success">{message}</Notice><Link className="btn-primary mt-4 w-full" to="/login">返回登入</Link></div>}{!message && <form className="mt-6 space-y-4" onSubmit={submit}>{error && <Notice type="error">{error}</Notice>}<div><label className="label">新密碼</label><input className="input" type="password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required /></div><div><label className="label">確認新密碼</label><input className="input" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></div><button className="btn-primary w-full">更新密碼</button></form>}</Shell>;
}
