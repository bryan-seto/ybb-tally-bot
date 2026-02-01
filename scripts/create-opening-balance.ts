/**
 * Create Opening Balance Transaction Script
 * 
 * Creates a transaction to establish the opening balance from Splitwise:
 * - Amount: $761.20 (paid by Hwei Yeen)
 * - Split: 50/50 (Bryan 50%, Hwei Yeen 50%)
 * - Result: Bryan owes Hwei Yeen $380.60
 * 
 * Usage:
 *   export DATABASE_URL="your_production_database_url"
 *   tsx scripts/create-opening-balance.ts
 */

import { prisma } from '../src/lib/prisma';
import { getUserBName } from '../src/config';

async function createOpeningBalance(): Promise<void> {
  let connected = false;

  try {
    // Connect to database
    console.log('🔄 Connecting to database...');
    await prisma.$connect();
    connected = true;
    console.log('✅ Database connected');

    // Look up Hwei Yeen user
    console.log('🔍 Looking up Hwei Yeen user...');
    const hweiYeen = await prisma.user.findFirst({
      where: { role: 'HweiYeen' }
    });

    // Validate user exists
    if (!hweiYeen) {
      throw new Error(
        'Hwei Yeen user not found in database.\n' +
        'Please ensure the User table contains a user with role \'HweiYeen\'.'
      );
    }

    console.log(`✅ Hwei Yeen user found: ID=${hweiYeen.id}, Name=${hweiYeen.name}, Role=${hweiYeen.role}`);

    // Create opening balance transaction
    console.log('💰 Creating opening balance transaction...');
    const transaction = await prisma.transaction.create({
      data: {
        amountSGD: 761.20,
        currency: 'SGD',
        category: 'Other', // Note: Using 'Other' to match VALID_CATEGORIES. Change to 'Others' if your schema differs.
        description: 'Opening Balance from Splitwise',
        payerId: hweiYeen.id,
        date: new Date(),
        bryanPercentage: 0.5,
        hweiYeenPercentage: 0.5,
      }
    });

    // Success message
    console.log('\n✅ Opening balance transaction created successfully!');
    console.log(`   Transaction ID: ${transaction.id}`);
    console.log(`   Amount: $${transaction.amountSGD.toFixed(2)}`);
    console.log(`   Payer: ${getUserBName()} (ID: ${hweiYeen.id})`);
    console.log(`   Split: Bryan 50% / ${getUserBName()} 50%`);
    console.log(`   Expected balance: Bryan owes ${getUserBName()} $380.60`);
    console.log('\n✅ Migration complete! Verify balance in bot with /balance command.');

  } catch (error: any) {
    console.error('\n❌ Error creating opening balance transaction:');
    console.error(`   ${error.message}`);
    
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    
    if (error.meta) {
      console.error(`   Details: ${JSON.stringify(error.meta, null, 2)}`);
    }
    
    // Re-throw to exit with error code
    throw error;
  } finally {
    // Always disconnect, even if there was an error
    if (connected) {
      try {
        await prisma.$disconnect();
        console.log('✅ Disconnected from database');
      } catch (disconnectError: any) {
        console.error('⚠️  Warning: Error disconnecting from database:', disconnectError.message);
      }
    }
  }
}

// Run the script
createOpeningBalance()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed. Please review the error messages above.');
    process.exit(1);
  });
