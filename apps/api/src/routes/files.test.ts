import { describe, expect, it } from 'vitest';
import { googleSheetId } from './files.js';

describe('Google Sheets link validation', () => {
  it('extracts an id from an official sharing link', () => {
    expect(googleSheetId('https://docs.google.com/spreadsheets/d/abcDEF_123-xy/edit#gid=0')).toBe('abcDEF_123-xy');
  });

  it('rejects non-Google hosts and misleading paths', () => {
    expect(() => googleSheetId('https://docs.google.com.evil.example/spreadsheets/d/abc/edit')).toThrow();
    expect(() => googleSheetId('https://docs.google.com/document/d/abc/edit')).toThrow();
  });

  it('requires https', () => {
    expect(() => googleSheetId('http://docs.google.com/spreadsheets/d/abc/edit')).toThrow();
  });
});
