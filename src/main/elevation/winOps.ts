// Fixed PowerShell bodies for elevated jobs. Each body reads its parameters from $In (parsed input.json)
// and reports through Progress / Result. Never interpolate values into these strings.

export const WIN_JOB_PRELUDE = `param([string]$Dir)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$Out = Join-Path $Dir 'out.jsonl'
$In = Get-Content -LiteralPath (Join-Path $Dir 'input.json') -Raw -Encoding UTF8 | ConvertFrom-Json
function Emit($o) { [System.IO.File]::AppendAllText($Out, (ConvertTo-Json -InputObject $o -Compress -Depth 8) + [Environment]::NewLine) }
function Progress($done, $total, $current) { Emit @{ type = 'progress'; done = $done; total = $total; current = $current } }
function Result($data) { Emit @{ type = 'result'; data = $data } }
function Cancelled { Test-Path -LiteralPath (Join-Path $Dir 'cancel.flag') }
`;

export const winOps = {
  /** Delete files (older than minAgeHours) inside fixed system junk folders. */
  deleteContents: `
$cutoff = (Get-Date).AddHours(-[double]$In.minAgeHours)
$deleted = 0; $failed = 0; $bytes = 0; $i = 0
$targets = @($In.paths)
foreach ($t in $targets) {
  $i++
  Progress $i $targets.Count $t
  if (-not (Test-Path -LiteralPath $t)) { continue }
  Get-ChildItem -LiteralPath $t -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object {
    if (Cancelled) { return }
    $len = $_.Length
    try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop; $deleted++; $bytes += $len } catch { $failed++ }
  }
  Get-ChildItem -LiteralPath $t -Recurse -Force -Directory -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending | ForEach-Object {
    if (-not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
      Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
    }
  }
}
Result @{ deleted = $deleted; failed = $failed; bytes = $bytes }
`,

  /** Move items (quarantine). Falls back to copy+delete across volumes. */
  movePaths: `
$results = @(); $i = 0
$items = @($In.items)
foreach ($it in $items) {
  $i++
  Progress $i $items.Count $it.src
  $ok = $false; $err = $null
  try {
    $parent = Split-Path -Parent $it.dst
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    try { Move-Item -LiteralPath $it.src -Destination $it.dst -Force -ErrorAction Stop }
    catch {
      Copy-Item -LiteralPath $it.src -Destination $it.dst -Recurse -Force -ErrorAction Stop
      Remove-Item -LiteralPath $it.src -Recurse -Force -ErrorAction Stop
    }
    $ok = $true
  } catch { $err = $_.Exception.Message }
  $results += @{ src = $it.src; ok = $ok; error = $err }
}
Result $results
`,

  /** Remove items recursively (used to purge quarantine entries holding admin-owned files). */
  removePaths: `
$ok = 0; $failed = 0
foreach ($p in @($In.paths)) {
  try { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop; $ok++ } catch { $failed++ }
}
Result @{ ok = $ok; failed = $failed }
`,

  /** Export registry keys to .reg files then delete them. */
  regExportDelete: `
$results = @()
foreach ($it in @($In.items)) {
  $ok = $false; $err = $null
  & reg.exe export $it.key $it.file /y 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    & reg.exe delete $it.key /f 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $ok = $true } else { $err = 'delete failed' }
  } else { $err = 'export failed' }
  $results += @{ key = $it.key; ok = $ok; error = $err }
}
Result $results
`,

  /** Export a registry key (backup) then delete one value from it. */
  regDeleteValue: `
& reg.exe export $In.key $In.backup /y 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Registry backup failed' }
Remove-ItemProperty -LiteralPath ('Registry::' + $In.key) -Name $In.name -Force -ErrorAction Stop
Result @{ ok = $true }
`,

  regImport: `
$ok = 0; $failed = 0
foreach ($f in @($In.files)) { & reg.exe import $f 2>&1 | Out-Null; if ($LASTEXITCODE -eq 0) { $ok++ } else { $failed++ } }
Result @{ ok = $ok; failed = $failed }
`,

  /** Same format Task Manager uses: first byte 02 = enabled, 03 = disabled, followed by 11 bytes. */
  setStartupApproved: `
$path = 'Registry::' + $In.key
if (-not (Test-Path -LiteralPath $path)) { New-Item -Path $path -Force | Out-Null }
$bytes = New-Object byte[] 12
if ($In.enabled) { $bytes[0] = 2 } else {
  $bytes[0] = 3
  $ft = [BitConverter]::GetBytes((Get-Date).ToFileTimeUtc())
  [Array]::Copy($ft, 0, $bytes, 4, 8)
}
New-ItemProperty -LiteralPath $path -Name $In.name -PropertyType Binary -Value $bytes -Force | Out-Null
Result @{ ok = $true }
`,

  taskToggle: `
if ($In.enabled) { Enable-ScheduledTask -TaskPath $In.path -TaskName $In.name -ErrorAction Stop | Out-Null }
else { Disable-ScheduledTask -TaskPath $In.path -TaskName $In.name -ErrorAction Stop | Out-Null }
Result @{ ok = $true }
`,

  serviceStartType: `
Set-Service -Name $In.name -StartupType $In.startType -ErrorAction Stop
Result @{ ok = $true }
`,

  trim: `
$results = @()
foreach ($l in @($In.letters)) {
  try { Optimize-Volume -DriveLetter $l -ReTrim -ErrorAction Stop; $results += @{ letter = $l; ok = $true } }
  catch { $results += @{ letter = $l; ok = $false; error = $_.Exception.Message } }
}
Result $results
`,

  restoreList: `
$list = @(Get-ComputerRestorePoint -ErrorAction SilentlyContinue | ForEach-Object {
  @{ seq = [int]$_.SequenceNumber; description = [string]$_.Description; created = $_.ConvertToDateTime($_.CreationTime).ToUniversalTime().ToString('o'); type = [int]$_.RestorePointType }
})
Result $list
`,

  restoreCreate: `
$before = @(Get-ComputerRestorePoint -ErrorAction SilentlyContinue).Count
try { Enable-ComputerRestore -Drive ($env:SystemDrive + '\\') -ErrorAction SilentlyContinue } catch {}
Checkpoint-Computer -Description $In.description -RestorePointType 'MODIFY_SETTINGS' -WarningAction SilentlyContinue -ErrorAction Stop
$after = @(Get-ComputerRestorePoint -ErrorAction SilentlyContinue).Count
Result @{ created = ($after -gt $before) }
`,

  restoreDelete: `
Add-Type -Namespace SecureWipe -Name SR -MemberDefinition '[DllImport("srclient.dll")] public static extern int SRRemoveRestorePoint(int index);'
$ok = 0; $failed = 0
foreach ($s in @($In.seqs)) { if ([SecureWipe.SR]::SRRemoveRestorePoint([int]$s) -eq 0) { $ok++ } else { $failed++ } }
Result @{ ok = $ok; failed = $failed }
`,

  /** powercfg hibernation switches (mode is validated by the caller). */
  hibernate: `
$pcArgs = switch ([string]$In.mode) { 'off' { @('/hibernate', 'off') } 'on' { @('/hibernate', 'on') } 'reduced' { @('/h', '/type', 'reduced') } 'full' { @('/h', '/type', 'full') } default { throw 'invalid mode' } }
$out = & powercfg.exe @pcArgs 2>&1 | Out-String
Result @{ code = $LASTEXITCODE; output = $out.Trim() }
`,

  smartDetail: `
$list = @(Get-CimInstance -Namespace 'root/Microsoft/Windows/Storage' -ClassName MSFT_PhysicalDisk | ForEach-Object {
  $c = Get-CimAssociatedInstance -InputObject $_ -ResultClassName MSFT_StorageReliabilityCounter -ErrorAction SilentlyContinue | Select-Object -First 1
  @{
    deviceId = [string]$_.DeviceId; model = [string]$_.FriendlyName; serial = ([string]$_.SerialNumber).Trim()
    media = [string]$_.MediaType; bus = [string]$_.BusType; size = [double]$_.Size; health = [string]$_.HealthStatus
    temperature = $c.Temperature; powerOnHours = $c.PowerOnHours; wear = $c.Wear
    readErrors = $c.ReadErrorsUncorrected; writeErrors = $c.WriteErrorsUncorrected
  }
})
Result $list
`,
} as const;

export type WinOp = keyof typeof winOps;
