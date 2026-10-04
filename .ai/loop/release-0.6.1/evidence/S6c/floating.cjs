module.exports = {
  root: true,
  parser: require.resolve('@typescript-eslint/parser', { paths: ['E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041'] }),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', project: ['E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/packages/cli/tsconfig.json'], tsconfigRootDir: 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/packages/cli' },
  plugins: ['@typescript-eslint'],
  rules: { '@typescript-eslint/no-floating-promises': 'error' },
};
