'use strict';
/* Safety net: writes dist/latest.yml (the file the program reads to find updates)
   if the installer builder did not create it. Usage: node scripts/make-latest.js */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dist = path.join(__dirname, '..', 'dist');
const yml = path.join(dist, 'latest.yml');
if (fs.existsSync(yml)) {
	console.log('latest.yml already exists');
	process.exit(0);
}
const exe = fs.readdirSync(dist).find((f) => /^Rockmines-WorkTrail-Setup-.*\.exe$/.test(f));
if (!exe) {
	console.error('No installer found in dist');
	process.exit(1);
}
const data = fs.readFileSync(path.join(dist, exe));
const sha512 = crypto.createHash('sha512').update(data).digest('base64');
const version = exe.replace(/^Rockmines-WorkTrail-Setup-/, '').replace(/\.exe$/, '');
const text = [
	'version: ' + version,
	'files:',
	'  - url: ' + exe,
	'    sha512: ' + sha512,
	'    size: ' + data.length,
	'path: ' + exe,
	'sha512: ' + sha512,
	"releaseDate: '" + new Date().toISOString() + "'",
	'',
].join('\n');
fs.writeFileSync(yml, text);
console.log('latest.yml written for ' + version);
