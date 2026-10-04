$n = $env:NEEDLE
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Replace('\', '/').Contains($n) } | ForEach-Object { [string]$_.ProcessId + ' ' + $_.Name }
