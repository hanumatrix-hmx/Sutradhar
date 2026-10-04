$f = [IO.File]::Open($env:LOCKPATH, 'Open', 'ReadWrite', 'ReadWrite')
'ready'
[void][Console]::In.ReadLine()
$f.Close()
'released'
