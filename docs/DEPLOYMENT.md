# ExcelMaster 正式部署：Supabase + Railway + Vercel

正式架構：

- **Supabase**：PostgreSQL、`pgmq` Queues、S3 相容 Storage。
- **Railway**：Fastify API、Queue Worker、Python Parser 三個常駐服務。
- **Vercel**：React/Vite 靜態前端。

Queue 直接透過 Prisma/PostgreSQL 呼叫 `pgmq`，不需要 Supabase Data API、`service_role` key、Redis 或 BullMQ。

## 1. 建立 Supabase Project

1. 登入 Supabase，選 **New project**。
2. Project 名稱填 `excelmaster-production`。
3. Region 選離使用者與 Railway 最近的區域，台灣建議 Singapore。
4. 產生高強度 Database Password，存進自己的密碼管理器，不要提交到 Git 或傳到聊天室。
5. Project 建立完成後，按頂部 **Connect**。
6. 選 **Session pooler**、port `5432` 的連線字串。API 與 Worker 都是常駐服務，使用 Session pooler；不要選 port `6543` 的 transaction pooler。
7. 將 `[YOUR-PASSWORD]` 換成 URL encoded 後的資料庫密碼，這個完整字串就是後續的 `DATABASE_URL`。

## 2. 啟用 Supabase Queues

1. Dashboard → Integrations → Queues，啟用 `pgmq` extension。
2. Queues → **Create queue**。
3. Queue 名稱必須填：

```text
excel_processing
```

4. Queue Type 選 **Basic / Durable Queue**，不要選 Unlogged Queue。
5. 保留 RLS；本系統直接使用 PostgreSQL 連線，不需要把 Queue 暴露到 PostgREST/Data API。

也可以在 SQL Editor 執行 repository 的 `supabase/queue.sql`。API 與 Worker 啟動時會再次確認 extension 與 Queue 存在，因此初始化是冪等的。

## 3. 建立 Supabase Storage

1. Storage → **New bucket**。
2. Bucket 名稱填：

```text
excelmaster-files
```

3. 設為 Private bucket。
4. Project Settings → Storage → S3 Access Keys，建立 server-side S3 access key。
5. 保存以下五個值：Endpoint、Region、Bucket、Access Key ID、Secret Access Key。
6. Supabase S3 必須使用 `S3_FORCE_PATH_STYLE=true`。

S3 access key 能繞過 Storage RLS，只能放在 API 與 Worker 的秘密環境變數中。

## 4. 建立 Railway Project

1. Railway → **New Project → Empty Project**。
2. 名稱填 `excelmaster-compute`，region 選 Singapore。
3. 設定 Hard Usage Limit。
4. 不需要在 Railway 建立 PostgreSQL、Redis 或 Bucket。

## 5. 部署 Parser

1. Create → GitHub Repo → `erin20080306/excelautomation`。
2. Branch 選 `codex/excelmaster-platform`，服務名稱改為 `parser`。
3. Settings → Config as Code → Config File Path：`/railway.parser.json`。
4. Root Directory 保持 `/`。
5. Variables → Raw Editor：

```text
NODE_ENV=production
MAX_FILE_SIZE_MB=50
```

6. 不要產生 public domain。API 與 Worker 只透過 Railway private network 呼叫 Parser。

## 6. 部署 API

1. 再次從同一個 repository/branch 建立服務，名稱改為 `api`。
2. Config File Path：`/railway.api.json`；Root Directory 保持 `/`。
3. Settings → Networking → **Generate Domain**，記下 API HTTPS 網址。
4. 在自己的電腦產生秘密值：

```bash
openssl rand -base64 48
openssl rand -hex 32
```

第一行是 `JWT_SECRET`，第二行是 `FIELD_ENCRYPTION_KEY`。

5. Variables → Raw Editor；把 `<...>` 全部換成自己的值：

```text
NODE_ENV=production
DATABASE_URL=<Supabase Session pooler 5432 完整字串>
JWT_SECRET=<openssl base64 輸出>
FIELD_ENCRYPTION_KEY=<openssl hex 輸出>
WEB_ORIGIN=https://excelautomation-api-seven.vercel.app
PARSER_URL=http://${{parser.RAILWAY_PRIVATE_DOMAIN}}:8000
STORAGE_DRIVER=s3
S3_ENDPOINT=<Supabase direct storage S3 endpoint>
S3_REGION=<Supabase Storage region>
S3_BUCKET=excelmaster-files
S3_ACCESS_KEY_ID=<Supabase S3 access key id>
S3_SECRET_ACCESS_KEY=<Supabase S3 secret access key>
S3_FORCE_PATH_STYLE=true
MAX_FILE_SIZE_MB=50
MAX_ZIP_UNCOMPRESSED_MB=500
```

`railway.api.json` 會在部署前執行 Prisma schema 同步與 `queue:init`。

## 7. 部署 Worker

1. 再次從同一個 repository/branch 建立服務，名稱改為 `worker`。
2. Config File Path：`/railway.worker.json`；Root Directory 保持 `/`。
3. 不要產生 public domain。
4. Variables → Raw Editor：

```text
NODE_ENV=production
DATABASE_URL=<與 API 完全相同的 Supabase Session pooler 字串>
PARSER_URL=http://${{parser.RAILWAY_PRIVATE_DOMAIN}}:8000
STORAGE_DRIVER=s3
S3_ENDPOINT=<Supabase direct storage S3 endpoint>
S3_REGION=<Supabase Storage region>
S3_BUCKET=excelmaster-files
S3_ACCESS_KEY_ID=<Supabase S3 access key id>
S3_SECRET_ACCESS_KEY=<Supabase S3 secret access key>
S3_FORCE_PATH_STYLE=true
WORKER_CONCURRENCY=3
PGMQ_VISIBILITY_TIMEOUT_SECONDS=1800
PGMQ_POLL_INTERVAL_MS=1000
PGMQ_RETRY_BASE_SECONDS=2
```

Visibility timeout 必須大於單一 Excel 分析或匯出的最長預期時間。預設 30 分鐘；若大型檔案可能超過 30 分鐘，應提高此值。

## 8. 檢查後端

1. API Pre-deploy Logs 應顯示 Prisma schema 與 Queue 初始化成功。
2. 開啟 `https://<API 網域>/health`，應回傳：

```json
{"status":"ok","service":"api"}
```

3. Worker logs 應顯示 `worker.ready`，queue 為 `excel_processing`。
4. Parser logs 應顯示 Uvicorn 正在 port 8000 執行。

## 9. 設定 Vercel

1. Vercel 專案 `excelautomation-api` → Settings → Environment Variables。
2. 新增：

```text
VITE_API_URL=https://<Railway API 網域>/api
```

3. 套用至 Production，儲存後 Redeploy。
4. Root Directory 保持 `.`，Node.js 使用 22.x。

## 10. 存取模式與驗收

- 公開 SaaS：關閉 Vercel Deployment Protection；任何人都能看到公開註冊頁。
- 內部系統：保留保護，並在公開 API 前加入邀請制或停用公開註冊。

驗收順序：

1. 建立第一個 Workspace。
2. 上傳小型 `.xlsx`。
3. 在 Supabase Queues 觀察訊息被 Worker 讀取並完成刪除。
4. 檢查分析結果與人工確認項目。
5. 建立匯出並下載 `.xlsx`，確認 Supabase Storage 有新物件。
6. 暫停 Worker 測試一次：訊息應在 visibility timeout 後重新出現；啟動 Worker 後可繼續處理。

## Queue 行為

- API 的應用資料與 Queue 訊息在同一個 PostgreSQL transaction 內提交。
- Worker 使用 pull-based `pgmq.read` 與 visibility timeout。
- 長任務執行期間會定期延長 visibility timeout，避免另一個 Worker 重複領取。
- 成功訊息永久刪除。
- 暫時失敗會以 exponential backoff 重試。
- 超過 `maxAttempts` 或 payload 無效的訊息會封存至 Queue archive table。
- ProcessingJobItem 與 ExportJob 提供冪等保護，避免 Worker crash 後重複完成結果。
