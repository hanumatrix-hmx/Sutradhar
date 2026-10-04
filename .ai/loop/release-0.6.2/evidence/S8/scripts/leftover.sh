#!/bin/bash
# leftover.sh <ISO name>: PIDs of chrome.exe/node.exe whose command line contains scratchpad/<name> (pattern built by
# concatenation so this query's own command line never matches itself).
powershell.exe -NoProfile -Command "\$p = '*scratch' + 'pad/' + '$1' + '*'; Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' or Name='node.exe'\" | Where-Object { \$_.CommandLine -and \$_.CommandLine.Replace('\','/') -like \$p } | ForEach-Object { \$_.ProcessId }" | tr -d '\r'
