import json,sys
f='audit-findings.json'
d=json.load(open(f,encoding='utf-8'))
op=sys.argv[1]; payload=json.loads(sys.argv[2])
if op=='progress': d['progress'].append(payload)
elif op=='finding':
  d['findings']=[x for x in d['findings'] if x.get('id')!=payload['id']]+[payload]
elif op=='verified': d['verified'].append(payload)
elif op=='note': d['notes'].append(payload)
elif op=='set': d.update(payload)
json.dump(d,open(f,'w',encoding='utf-8'),indent=2)
