import { describe, expect, it } from 'vitest';
import { parseDesktopFile } from '../src/main/services/apps/linuxApps';
import { iconPathFromDisplayIcon, parseCommandLine } from '../src/main/services/apps/windowsApps';
import { parseProfilesIni } from '../src/main/services/browsers';
import { parseRecycleInfo } from '../src/main/services/trash';
import { compareVersions } from '../src/main/services/updates';

describe('parseCommandLine', () => {
  it('handles quoted executables', () => {
    expect(parseCommandLine('"C:\\Program Files\\App\\unins000.exe" /SILENT')).toEqual({ exe: 'C:\\Program Files\\App\\unins000.exe', args: '/SILENT' });
  });
  it('handles unquoted paths with spaces', () => {
    expect(parseCommandLine('C:\\Program Files\\My App\\uninstall.exe --force')).toEqual({ exe: 'C:\\Program Files\\My App\\uninstall.exe', args: '--force' });
  });
  it('handles msiexec', () => {
    expect(parseCommandLine('MsiExec.exe /I{12345678-1234-1234-1234-123456789012}')).toEqual({ exe: 'MsiExec.exe', args: '/I{12345678-1234-1234-1234-123456789012}' });
  });
});

describe('iconPathFromDisplayIcon', () => {
  it('strips quotes and icon index', () => {
    expect(iconPathFromDisplayIcon('"C:\\x\\app.exe",0')).toBe('C:\\x\\app.exe');
    expect(iconPathFromDisplayIcon('C:\\x\\app.ico')).toBe('C:\\x\\app.ico');
  });
});

describe('parseRecycleInfo', () => {
  it('reads Windows 10 $I v2 metadata', () => {
    const p = 'C:\\Users\\me\\Desktop\\notes.txt';
    const buf = Buffer.alloc(28 + (p.length + 1) * 2);
    buf.writeBigInt64LE(2n, 0);
    buf.writeBigInt64LE(1234n, 8);
    const ms = Date.UTC(2026, 0, 2, 3, 4, 5);
    buf.writeBigUInt64LE((BigInt(ms) + 11644473600000n) * 10000n, 16);
    buf.writeInt32LE(p.length + 1, 24);
    buf.write(p, 28, 'utf16le');
    expect(parseRecycleInfo(buf)).toEqual({ size: 1234, deletedAt: ms, originalPath: p });
  });
  it('rejects garbage', () => {
    expect(parseRecycleInfo(Buffer.alloc(10))).toBeNull();
  });
});

describe('parseProfilesIni', () => {
  it('lists relative and absolute Firefox profiles', () => {
    const ini = '[General]\nStartWithLastProfile=1\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/abc.default-release\n\n[Profile1]\nName=work\nIsRelative=0\nPath=D:\\FF\\work\n\n[Install123]\nDefault=Profiles/abc\n';
    expect(parseProfilesIni(ini)).toEqual([
      { name: 'default-release', path: 'Profiles/abc.default-release', relative: true },
      { name: 'work', path: 'D:\\FF\\work', relative: false },
    ]);
  });
});

describe('parseDesktopFile', () => {
  it('reads only the [Desktop Entry] section', () => {
    const d = parseDesktopFile('[Desktop Entry]\nName=Editor\nExec=/usr/bin/editor %F\nNoDisplay=false\n[Desktop Action new]\nName=New Window\n');
    expect(d).toMatchObject({ name: 'Editor', exec: '/usr/bin/editor %F', hidden: false, isApp: true });
  });
});

describe('compareVersions', () => {
  it('orders semantic versions', () => {
    expect(compareVersions('2.1.0', '2.0.9')).toBe(1);
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('1.9', '2.0.0')).toBe(-1);
  });
});
