const { verifyBackupRestoreProvider } = require('../config/backupRestoreAssurance');

(async () => {
  const result = await verifyBackupRestoreProvider(process.env);
  const output = {
    state: result.state,
    ready: result.ready,
    summary: result.summary,
    checked_at: result.checked_at || new Date().toISOString(),
    checks: result.checks
  };
  console.log(JSON.stringify(output, null, 2));

  if (result.state === 'blocked' || (String(process.env.BACKUP_ASSURANCE_REQUIRED || 'false').toLowerCase() === 'true' && !result.ready)) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error('Backup/restore assurance check failed safely:', error?.message || 'unknown error');
  process.exitCode = 1;
});
