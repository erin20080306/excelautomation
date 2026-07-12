import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UserSession } from '@excelmaster/shared';
import { api } from './api';

type AuthValue = {
  session: UserSession | null; loading: boolean;
  login(email: string, password: string, mfaCode?: string): Promise<{ mfaRequired: boolean }>;
  register(input: { email: string; password: string; name: string; workspaceName: string; captchaToken: string }): Promise<{ verificationRequired: boolean; message: string }>;
  logout(): void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<UserSession | null>(() => {
    const stored = localStorage.getItem('excelmaster.session');
    try { return stored ? JSON.parse(stored) : null; } catch { return null; }
  });
  const [loading, setLoading] = useState(Boolean(localStorage.getItem('excelmaster.token')));

  const persist = (next: UserSession | null) => {
    setSession(next);
    if (next) { localStorage.setItem('excelmaster.token', next.token); localStorage.setItem('excelmaster.session', JSON.stringify(next)); }
    else { localStorage.removeItem('excelmaster.token'); localStorage.removeItem('excelmaster.session'); }
  };

  useEffect(() => {
    const token = localStorage.getItem('excelmaster.token');
    if (!token) { setLoading(false); return; }
    api.get('/auth/me').then(({ data }) => persist({ token, ...data })).catch(() => persist(null)).finally(() => setLoading(false));
    const unauthorized = () => { persist(null); setLoading(false); };
    window.addEventListener('excelmaster:unauthorized', unauthorized);
    return () => window.removeEventListener('excelmaster:unauthorized', unauthorized);
  }, []);

  const value = useMemo<AuthValue>(() => ({
    session, loading,
    async login(email, password, mfaCode) {
      const { data } = await api.post<UserSession | { mfaRequired: true }>('/auth/login', { email, password, mfaCode });
      if ('mfaRequired' in data) return { mfaRequired: true };
      persist(data); return { mfaRequired: false };
    },
    async register(input) { const { data } = await api.post<{ verificationRequired: boolean; message: string }>('/auth/register', input); return data; },
    logout() { persist(null); }
  }), [session, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider 尚未初始化');
  return value;
}
