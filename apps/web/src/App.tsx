import { Navigate, Route, Routes } from 'react-router-dom';
import { FileSpreadsheet } from 'lucide-react';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { QueuePage } from './pages/QueuePage';
import { ReviewsPage } from './pages/ReviewsPage';
import { ReportTypesPage, RulesPage, SchemasPage, SourcesPage, TemplatesPage } from './pages/CatalogPages';
import { AuditPage, ExportsPage, SettingsPage } from './pages/OperationsPages';
import { AdminPage, BillingPage } from './pages/AdminPages';

function ProtectedLayout() {
  const { session } = useAuth();
  return session ? <Layout /> : <Navigate to="/login" replace />;
}

export function App() {
  const { loading } = useAuth();
  if (loading) return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F3F8F6] text-brand-700"><div className="animate-pulse rounded-2xl bg-brand-600 p-4 text-white"><FileSpreadsheet size={30} /></div><p className="text-sm font-bold">正在驗證安全工作階段…</p></div>;
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedLayout />}>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/analysis" element={<AnalysisPage />} />
      <Route path="/sources" element={<SourcesPage />} />
      <Route path="/queue" element={<QueuePage />} />
      <Route path="/reviews" element={<ReviewsPage />} />
      <Route path="/report-types" element={<ReportTypesPage />} />
      <Route path="/schemas" element={<SchemasPage />} />
      <Route path="/templates" element={<TemplatesPage />} />
      <Route path="/rules" element={<RulesPage />} />
      <Route path="/exports" element={<ExportsPage />} />
      <Route path="/audit" element={<AuditPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/billing" element={<BillingPage />} />
      <Route path="/admin" element={<AdminPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Routes>;
}
