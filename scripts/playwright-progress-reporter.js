const fs = require('fs');

class PlaywrightProgressReporter {
  constructor() {
    this.statusFile = process.env.SVSCH_TEST_STATUS_FILE;
    this.total = 0;
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
  }

  onBegin(config, suite) {
    this.total = suite.allTests().length;
    this.updateStatus();
  }

  onTestEnd(test, result) {
    if (result.status === 'passed') {
      this.passed++;
    } else if (result.status === 'skipped') {
      this.skipped++;
    } else {
      this.failed++;
    }
    this.updateStatus();
  }

  onEnd() {
    this.updateStatus();
  }

  updateStatus() {
    if (!this.statusFile) return;
    const completed = this.passed + this.failed + this.skipped;
    const runnerPid = process.env.SVSCH_RUNNER_PID
      ? parseInt(process.env.SVSCH_RUNNER_PID, 10)
      : process.pid;
    const status = {
      total: this.total,
      completed: completed,
      passed: this.passed,
      failed: this.failed,
      skipped: this.skipped,
      pid: runnerPid,
      timestamp: Date.now(),
    };
    try {
      fs.writeFileSync(this.statusFile, JSON.stringify(status, null, 2), 'utf8');
    } catch {
      // Ignore write errors to prevent crashing test run
    }
  }
}

module.exports = PlaywrightProgressReporter;
