const https = require('https');
const fs = require('fs');
const path = require('path');

async function getReleases() {
    return new Promise((resolve, reject) => {
        https.get('https://update.code.visualstudio.com/api/releases/stable', (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

async function main() {
    const releases = await getReleases();
    // VSCode versions are 1.X.Y. We care about X.
    const minors = [...new Set(releases.map(v => parseInt(v.split('.')[1])))].sort((a, b) => b - a);
    
    const latest = minors[0];
    const toTest = new Set();

    // 1. Three latest major versions
    toTest.add(minors[0]);
    toTest.add(minors[1]);
    toTest.add(minors[2]);

    // 2. Every 10th version out of the last 50
    const startRange = latest - 50;
    for (let v = latest; v >= startRange; v--) {
        if (v % 10 === 0 && v >= startRange) {
            toTest.add(v);
        }
    }

    // Ensure we don't go below 1.90.0 as it's our minimum engine requirement
    const result = Array.from(toTest)
        .filter(v => v >= 90)
        .sort((a, b) => b - a)
        .map(v => `1.${v}.0`);

    const filePath = path.resolve(__dirname, '../vscode-versions.json');
    fs.writeFileSync(filePath, JSON.stringify(result, null, 2) + '\n');
    
    // Output for GitHub Actions
    console.log(JSON.stringify(result));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
