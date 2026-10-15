import { app } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type { Platform, SystemInfo } from '@shared/types';
import { isElevated } from '../elevation/broker';
import { run } from '../infra/exec';
import { getDataDir, isPortable } from '../infra/paths';

let osName: string | null = null;

async function detectOsName(): Promise<string> {
  try {
    if (process.platform === 'win32') {
      const key = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';
      const res = await run('reg.exe', ['query', key]);
      const val = (name: string) => res.stdout.match(new RegExp(`^\\s+${name}\\s+REG_\\w+\\s+(.+)$`, 'm'))?.[1]?.trim();
      let product = val('ProductName') ?? 'Windows';
      const build = Number(val('CurrentBuild') ?? '0');
      // Windows 11 still reports "Windows 10" in ProductName.
      if (build >= 22000) product = product.replace('Windows 10', 'Windows 11');
      const display = val('DisplayVersion');
      return `${product}${display ? ` ${display}` : ''} (build ${build})`;
    }
    if (process.platform === 'darwin') {
      const v = await run('sw_vers', ['-productVersion']);
      return `macOS ${v.stdout.trim()}`;
    }
    const rel = fs.readFileSync('/etc/os-release', 'utf8');
    return rel.match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1] ?? `Linux ${os.release()}`;
  } catch {
    return `${os.type()} ${os.release()}`;
  }
}

export async function getSystemInfo(): Promise<SystemInfo> {
  if (!osName) osName = await detectOsName();
  const cpus = os.cpus();
  return {
    platform: process.platform as Platform,
    arch: os.arch(),
    osName,
    hostname: os.hostname(),
    userName: os.userInfo().username,
    homeDir: os.homedir(),
    cpuModel: cpus[0]?.model.trim().replace(/\s+/g, ' ') ?? 'Unknown',
    cpuCores: cpus.length,
    totalMem: os.totalmem(),
    freeMem: os.freemem(),
    uptimeSec: Math.round(os.uptime()),
    isElevated: isElevated(),
    appVersion: app.getVersion(),
    dataDir: getDataDir(),
    portable: isPortable(),
  };
}

export async function getOsName(): Promise<string> {
  if (!osName) osName = await detectOsName();
  return osName;
}
