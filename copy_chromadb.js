const fs = require('fs');
const path = require('path');
const os = require('os');

const sourceDir = path.join(os.homedir(), 'Documents/Projects/vector-data/chroma_db');
const targetDir = path.join(__dirname, 'data');

function copyDirectory(src, dest) {
    if (!fs.existsSync(src)) {
        console.error(`Source directory does not exist: ${src}`);
        process.exit(1);
    }

    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
        console.log(`Created target directory: ${dest}`);
    }

    const items = fs.readdirSync(src);

    for (const item of items) {
        const srcPath = path.join(src, item);
        const destPath = path.join(dest, item);

        const stat = fs.statSync(srcPath);

        if (stat.isDirectory()) {
            copyDirectory(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copied: ${item}`);
        }
    }
}

console.log(`Copying ChromaDB from ${sourceDir} to ${targetDir}...`);
copyDirectory(sourceDir, targetDir);
console.log('ChromaDB copy completed successfully!');