import sys,json
f=sys.argv[1]; skip=int(sys.argv[2]) if len(sys.argv)>2 else 0
for i,l in enumerate(open(f,encoding='utf-8')):
  if i<skip: continue
  try: d=json.loads(l)
  except: print(l[:300].rstrip()); continue
  w=d.get('warden')
  ws=' '.join(f"{x['label']}:{x['type']}{'<'+x['blockedBy'] if x.get('blockedBy') else ''}{':S' if (x.get('confirmedSafe') or x.get('safe')) else ''}" for x in w) if isinstance(w,list) else str(w)[:60]
  s=d.get('scenario') or d.get('s'); t=d.get('trial',d.get('t')); H=d.get('holder') or d.get('H')
  print(s,t,'H='+str(H),'|',ws,'| closed',d.get('closed'),'innocent',d.get('innocentClosed',d.get('innocent')),'still',d.get('stillBlocked',d.get('still')),'acc',d.get('lastAccept',d.get('lastAcc')),'snap',d.get('snap'),(d.get('err') or '')[:150])
