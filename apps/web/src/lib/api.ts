import axios from 'axios';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api', timeout: 290_000 });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('excelmaster.token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use((response) => response, (error) => {
  if (error.response?.status === 401 && !String(error.config?.url).includes('/auth/login')) {
    localStorage.removeItem('excelmaster.token');
    localStorage.removeItem('excelmaster.session');
    window.dispatchEvent(new Event('excelmaster:unauthorized'));
  }
  return Promise.reject(error);
});

export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) return String(error.response?.data?.message ?? error.message);
  return error instanceof Error ? error.message : '操作失敗';
}

export function uploadFiles(formData: FormData, onProgress: (progress: number) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${api.defaults.baseURL}/files/upload`);
    const token = localStorage.getItem('excelmaster.token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => onProgress(event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : 0);
    xhr.timeout = 290_000;
    xhr.onerror = () => reject(new Error('分析服務未收到完整請求。請確認網路連線；線上版請將單批控制在畫面顯示的檔案數與 MB 上限內。'));
    xhr.onabort = () => reject(new Error('上傳已中止，未建立整合檔或 GAS 報告。'));
    xhr.ontimeout = () => reject(new Error('線上分析超過 290 秒。請減少單批檔案，或使用訂閱安裝版處理大型資料。'));
    xhr.onload = () => {
      let body: any;
      try { body = JSON.parse(xhr.responseText); } catch { body = { message: xhr.responseText }; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.message ?? '上傳失敗'));
    };
    xhr.send(formData);
  });
}
