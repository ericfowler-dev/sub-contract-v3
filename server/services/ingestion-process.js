const path = require('path');
const { fork } = require('child_process');

// Keep a large or damaged workbook from taking down the dashboard process.
// One parser at a time keeps peak memory bounded on the hosted instance.
let parsing = false;

async function parseExcelFileIsolated(filePath) {
  if (parsing) throw new Error('Another upload is being processed. Please try again shortly.');
  parsing = true;
  try {
    return await new Promise((resolve, reject) => {
      const child = fork(path.join(__dirname, 'ingestion-worker.js'), [filePath], {
        execArgv: ['--max-old-space-size=256'],
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      let result;
      const timeout = setTimeout(() => child.kill(), 120000);
      child.once('message', message => { result = message; });
      child.once('error', err => {
        clearTimeout(timeout);
        reject(err);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0 || !result) {
          reject(new Error('The workbook exceeded the upload processing limit. Existing transactions and projected costs were preserved. Try a smaller workbook containing only SubContract Detail.'));
        } else if (result.error) {
          reject(new Error(result.error));
        } else {
          resolve(result.rows);
        }
      });
    });
  } finally {
    parsing = false;
  }
}

module.exports = { parseExcelFileIsolated };
