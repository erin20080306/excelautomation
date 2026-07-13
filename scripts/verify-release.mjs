import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import unzipper from 'unzipper';

const archivePath = path.resolve(process.argv[2] ?? '');
if (!archivePath.toLowerCase().endsWith('.zip')) throw new Error('用法：node scripts/verify-release.mjs <release.zip>');
const archive = await unzipper.Open.file(archivePath);
const names = archive.files.map((entry) => entry.path.replaceAll('\\', '/'));
const required = ['ExcelMaster/.env.example', 'ExcelMaster/docker-compose.yml', 'ExcelMaster/release-manifest.json', 'ExcelMaster/安裝說明.md'];
for (const name of required) if (!names.includes(name)) throw new Error(`安裝包缺少：${name}`);
for (const name of names) {
  if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`不安全的 ZIP 路徑：${name}`);
  if (/(^|\/)(\.git|node_modules|\.env)(\/|$)/.test(name) && !name.endsWith('/.env.example')) throw new Error(`安裝包含有禁止內容：${name}`);
}

const lowerName = path.basename(archivePath).toLowerCase();
if (lowerName.includes('windows')) {
  for (const name of ['ExcelMaster/installer/Install-ExcelMaster.cmd', 'ExcelMaster/installer/Install-ExcelMaster.ps1']) if (!names.includes(name)) throw new Error(`Windows 安裝包缺少：${name}`);
  if (names.includes('ExcelMaster/installer/Install-ExcelMaster.command')) throw new Error('Windows 安裝包不應包含 macOS 安裝程式');
} else if (lowerName.includes('macos')) {
  if (!names.includes('ExcelMaster/installer/Install-ExcelMaster.command')) throw new Error('macOS 安裝包缺少 .command 安裝程式');
  if (names.includes('ExcelMaster/installer/Install-ExcelMaster.cmd') || names.includes('ExcelMaster/installer/Install-ExcelMaster.ps1')) throw new Error('macOS 安裝包不應包含 Windows 安裝程式');
} else throw new Error('ZIP 檔名必須包含 Windows 或 macOS');

const manifestEntry = archive.files.find((entry) => entry.path.replaceAll('\\', '/') === 'ExcelMaster/release-manifest.json');
const manifest = JSON.parse((await manifestEntry.buffer()).toString('utf8'));
if (manifest.application !== 'ExcelMaster' || manifest.licenseRequired !== true || manifest.manual !== '安裝說明.md') throw new Error('release-manifest.json 內容不完整');
const version = path.basename(archivePath).match(/-(\d+\.\d+\.\d+)-/)?.[1];
if (!version || manifest.version !== version) throw new Error(`manifest 版本 ${manifest.version} 與 ZIP 檔名 ${version ?? '未知'} 不一致`);

const data = await fs.readFile(archivePath);
const digest = crypto.createHash('sha256').update(data).digest('hex');
const sidecarPath = `${archivePath}.sha256`;
try {
  const sidecar = await fs.readFile(sidecarPath, 'utf8');
  if (!sidecar.toLowerCase().includes(digest)) throw new Error('SHA-256 sidecar 與 ZIP 不一致');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
console.log(JSON.stringify({ ok: true, archive: path.basename(archivePath), entries: names.length, sha256: digest }));
