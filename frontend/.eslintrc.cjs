var config = {
	root: true,
	env: {
		browser: true,
		es2021: true,
	},
	parser: '@babel/eslint-parser',
	extends: ['eslint:recommended', 'plugin:import/recommended', 'prettier'],
	parserOptions: {
		ecmaVersion: 2021,
		sourceType: 'module',
		requireConfigFile: false,
	},
	settings: {
		'import/resolver': {
			node: {
				extensions: ['.js'],
			},
		},
	},
	rules: {
		'import/order': [
			'warn',
			{
				groups: [['builtin', 'external'], 'internal', 'parent', 'sibling', 'index'],
				'newlines-between': 'always',
			},
		],
		'no-console': ['warn', { allow: ['warn', 'error'] }],
	},
};

var moduleRef = Function('return typeof module === "undefined" ? undefined : module;')();

if (moduleRef) {
	moduleRef.exports = config;
}
