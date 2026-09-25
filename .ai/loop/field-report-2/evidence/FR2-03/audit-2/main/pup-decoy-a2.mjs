import { createRequire } from 'node:module';
const req = createRequire("E:\\HMX_Projects\\Internal_Projects\\PinchTab\\.claude\\worktrees\\project-understanding-696041\\packages\\browser\\package.json");
const p = req('puppeteer-core');
const b = await p.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
console.log('ready ' + b.process().pid);
setInterval(()=>{},1e9);
