# Opens the built .twbx in Tableau Desktop and reports whether a workbook window
# actually appeared.
#
# This is the definitive test of "does it open" and it cannot be faked by any
# amount of XML inspection. The COM automation route is unavailable until
# Tableau Desktop has been launched at least once (that is when it registers
# Tableau.Application), so this drives the application directly instead.
#
# The window is deliberately left OPEN so the result can be inspected by eye.

param(
    [string]$Twbx = "C:\Users\User\Documents\Tableau-DataApp-Superstore\build\Superstore Executive.twbx",
    [int]$TimeoutSeconds = 150
)

$ErrorActionPreference = "Continue"

if (-not (Test-Path -LiteralPath $Twbx)) {
    Write-Output "FATAL: not found: $Twbx"
    exit 2
}

$exe = "C:\Program Files\Tableau\Tableau 2026.3\bin\tableau.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    $cand = Get-ChildItem "C:\Program Files\Tableau\Tableau 20*\bin\tableau.exe" -ErrorAction SilentlyContinue |
            Sort-Object FullName | Select-Object -Last 1
    if ($cand) { $exe = $cand.FullName }
}
if (-not (Test-Path -LiteralPath $exe)) {
    Write-Output "SKIP: Tableau Desktop not found"
    exit 3
}

Write-Output "exe    : $exe"
Write-Output "twbx   : $Twbx"
Write-Output "size   : {0:N0} KB" -f ((Get-Item -LiteralPath $Twbx).Length / 1KB)

$before = @(Get-Process -Name tableau -ErrorAction SilentlyContinue)
Write-Output "running before: $($before.Count)"

Write-Output "launching..."
Start-Process -FilePath $exe -ArgumentList "`"$Twbx`""
Start-Sleep -Seconds 5

# Wait for a top-level window whose title mentions the workbook. Tableau's
# startup window says "Tableau" and gains the workbook name once loaded.
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$title = $null
$matched = $false
while ((Get-Date) -lt $deadline) {
    $procs = @(Get-Process -Name tableau -ErrorAction SilentlyContinue |
               Where-Object { $_.MainWindowTitle -ne "" })
    foreach ($p in $procs) {
        $title = $p.MainWindowTitle
        if ($title -match "Superstore") { $matched = $true; break }
    }
    if ($matched) { break }
    Start-Sleep -Seconds 3
}

Write-Output ""
if ($matched) {
    Write-Output "RESULT: OPENED"
    Write-Output "window : $title"
    exit 0
}

$final = @(Get-Process -Name tableau -ErrorAction SilentlyContinue |
           Where-Object { $_.MainWindowTitle -ne "" })
Write-Output "RESULT: NO WORKBOOK WINDOW"
Write-Output "processes: $($final.Count)"
foreach ($p in $final) { Write-Output "  title: $($p.MainWindowTitle)" }
if ($final.Count -eq 0) {
    Write-Output "  (Tableau exited - it may have rejected the file)"
}
exit 1
