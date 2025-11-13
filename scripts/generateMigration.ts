// scripts/generateMigration.ts
import { exec } from 'child_process';

const migrationName = process.argv[2];

if (!migrationName) {
  console.error('Usage: npm run migration User');
  process.exit(1);
}

const command = `npx sequelize-cli migration:generate --name ${migrationName}`;

exec(command, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error: ${error.message}`);
    return;
  }
  if (stderr) {
    console.error(`stderr: ${stderr}`);
    return;
  }
  console.log(`stdout: ${stdout}`);
});
