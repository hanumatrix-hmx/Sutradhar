$needles = $env:NEEDLES.Split('|')
Get-CimInstance Win32_Process | Where-Object { $c = $_.CommandLine; if (-not $c) { return $false }; $l = $c.ToLower().Replace('\', '/'); foreach ($n in $needles) { if ($l.Contains($n)) { return $true } }; return $false } | ForEach-Object { [string]$_.ProcessId + ' ' + $_.Name }
