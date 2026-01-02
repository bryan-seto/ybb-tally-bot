import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function forensicAudit() {
  try {
    console.log('🔍 FORENSIC AUDIT: Batch Settlement Event Analysis\n');
    console.log('='.repeat(80));
    console.log('Target Event: 2026-01-01T06:49:02.232Z\n');
    
    // Define the time window around the batch settlement
    const settleTime = new Date('2026-01-01T06:49:02.232Z');
    const windowStart = new Date('2026-01-01T06:49:00Z');
    const windowEnd = new Date('2026-01-01T06:50:00Z');
    
    // TABLE A: The Accident Victims (transactions settled in the batch event)
    console.log('📊 TABLE A: THE ACCIDENT VICTIMS (Recently Settled)\n');
    const victims = await prisma.transaction.findMany({
      where: {
        updatedAt: {
          gte: windowStart,
          lte: windowEnd,
        },
        isSettled: true,
      },
      orderBy: {
        id: 'desc',
      },
    });
    
    if (victims.length === 0) {
      console.log('❌ No transactions found in the time window.');
    } else {
      console.log('ID   | Description                    | Amount    | Created At        | Updated At');
      console.log('-'.repeat(80));
      
      let totalVictims = 0;
      for (const tx of victims) {
        const id = tx.id.toString().padStart(4);
        const desc = (tx.description || 'No description').substring(0, 30).padEnd(30);
        const amount = `$${tx.amountSGD.toFixed(2)}`.padStart(9);
        const createdAt = tx.createdAt.toISOString().split('T')[0];
        const updatedAt = tx.updatedAt.toISOString().split('T')[0] + ' ' + tx.updatedAt.toISOString().split('T')[1].substring(0, 8);
        
        console.log(`${id} | ${desc} | ${amount} | ${createdAt} | ${updatedAt}`);
        totalVictims += tx.amountSGD;
      }
      
      console.log('-'.repeat(80));
      console.log(`\n📈 SUMMARY - TABLE A:`);
      console.log(`   Total Transactions Affected: ${victims.length}`);
      console.log(`   Total Value: SGD $${totalVictims.toFixed(2)}`);
    }
    
    // TABLE B: The Survivors (currently unsettled transactions)
    console.log('\n\n📊 TABLE B: THE SURVIVORS (Currently Unsettled)\n');
    const survivors = await prisma.transaction.findMany({
      where: {
        isSettled: false,
      },
      orderBy: {
        id: 'desc',
      },
    });
    
    if (survivors.length === 0) {
      console.log('✅ No unsettled transactions found. All are settled.');
    } else {
      console.log('ID   | Description                    | Amount    | Created At');
      console.log('-'.repeat(70));
      
      let totalSurvivors = 0;
      for (const tx of survivors) {
        const id = tx.id.toString().padStart(4);
        const desc = (tx.description || 'No description').substring(0, 30).padEnd(30);
        const amount = `$${tx.amountSGD.toFixed(2)}`.padStart(9);
        const createdAt = tx.createdAt.toISOString().split('T')[0];
        
        console.log(`${id} | ${desc} | ${amount} | ${createdAt}`);
        totalSurvivors += tx.amountSGD;
      }
      
      console.log('-'.repeat(70));
      console.log(`\n📈 SUMMARY - TABLE B:`);
      console.log(`   Total Unsettled Transactions: ${survivors.length}`);
      console.log(`   Total Value: SGD $${totalSurvivors.toFixed(2)}`);
      console.log(`   Expected Balance: SGD $418.44`);
      if (Math.abs(totalSurvivors - 418.44) < 0.01) {
        console.log(`   ✅ Balance matches expected value!`);
      } else {
        console.log(`   ⚠️  Balance discrepancy: $${(totalSurvivors - 418.44).toFixed(2)}`);
      }
    }
    
    // REVERT LIST GENERATION
    console.log('\n\n🔄 REVERT LIST (JSON Array of Transaction IDs)\n');
    if (victims.length > 0) {
      const revertIds = victims.map(tx => tx.id.toString());
      console.log('Copy this JSON array for the revert script:');
      console.log(JSON.stringify(revertIds, null, 2));
      console.log('\nOr as a single-line array:');
      console.log(`[${revertIds.join(', ')}]`);
    } else {
      console.log('No transactions to revert.');
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ Forensic audit complete.\n');
    
  } catch (error: any) {
    console.error('❌ Error during forensic audit:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

forensicAudit();

