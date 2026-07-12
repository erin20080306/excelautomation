# ExcelMaster 正式部署：Vercel Neon + Render

目前架構：

- **Vercel**：React/Vite 靜態前端，以及 Marketplace Neon PostgreSQL。
- **Neon PostgreSQL**：應用資料、背景工作 Queue 與測試部署的檔案物件。
- **Render**：同一個 Docker Web Service 內執行 Fastify API、Queue Worker 與 Python Parser。

Queue 使用 repository 內建的標準 PostgreSQL 資料表與 `FOR UPDATE SKIP LOCKED`，不需要 `pgmq`、Redis 或 BullMQ。API 建立工作時會在同一個 database transaction 寫入業務資料與 Queue 訊息。

## 1. 在 Vercel 建立 Neon 資料庫

1. 開啟 Vercel 專案 `excelautomation-api`。
2. 前往 Storage / Marketplace，加入 Neon Postgres。
3. 將 Neon 連接至 Production；需要 Preview 或 Development 時再另外勾選。
4. Vercel 會建立秘密環境變數 `DATABASE_URL`。不要把連線字串提交到 Git 或貼進聊天室。
5. 後端是常駐服務，建議提供 Neon pooled connection string；Prisma 6 可直接使用。

第一次透過 CLI 安裝 Neon 時，Vercel 會要求帳號擁有者接受 Marketplace 法律條款。這一步必須由帳號擁有者本人完成。

## 2. 部署 Render Backend

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/erin20080306/excelautomation/tree/codex/excelmaster-platform)

Blueprint 只建立一個 `excelautomation-backend` Web Service。建立時輸入：

```text
DATABASE_URL=<Vercel Neon 的完整 pooled connection string>
SEED_ADMIN_EMAIL=<測試管理者 Email>
SEED_ADMIN_PASSWORD=<至少 10 個字元的測試密碼>
```

Render 會自動產生 `JWT_SECRET` 與 `FIELD_ENCRYPTION_KEY`。`WEB_ORIGIN` 已限制為：

```text
https://excelautomation-api-seven.vercel.app
```

Docker 啟動流程會依序：

1. 執行 Prisma `db push`，建立或更新 Neon schema。
2. 依環境變數建立或更新測試管理者，角色為 Workspace `OWNER`。
3. 啟動 API（port 10000）、Worker 與只在容器內監聽的 Parser（port 8000）。

## 3. 檢查後端

Render 部署完成後開啟：

```text
https://<render-domain>/health
```

應回傳：

```json
{"status":"ok","service":"api"}
```

Logs 應顯示 database schema、測試管理者 seed 完成，以及 `worker.ready`。Queue 的預設 visibility timeout 為 30 分鐘；長任務執行時 Worker 會持續延長 visibility timeout。

## 4. 連接 Vercel 前端

在 Vercel 專案 Settings → Environment Variables 新增：

```text
VITE_API_URL=https://<render-domain>/api
```

套用至 Production 並重新部署。Vercel 專案 Root Directory 必須是 repository 根目錄 `.`，不能設成 `apps/api`。

## 5. 驗收

1. 開啟登入頁，以設定的測試管理者登入。
2. 上傳小型 `.xlsx`。
3. 確認分析狀態完成，且人工確認項目可讀取。
4. 建立匯出並下載 `.xlsx`。
5. 在 Neon 檢查 `QueueMessage`：成功訊息會刪除，超過重試次數的訊息會保留並標記 `archivedAt`。
6. 在 Neon 檢查 `StoredObject` 已保存來源與匯出檔案。

## Queue 行為

- `QueueMessage` 只使用標準 PostgreSQL 功能，適用於 Neon，不依賴額外 extension。
- Worker 以 `FOR UPDATE SKIP LOCKED` 原子領取可見訊息，可安全支援多個 Worker。
- 長任務會更新 `visibleAt`，避免另一個 Worker 重複領取。
- 成功訊息刪除；暫時失敗使用 exponential backoff 重試。
- 超過 `maxAttempts` 或 payload 無效的訊息會封存。
- `ProcessingJobItem` 與 `ExportJob` 提供額外的冪等保護。

## 儲存邊界

目前測試部署設定 `STORAGE_DRIVER=database`，因此檔案也存於 Neon。這能避免免費容器重啟造成檔案遺失，適合功能驗證與小型資料。正式大量檔案應改用私有 S3 相容 bucket，並將 `STORAGE_DRIVER` 改成 `s3`。

## 安全注意事項

- `DATABASE_URL`、測試密碼、JWT 與加密金鑰只能放在平台的秘密環境變數。
- 測試管理者完成驗收後應立即更換強密碼，或清除 seed 環境變數。
- 正式公開前應評估關閉公開註冊、設定邀請制與監控 Neon/Render 使用量。
