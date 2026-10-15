import { shell } from 'electron';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { OperationResult, StartupItem, StartupSource } from '@shared/types';
import { elevatedSh, elevatedWin, runWinOpAsUser } from '../elevation/broker';
import { AppError, errMessage } from '../infra/errors';
import { run, runPowerShellJson } from '../infra/exec';
import { exists, isMac, isWin, listDir, readText } from '../infra/fsx';
import { addHistory, statusOf } from '../infra/history';
import { newId } from '../infra/ids';
import { readJson, writeJsonAtomic } from '../infra/jsonStore';
import { dataPath } from '../infra/paths';
import { QuarantineBuilder } from '../safety/quarantine';
import { regExport } from '../safety/regBackup';
import { createSession, getItems, getSession } from '../safety/scanSession';
import type { TaskContext } from '../tasks/taskManager';
import { parseDesktopFile } from './apps/linuxApps';

interface StartupInternal extends StartupItem {
  // Windows run keys / startup folders
  regKey?: string;
  valueName?: string;
  approvedKey?: string;
  approvedName?: string;
  file?: string;
  // scheduled task / service
  taskPath?: string;
  taskName?: string;
  serviceName?: string;
  exePath?: string;
  // macOS / Linux
  label?: string;
  plist?: string;
  desktopFile?: string;
  systemDesktopFile?: string;
  unit?: string;
}

const SESSION = 'startup';
const servicesFile = () => dataPath('startup-services.json');

// ---------------- Windows ----------------

interface WinRaw {
  source: StartupSource;
  name: string;
  command: string;
  exe: string;
  publisher: string;
  signature: string;
  enabled: boolean;
  regKey?: string;
  valueName?: string;
  approvedKey?: string;
  approvedName?: string;
  file?: string;
  taskPath?: string;
  taskName?: string;
  serviceName?: string;
}

const WIN_LIST = `
$in = Get-SwInput
$sigCache = @{}
function Get-ExePath([string]$cmd) {
  if (-not $cmd) { return $null }
  $c = [Environment]::ExpandEnvironmentVariables($cmd.Trim())
  if ($c.StartsWith('"')) { $e = $c.IndexOf('"', 1); if ($e -gt 0) { return $c.Substring(1, $e - 1) } }
  if ($c -match '^(.+?\\.(exe|com|bat|cmd))(\\s|$)') { return $Matches[1] }
  return ($c -split '\\s+')[0]
}
function Get-Meta([string]$exe) {
  $pub = ''; $sig = 'unknown'
  if ($exe -and (Test-Path -LiteralPath $exe -PathType Leaf)) {
    if ($sigCache.ContainsKey($exe)) { return $sigCache[$exe] }
    try { $pub = [string](Get-Item -LiteralPath $exe).VersionInfo.CompanyName } catch {}
    $sigCache[$exe] = @($pub.Trim(), $sig)
  }
  return @($pub.Trim(), $sig)
}
function Is-Enabled($approvedPath, $name) {
  try {
    $v = (Get-ItemProperty -LiteralPath $approvedPath -Name $name -ErrorAction Stop).$name
    if ($v -is [byte[]] -and $v.Length -gt 0) { return (($v[0] -band 1) -eq 0) }
  } catch {}
  return $true
}
$items = @()
$approvedBase = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved'
$runs = @(
  @{ src = 'run-user'; ps = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'; reg = 'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'; ap = 'HKCU:\\' + $approvedBase + '\\Run'; apReg = 'HKEY_CURRENT_USER\\' + $approvedBase + '\\Run' },
  @{ src = 'run-machine'; ps = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'; reg = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'; ap = 'HKLM:\\' + $approvedBase + '\\Run'; apReg = 'HKEY_LOCAL_MACHINE\\' + $approvedBase + '\\Run' },
  @{ src = 'run-machine'; ps = 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'; reg = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'; ap = 'HKLM:\\' + $approvedBase + '\\Run32'; apReg = 'HKEY_LOCAL_MACHINE\\' + $approvedBase + '\\Run32' }
)
foreach ($r in $runs) {
  if (-not (Test-Path $r.ps)) { continue }
  $props = Get-ItemProperty -LiteralPath $r.ps -ErrorAction SilentlyContinue
  if (-not $props) { continue }
  foreach ($p in $props.PSObject.Properties) {
    if ($p.Name -like 'PS*') { continue }
    $cmd = [string]$p.Value
    $exe = Get-ExePath $cmd
    $m = Get-Meta $exe
    $items += @{ source = $r.src; name = $p.Name; command = $cmd; exe = $exe; publisher = $m[0]; signature = $m[1]; enabled = (Is-Enabled $r.ap $p.Name); regKey = $r.reg; valueName = $p.Name; approvedKey = $r.apReg; approvedName = $p.Name }
  }
}
$shell = New-Object -ComObject WScript.Shell
$folders = @(
  @{ src = 'folder-user'; dir = [Environment]::GetFolderPath('Startup'); ap = 'HKCU:\\' + $approvedBase + '\\StartupFolder'; apReg = 'HKEY_CURRENT_USER\\' + $approvedBase + '\\StartupFolder' },
  @{ src = 'folder-common'; dir = [Environment]::GetFolderPath('CommonStartup'); ap = 'HKLM:\\' + $approvedBase + '\\StartupFolder'; apReg = 'HKEY_LOCAL_MACHINE\\' + $approvedBase + '\\StartupFolder' }
)
foreach ($f in $folders) {
  if (-not $f.dir -or -not (Test-Path -LiteralPath $f.dir)) { continue }
  foreach ($file in Get-ChildItem -LiteralPath $f.dir -File -ErrorAction SilentlyContinue) {
    if ($file.Name -eq 'desktop.ini') { continue }
    $target = $file.FullName; $cmd = $file.FullName
    if ($file.Extension -eq '.lnk') { try { $l = $shell.CreateShortcut($file.FullName); $target = $l.TargetPath; $cmd = ($l.TargetPath + ' ' + $l.Arguments).Trim() } catch {} }
    $m = Get-Meta $target
    $items += @{ source = $f.src; name = [IO.Path]::GetFileNameWithoutExtension($file.Name); command = $cmd; exe = $target; publisher = $m[0]; signature = $m[1]; enabled = (Is-Enabled $f.ap $file.Name); file = $file.FullName; approvedKey = $f.apReg; approvedName = $file.Name }
  }
}
# Task Scheduler COM API: much faster than Get-ScheduledTask (CIM).
try {
  $ts = New-Object -ComObject Schedule.Service
  $ts.Connect()
  $folders = New-Object System.Collections.Queue
  $folders.Enqueue($ts.GetFolder('\\'))
  while ($folders.Count -gt 0) {
    $f = $folders.Dequeue()
    if ($f.Path -like '\\Microsoft*') { continue }
    foreach ($sub in $f.GetFolders(0)) { $folders.Enqueue($sub) }
    foreach ($t in $f.GetTasks(1)) {
      $def = $t.Definition
      $hasLogon = $false
      foreach ($tr in $def.Triggers) { if ($tr.Type -eq 8 -or $tr.Type -eq 9) { $hasLogon = $true } }
      if (-not $hasLogon) { continue }
      $exe = ''; $cmd = ''
      foreach ($a in $def.Actions) { if ($a.Type -eq 0) { $exe = [Environment]::ExpandEnvironmentVariables(([string]$a.Path).Trim('"')); $cmd = ($exe + ' ' + [string]$a.Arguments).Trim(); break } }
      $m = Get-Meta $exe
      $parent = $f.Path; if (-not $parent.EndsWith('\\')) { $parent = $parent + '\\' }
      $items += @{ source = 'task'; name = [string]$t.Name; command = $cmd; exe = $exe; publisher = $m[0]; signature = $m[1]; enabled = [bool]$t.Enabled; taskPath = $parent; taskName = [string]$t.Name }
    }
  }
} catch {}
$tracked = @($in.services)
$win = $env:windir.ToLower()
foreach ($s in Get-CimInstance Win32_Service -ErrorAction SilentlyContinue) {
  $exe = Get-ExePath ([string]$s.PathName)
  if (-not $exe) { continue }
  $isTracked = $tracked -contains $s.Name
  if (-not $isTracked -and ([string]$s.StartMode -ne 'Auto' -or $exe.ToLower().StartsWith($win))) { continue }
  $m = Get-Meta $exe
  $items += @{ source = 'service'; name = [string]$s.DisplayName; command = [string]$s.PathName; exe = $exe; publisher = $m[0]; signature = $m[1]; enabled = ([string]$s.StartMode -eq 'Auto'); serviceName = [string]$s.Name }
}
Out-SwJson $items
`;

const WIN_SIGS = `
$out = @{}
foreach ($exe in @((Get-SwInput).paths)) {
  $sig = 'unknown'; $signer = ''
  if ($exe -and (Test-Path -LiteralPath $exe -PathType Leaf)) {
    try {
      $s = Get-AuthenticodeSignature -LiteralPath $exe -ErrorAction Stop
      if ($s.Status -eq 'Valid') { $sig = 'valid'; $signer = ($s.SignerCertificate.Subject -replace '^CN="?([^,"]+)"?.*','$1') }
      elseif ($s.Status -eq 'NotSigned') { $sig = 'unsigned' } else { $sig = 'invalid' }
    } catch {}
  }
  $out[$exe] = @{ signature = $sig; signer = $signer }
}
Out-SwJson $out
`;

/** Authenticode checks are slow (catalog lookups), so they run after the list is shown. */
export async function startupSignatures(sessionId: string, ctx: TaskContext): Promise<Record<string, { signature: StartupItem['signature']; publisher?: string }>> {
  if (!isWin) return {};
  const session = getSession<StartupInternal>(sessionId, SESSION);
  const items = [...session.items.values()].filter((i) => i.exePath);
  const paths = [...new Set(items.map((i) => i.exePath!))];
  if (!paths.length) return {};
  const res = await runPowerShellJson<Record<string, { signature: string; signer: string }>>(WIN_SIGS, { input: { paths }, timeoutMs: 180000, signal: ctx.signal });
  const out: Record<string, { signature: StartupItem['signature']; publisher?: string }> = {};
  for (const i of items) {
    const r = res[i.exePath!];
    if (!r) continue;
    i.signature = (['valid', 'invalid', 'unsigned'].includes(r.signature) ? r.signature : 'unknown') as StartupItem['signature'];
    if (!i.publisher && r.signer) i.publisher = r.signer;
    out[i.id] = { signature: i.signature, publisher: i.publisher };
  }
  return out;
}

async function listWindows(): Promise<StartupInternal[]> {
  const tracked = readJson<string[]>(servicesFile(), []);
  const raw = await runPowerShellJson<WinRaw[]>(WIN_LIST, { input: { services: tracked }, timeoutMs: 120000 });
  return raw.map((r) => {
    const machine = r.source === 'run-machine' || r.source === 'folder-common' || r.source === 'service';
    return {
      id: newId(),
      name: r.name,
      command: r.command,
      publisher: r.publisher || undefined,
      signature: (['valid', 'invalid', 'unsigned'].includes(r.signature) ? r.signature : 'unknown') as StartupItem['signature'],
      source: r.source,
      enabled: r.enabled,
      canToggle: true,
      canRemove: r.source.startsWith('run-') || r.source.startsWith('folder-'),
      requiresAdmin: machine,
      location: r.regKey ?? r.file ?? (r.taskPath ? `${r.taskPath}${r.taskName}` : r.serviceName ?? ''),
      regKey: r.regKey,
      valueName: r.valueName,
      approvedKey: r.approvedKey,
      approvedName: r.approvedName,
      file: r.file,
      taskPath: r.taskPath,
      taskName: r.taskName,
      serviceName: r.serviceName,
      exePath: r.exe || undefined,
    };
  });
}

async function toggleWindows(item: StartupInternal, enabled: boolean): Promise<void> {
  switch (item.source) {
    case 'run-user':
    case 'folder-user':
      await runWinOpAsUser('setStartupApproved', { key: item.approvedKey, name: item.approvedName, enabled });
      return;
    case 'run-machine':
    case 'folder-common':
      await elevatedWin('setStartupApproved', { key: item.approvedKey, name: item.approvedName, enabled });
      return;
    case 'task':
      try {
        await runWinOpAsUser('taskToggle', { path: item.taskPath, name: item.taskName, enabled });
      } catch {
        await elevatedWin('taskToggle', { path: item.taskPath, name: item.taskName, enabled });
      }
      return;
    case 'service': {
      await elevatedWin('serviceStartType', { name: item.serviceName, startType: enabled ? 'Automatic' : 'Manual' });
      const tracked = new Set(readJson<string[]>(servicesFile(), []));
      if (enabled) tracked.delete(item.serviceName!);
      else tracked.add(item.serviceName!);
      writeJsonAtomic(servicesFile(), [...tracked]);
      return;
    }
    default:
      throw new AppError('NOT_SUPPORTED');
  }
}

async function removeWindows(items: StartupInternal[], q: QuarantineBuilder): Promise<OperationResult> {
  const res: OperationResult = { succeeded: 0, failed: 0, bytes: 0, errors: [] };
  for (const item of items) {
    try {
      if (item.source === 'run-user') {
        const file = q.registryBackupPath();
        if (!(await regExport(item.regKey!, file))) throw new Error('Registry backup failed');
        const del = await run('reg.exe', ['delete', item.regKey!, '/v', item.valueName!, '/f']);
        if (del.code !== 0) throw new Error(del.stderr.trim() || 'Delete failed');
        q.registerRegistryBackup(item.regKey!, file, false);
      } else if (item.source === 'run-machine') {
        const file = q.registryBackupPath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await elevatedWin('regDeleteValue', { key: item.regKey, name: item.valueName, backup: file });
        q.registerRegistryBackup(item.regKey!, file, true);
      } else if (item.file) {
        const r = await q.addPaths([{ path: item.file, bytes: 0 }], item.source === 'folder-common');
        if (r.failed.length) throw new Error(r.failed[0].message);
      } else throw new AppError('NOT_SUPPORTED');
      res.succeeded++;
    } catch (err) {
      res.failed++;
      res.errors.push({ path: item.name, message: errMessage(err) });
    }
  }
  return res;
}

// ---------------- macOS ----------------

async function plistJson(file: string): Promise<Record<string, unknown> | null> {
  const r = await run('plutil', ['-convert', 'json', '-o', '-', file]).catch(() => null);
  if (!r || r.code !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

async function launchdDisabled(domain: string): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  const r = await run('launchctl', ['print-disabled', domain]).catch(() => null);
  for (const line of r?.stdout.split('\n') ?? []) {
    const m = line.match(/"([^"]+)"\s*=>\s*(\w+)/);
    if (m) map.set(m[1], m[2] === 'true' || m[2] === 'disabled');
  }
  return map;
}

async function listMac(): Promise<StartupInternal[]> {
  const uid = process.getuid?.() ?? 501;
  const gui = await launchdDisabled(`gui/${uid}`);
  const sys = await launchdDisabled('system');
  const out: StartupInternal[] = [];
  const dirs: [string, StartupSource][] = [
    [path.join(os.homedir(), 'Library', 'LaunchAgents'), 'launch-agent-user'],
    ['/Library/LaunchAgents', 'launch-agent-system'],
    ['/Library/LaunchDaemons', 'launch-daemon'],
  ];
  for (const [dir, source] of dirs) {
    for (const e of await listDir(dir)) {
      if (!e.name.endsWith('.plist')) continue;
      const file = path.join(dir, e.name);
      const pl = await plistJson(file);
      if (!pl) continue;
      const label = String(pl.Label ?? e.name.replace(/\.plist$/, ''));
      if (label.startsWith('com.apple.')) continue;
      const args = Array.isArray(pl.ProgramArguments) ? (pl.ProgramArguments as string[]) : pl.Program ? [String(pl.Program)] : [];
      const disabledMap = source === 'launch-daemon' ? sys : gui;
      const disabled = disabledMap.get(label) ?? pl.Disabled === true;
      out.push({
        id: newId(),
        name: label,
        command: args.join(' '),
        signature: 'unknown',
        source,
        enabled: !disabled,
        canToggle: true,
        canRemove: source === 'launch-agent-user',
        requiresAdmin: source === 'launch-daemon',
        location: file,
        label,
        plist: file,
      });
    }
  }
  const li = await run('osascript', ['-e', 'tell application "System Events" to get the {name, path} of every login item']).catch(() => null);
  if (li?.code === 0) {
    const parts = li.stdout.trim().split(', ');
    const half = Math.floor(parts.length / 2);
    for (let i = 0; i < half; i++) {
      out.push({ id: newId(), name: parts[i], command: parts[half + i] ?? '', signature: 'unknown', source: 'login-item', enabled: true, canToggle: false, canRemove: true, requiresAdmin: false, location: parts[half + i] ?? '', label: parts[i] });
    }
  }
  return out;
}

async function toggleMac(item: StartupInternal, enabled: boolean): Promise<void> {
  const uid = process.getuid?.() ?? 501;
  if (item.source === 'launch-daemon') {
    await elevatedSh('launchd', [enabled ? 'enable' : 'disable', item.label!, item.plist!], 'SecureWipe needs administrator rights to change a system service.');
    return;
  }
  const domain = `gui/${uid}`;
  if (enabled) {
    await run('launchctl', ['enable', `${domain}/${item.label}`]);
    await run('launchctl', ['bootstrap', domain, item.plist!]).catch(() => null);
  } else {
    await run('launchctl', ['disable', `${domain}/${item.label}`]);
    await run('launchctl', ['bootout', domain, item.plist!]).catch(() => null);
  }
}

// ---------------- Linux ----------------

const OVERRIDE_MARK = 'X-SecureWipe-Override=true';

function setDesktopKey(text: string, key: string, value: string): string {
  const lines = text.split(/\r?\n/);
  let inEntry = false;
  let entryEnd = -1;
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('[')) {
      if (inEntry && entryEnd < 0) entryEnd = i;
      inEntry = l === '[Desktop Entry]';
      continue;
    }
    if (inEntry && l.startsWith(`${key}=`)) {
      lines[i] = `${key}=${value}`;
      replaced = true;
    }
  }
  if (!replaced) {
    const at = entryEnd < 0 ? lines.length : entryEnd;
    lines.splice(at, 0, `${key}=${value}`);
  }
  return lines.join('\n');
}

function desktopEnabled(text: string): boolean {
  return !/^Hidden\s*=\s*true/m.test(text) && !/^X-GNOME-Autostart-enabled\s*=\s*false/m.test(text);
}

async function listLinux(): Promise<StartupInternal[]> {
  const config = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  const userDir = path.join(config, 'autostart');
  const out: StartupInternal[] = [];
  const userNames = new Set<string>();
  for (const e of await listDir(userDir)) {
    if (!e.name.endsWith('.desktop')) continue;
    const file = path.join(userDir, e.name);
    const text = (await readText(file)) ?? '';
    const d = parseDesktopFile(text);
    userNames.add(e.name);
    const sysFile = path.join('/etc/xdg/autostart', e.name);
    const isOverride = text.includes(OVERRIDE_MARK) || (await exists(sysFile));
    out.push({
      id: newId(),
      name: d.name ?? e.name,
      command: d.exec ?? '',
      signature: 'unknown',
      source: isOverride ? 'xdg-system' : 'xdg-user',
      enabled: desktopEnabled(text),
      canToggle: true,
      canRemove: !isOverride,
      requiresAdmin: false,
      location: file,
      desktopFile: file,
      systemDesktopFile: isOverride ? sysFile : undefined,
    });
  }
  for (const e of await listDir('/etc/xdg/autostart')) {
    if (!e.name.endsWith('.desktop') || userNames.has(e.name)) continue;
    const file = path.join('/etc/xdg/autostart', e.name);
    const text = (await readText(file)) ?? '';
    const d = parseDesktopFile(text);
    if (/^OnlyShowIn=/m.test(text) && !new RegExp(`OnlyShowIn=.*${process.env.XDG_CURRENT_DESKTOP?.split(':')[0] ?? '___'}`, 'm').test(text)) continue;
    out.push({
      id: newId(),
      name: d.name ?? e.name,
      command: d.exec ?? '',
      signature: 'unknown',
      source: 'xdg-system',
      enabled: desktopEnabled(text),
      canToggle: true,
      canRemove: false,
      requiresAdmin: false,
      location: file,
      desktopFile: path.join(userDir, e.name),
      systemDesktopFile: file,
    });
  }
  const unitDir = path.join(config, 'systemd', 'user');
  for (const e of await listDir(unitDir)) {
    if (!e.name.endsWith('.service') || !e.isFile()) continue;
    const st = await run('systemctl', ['--user', 'is-enabled', e.name]).catch(() => null);
    const state = st?.stdout.trim() ?? '';
    if (state !== 'enabled' && state !== 'disabled') continue;
    const text = (await readText(path.join(unitDir, e.name))) ?? '';
    out.push({
      id: newId(),
      name: e.name.replace(/\.service$/, ''),
      command: text.match(/^ExecStart=(.*)$/m)?.[1] ?? '',
      signature: 'unknown',
      source: 'systemd-user',
      enabled: state === 'enabled',
      canToggle: true,
      canRemove: false,
      requiresAdmin: false,
      location: path.join(unitDir, e.name),
      unit: e.name,
    });
  }
  return out;
}

async function toggleLinux(item: StartupInternal, enabled: boolean): Promise<void> {
  if (item.source === 'systemd-user') {
    const r = await run('systemctl', ['--user', enabled ? 'enable' : 'disable', item.unit!]);
    if (r.code !== 0) throw new Error(r.stderr.trim());
    return;
  }
  const userFile = item.desktopFile!;
  if (item.systemDesktopFile) {
    const current = (await readText(userFile)) ?? '';
    if (enabled && current.includes(OVERRIDE_MARK)) {
      await fsp.rm(userFile, { force: true });
      return;
    }
    const base = current || ((await readText(item.systemDesktopFile)) ?? '');
    let next = setDesktopKey(base, 'Hidden', enabled ? 'false' : 'true');
    if (!current) next = setDesktopKey(next, OVERRIDE_MARK.split('=')[0], 'true');
    await fsp.mkdir(path.dirname(userFile), { recursive: true });
    await fsp.writeFile(userFile, next);
    return;
  }
  const text = (await readText(userFile)) ?? '';
  let next = setDesktopKey(text, 'Hidden', enabled ? 'false' : 'true');
  if (enabled) next = setDesktopKey(next, 'X-GNOME-Autostart-enabled', 'true');
  await fsp.writeFile(userFile, next);
}

// ---------------- shared ----------------

export async function listStartup(): Promise<{ sessionId: string; items: StartupItem[] }> {
  const items = isWin ? await listWindows() : isMac ? await listMac() : await listLinux();
  items.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  const session = createSession<StartupInternal>(SESSION, items.map((i) => [i.id, i]));
  return { sessionId: session.id, items: items.map(toPublic) };
}

function toPublic(i: StartupInternal): StartupItem {
  return {
    id: i.id,
    name: i.name,
    command: i.command,
    publisher: i.publisher,
    signature: i.signature,
    source: i.source,
    enabled: i.enabled,
    canToggle: i.canToggle,
    canRemove: i.canRemove,
    requiresAdmin: i.requiresAdmin,
    location: i.location,
  };
}

export async function toggleStartup(sessionId: string, itemId: string, enabled: boolean): Promise<StartupItem> {
  const session = getSession<StartupInternal>(sessionId, SESSION);
  const [item] = getItems(session, [itemId]);
  if (!item.canToggle) throw new AppError('NOT_SUPPORTED');
  if (isWin) await toggleWindows(item, enabled);
  else if (isMac) await toggleMac(item, enabled);
  else await toggleLinux(item, enabled);
  item.enabled = enabled;
  addHistory({ module: 'startup', action: enabled ? 'enable' : 'disable', items: 1, bytes: 0, status: 'success', detail: item.name });
  return toPublic(item);
}

export async function removeStartup(sessionId: string, itemIds: string[]): Promise<OperationResult> {
  const session = getSession<StartupInternal>(sessionId, SESSION);
  const items = getItems(session, itemIds).filter((i) => i.canRemove);
  const q = new QuarantineBuilder('Startup');
  let res: OperationResult;
  if (isWin) res = await removeWindows(items, q);
  else {
    res = { succeeded: 0, failed: 0, bytes: 0, errors: [] };
    for (const item of items) {
      try {
        if (item.source === 'login-item') {
          const r = await run('osascript', ['-e', `tell application "System Events" to delete login item "${item.label!.replace(/"/g, '')}"`]);
          if (r.code !== 0) throw new Error(r.stderr.trim());
        } else {
          if (item.source === 'launch-agent-user') await toggleMac(item, false).catch(() => undefined);
          const file = item.plist ?? item.desktopFile!;
          const r = await q.addPaths([{ path: file, bytes: 0 }], false);
          if (r.failed.length) throw new Error(r.failed[0].message);
        }
        res.succeeded++;
      } catch (err) {
        res.failed++;
        res.errors.push({ path: item.name, message: errMessage(err) });
      }
    }
  }
  q.finalize();
  for (const item of items) if (!res.errors.some((e) => e.path === item.name)) session.items.delete(item.id);
  addHistory({ module: 'startup', action: 'remove', items: res.succeeded, bytes: 0, status: statusOf(res.succeeded, res.failed) });
  return res;
}

export async function revealStartup(sessionId: string, itemId: string): Promise<void> {
  const session = getSession<StartupInternal>(sessionId, SESSION);
  const [item] = getItems(session, [itemId]);
  const target = item.file ?? item.plist ?? item.desktopFile ?? item.location;
  if (target && (await exists(target))) shell.showItemInFolder(target);
}
