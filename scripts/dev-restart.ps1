# Restarts the API and worker on this machine (Windows). Logs go to %TEMP%\api<N>.log and worker<N>.log.
#   powershell -File scripts/dev-restart.ps1 -Apis 2 -Workers 2 -WorkerIntervalMs 300
# API processes listen on ports 3000, 3001, ...
param([int]$Workers = 1, [int]$WorkerIntervalMs = 0, [int]$Apis = 1)

if ($WorkerIntervalMs -gt 0) { $env:WORKER_INTERVAL_MS = "$WorkerIntervalMs" } else { Remove-Item Env:WORKER_INTERVAL_MS -ErrorAction SilentlyContinue }

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'src[\\/](index|worker)\.js' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep 1

$wd = Join-Path (Split-Path $PSScriptRoot -Parent) 'server'
for ($i = 0; $i -lt $Apis; $i++) {
  $env:PORT = "$(3000 + $i)"
  Start-Process -FilePath node -ArgumentList '--env-file=.env', 'src/index.js' -WorkingDirectory $wd `
    -RedirectStandardOutput "$env:TEMP\api$i.log" -RedirectStandardError "$env:TEMP\api$i.err" -WindowStyle Hidden
}
Remove-Item Env:PORT -ErrorAction SilentlyContinue
for ($i = 1; $i -le $Workers; $i++) {
  Start-Process -FilePath node -ArgumentList '--env-file=.env', 'src/worker.js' -WorkingDirectory $wd `
    -RedirectStandardOutput "$env:TEMP\worker$i.log" -RedirectStandardError "$env:TEMP\worker$i.err" -WindowStyle Hidden
}
for ($p = 0; $p -lt $Apis; $p++) {
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep 1
    try { $h = Invoke-WebRequest -UseBasicParsing "http://localhost:$(3000 + $p)/api/v1/health"; "api $p up: $($h.Content)"; break } catch { }
  }
}
