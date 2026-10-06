// ESM-only packages that must be transformed to CommonJS for jest
const esmPackages = ['@actions/github', '@octokit', 'universal-user-agent', 'before-after-hook', 'fast-content-type-parse', 'json-with-bigint', 'content-type']

module.exports = {
  clearMocks: true,
  moduleFileExtensions: ['js', 'ts'],
  testMatch: ['**/*.test.ts'],
  testRunner: 'jest-circus/runner',
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.m?js$': ['ts-jest', {tsconfig: {allowJs: true, esModuleInterop: true}}]
  },
  transformIgnorePatterns: [`/node_modules/(?!(${esmPackages.join('|')})/)`],
  verbose: true,
  forceExit: true
}
