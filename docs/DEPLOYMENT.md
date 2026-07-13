# ExcelMaster 全 Vercel 試用部署

## 架構

- `excelautomation-api`：React/Vite Web。
- `excelautomation-backend`：Fastify API Vercel Function。
- `excelautomation-parser`：FastAPI/openpyxl Vercel Function。
- Vercel Marketplace Neon：PostgreSQL、試用檔案物件與應用資料。

三個執行專案都在 Vercel。API 與 Parser 分開部署是因為它們使用不同 runtime；Parser 以 `PARSER_SHARED_SECRET` 驗證 API 呼叫。

## 試用版限制

Vercel Function request/response payload 有 4.5 MB 限制，Hobby Fluid Compute 最長執行 300 秒。因此線上版明確限制：

- 單批最多 5 份來源檔案。
- multipart request 內來源檔案總量最多 3 MB。
- 匯出檔案最多 4 MB。
- 單次分析或匯出必須在 5 分鐘內完成。
- 不執行常駐 Worker、排程監控或 100 份背景批次。

完整背景 Queue、重試、大量批次與 Docker 環境保留在下載包。

## 1. Neon

Web 專案已透過 Vercel Marketplace 連接 Neon，Production 環境包含 `DATABASE_URL` 與 `DATABASE_URL_UNPOOLED`。Schema 使用：

```bash
node --env-file=.env.production ./node_modules/prisma/build/index.js db push --schema apps/api/prisma/schema.prisma
```

秘密連線字串不可提交到 Git。

## 2. Parser 專案

Parser 的 Vercel Root Directory 是 `apps/parser`，設定檔為 `apps/parser/vercel.json`。

Production 環境變數：

```text
NODE_ENV=production
MAX_FILE_SIZE_MB=3
PARSER_SHARED_SECRET=<至少 32 字元亂數>
```

部署後 `/health` 應回傳 `{"status":"ok"}`。未提供正確共享密鑰呼叫 `/analyze` 或 `/export` 必須回傳 401。

## 3. API 專案

API 使用 repository 根目錄與 `vercel.api.json`：

```bash
vercel deploy --prod --local-config vercel.api.json
```

Production 環境變數：

```text
NODE_ENV=production
DATABASE_URL=<Neon pooled URL>
JWT_SECRET=<至少 32 字元亂數>
FIELD_ENCRYPTION_KEY=<至少 32 字元亂數>
WEB_ORIGIN=https://excelautomation-api-seven.vercel.app
PARSER_URL=https://<parser-project>.vercel.app
PARSER_SHARED_SECRET=<與 Parser 相同>
PROCESSING_MODE=inline
STORAGE_DRIVER=database
MAX_FILE_SIZE_MB=3
MAX_ZIP_UNCOMPRESSED_MB=12
TRIAL_MAX_FILES=5
TRIAL_MAX_TOTAL_MB=3
TRIAL_MAX_OUTPUT_MB=4
APP_URL=https://excelautomation-api-seven.vercel.app
TURNSTILE_SECRET_KEY=<Cloudflare Turnstile secret>
RESEND_API_KEY=<Resend API key>
MAIL_FROM=ExcelMaster <no-reply@你的已驗證網域>
STRIPE_SECRET_KEY=<Stripe live secret key>
STRIPE_WEBHOOK_SECRET=<Stripe webhook signing secret>
ECPAY_MERCHANT_ID=<綠界商店代號>
ECPAY_HASH_KEY=<綠界 HashKey>
ECPAY_HASH_IV=<綠界 HashIV>
ECPAY_TEST_MODE=false
```

API 與 Neon 同樣放在 `iad1`，減少資料庫往返延遲。`/health` 應回傳 `processingMode: "inline"`。

## 4. Web 專案

Web 專案使用 repository 根目錄與 `vercel.json`。Production 環境變數：

```text
VITE_API_URL=https://<api-project>.vercel.app/api
```

Root Directory 必須為 `.`，Build Command 為 `npm run build:web`，Output Directory 為 `apps/web/dist`。

另設定 `VITE_TURNSTILE_SITE_KEY=<Cloudflare Turnstile site key>`。台灣商家優先使用綠界，後端通知網址為 `https://excelautomation-backend.vercel.app/api/billing/ecpay/notify`；測試商店才可設 `ECPAY_TEST_MODE=true`。若使用有資格申請的海外 Stripe 帳戶，Webhook endpoint 設為 `https://excelautomation-backend.vercel.app/api/billing/webhook`，至少訂閱 `checkout.session.completed` 與 `checkout.session.expired`。未完成金鑰設定前，公開註冊與付款會回傳 503，不會使用不安全的 bypass。

## 5. 驗收

1. API `/health` 與 Parser `/health` 回傳 200。
2. 使用測試管理者登入。
3. 上傳小於 3 MB 的 `.xlsx`，同一請求完成分析。
4. 分類、表頭、欄位對應與信心度可讀取。
5. 建立小於 4 MB 的匯出，取得簽名下載連結並下載有效 `.xlsx`。
6. 超過 5 份或 3 MB 時，前端與 API 都必須拒絕並顯示試用限制。
7. Parser 缺少共享密鑰時必須拒絕分析與匯出。

## 下載包

頁首「下載完整版」連結指向目前 GitHub 分支 ZIP。下載後可透過 `docker compose` 啟動完整 API、Worker、Parser 與 PostgreSQL Queue；正式大量檔案建議將 Storage Adapter 改成私有 S3 相容儲存。
