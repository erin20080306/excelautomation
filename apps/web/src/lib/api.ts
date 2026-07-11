import axios from 'axios';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api', timeout: 30_000 });

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
    xhr.onerror = () => reject(new Error('網路連線中斷'));
    xhr.onload = () => {
      let body: any;
      try { body = JSON.parse(xhr.responseText); } catch { body = { message: xhr.responseText }; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.message ?? '上傳失敗'));
    };
    xhr.send(formData);
  });
}
