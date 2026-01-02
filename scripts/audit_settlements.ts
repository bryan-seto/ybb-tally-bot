import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function auditSettlements() {
  try {
    console.log('🔍 AUDIT: Checking settlement status for transactions 83, 84, 85, 86\n');
    console.log('=' .repeat(80));
    
    const transactions = await prisma.transaction.findMany({
      where: {
        id: {
          in: [BigInt(83), BigInt(84), BigInt(85), BigInt(86)]
        }
      },
      include: {
        payer: true
      },
      orderBy: {
        id: 'desc'
      }
    });

    if (transactions.length === 0) {
      console.log('❌ No transactions found with IDs 83, 84, 85, 86');
      return;
    }

    console.log('\n📊 RESULTS:\n');
    console.log('ID  | Description              | Amount    | isSettled | Status    | Created At');
    console.log('-'.repeat(80));
    
    for (const tx of transactions) {
      const id = tx.id.toString().padStart(3);
      const desc = (tx.description || 'No description').substring(0, 22).padEnd(22);
      const amount = `$${tx.amountSGD.toFixed(2)}`.padStart(9);
      const isSettled = tx.isSettled ? '✅ TRUE ' : '🔴 FALSE';
      const status = tx.isSettled ? 'Settled  ' : 'Unsettled';
      const createdAt = tx.createdAt.toISOString().split('T')[0];
      
      console.log(`${id}  | ${desc} | ${amount} | ${isSettled} | ${status} | ${createdAt}`);
    }
    
    console.log('\n' + '='.repeat(80));
    
    const settledCount = transactions.filter(tx => tx.isSettled).length;
    const unsettledCount = transactions.filter(tx => !tx.isSettled).length;
    
    console.log(`\n📈 SUMMARY:`);
    console.log(`   ✅ Settled: ${settledCount}`);
    console.log(`   🔴 Unsettled: ${unsettledCount}`);
    
    if (unsettledCount > 0) {
      console.log(`\n⚠️  DIAGNOSIS: Transactions are UNSETTLED in database.`);
      console.log(`   If UI shows ✅, this is a UI display bug.`);
    } else {
      console.log(`\n⚠️  DIAGNOSIS: Transactions are SETTLED in database.`);
      console.log(`   Need to investigate auto-settlement mechanism.`);
    }
    
  } catch (error: any) {
    console.error('❌ Error during audit:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

auditSettlements();

