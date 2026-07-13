import { z } from 'zod';
import type { AppConfig } from '../config.js';

const cleanText = (value: unknown, maxLength = 160): string => String(value ?? '').normalize('NFKC').replace(/\p{Cc}/gu, ' ').trim().slice(0, maxLength);

export const codeGenerationResultSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(2_000),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  safetyNotes: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  setupSteps: z.array(z.string().trim().min(1).max(800)).max(30).default([]),
  vbaCode: z.string().max(80_000).default(''),
  appsScriptCode: z.string().max(80_000).default(''),
  tests: z.array(z.string().trim().min(1).max(800)).max(30).default([])
});

export type CodeGenerationResult = z.infer<typeof codeGenerationResultSchema>;
export type CodeTarget = 'VBA' | 'APPS_SCRIPT' | 'BOTH';

type SourceFileForContext = {
  name: string;
  reportTypeKey?: string | null;
  confidence?: number | null;
  sheets: Array<{
    name: string;
    maxRow: number;
    maxColumn: number;
    metadata?: unknown;
    fields: Array<{
      sourceName: string;
      targetKey?: string | null;
      dataType?: string | null;
      confidence: number;
      columnIndex: number;
    }>;
  }>;
};

export type SafeSourceContext = Array<{
  fileName: string;
  reportType: string | null;
  confidence: number | null;
  sheets: Array<{
    name: string;
    rowCount: number;
    columnCount: number;
    headerRow: number | null;
    dataRowCount: number;
    formulaCount: number;
    fields: Array<{
      sourceName: string;
      targetKey: string | null;
      dataType: string | null;
      confidence: number;
      columnIndex: number;
    }>;
  }>;
}>;

function metadataNumber(metadata: unknown, keys: string[]): number | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value >= 0) return Math.trunc(value);
  }
  return null;
}

/** Build the only source context allowed to leave ExcelMaster. Raw rows and cell values are intentionally unreachable. */
export function buildSourceContext(files: SourceFileForContext[]): SafeSourceContext {
  return files.slice(0, 5).map((file) => ({
    fileName: cleanText(file.name, 200),
    reportType: file.reportTypeKey ? cleanText(file.reportTypeKey, 80) : null,
    confidence: typeof file.confidence === 'number' ? Math.max(0, Math.min(1, file.confidence)) : null,
    sheets: file.sheets.slice(0, 20).map((sheet) => {
      const headerRow = metadataNumber(sheet.metadata, ['headerRow', 'header_row']);
      const dataRowCount = metadataNumber(sheet.metadata, ['dataRowCount', 'data_row_count']) ?? Math.max(0, sheet.maxRow - (headerRow ?? 1));
      const formulaCount = metadataNumber(sheet.metadata, ['formulaCount', 'formula_count']) ?? 0;
      return {
        name: cleanText(sheet.name, 120),
        rowCount: Math.max(0, sheet.maxRow),
        columnCount: Math.max(0, sheet.maxColumn),
        headerRow,
        dataRowCount,
        formulaCount,
        fields: sheet.fields.slice(0, 80).map((field) => ({
          sourceName: cleanText(field.sourceName, 160),
          targetKey: field.targetKey ? cleanText(field.targetKey, 120) : null,
          dataType: field.dataType ? cleanText(field.dataType, 60) : null,
          confidence: Math.max(0, Math.min(1, Number(field.confidence) || 0)),
          columnIndex: Math.max(0, Math.trunc(field.columnIndex))
        }))
      };
    })
  }));
}

export function estimateGeminiCostUsd(promptTokens: number, outputTokens: number, thinkingTokens = 0): number {
  const inputCost = Math.max(0, promptTokens) * 0.30 / 1_000_000;
  const outputCost = (Math.max(0, outputTokens) + Math.max(0, thinkingTokens)) * 2.50 / 1_000_000;
  return Number((inputCost + outputCost).toFixed(8));
}

const blockedPatterns: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bWScript\.Shell\b/i, label: 'WScript.Shell 系統指令' },
  { pattern: /\b(?:PowerShell|cmd\.exe)\b/i, label: '作業系統命令' },
  { pattern: /\bRegWrite\b/i, label: '登錄檔寫入' },
  { pattern: /\bShell\s*\(/i, label: 'VBA Shell 執行' },
  { pattern: /\bADODB\.Stream\b/i, label: '任意檔案串流' },
  { pattern: /\bCreateObject\s*\(\s*["']Scripting\.FileSystemObject/i, label: '檔案系統物件' },
  { pattern: /\b(?:Kill|RmDir)\s+[^\r\n]+/i, label: '刪除檔案或資料夾' },
  { pattern: /\beval\s*\(/i, label: '動態 eval 執行' },
  { pattern: /\bnew\s+Function\s*\(/i, label: '動態 Function 執行' }
];

export function inspectGeneratedCode(result: CodeGenerationResult): { blocked: boolean; warnings: string[] } {
  const code = `${result.vbaCode}\n${result.appsScriptCode}`;
  const warnings = blockedPatterns.filter(({ pattern }) => pattern.test(code)).map(({ label }) => `已攔截：${label}`);
  if (/UrlFetchApp\.fetch\s*\(/i.test(result.appsScriptCode)) warnings.push('Apps Script 會連線到外部網址，請先確認目的網域與傳送內容。');
  return { blocked: warnings.some((warning) => warning.startsWith('已攔截：')), warnings };
}

const responseSchema = {
  type: 'object',
  required: ['title', 'summary', 'assumptions', 'safetyNotes', 'setupSteps', 'vbaCode', 'appsScriptCode', 'tests'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    safetyNotes: { type: 'array', items: { type: 'string' } },
    setupSteps: { type: 'array', items: { type: 'string' } },
    vbaCode: { type: 'string' },
    appsScriptCode: { type: 'string' },
    tests: { type: 'array', items: { type: 'string' } }
  }
} as const;

export type GeminiUsage = {
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export async function generateGeminiCode(input: {
  config: Pick<AppConfig, 'GEMINI_API_KEY' | 'GEMINI_MODEL' | 'GEMINI_MAX_OUTPUT_TOKENS'>;
  target: CodeTarget;
  requirement: string;
  sourceContext: SafeSourceContext;
  fetchImpl?: typeof fetch;
}): Promise<{ result: CodeGenerationResult; usage: GeminiUsage }> {
  const apiKey = input.config.GEMINI_API_KEY;
  if (!apiKey) throw new Error('智慧程式碼服務尚未設定，請由管理員設定 Gemini API 金鑰。');
  const requirement = cleanText(input.requirement, 4_000);
  const targetInstruction = input.target === 'BOTH' ? '同時產生 VBA 與 Google Apps Script' : input.target === 'VBA' ? '只產生 VBA，appsScriptCode 請留空' : '只產生 Google Apps Script，vbaCode 請留空';
  const prompt = [
    `使用者需求：${requirement}`,
    `目標：${targetInstruction}`,
    '以下是由 ExcelMaster 在伺服器端去識別化後的結構資訊，只包含檔名、工作表尺寸、表頭與欄位語意，不包含任何原始儲存格內容：',
    JSON.stringify(input.sourceContext),
    '請提供可讀、具註解、可直接貼入編輯器的程式碼，使用工作表名稱與表頭名稱尋找欄位，不可依賴固定欄號。',
    '不得產生 Shell、PowerShell、cmd、登錄檔、任意檔案刪除、動態 eval、憑證讀取或把試算表資料傳往外部服務的程式。',
    '程式不得自動執行；清楚列出安裝步驟、必要權限、假設、安全注意事項與測試案例。'
  ].join('\n\n');

  const response = await (input.fetchImpl ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.config.GEMINI_MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: '你是 Excel 與 Google Sheets 自動化資深工程師。回覆必須符合指定 JSON schema，使用繁體中文說明，程式碼內不得包含真實憑證或原始資料。' }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.2,
        maxOutputTokens: input.config.GEMINI_MAX_OUTPUT_TOKENS
      }
    })
  });
  const payload = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    const serviceMessage = cleanText(payload?.error?.message, 400);
    throw new Error(serviceMessage ? `Gemini 產生失敗：${serviceMessage}` : `Gemini 產生失敗（HTTP ${response.status}）`);
  }
  const text = payload?.candidates?.[0]?.content?.parts?.map((part: Record<string, unknown>) => typeof part.text === 'string' ? part.text : '').join('').trim();
  if (!text) throw new Error('Gemini 未回傳可用的程式碼內容。');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Gemini 回傳格式無法解析，請重新產生。'); }
  const result = codeGenerationResultSchema.parse(parsed);
  const usageMetadata = payload.usageMetadata ?? {};
  const promptTokens = Math.max(0, Number(usageMetadata.promptTokenCount) || 0);
  const outputTokens = Math.max(0, Number(usageMetadata.candidatesTokenCount) || 0);
  const thinkingTokens = Math.max(0, Number(usageMetadata.thoughtsTokenCount) || 0);
  const totalTokens = Math.max(promptTokens + outputTokens + thinkingTokens, Number(usageMetadata.totalTokenCount) || 0);
  return { result, usage: { promptTokens, outputTokens, thinkingTokens, totalTokens, estimatedCostUsd: estimateGeminiCostUsd(promptTokens, outputTokens, thinkingTokens) } };
}
