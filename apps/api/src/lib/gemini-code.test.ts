import { describe, expect, it, vi } from 'vitest';
import { buildSourceContext, estimateGeminiCostUsd, generateGeminiCode, inspectGeneratedCode } from './gemini-code.js';

describe('Gemini code generation privacy and safety', () => {
  it('builds schema-only context without raw cell rows or values', () => {
    const input: any = [{
      name: 'sales.xlsx', reportTypeKey: 'sales', confidence: 0.91, rawRows: [['SECRET-CUSTOMER']], normalizedRows: [{ customer: 'SECRET-CUSTOMER' }],
      sheets: [{ name: 'Orders', maxRow: 20, maxColumn: 3, metadata: { headerRow: 2, dataRowCount: 18, sampleValues: ['SECRET-CUSTOMER'] }, fields: [{ sourceName: '客戶', targetKey: 'customer', dataType: 'text', confidence: 0.95, columnIndex: 1, evidence: { examples: ['SECRET-CUSTOMER'] } }] }]
    }];
    const serialized = JSON.stringify(buildSourceContext(input));
    expect(serialized).toContain('客戶');
    expect(serialized).not.toContain('SECRET-CUSTOMER');
    expect(serialized).not.toContain('rawRows');
    expect(serialized).not.toContain('sampleValues');
  });

  it('estimates stable Gemini 2.5 Flash token cost', () => {
    expect(estimateGeminiCostUsd(8_000, 3_000, 1_000)).toBe(0.0124);
  });

  it('blocks operating-system execution', () => {
    const inspection = inspectGeneratedCode({ title: 'x', summary: 'x', assumptions: [], safetyNotes: [], setupSteps: [], tests: [], appsScriptCode: '', vbaCode: 'Sub Run()\nShell("cmd.exe /c whoami")\nEnd Sub' });
    expect(inspection.blocked).toBe(true);
    expect(inspection.warnings.join(' ')).toContain('Shell');
  });

  it('calls Gemini with structured output and parses usage', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-goog-api-key']).toBe('server-only-test-key-1234567890');
      const requestBody = JSON.parse(String(init?.body));
      expect(requestBody.generationConfig.responseMimeType).toBe('application/json');
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: '自動整理', summary: '整理資料', assumptions: [], safetyNotes: [], setupSteps: ['貼入模組'], vbaCode: 'Sub Main()\nEnd Sub', appsScriptCode: '', tests: ['使用副本測試'] }) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const response = await generateGeminiCode({
      config: { GEMINI_API_KEY: 'server-only-test-key-1234567890', GEMINI_MODEL: 'gemini-2.5-flash', GEMINI_MAX_OUTPUT_TOKENS: 8192 },
      target: 'VBA', requirement: '依照表頭將重複資料去除並保留最新一筆', sourceContext: [], fetchImpl: fetchImpl as typeof fetch
    });
    expect(response.result.title).toBe('自動整理');
    expect(response.usage.totalTokens).toBe(150);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
