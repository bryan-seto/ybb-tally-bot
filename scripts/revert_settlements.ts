import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Revert settlement status for specified transaction IDs
 * Usage: npx tsx scripts/revert_settlements.ts
 * 
 * The script will prompt for confirmation before reverting.
 * Transaction IDs should be provided as command-line arguments or hardcoded.
 */

async function revertSettlements(transactionIds: string[]) {
  try {
    if (transactionIds.length === 0) {
      console.log('❌ No transaction IDs provided.');
      console.log('Usage: npx tsx scripts/revert_settlements.ts <id1> <id2> ...');
      console.log('Or modify the script to include the IDs array.');
      return;
    }

    console.log('🔄 REVERT SETTLEMENTS\n');
    console.log('='.repeat(80));
    console.log(`Target Transactions: ${transactionIds.length} transactions\n`);

    // Convert string IDs to BigInt
    const ids = transactionIds.map(id => BigInt(id));

    // Fetch the transactions to verify they exist and are settled
    const transactions = await prisma.transaction.findMany({
      where: {
        id: { in: ids },
      },
      orderBy: {
        id: 'desc',
      },
    });

    if (transactions.length === 0) {
      console.log('❌ No transactions found with the provided IDs.');
      return;
    }

    // Check which ones are actually settled
    const settledTransactions = transactions.filter(tx => tx.isSettled);
    const alreadyUnsettled = transactions.filter(tx => !tx.isSettled);

    if (settledTransactions.length === 0) {
      console.log('✅ All specified transactions are already unsettled.');
      if (alreadyUnsettled.length > 0) {
        console.log(`\nAlready unsettled: ${alreadyUnsettled.map(tx => tx.id.toString()).join(', ')}`);
      }
      return;
    }

    // Display summary
    console.log('📊 TRANSACTIONS TO REVERT:\n');
    console.log('ID   | Description                    | Amount    | Status');
    console.log('-'.repeat(70));
    
    let totalValue = 0;
    for (const tx of settledTransactions) {
      const id = tx.id.toString().padStart(4);
      const desc = (tx.description || 'No description').substring(0, 30).padEnd(30);
      const amount = `$${tx.amountSGD.toFixed(2)}`.padStart(9);
      const status = tx.isSettled ? '✅ Settled' : '🔴 Unsettled';
      
      console.log(`${id} | ${desc} | ${amount} | ${status}`);
      totalValue += tx.amountSGD;
    }
    
    console.log('-'.repeat(70));
    console.log(`\n📈 SUMMARY:`);
    console.log(`   Transactions to revert: ${settledTransactions.length}`);
    console.log(`   Total value: SGD $${totalValue.toFixed(2)}`);
    
    if (alreadyUnsettled.length > 0) {
      console.log(`\n⚠️  Note: ${alreadyUnsettled.length} transaction(s) are already unsettled and will be skipped.`);
    }

    // Confirmation prompt (in a real scenario, you might want to use readline)
    console.log('\n⚠️  WARNING: This will set isSettled=false for the above transactions.');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to proceed...\n');
    
    // Wait 5 seconds for user to cancel
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Perform the revert
    const settledIds = settledTransactions.map(tx => tx.id);
    const result = await prisma.transaction.updateMany({
      where: {
        id: { in: settledIds },
        isSettled: true, // Only update if currently settled
      },
      data: {
        isSettled: false,
      },
    });

    console.log(`\n✅ Revert complete!`);
    console.log(`   Transactions reverted: ${result.count}`);
    console.log(`   Total value restored: SGD $${totalValue.toFixed(2)}`);
    console.log('\n' + '='.repeat(80));

  } catch (error: any) {
    console.error('❌ Error during revert:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

// Get transaction IDs from command line arguments or use the forensic audit results
const args = process.argv.slice(2);

// If no args provided, use the IDs from the forensic audit
const defaultIds = [
  '86', '85', '84', '83', '82', '81', '79', '78', '77',
  '75', '74', '73', '66', '65', '64'
];

const transactionIds = args.length > 0 ? args : defaultIds;

revertSettlements(transactionIds);

