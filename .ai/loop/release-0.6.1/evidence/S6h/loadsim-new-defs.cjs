const base = require('./S6h-defs.cjs');
module.exports = { ...base, mutants: base.mutants.filter((m) => m.id === 'LOAD-SIM-80ms-gap').map((m) => ({ ...m, tests: ['tests/unit/temp-profile.spec.ts', '-t', 'T5'] })) };
