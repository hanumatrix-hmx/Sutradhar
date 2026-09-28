import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const b = await import(pathToFileURL(path.join(root, 'packages/browser/dist/index.js')).href);
const rt = await import(pathToFileURL(path.join(root, 'packages/capability-runtime/dist/index.js')).href);
console.log('defaultDownloadRoot() =', b.defaultDownloadRoot(), '| os.tmpdir() =', os.tmpdir());
const d = rt.resolveFsRoots({ options: {}, env: {} });
console.log('unset env  => download', JSON.stringify(d.allowedDownloadRoots), 'upload', JSON.stringify(d.allowedUploadRoots));
const e = rt.resolveFsRoots({ options: {}, env: { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: os.tmpdir(), SUTRADHAR_ALLOWED_UPLOAD_ROOTS: os.homedir() } });
console.log('env set    => download', JSON.stringify(e.allowedDownloadRoots), 'upload', JSON.stringify(e.allowedUploadRoots));
try { rt.resolveFsRoots({ options: {}, env: { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: 'relative/dir' } }); console.log('NEGATIVE CONTROL FAILED: relative accepted'); }
catch (err) { console.log('relative entry => throws:', err.message); }
