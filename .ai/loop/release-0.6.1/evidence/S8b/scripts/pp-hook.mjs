// Resolution hook for scratch copies of the CLI bundle (control + live mutants): resolve the bare
// 'puppeteer-core' specifier exactly as the REAL dist/cli-bin.js would (same parentURL), so no
// junction/link is needed in the scratchpad. Nothing else is touched.
import { registerHooks } from 'node:module';
const REAL_PARENT = 'file:///E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/packages/sutradhar/dist/cli-bin.js';
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'puppeteer-core' || spec.startsWith('puppeteer-core/')) return next(spec, { ...ctx, parentURL: REAL_PARENT });
    return next(spec, ctx);
  },
});
