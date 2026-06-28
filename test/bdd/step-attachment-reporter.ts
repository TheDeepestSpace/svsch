import fs from 'fs';
import path from 'path';

export default class StepAttachmentReporter {
  constructor() {
    this.attachmentsCount = new Map();
    // scenarioTitle -> stepTitle -> string[] (paths or names)
    this.scenarioAttachments = new Map();
  }

  onStepBegin(test, result, step) {
    // Playwright BDD wraps cucumber steps in playwright steps with the text.
    // We only care about steps starting with Given, When, Then, And, But
    if (/^(Given|When|Then|And|But)\s/.test(step.title)) {
      this.attachmentsCount.set(step, result.attachments.length);
    }
  }

  onStepEnd(test, result, step) {
    if (/^(Given|When|Then|And|But)\s/.test(step.title)) {
      const previousLength = this.attachmentsCount.get(step) || 0;
      const currentLength = result.attachments.length;
      
      if (currentLength > previousLength) {
        let scenarioTitle = test.title;
        if (scenarioTitle.startsWith('Example #') && test.parent) {
          scenarioTitle = `${test.parent.title} - ${scenarioTitle}`;
        }
        const text = step.title.replace(/^(Given|When|Then|And|But)\s+/, '');
        
        if (!this.scenarioAttachments.has(scenarioTitle)) {
          this.scenarioAttachments.set(scenarioTitle, new Map());
        }
        
        const stepMap = this.scenarioAttachments.get(scenarioTitle);
        if (!stepMap.has(text)) {
          stepMap.set(text, []);
        }
        
        const addedAttachments = result.attachments.slice(previousLength, currentLength);
        stepMap.get(text).push(addedAttachments);
      }
    }
  }

  onEnd(result) {
    const out = {};
    for (const [scenario, stepMap] of this.scenarioAttachments.entries()) {
      out[scenario] = {};
      for (const [step, atts] of stepMap.entries()) {
        out[scenario][step] = atts;
      }
    }
    
    const outPath = path.resolve('test-results/bdd/step-attachments.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log(`Saved step-attachments.json`);
  }
}
