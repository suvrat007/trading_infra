<#
  Configure + build the engine.

  CMake and the MSVC toolchain ship inside Visual Studio Build Tools and are
  not on PATH, so this script locates them with vswhere rather than hardcoding
  a version. Usage:  .\build.ps1  [-Config Release] [-Clean]
#>
param(
  [ValidateSet('Release', 'Debug', 'RelWithDebInfo')]
  [string]$Config = 'Release',
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$buildDir = Join-Path $root 'build'

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) { throw "vswhere.exe not found - install Visual Studio Build Tools." }

$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) { throw "No Visual Studio install with the C++ toolset was found." }

$cmake = Join-Path $vsPath 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
if (-not (Test-Path $cmake)) { $cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source }
if (-not $cmake) { throw "cmake.exe not found." }

if ($Clean -and (Test-Path $buildDir)) {
  Write-Host "[build] removing $buildDir" -ForegroundColor DarkGray
  Remove-Item $buildDir -Recurse -Force
}

Write-Host "[build] cmake   : $cmake" -ForegroundColor DarkGray
Write-Host "[build] toolset : $vsPath" -ForegroundColor DarkGray
Write-Host "[build] config  : $Config" -ForegroundColor DarkGray

# Multi-config Visual Studio generator: configure once, pick the config at build
# time. Architecture is pinned to x64 so it matches the Node process.
& $cmake -S $root -B $buildDir -G 'Visual Studio 17 2022' -A x64
if ($LASTEXITCODE -ne 0) { throw "cmake configure failed ($LASTEXITCODE)" }

& $cmake --build $buildDir --config $Config --parallel
if ($LASTEXITCODE -ne 0) { throw "cmake build failed ($LASTEXITCODE)" }

$exe = Join-Path $buildDir "bin\$Config\trading_engine.exe"
if (-not (Test-Path $exe)) { $exe = Join-Path $buildDir 'bin\trading_engine.exe' }
Write-Host "[build] ok -> $exe" -ForegroundColor Green
