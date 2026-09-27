# f1sim - local setup and build for Windows.
#
#   .\setup.ps1              build Release, run tests, install Python packages
#   .\setup.ps1 -Models      also regenerate the car models with Blender
#   .\setup.ps1 -Run         start the game after building
#   .\setup.ps1 -SkipPython  do not touch Python packages
#
# Needs: Visual Studio 2022/2026 with "Desktop development with C++" (brings CMake),
# Python 3 (optional, for data scripts), Blender 4.2+ (optional, for -Models).
param(
    [switch]$Models,
    [switch]$Run,
    [switch]$SkipPython,
    [string]$Config = "Release"
)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Write-Step([string]$text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Write-Warn([string]$text) { Write-Host "    ! $text" -ForegroundColor Yellow }

function Find-CMake {
    $cmd = Get-Command cmake -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    if (-not ${env:ProgramFiles(x86)}) { return $null }
    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if ($vs) {
            $candidate = Join-Path $vs "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
            if (Test-Path $candidate) { return $candidate }
        }
    }
    return $null
}

function Find-Python {
    foreach ($name in @("py", "python")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source -notlike "*WindowsApps*") { return $cmd.Source }
    }
    return $null
}

function Find-Blender {
    $cmd = Get-Command blender -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    if (-not $env:ProgramFiles) { return $null }
    $root = Join-Path $env:ProgramFiles "Blender Foundation"
    if (Test-Path $root) {
        $exe = Get-ChildItem -Path $root -Recurse -Filter blender.exe -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1
        if ($exe) { return $exe.FullName }
    }
    return $null
}

Write-Step "Checking tools"
$cmake = Find-CMake
if (-not $cmake) {
    Write-Host "CMake / Visual Studio C++ tools not found." -ForegroundColor Red
    Write-Host "Install Visual Studio with the workload 'Desktop development with C++' and run this again."
    exit 1
}
Write-Host "    CMake:   $cmake"
$python = Find-Python
if ($python) { Write-Host "    Python:  $python" } else { Write-Warn "Python not found (only needed for data scripts)" }
$blender = Find-Blender
if ($blender) { Write-Host "    Blender: $blender" } else { Write-Warn "Blender not found (only needed for -Models)" }

if ($Models) {
    if (-not $blender) { Write-Host "Blender is required for -Models." -ForegroundColor Red; exit 1 }
    foreach ($car in @("2025", "2026")) {
        Write-Step "Generating the $car car model in Blender"
        & $blender -b -P scripts\blender\build_car.py -- --car $car --out data\models --blend-dir art\blender
        if ($LASTEXITCODE -ne 0) { Write-Host "Model generation failed." -ForegroundColor Red; exit 1 }
    }
}

Write-Step "Configuring (first run downloads SDL3, takes a few minutes)"
& $cmake -S . -B build -A x64
if ($LASTEXITCODE -ne 0) { Write-Host "Configure failed." -ForegroundColor Red; exit 1 }

Write-Step "Building ($Config)"
& $cmake --build build --config $Config --parallel
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed." -ForegroundColor Red; exit 1 }

Write-Step "Running the regression tests"
& ".\build\$Config\f1sim_tests.exe"
if ($LASTEXITCODE -ne 0) { Write-Host "Tests failed - see the output above." -ForegroundColor Red; exit 1 }

if ($python -and -not $SkipPython) {
    Write-Step "Installing Python packages for the data scripts"
    & $python -m pip install --user -r scripts\requirements.txt
    if ($LASTEXITCODE -ne 0) { Write-Warn "pip failed - the game still works, only the data scripts need these packages" }
}

$exe = Join-Path $PSScriptRoot "build\$Config\f1sim.exe"
Write-Host "`nDone. Game: $exe" -ForegroundColor Green
Write-Host "Benchmark: .\build\$Config\f1sim_bench.exe data\cars\f1_2025_generic.ini data\tracks\red_bull_ring.csv"
if ($Run) { Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) }
