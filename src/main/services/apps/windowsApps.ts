import * as fs from 'node:fs';
import * as path from 'node:path';
import type { UninstallResult } from '@shared/types';
import { AppError } from '../../infra/errors';
import { runPowerShellJson } from '../../infra/exec';
import { exists } from '../../infra/fsx';
import { newId } from '../../infra/ids';
import { regKeyExists } from '../../safety/regBackup';
import { emitEvent, type TaskContext } from '../../tasks/taskManager';
import type { AppInternal } from './model';

interface RegApp {
  key: string;
  keyName: string;
  scope: 'user' | 'machine';
  name: string;
  publisher: string;
  version: string;
  installDate: string;
  size: number;
  location: string;
  uninstall: string;
  quiet: string;
  icon: string;
  msi: number;
  noRemove: number;
}

interface AppxApp {
  fullName: string;
  family: string;
  name: string;
  displayName: string | null;
  publisher: string | null;
  version: string;
  location: string;
  logo: string | null;
  installDate: string | null;
}

const LIST_SCRIPT = `
$roots = @(
  @{ p = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'; scope = 'machine'; reg = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
  @{ p = 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'; scope = 'machine'; reg = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
  @{ p = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'; scope = 'user'; reg = 'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall' }
)
$reg = @()
foreach ($r in $roots) {
  if (-not (Test-Path $r.p)) { continue }
  foreach ($k in (Get-ChildItem -LiteralPath $r.p -ErrorAction SilentlyContinue)) {
    $v = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
    if (-not $v -or -not $v.DisplayName) { continue }
    if ($v.SystemComponent -eq 1 -or $v.ParentKeyName -or ([string]$v.ReleaseType) -match 'Update|Hotfix') { continue }
    $reg += @{
      key = $r.reg + '\\' + $k.PSChildName; keyName = [string]$k.PSChildName; scope = $r.scope
      name = [string]$v.DisplayName; publisher = [string]$v.Publisher; version = [string]$v.DisplayVersion
      installDate = [string]$v.InstallDate; size = [double]$v.EstimatedSize; location = [string]$v.InstallLocation
      uninstall = [string]$v.UninstallString; quiet = [string]$v.QuietUninstallString; icon = [string]$v.DisplayIcon
      msi = [int]$v.WindowsInstaller; noRemove = [int]$v.NoRemove
    }
  }
}
$appx = @()
try {
  Add-Type -Namespace SecureWipe -Name Shell -MemberDefinition '[DllImport("shlwapi.dll", CharSet=CharSet.Unicode)] public static extern int SHLoadIndirectString(string src, System.Text.StringBuilder outBuf, int cch, System.IntPtr reserved);'
  function Resolve-Res($full, $name, $val) {
    if (-not $val) { return $null }
    if (-not $val.StartsWith('ms-resource:')) { return $val }
    $r = $val.Substring(12)
    if ($r.StartsWith('//')) { $uri = 'ms-resource:' + $r }
    elseif ($r.StartsWith('/')) { $uri = 'ms-resource://' + $name + $r }
    elseif ($r.Contains('/')) { $uri = 'ms-resource://' + $name + '/' + $r }
    else { $uri = 'ms-resource://' + $name + '/resources/' + $r }
    $sb = New-Object System.Text.StringBuilder 1024
    if ([SecureWipe.Shell]::SHLoadIndirectString('@{' + $full + '?' + $uri + '}', $sb, 1024, [IntPtr]::Zero) -eq 0) { return $sb.ToString() }
    return $null
  }
  $pkgs = Get-AppxPackage -ErrorAction Stop | Where-Object { -not $_.IsFramework -and -not $_.NonRemovable -and [string]$_.SignatureKind -ne 'System' -and -not $_.IsResourcePackage }
  foreach ($p in $pkgs) {
    $dn = $null; $pub = $null; $logo = $null
    $manifest = Join-Path $p.InstallLocation 'AppxManifest.xml'
    if (Test-Path -LiteralPath $manifest) {
      try {
        [xml]$m = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8
        $dn = Resolve-Res $p.PackageFullName $p.Name ([string]$m.Package.Properties.DisplayName)
        $pub = Resolve-Res $p.PackageFullName $p.Name ([string]$m.Package.Properties.PublisherDisplayName)
        $lp = [string]$m.Package.Properties.Logo
        if ($lp) {
          $full = Join-Path $p.InstallLocation $lp
          $dir = Split-Path -Parent $full
          $base = [IO.Path]::GetFileNameWithoutExtension($full); $ext = [IO.Path]::GetExtension($full)
          $cand = Get-ChildItem -LiteralPath $dir -Filter ($base + '*' + $ext) -ErrorAction SilentlyContinue | Sort-Object { if ($_.Name -match 'scale-100') { 0 } else { 1 } } | Select-Object -First 1
          if ($cand) { $logo = $cand.FullName }
        }
      } catch {}
    }
    $installed = $null
    try { $installed = (Get-Item -LiteralPath $p.InstallLocation -ErrorAction Stop).CreationTime.ToString('yyyyMMdd') } catch {}
    $appx += @{ fullName = [string]$p.PackageFullName; family = [string]$p.PackageFamilyName; name = [string]$p.Name; displayName = $dn; publisher = $pub; version = [string]$p.Version; location = [string]$p.InstallLocation; logo = $logo; installDate = $installed }
  }
} catch {}
Out-SwJson @{ reg = $reg; appx = $appx }
`;

function isoDate(yyyymmdd: string | null | undefined): string | undefined {
  const m = yyyymmdd?.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/** "C:\x\app.exe",0 → C:\x\app.exe */
export function iconPathFromDisplayIcon(raw: string): string | undefined {
  if (!raw) return undefined;
  let p = raw.trim();
  if (p.startsWith('"')) p = p.slice(1, p.indexOf('"', 1) > 0 ? p.indexOf('"', 1) : undefined);
  p = p.replace(/,\s*-?\d+$/, '').trim();
  p = p.replace(/%([^%]+)%/g, (_, v: string) => process.env[v] ?? `%${v}%`);
  return p || undefined;
}

/** Splits an UninstallString into executable and raw argument string (quoting preserved). */
export function parseCommandLine(cmd: string): { exe: string; args: string } {
  const s = cmd.trim().replace(/%([^%]+)%/g, (_, v: string) => process.env[v] ?? `%${v}%`);
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1);
    if (end > 0) return { exe: s.slice(1, end), args: s.slice(end + 1).trim() };
  }
  const m = s.match(/^(.+?\.(?:exe|cmd|bat|com))(?=\s|$)(.*)$/i);
  if (m) return { exe: m[1].trim(), args: m[2].trim() };
  const sp = s.indexOf(' ');
  return sp < 0 ? { exe: s, args: '' } : { exe: s.slice(0, sp), args: s.slice(sp + 1).trim() };
}

const GUID = /^\{[0-9A-F-]{36}\}$/i;

export async function listWindowsApps(): Promise<AppInternal[]> {
  const data = await runPowerShellJson<{ reg: RegApp[]; appx: AppxApp[] }>(LIST_SCRIPT, { timeoutMs: 120000 });
  const out: AppInternal[] = [];
  const seen = new Set<string>();
  for (const r of data.reg ?? []) {
    const dedupe = `${r.name.toLowerCase()}|${(r.version ?? '').toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const msi = r.msi === 1 && GUID.test(r.keyName);
    const broken = !r.uninstall && !r.quiet && !msi;
    const location = r.location?.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '') || undefined;
    out.push({
      id: newId(),
      name: r.name.trim(),
      publisher: r.publisher?.trim() || undefined,
      version: r.version?.trim() || undefined,
      installDate: isoDate(r.installDate),
      sizeBytes: r.size > 0 ? Math.round(r.size * 1024) : undefined,
      source: 'win32',
      scope: r.scope,
      requiresAdmin: r.scope === 'machine',
      hasQuiet: !!r.quiet || msi,
      broken,
      installLocation: location,
      regKey: r.key,
      regKeyName: r.keyName,
      uninstallString: r.uninstall || undefined,
      quietUninstallString: r.quiet || undefined,
      msi,
      iconPath: iconPathFromDisplayIcon(r.icon),
    });
  }
  for (const a of data.appx ?? []) {
    out.push({
      id: newId(),
      name: a.displayName?.trim() || a.name,
      publisher: a.publisher?.trim() || undefined,
      version: a.version,
      installDate: isoDate(a.installDate),
      source: 'store',
      scope: 'user',
      requiresAdmin: false,
      hasQuiet: true,
      broken: false,
      installLocation: a.location || undefined,
      packageFullName: a.fullName,
      packageName: a.name,
      packageFamily: a.family,
      iconPath: a.logo ?? undefined,
    });
  }
  return out;
}

const RUN_SCRIPT = `
try {
  if ($env:SW_ARGS) { $p = Start-Process -FilePath $env:SW_EXE -ArgumentList $env:SW_ARGS -PassThru -Wait -ErrorAction Stop }
  else { $p = Start-Process -FilePath $env:SW_EXE -PassThru -Wait -ErrorAction Stop }
  Out-SwJson @{ code = $p.ExitCode; error = $null }
} catch { Out-SwJson @{ code = -1; error = $_.Exception.Message } }
`;

function buildCommand(app: AppInternal, quiet: boolean): { exe: string; args: string } {
  if (app.msi && app.regKeyName) {
    return { exe: 'msiexec.exe', args: `/x ${app.regKeyName}${quiet ? ' /qb /norestart' : ''}` };
  }
  const source = quiet && app.quietUninstallString ? app.quietUninstallString : app.uninstallString;
  if (!source) throw new AppError('NOT_FOUND', 'This application has no uninstaller');
  const cmd = parseCommandLine(source);
  if (/(^|\\)msiexec(\.exe)?$/i.test(cmd.exe)) cmd.args = cmd.args.replace(/(^|\s)\/I(?=\{)/i, '$1/X');
  return cmd;
}

async function stillInstalled(app: AppInternal): Promise<boolean> {
  if (app.source === 'store') {
    const res = await runPowerShellJson<{ present: boolean }>(`Out-SwJson @{ present = [bool](Get-AppxPackage -Name $env:SW_NAME -ErrorAction SilentlyContinue) }`, {
      env: { SW_NAME: app.packageName ?? '' },
    }).catch(() => ({ present: false }));
    return res.present;
  }
  if (app.regKey && (await regKeyExists(app.regKey))) return true;
  return false;
}

/**
 * Runs the vendor uninstaller through ShellExecute (so its own UAC manifest works), waits for it and its
 * child processes, then verifies the app is really gone. The renderer can stop waiting via task.signal
 * 'continue' when an uninstaller leaves a helper window open.
 */
export async function uninstallWindowsApp(app: AppInternal, quiet: boolean, ctx: TaskContext): Promise<UninstallResult> {
  if (app.source === 'store') {
    const res = await runPowerShellJson<{ ok: boolean; error?: string }>(
      `try { Remove-AppxPackage -Package $env:SW_PKG -ErrorAction Stop; Out-SwJson @{ ok = $true } } catch { Out-SwJson @{ ok = $false; error = $_.Exception.Message } }`,
      { env: { SW_PKG: app.packageFullName ?? '' }, signal: ctx.signal },
    );
    if (!res.ok) return { status: 'failed', message: res.error };
    return { status: (await stillInstalled(app)) ? 'still-installed' : 'removed' };
  }

  const cmd = buildCommand(app, quiet);
  if (!/^msiexec(\.exe)?$/i.test(cmd.exe) && path.isAbsolute(cmd.exe) && !fs.existsSync(cmd.exe)) {
    return { status: 'failed', message: 'uninstaller-missing' };
  }
  const waitingTimer = setTimeout(() => emitEvent({ kind: 'uninstall-waiting', taskId: ctx.id, appName: app.name }), 4000);
  const runner = runPowerShellJson<{ code: number; error: string | null }>(RUN_SCRIPT, {
    env: { SW_EXE: cmd.exe, SW_ARGS: cmd.args },
  });
  const outcome = await Promise.race([runner.then((r) => ({ kind: 'done' as const, r })), ctx.waitForSignal('continue').then((s) => ({ kind: s }))]);
  clearTimeout(waitingTimer);
  if (outcome.kind === 'cancelled') return { status: 'cancelled' };

  let exitCode: number | undefined;
  if (outcome.kind === 'done') {
    exitCode = outcome.r.code;
    if (outcome.r.error) {
      return /cancel/i.test(outcome.r.error) ? { status: 'cancelled', message: outcome.r.error } : { status: 'failed', message: outcome.r.error };
    }
    // MSI: 1602 = user cancelled, 1605 = not installed anymore.
    if (exitCode === 1602) return { status: 'cancelled', exitCode };
  }
  // Some uninstallers remove their registry entry shortly after exiting.
  for (let i = 0; i < 6; i++) {
    if (!(await stillInstalled(app))) return { status: 'removed', exitCode };
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (app.installLocation && !(await exists(app.installLocation)) && app.regKey) {
    // Files are gone but the vendor forgot its registry entry: treat as removed; the key shows up as a leftover.
    return { status: 'removed', exitCode };
  }
  return { status: 'still-installed', exitCode };
}
