module.exports = {
  extends: [
    '@commitlint/config-conventional',
    // '@commitlint/config-pnpm-scopes',
  ],
  rules: {
    // Do not care about cases!
    'subject-case': [0, 'always', 'sentence-case'],
    'type-case': [0, 'always', 'sentence-case'],
  },
};
