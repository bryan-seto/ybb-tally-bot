import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Starting Schema Verification...');
  try {
    // 1. Check connection
    await prisma.$connect();
    
    // 2. Verify the critical column that caused the crash exists
    const result: any[] = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = 'recurring_expenses' 
      AND column_name = 'lastProcessedDate';
    `;
    
    if (result.length === 0) {
      console.error('❌ CRITICAL FAILURE: Schema drift detected.');
      console.error('   Column "lastProcessedDate" is MISSING from "recurring_expenses".');
      console.error('   Action: You must apply the schema change manually or sync the DB.');
      process.exit(1);
    }
    
    console.log('✅ PASS: Critical schema columns exist.');
    process.exit(0);
  } catch (e) {
    console.error('❌ ERROR: Could not connect to database or verify schema.', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

