import { BrowserWindow, dialog } from 'electron';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExecutionReport, Language } from '@shared/types';
import { AppError } from '../infra/errors';
import { readJson, writeJsonAtomic } from '../infra/jsonStore';
import { dataPath } from '../infra/paths';

const dir = () => dataPath('reports');

export function hashReport(r: Omit<ExecutionReport, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(r)).digest('hex');
}

export function saveReport(r: Omit<ExecutionReport, 'hash'>): ExecutionReport {
  const full: ExecutionReport = { ...r, hash: hashReport(r) };
  writeJsonAtomic(path.join(dir(), `${r.id}.json`), full);
  return full;
}

export function getReport(id: string): ExecutionReport {
  if (!/^[a-f0-9]{16}$/.test(id)) throw new AppError('INVALID_INPUT');
  const r = readJson<ExecutionReport | null>(path.join(dir(), `${id}.json`), null);
  if (!r) throw new AppError('NOT_FOUND');
  return r;
}

export function verifyReport(r: ExecutionReport): boolean {
  const { hash, ...rest } = r;
  return hashReport(rest) === hash;
}

const L = {
  en: {
    title: 'Data Erasure Report',
    wipe: 'Free space wipe',
    shred: 'File shredding',
    id: 'Report ID',
    host: 'Computer',
    os: 'Operating system',
    app: 'Software',
    started: 'Started',
    finished: 'Finished',
    method: 'Method',
    passes: 'Passes',
    volume: 'Volume',
    fs: 'File system',
    media: 'Media',
    freeBefore: 'Free space before',
    written: 'Bytes written per pass',
    metadata: 'Metadata entries',
    trim: 'TRIM',
    status: 'Status',
    files: 'Files',
    bytes: 'Data size',
    failed: 'Failed',
    verify: 'Verification of last pass',
    yes: 'Enabled',
    no: 'Disabled',
    integrity: 'Integrity hash (SHA-256 of the report data)',
    ssdNote: 'Note: on SSDs and flash media, wear-levelling may keep copies of data outside the area that software can overwrite. For complete sanitisation of such devices use the manufacturer’s Secure Erase.',
    disclaimer: 'This report records the operations SecureWipe performed and the values it measured. It is not a third-party certification.',
  },
  vi: {
    title: 'Báo cáo xóa dữ liệu',
    wipe: 'Xóa sạch dung lượng trống',
    shred: 'Hủy tệp tin',
    id: 'Mã báo cáo',
    host: 'Máy tính',
    os: 'Hệ điều hành',
    app: 'Phần mềm',
    started: 'Bắt đầu',
    finished: 'Kết thúc',
    method: 'Phương pháp',
    passes: 'Số lượt ghi',
    volume: 'Phân vùng',
    fs: 'Hệ thống tệp',
    media: 'Loại ổ',
    freeBefore: 'Dung lượng trống ban đầu',
    written: 'Số byte đã ghi mỗi lượt',
    metadata: 'Mục metadata',
    trim: 'TRIM',
    status: 'Trạng thái',
    files: 'Số tệp',
    bytes: 'Dung lượng',
    failed: 'Thất bại',
    verify: 'Kiểm tra lượt ghi cuối',
    yes: 'Bật',
    no: 'Tắt',
    integrity: 'Mã toàn vẹn (SHA-256 của dữ liệu báo cáo)',
    ssdNote: 'Lưu ý: với SSD và bộ nhớ flash, cơ chế cân bằng hao mòn có thể giữ bản sao dữ liệu ở vùng phần mềm không ghi đè được. Để làm sạch hoàn toàn, hãy dùng chức năng Secure Erase của nhà sản xuất.',
    disclaimer: 'Báo cáo này ghi lại các thao tác SecureWipe đã thực hiện và số liệu đo được. Đây không phải chứng nhận của bên thứ ba.',
  },
};

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 2 : 0)} ${u[i]} (${n.toLocaleString('en-US')} B)`;
}

export function reportHtml(r: ExecutionReport, lang: Language): string {
  const t = L[lang];
  const date = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  let body = '';
  if (r.wipe) {
    body = r.wipe
      .map(
        (v) => `<h3>${esc(t.volume)}: ${esc(v.mount)}</h3><table>
      ${row(t.fs, esc(v.fs ?? '—'))}${row(t.media, esc(v.media.toUpperCase()))}${row(t.freeBefore, esc(fmtBytes(v.freeBefore)))}
      ${row(t.written, v.bytesWritten.map((b, i) => `#${i + 1}: ${esc(fmtBytes(b))}`).join('<br>'))}
      ${row(t.metadata, esc(v.metadataEntries.toLocaleString('en-US')))}${row(t.trim, esc(v.trim))}
      ${row(t.status, `<b class="${v.status}">${esc(v.status.toUpperCase())}</b>${v.error ? ` — ${esc(v.error)}` : ''}`)}</table>`,
      )
      .join('');
  } else if (r.shred) {
    body = `<table>${row(t.files, esc(r.shred.files))}${row(t.bytes, esc(fmtBytes(r.shred.bytes)))}${row(t.failed, esc(r.shred.failed))}${row(t.verify, r.shred.verify ? t.yes : t.no)}</table>
      <h3>${esc(t.files)}</h3><ol class="paths">${r.shred.paths.slice(0, 500).map((p) => `<li>${esc(p)}</li>`).join('')}${r.shred.paths.length > 500 ? `<li>… +${r.shred.paths.length - 500}</li>` : ''}</ol>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 18mm 16mm; }
    body { font-family: 'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #0f172a; font-size: 11px; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1d4ed8; padding-bottom: 10px; margin-bottom: 16px; }
    h1 { margin: 0; font-size: 22px; color: #1d4ed8; } h2 { margin: 2px 0 0; font-size: 13px; color: #475569; font-weight: 500; }
    h3 { font-size: 12px; margin: 18px 0 6px; }
    table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    th { width: 34%; color: #475569; font-weight: 600; }
    .completed { color: #15803d; } .cancelled { color: #b45309; } .failed { color: #b91c1c; }
    .hash { font-family: Consolas, monospace; font-size: 10px; word-break: break-all; background: #f1f5f9; padding: 8px; border-radius: 6px; }
    .note { color: #64748b; font-size: 10px; margin-top: 14px; line-height: 1.5; } .paths { font-family: Consolas, monospace; font-size: 9px; color: #334155; }
  </style></head><body>
    <header><div><h1>${esc(t.title)}</h1><h2>${esc(r.type === 'wipe' ? t.wipe : t.shred)}</h2></div><div>SecureWipe ${esc(r.appVersion)}</div></header>
    <table>${row(t.id, esc(r.id))}${row(t.host, esc(r.host))}${row(t.os, esc(r.os))}${row(t.started, esc(date(r.startedAt)))}${row(t.finished, esc(date(r.finishedAt)))}${row(t.method, esc(r.method))}${row(t.passes, esc(r.passes))}</table>
    ${body}
    <h3>${esc(t.integrity)}</h3><div class="hash">${esc(r.hash)}</div>
    <p class="note">${esc(t.ssdNote)}</p><p class="note">${esc(t.disclaimer)}</p>
  </body></html>`;
}

export async function exportReport(win: BrowserWindow | null, id: string, format: 'pdf' | 'json', lang: Language): Promise<string | null> {
  const r = getReport(id);
  const ext = format;
  const opts = { title: L[lang].title, defaultPath: `SecureWipe-Report-${r.id}.${ext}`, filters: [{ name: format.toUpperCase(), extensions: [ext] }] };
  const { filePath, canceled } = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (canceled || !filePath) return null;
  if (format === 'json') {
    fs.writeFileSync(filePath, JSON.stringify(r, null, 2), 'utf8');
    return filePath;
  }
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(reportHtml(r, lang)));
    const pdf = await pdfWin.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
    fs.writeFileSync(filePath, pdf);
  } finally {
    pdfWin.destroy();
  }
  return filePath;
}
