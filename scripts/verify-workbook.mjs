import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const workbookPath = process.argv[2];
if (!workbookPath) throw new Error('請提供 xlsx 路徑');
const previewDir = process.argv[3] ?? '/tmp/excelmaster-workbook-previews';
await fs.mkdir(previewDir, { recursive: true });

const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const summary = await workbook.inspect({ kind: 'sheet', include: 'id,name', maxChars: 6000 });
const parsed = summary.ndjson.split('\n').filter(Boolean).map((line) => JSON.parse(line));
const sheets = parsed.filter((item) => item.name).map((item) => item.name);
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 300 }, summary: 'final formula error scan' });

for (const sheetName of sheets) {
  const preview = await workbook.render({ sheetName, autoCrop: 'all', scale: 1, format: 'png' });
  await fs.writeFile(path.join(previewDir, `${sheetName.replaceAll('/', '_')}.png`), new Uint8Array(await preview.arrayBuffer()));
}

console.log(JSON.stringify({ workbookPath, sheets, formulaErrors: errors.ndjson, previewDir }));
