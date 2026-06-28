const reporter = require('multiple-cucumber-html-reporter');
const path = require('path');
const fs = require('fs');

console.log("Processing attachments before generating documentation...");

const cucumberReportPath = path.resolve('test-results/bdd/cucumber/cucumber-report.json');
const stepAttachmentsPath = path.resolve('test-results/bdd/step-attachments.json');

if (fs.existsSync(cucumberReportPath) && fs.existsSync(stepAttachmentsPath)) {
  try {
    const reportData = JSON.parse(fs.readFileSync(cucumberReportPath, 'utf8'));
    const stepMap = JSON.parse(fs.readFileSync(stepAttachmentsPath, 'utf8'));

    // Now inject into cucumber-report.json
    let injectedCount = 0;
    for (const feature of reportData) {
      const elementCounters: Record<string, number> = {};
      for (const element of feature.elements) {
        const baseTitle = element.name;
        elementCounters[baseTitle] = (elementCounters[baseTitle] || 0) + 1;
        
        const exampleTitle = `${baseTitle} - Example #${elementCounters[baseTitle]}`;
        const scenarioSteps = stepMap[exampleTitle] || stepMap[baseTitle];
        
        if (!scenarioSteps) continue;

        for (const step of element.steps) {
          const attachmentGroups = scenarioSteps[step.name];
          if (attachmentGroups && attachmentGroups.length > 0) {
            const attachments = attachmentGroups.shift(); // consume the attachments for this occurrence
            if (attachments && attachments.length > 0) {
              if (!step.embeddings) step.embeddings = [];
              for (const att of attachments) {
              let base64Body;
              
              let targetPath = att.path;
              if (targetPath && !fs.existsSync(targetPath)) {
                // CI copies /tmp/bdd-playwright-results to test-results/bdd/bdd-playwright-results
                const copiedPath = targetPath.replace(/^\/tmp\//, 'test-results/bdd/');
                if (fs.existsSync(copiedPath)) {
                  targetPath = copiedPath;
                }
              }

              if (targetPath && fs.existsSync(targetPath)) {
                base64Body = fs.readFileSync(targetPath).toString('base64');
              } else if (att.body) {
                base64Body = att.body;
              }
              
              if (base64Body) {
                step.embeddings.push({
                  data: base64Body,
                  mime_type: att.contentType || 'image/png'
                });
                injectedCount++;
              }
              }
            }
          }
        }
      }
    }

    fs.writeFileSync(cucumberReportPath, JSON.stringify(reportData, null, 2));
    console.log(`Injected ${injectedCount} attachments into cucumber-report.json`);
  } catch (err) {
    console.error("Error processing attachments:", err);
  }
} else {
  console.log("Could not find both cucumber-report.json and playwright-report.json, skipping attachment injection.");
}

reporter.generate({
  jsonDir: 'test-results/bdd/cucumber/',
  reportPath: 'test-results/bdd/',
  openReportInBrowser: false,
  pageTitle: 'SVSCH BDD Documentation',
  reportName: 'SVSCH Diagram Generation & Manipulation',
  displayDuration: true,
  displayReportTime: true,
  metadata: {
    browser: { name: 'chromium', version: 'latest' },
    device: 'Local Development Machine',
    platform: { name: 'linux', version: 'ubuntu' }
  },
  customData: {
    title: 'Project Info',
    data: [
      { label: 'Project', value: 'SVSCH' },
      { label: 'Release', value: '0.0.1' },
      { label: 'Environment', value: 'Development' }
    ]
  }
});

console.log('Documentation generated: test-results/bdd/index.html');
