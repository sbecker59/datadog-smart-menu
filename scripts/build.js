const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const filesToCopy = [
    'manifest.json',
    'background',
    'content',
    'icons',
    'popup',
    'shared'
];

if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

for (const file of filesToCopy) {
    const source = path.join(rootDir, file);
    const destination = path.join(distDir, file);

    if (!fs.existsSync(source)) {
        throw new Error(`Missing required file or directory: ${file}`);
    }

    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
        fs.cpSync(source, destination, { recursive: true });
    } else {
        fs.copyFileSync(source, destination);
    }
}

console.log(`Extension built in ${distDir}`);
