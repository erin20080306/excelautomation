# ExcelMaster 正式部署：Railway 後端 + Vercel 前端

這份流程使用 Railway 託管 PostgreSQL、Redis、S3 相容 Bucket、Parser、API 與 Worker；Vercel 繼續負責 React 靜態前端。所有服務建議放在同一個 Railway Project，並選擇 Singapore region。

## 0. 已在 repository 準備好的設定

- `railway.api.json`：API Docker build、`/health`、重啟策略及 Prisma schema 同步。
- `railway.worker.json`：Worker Docker build 與重啟策略。
- `railway.parser.json`：Parser Docker build、`/health` 與重啟策略。
- Vercel 仍由根目錄 `vercel.json` 建置 `apps/web/dist`。
- Node.js 固定在 22.x，避免 Vercel 自動跨 major version。

不要將任何正式密碼、Token 或 Bucket 金鑰提交到 Git。

## 1. 建立 Railway Project

1. 登入 Railway，選 **New Project → Empty Project**。
2. Project 名稱填 `excelmaster-production`。
3. 服務 region 全部選 **Southeast Asia / Singapore**。
4. 到 Project Settings 設定 Hard Usage Limit，避免測試期間意外產生過高費用。

## 2. 建立資料服務

在 Project canvas 依序按 **Create**：

1. **Database → PostgreSQL**，服務名稱保留為 `Postgres`。
2. **Database → Redis**，服務名稱保留為 `Redis`。
3. **Bucket**，名稱填 `excelmaster-files`，region 選 Singapore。

應用程式會使用 Railway reference variables，不需要複製資料庫或 Bucket 的真實密碼。

## 3. 建立 Parser

1. 選 **Create → GitHub Repo**，選 `erin20080306/excelautomation`。
2. Branch 選 `codex/excelmaster-platform`，服務名稱改為 `parser`。
3. Settings → Config as Code → Config File Path 填 `/railway.parser.json`。
4. Root Directory 保持 `/`，不要設為 `apps/parser`。
5. Variables → Raw Editor：

```text
NODE_ENV=production
MAX_FILE_SIZE_MB=50
```

6. 不要替 Parser 產生 public domain；API 與 Worker 只透過 Railway private network 呼叫它。

## 4. 建立 API

1. 再次由相同 GitHub repository 建立服務，名稱改為 `api`。
2. Branch 選 `codex/excelmaster-platform`。
3. Config File Path 填 `/railway.api.json`，Root Directory 保持 `/`。
4. Settings → Networking → **Generate Domain**。
5. 記下產生的網址，例如 `https://api-production-xxxx.up.railway.app`。
6. 在自己的電腦產生兩個秘密值：

```bash
openssl rand -base64 48
openssl rand -hex 32
```

第一行輸出用作 `JWT_SECRET`；第二行輸出用作 `FIELD_ENCRYPTION_KEY`。不要把輸出傳到聊天室或提交到 Git。

7. Variables → Raw Editor 貼上以下設定；把兩個 placeholder 換成剛才產生的值：

```text
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
JWT_SECRET=<第一行 openssl 輸出>
FIELD_ENCRYPTION_KEY=<第二行 openssl 輸出>
WEB_ORIGIN=https://excelautomation-api-seven.vercel.app
PARSER_URL=http://${{parser.RAILWAY_PRIVATE_DOMAIN}}:8000
STORAGE_DRIVER=s3
S3_ENDPOINT=${{excelmaster-files.ENDPOINT}}
S3_REGION=${{excelmaster-files.REGION}}
S3_BUCKET=${{excelmaster-files.BUCKET}}
S3_ACCESS_KEY_ID=${{excelmaster-files.ACCESS_KEY_ID}}
S3_SECRET_ACCESS_KEY=${{excelmaster-files.SECRET_ACCESS_KEY}}
S3_FORCE_PATH_STYLE=false
MAX_FILE_SIZE_MB=50
MAX_ZIP_UNCOMPRESSED_MB=500
```

`railway.api.json` 會在每次 API 部署前執行 Prisma `db push`。正式資料開始累積並需要變更 schema 後，應改用版本化 Prisma migrations。

## 5. 建立 Worker

1. 再次由相同 GitHub repository 建立服務，名稱改為 `worker`。
2. Branch 選 `codex/excelmaster-platform`。
3. Config File Path 填 `/railway.worker.json`，Root Directory 保持 `/`。
4. 不要產生 public domain。
5. Variables → Raw Editor：

```text
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
PARSER_URL=http://${{parser.RAILWAY_PRIVATE_DOMAIN}}:8000
STORAGE_DRIVER=s3
S3_ENDPOINT=${{excelmaster-files.ENDPOINT}}
S3_REGION=${{excelmaster-files.REGION}}
S3_BUCKET=${{excelmaster-files.BUCKET}}
S3_ACCESS_KEY_ID=${{excelmaster-files.ACCESS_KEY_ID}}
S3_SECRET_ACCESS_KEY=${{excelmaster-files.SECRET_ACCESS_KEY}}
S3_FORCE_PATH_STYLE=false
WORKER_CONCURRENCY=3
```

## 6. 檢查 Railway

1. Parser Deploy Logs 應顯示 Uvicorn 正在 port 8000 執行。
2. API deployment 的 Pre-deploy Logs 應顯示 Prisma schema 已同步。
3. 開啟 `https://<API 網域>/health`，應得到：

```json
{"status":"ok","service":"api"}
```

4. Worker Deploy Logs 應保持執行，不應反覆 crash/restart。

## 7. 設定 Vercel

在 Vercel 專案 `excelautomation-api`：

1. Settings → Environment Variables。
2. 新增 `VITE_API_URL=https://<API 網域>/api`。
3. Environment 勾選 Production；需要 Preview 測試時再勾 Preview。
4. 儲存後到 Deployments，對最新 commit 執行 Redeploy。
5. 確認 Settings → Build and Deployment：Root Directory 為 `.`。
6. 建議將 Node.js Version 設為 22.x，與 `.nvmrc` 和 Dockerfile 一致。

## 8. 選擇公開或內部使用

- **公開 SaaS**：關閉 Vercel Deployment Protection。任何人都可看到註冊頁並建立自己的隔離 Workspace。
- **內部系統**：保留 Vercel Protection；另應在應用程式加入邀請制或關閉公開註冊後，再公開 API domain。

目前程式包含公開註冊功能，不應在未決定使用模式前直接關閉所有保護。

## 9. 建立第一個帳號與驗收

1. 進入前端，選「立即建立」。
2. 建立第一個 Workspace 與 Owner 帳號。
3. 上傳一個小型 `.xlsx`。
4. 檢查檔案狀態依序前進，Worker 與 Parser logs 無錯誤。
5. 建立匯出並下載 `.xlsx`，確認 Bucket、Worker 與下載流程均正常。

## 10. 上線後

- 為 PostgreSQL 啟用備份並定期測試還原。
- Railway 設 Hard Usage Limit 與用量警示。
- 保留 GitHub Actions 的 lint、typecheck、測試與 build 檢查。
- Google/Microsoft OAuth 與 AI provider 目前不是核心流程必要設定；只有實作並啟用對應整合時才配置。
