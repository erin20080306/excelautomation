import { ArrowLeft, FileSpreadsheet, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

function LegalLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#F3F8F6] px-4 py-8 sm:px-8"><div className="mx-auto max-w-4xl"><div className="flex flex-wrap items-center justify-between gap-4"><Link to="/login" className="flex items-center gap-3 font-black text-ink"><span className="rounded-xl bg-brand-600 p-2.5 text-white"><FileSpreadsheet size={22}/></span>ExcelMaster</Link><Link to="/login" className="btn-secondary"><ArrowLeft size={16}/>返回登入</Link></div><main className="card mt-8 overflow-hidden"><header className="bg-ink px-6 py-10 text-white sm:px-10"><p className="text-xs font-black uppercase tracking-[.2em] text-emerald-300">Legal & trust</p><h1 className="mt-3 text-3xl font-black">{title}</h1><p className="mt-3 max-w-2xl leading-7 text-slate-300">{subtitle}</p><p className="mt-4 text-xs text-slate-400">版本日期：2026 年 7 月 13 日</p></header><article className="legal-copy px-6 py-8 text-sm leading-7 text-slate-600 sm:px-10">{children}</article></main><p className="py-6 text-center text-xs text-slate-400">正式商業上線前，應由台灣執業法律專業人員依實際公司、金流與資料流完成最終審閱。</p></div></div>;
}

export function PrivacyPage() {
  return <LegalLayout title="隱私權政策" subtitle="說明 ExcelMaster 在帳號、試用、訂閱、檔案處理、安裝包下載與裝置授權流程中如何處理資料。">
    <h2>一、適用範圍與資料角色</h2><p>本政策適用於 ExcelMaster 雲端網站、API、管理後台及安裝版授權服務。使用者上傳的試算表內容由使用者決定處理目的；平台僅為提供合併、分析、匯出及支援服務而處理。</p>
    <h2>二、收集的資料</h2><ul><li>帳號資料：姓名、Email、工作區、角色、驗證與 MFA 狀態。</li><li>服務資料：上傳檔名、檔案內容、欄位分析、整合設定、輸出檔與操作紀錄。</li><li>訂閱資料：方案、訂單編號、付款狀態、訂閱期間；平台不保存完整信用卡資料。</li><li>安裝與安全資料：IP、User-Agent、下載時間、啟用碼末四碼、雜湊後的裝置識別、裝置名稱與最後授權驗證時間。</li></ul>
    <h2>三、使用目的</h2><p>資料用於提供智慧表頭辨識、多檔合併、Excel／GAS 報告、帳號安全、訂閱與裝置授權、故障排查、稽核、防詐欺及法令遵循。未經同意不會出售試算表內容或用於第三方廣告。</p>
    <h2>四、智慧程式碼與 Gemini</h2><p>使用智慧 VBA／Apps Script 功能時，平台只會把使用者輸入的需求，以及去識別化後的檔名、工作表名稱、表頭位置、欄位名稱／型別／語意與統計數量傳送給 Google Gemini；不傳送原始儲存格資料、完整資料列或帳號密鑰。使用者不應在需求文字中輸入密碼、API 金鑰或不必要的個人資料。產生的程式碼不會自動執行，應先人工檢查並在檔案副本測試。</p>
    <h2>五、保存與刪除</h2><p>保存期間依服務提供、訂閱、稽核、備份及法定義務所需決定。試用或訂閱終止後，應提供合理期間讓使用者匯出資料，再依正式資料保留表刪除或去識別化。付款、稅務與安全稽核可能依法保存較久。</p>
    <h2>六、委外服務與跨境</h2><p>目前可能使用 Vercel、Neon、Resend、Cloudflare Turnstile、Google Gemini，以及日後啟用的 ECPay、Stripe 或 Codex Sites。這些供應商只在提供代管、資料庫、Email、人機驗證、智慧程式碼及金流所需範圍處理資料，資料可能依其基礎設施跨境傳輸。</p>
    <h2>七、使用者權利</h2><p>使用者可要求查詢、更正、取得副本、停止處理或刪除個人資料；若因契約、資安或法定保存義務無法立即刪除，平台應說明原因。請透過帳號所屬平台管理者提出申請。</p>
    <h2>八、檔案中的第三人資料</h2><p>上傳包含員工、客戶或供應商資料前，使用者應確認具有合法依據並只上傳必要欄位。涉及身分證號、醫療、金融或其他敏感資料時，應先去識別化並評估是否適合使用本服務。</p>
    <h2>九、政策更新</h2><p>重大變更會在服務內公告並更新版本日期；若變更影響既有資料使用目的，將依法取得同意或提供選擇。</p>
  </LegalLayout>;
}

export function SecurityPolicyPage() {
  return <LegalLayout title="安全政策" subtitle="ExcelMaster 採取的帳號、資料、下載、授權與事件處理控制，以及使用者應共同遵守的安全責任。">
    <div className="grid gap-4 sm:grid-cols-2"><div className="rounded-2xl bg-brand-50 p-5"><ShieldCheck className="text-brand-700"/><h2 className="!mt-3">平台控制</h2><p>最小權限、Email 驗證、登入鎖定、MFA、速率限制、稽核、私有安裝包與一次性下載。</p></div><div className="rounded-2xl bg-slate-50 p-5"><LockKeyhole className="text-slate-700"/><h2 className="!mt-3">授權控制</h2><p>伺服器端到期日、裝置雜湊綁定、定期驗證、裝置數限制與管理員撤銷。</p></div></div>
    <h2>一、帳號與存取</h2><p>密碼以 bcrypt 雜湊保存；正式環境應啟用 Email 驗證、Turnstile、登入失敗鎖定與管理員 MFA。工作區角色與平台 SUPERADMIN 分離，付費權益不因擁有 OWNER 角色而自動取得。</p>
    <h2>二、資料與傳輸</h2><p>正式服務使用 HTTPS。密鑰只應存放於受控環境變數；檔案、資料庫與備份應限制存取並設定保存期限。Gemini 金鑰不得送到瀏覽器或寫入 Git；產生的程式碼須經危險指令掃描且不會自動執行。安裝包以 SHA-256 驗證，下載網址短效且只能使用一次。</p>
    <h2>三、訂閱與防繞過</h2><p>是否可下載與使用安裝版以授權伺服器時間、訂閱狀態及裝置紀錄為準。訂閱到期或撤銷屬權威拒絕，不適用離線緩衝；只有授權服務暫時不可達且先前成功驗證過時，才可在設定上限內短暫離線。</p>
    <h2>四、限制與共同責任</h2><p>使用者必須保護帳號、啟用碼與本機 `.env`，維持作業系統、Docker Desktop 與瀏覽器更新，不得共享啟用碼、修改授權控制或將服務暴露於未受保護的公網。任何可由客戶取得系統管理權限的本機軟體都無法承諾絕對不可破解；平台以伺服器授權、稽核、最小化離線期與合約條款降低風險。</p>
    <h2>五、弱點回報</h2><p>發現可能造成未授權存取、資料外洩或授權繞過的問題時，請勿公開利用或存取他人資料；請透過平台管理者提供重現步驟、受影響網址、時間與必要的去識別化證據。平台應確認回報、評估嚴重度、修補並通知受影響使用者。</p>
    <h2>六、事件與復原</h2><p>事件處理包含隔離、保存稽核、撤銷權杖／裝置、修補、還原及事後檢討。正式營運前應建立加密備份、還原演練、監控告警、金鑰輪替與法定通報流程。</p>
  </LegalLayout>;
}
