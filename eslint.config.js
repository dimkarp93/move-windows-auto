const gjsGlobals = {
    imports: 'readonly',
    print: 'readonly',
    printerr: 'readonly',
    log: 'readonly',
    logError: 'readonly',
    console: 'readonly',
    TextDecoder: 'readonly',
    TextEncoder: 'readonly',
    ARGV: 'readonly',
    globalThis: 'readonly',
    global: 'readonly',
};

export default [
    {
        files: ['src/**/*.js', 'tests/**/*.js', 'tools/**/*.js'],
        languageOptions: {ecmaVersion: 2022, sourceType: 'module', globals: gjsGlobals},
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['error', {args: 'none', caughtErrors: 'none'}],
            'no-redeclare': 'error',
            'no-dupe-keys': 'error',
            'no-unreachable': 'error',
        },
    },
    {
        files: ['src/legacy/**/*.js'],
        languageOptions: {ecmaVersion: 2022, sourceType: 'script', globals: gjsGlobals},
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['error', {args: 'none', vars: 'local'}],
        },
    },
    {
        files: ['eslint.config.js'],
        languageOptions: {ecmaVersion: 2022, sourceType: 'module'},
    },
];
