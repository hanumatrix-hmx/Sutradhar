$all = @(Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%sutradhar-cli%'")
$upper = @($all | Where-Object { $_.CommandLine -cmatch 'SUTRADHAR-CLI' })
"total-prefixed=$($all.Count) upper-case=$($upper.Count)"
$upper | ForEach-Object { "UPPER pid=$($_.ProcessId) name=$($_.Name)" }
