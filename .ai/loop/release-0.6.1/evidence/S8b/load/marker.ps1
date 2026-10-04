$m = $env:LOAD_MARKER
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($m) } | ForEach-Object { [string]$_.ProcessId }
