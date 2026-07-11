import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Ban, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { EmptyState, Loading, PageHeader, StatusBadge } from '../components/ui';

export function QueuePage() {
  const client = useQueryClient();
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: async () => (await api.get('/jobs')).data, refetchInterval: 5000 });
  const cancel = useMutation({ mutationFn: async (id: string) => api.post(`/jobs/${id}/cancel`), onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }) });
  return <><PageHeader title="處理佇列" description="每份檔案由背景 Worker 獨立處理，不會將整個批次一次載入記憶體。失敗項目會依指數退避重試。" action={<button className="btn-secondary" onClick={() => jobs.refetch()}><RefreshCw size={16} />立即更新</button>} />
    <section className="card overflow-hidden">{jobs.isLoading ? <Loading /> : !jobs.data?.items.length ? <EmptyState icon={<Activity />} title="佇列目前為空" description="建立分析批次後，從排隊、驗證到匯出的完整狀態會顯示在這裡。" /> : <div className="table-wrap"><table className="table"><thead><tr><th>批次</th><th>狀態</th><th>進度</th><th>檔案</th><th>完成 / 失敗</th><th>建立時間</th><th></th></tr></thead><tbody>{jobs.data.items.map((job: any) => <tr key={job.id}><td className="font-bold text-slate-800">{job.name}</td><td><StatusBadge status={job.status} /></td><td><div className="w-40"><div className="mb-1 flex justify-between text-xs"><span>{job.progress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${job.progress}%` }} /></div></div></td><td>{job.totalItems}</td><td><span className="text-emerald-700">{job.completedItems}</span> / <span className="text-rose-600">{job.failedItems}</span></td><td>{new Date(job.createdAt).toLocaleString('zh-TW')}</td><td>{!['completed', 'failed', 'cancelled'].includes(job.status) && <button className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="取消批次" onClick={() => cancel.mutate(job.id)}><Ban size={17} /></button>}</td></tr>)}</tbody></table></div>}</section>
  </>;
}
