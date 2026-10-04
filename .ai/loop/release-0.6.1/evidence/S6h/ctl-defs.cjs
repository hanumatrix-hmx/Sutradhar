const base = require('./S6h-defs.cjs');
module.exports = { ...base, tests: ['tests/unit/zz-s6h-old-t5.spec.ts'], mutants: base.mutants.filter((m) => m.id === 'LOAD-SIM-80ms-gap').map((m) => ({ ...m, mustFail: ['OLDT5'] })) };
