<#
.SYNOPSIS
  Resolve the MSVC link.exe path with a Git-for-Windows POSIX 'link' fallback guard.

.DESCRIPTION
  Implements the §MSVC linker resolution override procedure committed in
    runs/run_20260521_093931_p5_sw_llmwiki_slice2/agreed_contract.json#msvc_linker_resolution_override
  This script must be invoked before any `cargo build` or `npx tauri build`
  inside the llmwiki target tree on Windows hosts where Git-for-Windows is
  present on PATH ahead of the MSVC toolchain.

  Round-2 extension (Phase I): Steps 3.5 and 3.6 added per the Round-1 work
  item recorded in `runs/<run_id>/tool_results/t1_build_linker_resolution.txt`.
    Step 3.5 walks common Visual Studio install roots under
      $env:ProgramFiles(x86)\Microsoft Visual Studio\<sku-or-version>\<edition>\VC\Tools\MSVC\*\bin\Hostx64\x64\link.exe
      $env:ProgramFiles\Microsoft Visual Studio\<sku-or-version>\<edition>\VC\Tools\MSVC\*\bin\Hostx64\x64\link.exe
    Step 3.6 falls back to a hard-coded path from the agreed contract.

.NOTES
  - Side-effect class: read-only + run-local stat. The script does NOT mutate
    the caller's $env:Path; it only emits the resolved directory on stdout and
    writes a record file under scripts/.last-msvc-resolution.txt.
  - Exit codes:
      0  Success. Resolution succeeded (PATH / vswhere / walk / contract-pin).
      2  No MSVC found anywhere. Escalates to stop_condition
         contract_refresh_required per Round-2 evaluator non-blocking observation.
  - The caller is responsible for pre-pending the emitted directory to
    $env:Path for the duration of `npx tauri build`.
  - Portability caveat for Step 3.6: the hard-coded path comes from the
    agreed_contract.json#verified_msvc_path_on_current_host field captured on
    this slice's verified host. Other hosts will have a different path.
    Slice-2 ships with the pin because the host probe gate (SW-1) is known to
    false-positive on Git-for-Windows /usr/bin/link.exe; SW-1.1 tightens the
    gate so future slices can drop the pin.

.EXAMPLE
  $msvcDir = (& .\scripts\resolve-msvc-linker.ps1)
  if ($LASTEXITCODE -ne 0) { throw "MSVC link.exe not resolved." }
  $env:Path = "$msvcDir;$env:Path"
  npx tauri build
#>

[CmdletBinding()]
param(
  [string]$RecordPath
)

$ErrorActionPreference = 'Stop'

# Resolve script-relative default record path when caller did not override.
if (-not $RecordPath) {
  $scriptDir = if ($PSScriptRoot) {
    $PSScriptRoot
  } elseif ($MyInvocation.MyCommand.Path) {
    Split-Path -Parent $MyInvocation.MyCommand.Path
  } else {
    (Get-Location).Path
  }
  $RecordPath = Join-Path -Path $scriptDir -ChildPath ".last-msvc-resolution.txt"
}

function Write-Resolution {
  param(
    [string]$Path,
    [string]$Source
  )
  $line = "$Source`t$Path"
  try {
    $line | Set-Content -Path $RecordPath -Encoding utf8
  } catch {
    Write-Verbose ("Could not write record file: " + $_.Exception.Message)
  }
}

# Step 1: probe PATH for any link.exe
$pathResolved = $null
try {
  $pathResolved = (Get-Command link.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
} catch {
  $pathResolved = $null
}

# Step 2: if resolved path matches a Git-for-Windows POSIX or mingw 'link' prefix, fall through.
$gitPrefixMatch = $false
if ($pathResolved) {
  if ($pathResolved -match '\\Git\\usr\\bin\\' -or $pathResolved -match '\\Git\\mingw64\\bin\\') {
    $gitPrefixMatch = $true
  }
}

if ($pathResolved -and -not $gitPrefixMatch) {
  $dir = Split-Path -Parent $pathResolved
  Write-Resolution -Path $pathResolved -Source 'path'
  Write-Output $dir
  exit 0
}

# Step 3: vswhere fallback
$vswhere = Join-Path -Path ${env:ProgramFiles(x86)} -ChildPath 'Microsoft Visual Studio\Installer\vswhere.exe'
$vswhereResults = $null
if (Test-Path -LiteralPath $vswhere) {
  try {
    $vswhereResults = & $vswhere -find 'VC\Tools\MSVC\*\bin\Hostx64\x64\link.exe' 2>$null
  } catch {
    $vswhereResults = $null
  }
}

$firstHit = $null
if ($vswhereResults) {
  foreach ($candidate in $vswhereResults) {
    $trimmed = ($candidate -as [string]).Trim()
    if ($trimmed -and (Test-Path -LiteralPath $trimmed)) {
      $firstHit = $trimmed
      break
    }
  }
}

if ($firstHit) {
  $dir = Split-Path -Parent $firstHit
  Write-Resolution -Path $firstHit -Source 'vswhere'
  Write-Output $dir
  exit 0
}

# Step 3.5: directory walk under known VS install roots.
# Some Visual Studio installs ship without vswhere indexing (preview builds,
# offline installs, manually-extracted SDKs). Enumerate the canonical install
# patterns directly.
$walkRoots = @(
  ${env:ProgramFiles(x86)},
  ${env:ProgramFiles}
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$walkPatterns = @(
  'Microsoft Visual Studio\*\BuildTools\VC\Tools\MSVC\*\bin\Hostx64\x64\link.exe',
  'Microsoft Visual Studio\*\Community\VC\Tools\MSVC\*\bin\Hostx64\x64\link.exe',
  'Microsoft Visual Studio\*\Professional\VC\Tools\MSVC\*\bin\Hostx64\x64\link.exe',
  'Microsoft Visual Studio\*\Enterprise\VC\Tools\MSVC\*\bin\Hostx64\x64\link.exe',
  'Microsoft Visual Studio\*\Preview\VC\Tools\MSVC\*\bin\Hostx64\x64\link.exe'
)

$walkHit = $null
foreach ($root in $walkRoots) {
  foreach ($pattern in $walkPatterns) {
    $full = Join-Path -Path $root -ChildPath $pattern
    try {
      $matches = Get-ChildItem -Path $full -ErrorAction SilentlyContinue
    } catch {
      $matches = $null
    }
    if ($matches) {
      # Sort by FullName so MSVC versions are picked deterministically (highest
      # version path wins because the version segment is the only varying
      # alphanumeric in the canonical layout).
      $sorted = $matches | Sort-Object -Property FullName -Descending
      foreach ($m in $sorted) {
        if (Test-Path -LiteralPath $m.FullName) {
          $walkHit = $m.FullName
          break
        }
      }
    }
    if ($walkHit) { break }
  }
  if ($walkHit) { break }
}

if ($walkHit) {
  $dir = Split-Path -Parent $walkHit
  Write-Resolution -Path $walkHit -Source 'walk'
  Write-Output $dir
  exit 0
}

# Step 3.6: contract-pinned hard-coded fallback.
# Portability caveat: this path is host-specific (Slice-2 verified host).
# Slice SW-1.1 owns the gate-level fix; Slice 2 ships with the pin so the
# build is not blocked by the upstream gate false-positive.
$contractPin = 'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Tools\MSVC\14.51.36231\bin\Hostx64\x64\link.exe'
if (Test-Path -LiteralPath $contractPin) {
  $dir = Split-Path -Parent $contractPin
  Write-Resolution -Path $contractPin -Source 'contract_pin'
  Write-Output $dir
  exit 0
}

# Step 6: no MSVC anywhere.
Write-Error "MSVC not found; vswhere / walk / contract-pin all empty; escalate to stop_condition contract_refresh_required"
exit 2
