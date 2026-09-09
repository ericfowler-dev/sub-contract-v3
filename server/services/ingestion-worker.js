const { parseExcelFile } = require('./ingestion');

try {
  const rows = parseExcelFile(process.argv[2]);
  process.send({ rows }, () => process.disconnect());
} catch (err) {
  process.send({ error: err.message }, () => process.disconnect());
}
