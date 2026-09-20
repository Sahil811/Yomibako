// Post-compile: shadow RN/Expo packages inside .test-out so compiled
// tests require our in-memory mocks instead of the real native modules.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '.test-out');
const mocksDir = path.join(root, 'test', 'mocks');

const shims = {
  'react-native': 'react-native.js',
  'expo-secure-store': 'expo-secure-store.js',
  'expo-file-system': 'expo-file-system.js',
  'expo-audio': 'expo-audio.js',
  'react-native-zip-archive': 'react-native-zip-archive.js',
};

for (const [pkg, mockFile] of Object.entries(shims)) {
  const pkgDir = path.join(root, 'node_modules', pkg);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: pkg, version: '0.0.0-test', main: 'index.js' })
  );
  const rel = path
    .relative(pkgDir, path.join(mocksDir, mockFile))
    .split(path.sep)
    .join('/');
  fs.writeFileSync(
    path.join(pkgDir, 'index.js'),
    `module.exports = require(${JSON.stringify(rel.startsWith('.') ? rel : './' + rel)});\n`
  );
}
console.log('[shims] wrote', Object.keys(shims).length, 'package shims');
