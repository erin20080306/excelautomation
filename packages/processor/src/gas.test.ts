import { describe, expect, it } from 'vitest';
import { gasCompanionScript } from './index.js';

describe('professional GAS report companion', () => {
  it('creates a new spreadsheet with a dashboard, chart and image features', () => {
    const script = gasCompanionScript();
    expect(script).toContain('SpreadsheetApp.create');
    expect(script).toContain('GAS_專業分析');
    expect(script).toContain("newChart().asColumnChart()");
    expect(script).toContain('excelMasterAddReportImage');
    expect(script).toContain('insertImage');
    expect(script).toContain('IMAGE(RC[');
    expect(script).toContain('image_url');
    expect(() => new Function(script)).not.toThrow();
  });
});
