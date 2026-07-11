# ExcelMaster

多格式 Excel 智慧整合與自動化平台。這個 repository 是可執行的 monorepo，包含 React 前端、Fastify API、Supabase Queues Worker、FastAPI/openpyxl 解析服務、PostgreSQL 與 Storage Adapter。

## 核心流程

1. 使用者註冊時建立 Workspace，密碼使用 bcrypt 雜湊。
2. 瀏覽器可一次上傳多檔、整個資料夾或 ZIP；API 驗證大小、副檔名、MIME、ZIP 解壓上限與安全路徑。
3. API 以 SHA-256 在 Workspace 內去重，並以同一個 PostgreSQL transaction 建立 ProcessingJob、ProcessingJobItem 與 Supabase Queue 訊息。
4. Worker 從 Supabase `pgmq` Queue 拉取工作，呼叫 Python Parser 分析工作表結構、表頭、資料區、格式、公式、分類與欄位映射。
5. 低信心度分類、表頭或欄位映射建立 ReviewTask，不會直接混入自動整合。
6. 整合專案可保存 Append、Join、Lookup、Group、Split、Transform 與組合鍵去重管線。
7. 輸出由背景 Worker 產生真正的 `.xlsx`，包含總覽、欄位映射、異常、分類資料與處理紀錄；下載網址使用短效 JWT 簽名。

## 專案結構

```text
apps/web       React + TypeScript + Vite + Tailwind + TanStack Query
apps/api       Fastify + Prisma + PostgreSQL + REST API
apps/worker    Supabase Queues 背景分析與匯出 Worker
apps/parser    FastAPI + openpyxl + pandas Excel 解析/匯出服務
packages/shared 共享型別、Zod Schema 與整合引擎
```

## 本機啟動

需求：Node.js 22、Python 3.12，以及支援 `pgmq` 的 PostgreSQL（正式環境建議 Supabase）。

```bash
cp .env.example .env
# 將 JWT_SECRET 換成至少 32 字元的亂數，FIELD_ENCRYPTION_KEY 換成 64 位十六進位亂數
npm ci
python3 -m venv apps/parser/.venv
apps/parser/.venv/bin/pip install -r apps/parser/requirements.txt
npm run db:push
apps/parser/.venv/bin/uvicorn app.main:app --app-dir apps/parser --reload
npm run dev
```

前端為 `http://localhost:5173`，API 為 `http://localhost:4000`，Parser 文件在開發環境為 `http://localhost:8000/docs`。

第一次使用可在登入頁選「立即建立」，自行設定帳號、密碼與工作區。若需要固定的測試管理者，請在本機 `.env` 設定 `SEED_ADMIN_EMAIL`、`SEED_ADMIN_PASSWORD`、`SEED_ADMIN_NAME`、`SEED_WORKSPACE_NAME`，執行 `npm run db:seed` 後即可登入；帳密不會寫死在前端或提交到 Git。

## Docker Compose

```bash
cp .env.example .env
docker compose up -d postgres parser
docker compose run --rm api npx prisma db push --schema apps/api/prisma/schema.prisma
docker compose run --rm api npm run db:seed
docker compose up -d api worker web
```

開啟 `http://localhost:8080`。正式環境建議使用 Supabase PostgreSQL、Queues 與 Storage；API、Worker、Parser 部署在支援常駐程序的平台，Vercel 只部署前端靜態產物。

## Vercel 前端部署

Vercel 專案的 **Root Directory 必須設為 repository 根目錄 `.`**，不可選 `apps/api`。根目錄的 `vercel.json` 會使用 `npm ci --include=dev` 安裝 TypeScript，並只執行 `npm run build:web`，輸出 `apps/web/dist`。

Vercel 必須設定：

```text
VITE_API_URL=https://你的常駐-api-domain.example/api
```

Fastify API、Queue Worker 與 Python Parser 需部署到支援常駐程序的平台；PostgreSQL、Queue 與檔案儲存由 Supabase 提供。若 Vercel build log 顯示工作目錄為 `/vercel/path0/apps/api`，代表 Root Directory 仍設錯，需在 Project Settings → Build and Deployment 改回 `.` 後重新部署。

完整正式環境建議使用 Supabase 託管 PostgreSQL、Queues 與 S3 相容 Storage，Railway 託管 API、Worker、Parser，並保留 Vercel 作為前端。逐步操作、環境變數及驗收方式請見 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## 驗證

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Python 測試包含非第一列表頭、多層表頭、合併儲存格、隱藏列、總計排除、分類、欄位映射、民國年、Excel 日期序號、金額/百分比轉換、型別化匯出與公式注入防護。TypeScript 測試涵蓋 Append、四種 Join、Lookup、六種 Group 聚合、Split、Transform 與去重。

## API

所有 `/api`（簽名下載例外）皆需 `Authorization: Bearer <JWT>`，且 server 會重新驗證 WorkspaceMember。

| 方法 | 路徑 | 功能 |
|---|---|---|
| POST | `/api/auth/register` | 建立 User、Workspace 與標準報表 Schema |
| POST | `/api/auth/login` | 正式登入 |
| GET | `/api/dashboard` | 工作區即時摘要 |
| GET/POST/PATCH | `/api/projects` | 整合專案 |
| POST | `/api/files/upload` | 多檔、資料夾或 ZIP 上傳並排程 |
| GET | `/api/files` | 來源與分析結果 |
| POST | `/api/files/:id/reanalyze` | 重新分析 |
| GET/POST | `/api/schemas` | 動態欄位 Schema |
| GET/POST | `/api/templates` | 解析模板與版本 |
| POST | `/api/templates/:id/versions` | 建立新版本或由舊版本回復 |
| PATCH | `/api/templates/:id` | 啟用或停用模板 |
| GET/PATCH | `/api/reviews` | 人工確認中心 |
| GET/POST | `/api/sources` | 資料來源設定 |
| GET/POST | `/api/exports` | 背景 Excel 匯出 |
| POST | `/api/exports/:fileId/sign` | 短效下載網址 |
| GET | `/api/audit-logs` | 遮罩後的稽核紀錄 |
| GET/PUT | `/api/settings` | Workspace 設定 |
| GET | `/api/search` | 檔案、專案與批次搜尋 |

## 安全設計

- Workspace 關聯與 server-side membership 驗證確保租戶隔離。
- bcrypt 密碼雜湊、8 小時 API JWT、10 分鐘下載 JWT。
- Helmet、CORS、Rate Limit、Zod 輸入驗證與結構化錯誤回應。
- 副檔名/MIME 雙重驗證、50 MB 預設上限、ZIP bomb 與路徑穿越防護。
- SHA-256 內容去重；`.xlsm` 只讀資料，永不執行 VBA。
- 匯出時防護 `= + - @ tab CR` 開頭的 Excel/CSV Formula Injection。
- OAuth 或來源憑證使用 AES-256-GCM 加密，API log 自動遮罩 authorization、密碼與憑證。
- 稽核紀錄回傳前遮罩 Email 與電話。

## 外部憑證

核心本機上傳流程不需第三方 OAuth 憑證。正式部署需要 Supabase `DATABASE_URL`、`JWT_SECRET`、`FIELD_ENCRYPTION_KEY`，以及 Storage S3 endpoint、bucket、region 與 access key。Google Drive/Gmail 使用 Google OAuth client，OneDrive/SharePoint/Outlook 使用 Microsoft OAuth client。

## 已知邊界

- Google Drive、OneDrive、SharePoint、Gmail、Outlook 與本機 Agent 需要各自的 OAuth 應用、租戶同意與 callback 網域；未配置時 UI 不會把它們顯示為可操作來源。本 repository 已保留加密 credential 與 DataSource/AutomationRule 資料模型，但沒有假造外部連線成功。
- AI 預設完全停用；目前規則、別名、資料型態與結構推論已可獨立運作。串接任一 AI provider 前仍需額外設定 provider secret、資料處理條款與允許的資料區域。
- `.xls` 由 pandas/xlrd 讀取，無法像 OpenXML 一樣完整保留所有儲存格樣式；`.xlsx`/`.xlsm` 才能完整檢查樣式、合併格與公式。
