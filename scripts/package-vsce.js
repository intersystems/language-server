const { spawnSync } = require('node:child_process');

const explicitTarget = process.argv[2];
const resolveTarget = () => {
	if (explicitTarget) {
		return explicitTarget;
	}

	if (process.env.ISCLEXER_TARGET) {
		return process.env.ISCLEXER_TARGET;
	}

	const platform = process.platform;
	const arch = process.arch;
	const archMap = {
		x64: 'x64',
		arm64: 'arm64',
	};

	const mappedArch = archMap[arch];

	if (!mappedArch) {
		return null;
	}

	const platformMap = {
		win32: `win32-${mappedArch}`,
		darwin: `darwin-${mappedArch}`,
		linux: `linux-${mappedArch}`,
	};

	return platformMap[platform] ?? null;
};

const target = resolveTarget();

if (!target) {
	console.error('Usage: node ./scripts/package-vsce.js <target>');
	console.error('Or set ISCLEXER_TARGET for auto-detection.');
	process.exit(1);
}

const env = {
	...process.env,
	ISCLEXER_TARGET: target,
};

const run = (command) => {
	const result = spawnSync(command, {
		stdio: 'inherit',
		shell: true,
		env,
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
};

run('npm run webpack');
run(`vsce package --target ${target}`);