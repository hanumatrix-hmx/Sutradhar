const fs=require('fs');const [,,src,edits,out,cur]=process.argv;
const grab=(f)=>fs.readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
let orig; for(const j of grab(src)){for(const b of j.message?.content??[]){if(b.type==='tool_use'&&b.name==='Write'&&b.input.file_path.endsWith('step0-matrix-corrected.json'))orig=b.input.content;}}
fs.writeFileSync(out,orig);
const ids={};
for(const j of grab(edits)){for(const b of j.message?.content??[]){
 if(b.type==='tool_use'&&(b.name==='Edit'||(b.name==='Bash'&&b.input.command.includes('checkout -- .ai'))||(b.name==='Bash'&&b.input.command.includes('diff <(git show')))){ids[b.id]=1;console.log('USE',j.timestamp,b.name,JSON.stringify(b.input).slice(0,1500));}
 if(b.type==='tool_result'&&ids[b.tool_use_id])console.log('RESULT',JSON.stringify(b.content).slice(0,600));}}
const c=fs.readFileSync(cur,'utf8');console.log('orig len',Buffer.byteLength(orig),'cur len',Buffer.byteLength(c),'identical',orig===c);
