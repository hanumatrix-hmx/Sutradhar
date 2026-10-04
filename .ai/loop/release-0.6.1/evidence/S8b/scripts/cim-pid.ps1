$p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $env:QPID)
if ($p) { $p.CommandLine }
