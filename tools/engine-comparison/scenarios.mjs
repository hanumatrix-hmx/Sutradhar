// Shared scenario metadata used by both harnesses (kept as plain data — each harness implements
// the steps natively in its own idiom, since that's the realistic comparison: how each engine's
// own API handles the same task, not a shared DSL that would hide engine differences).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURE_PATH = path.join(here, 'fixtures', 'complex.html');
export const UPLOAD_FILE_PATH = path.join(here, 'fixtures', 'upload-payload.txt');

export const SCENARIOS = [
  {
    id: 'login-flow',
    title: 'Login + logout flow with dynamic flash-message verification',
    kind: 'public',
  },
  {
    id: 'dynamic-loading',
    title: 'Wait for AJAX-style delayed content, then extract it',
    kind: 'public',
  },
  {
    id: 'file-upload',
    title: 'Upload a local file through a native file input',
    kind: 'public',
  },
  {
    id: 'long-checkout',
    title: 'Long multi-step task: login -> add 3 items -> cart -> checkout -> confirm',
    kind: 'public',
  },
  {
    id: 'local-fixture',
    title: 'Shadow DOM text + delayed element + cross-origin-free iframe form, all in one page',
    kind: 'local',
  },
];
