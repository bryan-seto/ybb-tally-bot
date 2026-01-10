/**
 * Data Patch Script for Balance Adjustment
 * 
 * This script:
 * 1. Creates transactions to achieve target balance: HweiYeen owes Bryan $475.26
 *    (composed of $301.41 + $173.85)
 * 2. Settles all other existing unsettled transactions
 * 3. Verifies the final balance matches the target
 */

import { prisma } from '../src/lib/prisma';
import { ExpenseService } from '../src/services/expenseService';

// Target values
const TARGET_BALANCE = 475.26;
const COMPONENT_1 = 301.41;
const COMPONENT_2 = 173.85;
const TOLERANCE = 0.01; // Allow small floating point differences

/**
 * Main execution function
 */
async function dataPatch() {
  console.log('🔧 Starting data patch script...');
  console.log(`📊 Target balance: HweiYeen owes Bryan $${TARGET_BALANCE.toFixed(2)}`);
  console.log(`   Components: $${COMPONENT_1.toFixed(2)} + $${COMPONENT_2.toFixed(2)}`);

  try {
    // Initialize expense service for balance calculations
    const expenseService = new ExpenseService();

    // Step 1: Get users
    console.log('\n👥 Fetching users...');
    const bryan = await prisma.user.findFirst({
      where: { role: 'Bryan' },
    });
    const hweiYeen = await prisma.user.findFirst({
      where: { role: 'HweiYeen' },
    });

    if (!bryan || !hweiYeen) {
      throw new Error('Required users not found in database');
    }
    console.log(`✅ Found users: ${bryan.name} (ID: ${bryan.id}) and ${hweiYeen.name} (ID: ${hweiYeen.id})`);

    // Step 2: Get current state
    console.log('\n📈 Calculating current balance...');
    const currentBalance = await expenseService.calculateOutstandingBalance();
    console.log(`   Current balance:`);
    console.log(`   - Bryan owes: $${currentBalance.bryanOwes.toFixed(2)}`);
    console.log(`   - HweiYeen owes: $${currentBalance.hweiYeenOwes.toFixed(2)}`);

    // Step 3: Get all existing unsettled transactions
    console.log('\n🔍 Fetching existing unsettled transactions...');
    const existingUnsettled = await prisma.transaction.findMany({
      where: { isSettled: false },
      orderBy: { id: 'asc' },
    });
    console.log(`   Found ${existingUnsettled.length} unsettled transactions`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataPatch.ts:59',message:'Existing unsettled transactions before patch',data:{count:existingUnsettled.length,transactions:existingUnsettled.map(t=>({id:t.id.toString(),amount:t.amountSGD,payerId:t.payerId.toString(),bryanPercent:t.bryanPercentage,hweiYeenPercent:t.hweiYeenPercentage,isSettled:t.isSettled,category:t.category,description:t.description}))},timestamp:Date.now(),sessionId:'debug-session',runId:'debug-run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    // Step 4: Check if target balance already exists (idempotency check)
    const currentHweiYeenOwes = currentBalance.hweiYeenOwes;
    const isAlreadyPatched = Math.abs(currentHweiYeenOwes - TARGET_BALANCE) < TOLERANCE;

    // Check if patch transactions already exist (identified by category and description pattern)
    const patchTransactions = existingUnsettled.filter(t => 
      t.category === 'Data Patch' && 
      (t.description?.includes('Component 1') || t.description?.includes('Component 2'))
    );

    if (isAlreadyPatched && patchTransactions.length >= 2) {
      console.log(`\n✅ Target balance already achieved! HweiYeen owes $${currentHweiYeenOwes.toFixed(2)}`);
      console.log(`   Found ${patchTransactions.length} existing patch transactions`);
      
      // Settle other transactions (excluding patch transactions) - use transaction for atomicity
      await prisma.$transaction(async (tx) => {
        // Fetch fresh list inside transaction
        const allUnsettledNow = await tx.transaction.findMany({
          where: { isSettled: false },
        });
        
        const patchTransactionIds = patchTransactions.map(t => t.id);
        const otherTransactions = allUnsettledNow.filter(t => 
          !patchTransactionIds.includes(t.id)
        );
        
        if (otherTransactions.length > 0) {
          console.log(`\n🔧 Settling ${otherTransactions.length} other transactions (keeping patch transactions)...`);
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataPatch.ts:77',message:'Settling other transactions (idempotent path)',data:{otherCount:otherTransactions.length,otherIds:otherTransactions.map(t=>t.id.toString()),patchIds:patchTransactionIds.map(id=>id.toString())},timestamp:Date.now(),sessionId:'debug-session',runId:'debug-run2',hypothesisId:'FIX'})}).catch(()=>{});
          // #endregion
          const otherTransactionIds = otherTransactions.map(t => t.id);
          await tx.transaction.updateMany({
            where: { 
              id: { in: otherTransactionIds },
              isSettled: false
            },
            data: { isSettled: true },
          });
          console.log('✅ Other transactions settled');
        } else {
          console.log('   No other transactions to settle');
        }
      });
      
      // Verify final balance
      const finalBalance = await expenseService.calculateOutstandingBalance();
      console.log(`\n📊 Final balance:`);
      console.log(`   - Bryan owes: $${finalBalance.bryanOwes.toFixed(2)}`);
      console.log(`   - HweiYeen owes: $${finalBalance.hweiYeenOwes.toFixed(2)}`);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataPatch.ts:102',message:'Final balance after idempotent settlement',data:{bryanOwes:finalBalance.bryanOwes,hweiYeenOwes:finalBalance.hweiYeenOwes,target:TARGET_BALANCE},timestamp:Date.now(),sessionId:'debug-session',runId:'debug-run2',hypothesisId:'FIX'})}).catch(()=>{});
      // #endregion
      
      return;
    }

    // Step 5: Use database transaction for atomicity
    console.log('\n🔧 Processing patch within database transaction...');
    let transaction1: any;
    let transaction2: any;
    let settleCount = 0;

    await prisma.$transaction(async (tx) => {
      // Step 5a: Settle ALL unsettled transactions (fetch fresh list inside transaction to catch any created after initial fetch)
      // Only exclude patch transactions that we're about to create (they don't exist yet at this point)
      console.log(`   Fetching all unsettled transactions inside transaction...`);
      const allUnsettledInTx = await tx.transaction.findMany({
        where: { isSettled: false },
      });
      console.log(`   Found ${allUnsettledInTx.length} unsettled transactions to settle`);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataPatch.ts:117',message:'BEFORE settlement - all unsettled in transaction',data:{transactionIds:allUnsettledInTx.map(t=>t.id.toString()),count:allUnsettledInTx.length,transactions:allUnsettledInTx.map(t=>({id:t.id.toString(),amount:t.amountSGD,category:t.category,description:t.description?.substring(0,50)}))},timestamp:Date.now(),sessionId:'debug-session',runId:'debug-run2',hypothesisId:'FIX'})}).catch(()=>{});
      // #endregion
      
      if (allUnsettledInTx.length > 0) {
        const settleResult = await tx.transaction.updateMany({
          where: { 
            isSettled: false, // Settle ALL unsettled transactions (atomic, no race conditions)
          },
          data: { isSettled: true },
        });
        settleCount = settleResult.count;
        console.log(`   ✅ Settled ${settleCount} existing transactions`);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataPatch.ts:127',message:'AFTER settlement - all settled',data:{settledCount:settleCount},timestamp:Date.now(),sessionId:'debug-session',runId:'debug-run2',hypothesisId:'FIX'})}).catch(()=>{});
        // #endregion
      } else {
        console.log('   No existing transactions to settle');
      }

      // Step 5b: Create transactions to achieve target balance
      console.log('\n💸 Creating transactions to achieve target balance...');
      
      // To achieve HweiYeen owes $301.41: Bryan pays $602.82 with 50/50 split
      // HweiYeen's share = 602.82 * 0.5 = 301.41
      const transaction1Amount = COMPONENT_1 * 2; // $602.82
      console.log(`   Creating Transaction 1: Bryan pays $${transaction1Amount.toFixed(2)} (50/50 split) → HweiYeen owes $${COMPONENT_1.toFixed(2)}`);
      
      transaction1 = await tx.transaction.create({
        data: {
          amountSGD: transaction1Amount,
          currency: 'SGD',
          category: 'Data Patch',
          description: `Data patch: Component 1 (${COMPONENT_1.toFixed(2)})`,
          payerId: bryan.id,
          date: new Date(),
          isSettled: false,
          bryanPercentage: 0.5,
          hweiYeenPercentage: 0.5,
        },
      });
      console.log(`   ✅ Created transaction ID: ${transaction1.id}`);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataPatch.ts:150',message:'Created transaction1',data:{id:transaction1.id.toString(),amount:transaction1.amountSGD,payerId:transaction1.payerId.toString(),bryanPercent:transaction1.bryanPercentage,hweiYeenPercent:transaction1.hweiYeenPercentage,isSettled:transaction1.isSettled,expectedHweiYeenOwes:COMPONENT_1},timestamp:Date.now(),sessionId:'debug-session',runId:'debug-run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion

      // To achieve HweiYeen owes $173.85: Bryan pays $347.70 with 50/50 split
      // HweiYeen's share = 347.70 * 0.5 = 173.85
      const transaction2Amount = COMPONENT_2 * 2; // $347.70
      console.log(`   Creating Transaction 2: Bryan pays $${transaction2Amount.toFixed(2)} (50/50 split) → HweiYeen owes $${COMPONENT_2.toFixed(2)}`);
      
      transaction2 = await tx.transaction.create({
        data: {
          amountSGD: transaction2Amount,
          currency: 'SGD',
          category: 'Data Patch',
          description: `Data patch: Component 2 (${COMPONENT_2.toFixed(2)})`,
          payerId: bryan.id,
          date: new Date(),
          isSettled: false,
          bryanPercentage: 0.5,
          hweiYeenPercentage: 0.5,
        },
      });
      console.log(`   ✅ Created transaction ID: ${transaction2.id}`);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataPatch.ts:169',message:'Created transaction2',data:{id:transaction2.id.toString(),amount:transaction2.amountSGD,payerId:transaction2.payerId.toString(),bryanPercent:transaction2.bryanPercentage,hweiYeenPercent:transaction2.hweiYeenPercentage,isSettled:transaction2.isSettled,expectedHweiYeenOwes:COMPONENT_2},timestamp:Date.now(),sessionId:'debug-session',runId:'debug-run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      
      // Check all unsettled transactions after creation
      const allUnsettledAfterCreation = await tx.transaction.findMany({
        where: { isSettled: false },
      });
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataPatch.ts:177',message:'AFTER creation - all unsettled transactions',data:{count:allUnsettledAfterCreation.length,transactions:allUnsettledAfterCreation.map(t=>({id:t.id.toString(),amount:t.amountSGD,payerId:t.payerId.toString(),bryanPercent:t.bryanPercentage,hweiYeenPercent:t.hweiYeenPercentage,isSettled:t.isSettled,category:t.category,description:t.description}))},timestamp:Date.now(),sessionId:'debug-session',runId:'debug-run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
    });

    // Step 7: Verify the balance
    console.log('\n✅ Verification: Calculating final balance...');
    // Check actual database state before balance calculation
    const actualUnsettledInDb = await prisma.transaction.findMany({
      where: { isSettled: false },
      include: { payer: true },
    });
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataPatch.ts:187',message:'BEFORE balance calc - actual DB state',data:{unsettledCount:actualUnsettledInDb.length,transactions:actualUnsettledInDb.map(t=>({id:t.id.toString(),amount:t.amountSGD,payerId:t.payerId.toString(),payerRole:t.payer.role,bryanPercent:t.bryanPercentage,hweiYeenPercent:t.hweiYeenPercentage,isSettled:t.isSettled,category:t.category,description:t.description,expectedHweiYeenShare:(t.amountSGD*(t.hweiYeenPercentage??0.5))})),totalExpectedHweiYeenOwes:actualUnsettledInDb.reduce((sum,t)=>sum+(t.payerId===bryan.id?t.amountSGD*(t.hweiYeenPercentage??0.5):0),0)},timestamp:Date.now(),sessionId:'debug-session',runId:'debug-run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    const finalBalance = await expenseService.calculateOutstandingBalance();
    console.log(`   Final balance:`);
    console.log(`   - Bryan owes: $${finalBalance.bryanOwes.toFixed(2)}`);
    console.log(`   - HweiYeen owes: $${finalBalance.hweiYeenOwes.toFixed(2)}`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataPatch.ts:193',message:'Final balance calculation result',data:{bryanOwes:finalBalance.bryanOwes,hweiYeenOwes:finalBalance.hweiYeenOwes,targetBalance:TARGET_BALANCE,difference:Math.abs(finalBalance.hweiYeenOwes-TARGET_BALANCE)},timestamp:Date.now(),sessionId:'debug-session',runId:'debug-run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion

    // Check if target was achieved
    const balanceDifference = Math.abs(finalBalance.hweiYeenOwes - TARGET_BALANCE);
    if (balanceDifference < TOLERANCE) {
      console.log(`\n✅ SUCCESS! Target balance achieved: $${finalBalance.hweiYeenOwes.toFixed(2)} (target: $${TARGET_BALANCE.toFixed(2)})`);
      console.log(`   Components verified: $${COMPONENT_1.toFixed(2)} + $${COMPONENT_2.toFixed(2)} = $${(COMPONENT_1 + COMPONENT_2).toFixed(2)}`);
    } else {
      console.warn(`\n⚠️  WARNING: Balance mismatch!`);
      console.warn(`   Expected: $${TARGET_BALANCE.toFixed(2)}`);
      console.warn(`   Actual: $${finalBalance.hweiYeenOwes.toFixed(2)}`);
      console.warn(`   Difference: $${balanceDifference.toFixed(2)}`);
      throw new Error(`Balance verification failed. Expected ${TARGET_BALANCE}, got ${finalBalance.hweiYeenOwes}`);
    }

    // Step 8: Summary
    console.log('\n📋 Summary:');
    console.log(`   - Settled ${settleCount} existing transactions`);
    console.log(`   - Created 2 new transactions (IDs: ${transaction1.id}, ${transaction2.id})`);
    console.log(`   - Target balance achieved: HweiYeen owes Bryan $${TARGET_BALANCE.toFixed(2)}`);
    console.log('\n✅ Data patch completed successfully!');

  } catch (error: any) {
    console.error('\n❌ Error during data patch:');
    console.error(error);
    if (error.message) {
      console.error(`   Message: ${error.message}`);
    }
    if (error.stack) {
      console.error(`   Stack: ${error.stack}`);
    }
    throw error;
  } finally {
    // Always disconnect Prisma
    await prisma.$disconnect();
    console.log('\n🔌 Database connection closed');
  }
}

// Execute the script
dataPatch()
  .then(() => {
    console.log('\n✨ Script execution completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script execution failed');
    process.exit(1);
  });
