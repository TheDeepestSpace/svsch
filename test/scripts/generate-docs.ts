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
      for (const element of feature.elements) {
        const scenarioTitle = element.name;
        const scenarioSteps = stepMap[scenarioTitle];
        
        if (!scenarioSteps) continue;

        for (const step of element.steps) {
          const attachments = scenarioSteps[step.name];
          if (attachments && attachments.length > 0) {
            if (!step.embeddings) step.embeddings = [];
            for (const att of attachments) {
              let base64Body;
              
              if (att.path && fs.existsSync(att.path)) {
                base64Body = fs.readFileSync(att.path).toString('base64');
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
