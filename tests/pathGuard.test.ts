import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { configureGuard, isProtected, protectionReason } from '../src/main/safety/pathGuard';

const home = os.homedir();
const win = process.platform === 'win32';

describe('pathGuard', () => {
  it('rejects relative paths and filesystem roots', () => {
    expect(protectionReason('relative/file.txt')).toBe('not-absolute');
    expect(protectionReason(win ? 'C:\\' : '/')).toBe('root');
  });

  it('protects the home folder and its standard folders, but not their contents', () => {
    expect(isProtected(home)).toBe(true);
    expect(isProtected(path.join(home, 'Documents'))).toBe(true);
    expect(isProtected(path.join(home, 'Documents', 'report.docx'))).toBe(false);
    expect(isProtected(path.join(home, 'Downloads', 'big.iso'))).toBe(false);
  });

  it('protects app data and install folders after configuration', () => {
    const dataDir = path.join(os.tmpdir(), 'sw-guard-data');
    configureGuard({ dataDir });
    expect(protectionReason(path.join(dataDir, 'settings.json'))).toBe('app');
    configureGuard({});
  });

  it.runIf(win)('protects Windows system trees entirely', () => {
    const sysRoot = process.env.SystemRoot ?? 'C:\\Windows';
    expect(protectionReason(path.join(sysRoot, 'System32', 'drivers', 'etc', 'hosts'))).toBe('system');
    expect(protectionReason('c:\\windows\\explorer.exe')).toBe('system');
    expect(isProtected(process.env.ProgramFiles ?? 'C:\\Program Files')).toBe(true);
    expect(isProtected(path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'SomeApp'))).toBe(false);
    expect(isProtected(path.join(process.env.LOCALAPPDATA!, 'Temp'))).toBe(true);
    expect(isProtected(path.join(process.env.LOCALAPPDATA!, 'Temp', 'x.tmp'))).toBe(false);
  });

  it.runIf(!win)('protects Unix system trees and mount points', () => {
    expect(protectionReason('/usr/bin/ls')).toBe('system');
    expect(protectionReason('/etc/passwd')).toBe('system');
    expect(protectionReason('/media/user/USB')).toBe('root');
    expect(isProtected('/media/user/USB/file.txt')).toBe(false);
  });
});
