import { execSync } from 'child_process';
import { CONFIG, ensureNotProduction } from '../src/config';

/**
 * Reset local database - stops Docker, removes data, restarts, and reseeds
 * This operation is blocked in production for safety.
 */
async function resetDatabase() {
  // Safety check - block in production
  ensureNotProduction('Database reset operation');

  console.log('🔄 Resetting local database...');
  console.log('⚠️  This will delete all data in the local database.');

  try {
    // Stop Docker database
    console.log('Stopping database...');
    execSync('docker-compose down', { stdio: 'inherit' });

    // Start Docker database
    console.log('Starting database...');
    execSync('docker-compose up -d', { stdio: 'inherit' });

    // Wait for database to be ready
    console.log('Waiting for database to be ready...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Push schema (faster for local dev, avoids shadow database issues)
    console.log('Pushing schema to database...');
    execSync('dotenv -e .env.local -- npx prisma db push', { stdio: 'inherit' });

    // Run seed
    console.log('Seeding database...');
    execSync('npx prisma db seed', { stdio: 'inherit' });

    console.log('✅ Database reset complete!');
  } catch (error: any) {
    console.error('❌ Error resetting database:', error);
    process.exit(1);
  }
}

resetDatabase().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

