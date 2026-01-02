import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

async function diagnose() {
  console.log("🔍 FORENSIC DIAGNOSTIC: Transaction /96 Balance Analysis\n");
  console.log("=".repeat(80));

  // 1. Fetch transaction /96 by ID or description pattern
  const tx = await prisma.transaction.findFirst({
    where: {
      OR: [
        { id: BigInt(96) },
        { description: { contains: 'HY own Bryan' } }
      ]
    },
    include: {
      payer: true
    }
  });

  if (!tx) {
    console.error("❌ Transaction /96 not found. Check database.");
    return;
  }

  console.log("\n📊 TRANSACTION DATA:");
  console.log("-".repeat(80));
  console.log(`🆔 ID: ${tx.id}`);
  console.log(`📝 Description: ${tx.description}`);
  console.log(`💰 Amount: SGD $${tx.amountSGD.toFixed(2)}`);
  console.log(`👤 Payer: ${tx.payer.name} (ID: ${tx.payerId}, Role: ${tx.payer.role})`);
  console.log(`📊 Bryan Percentage: ${tx.bryanPercentage ?? 'NULL (defaults to 0.7)'}`);
  console.log(`📊 HY Percentage: ${tx.hweiYeenPercentage ?? 'NULL (defaults to 0.3)'}`);
  console.log(`🏁 Is Settled: ${tx.isSettled}`);
  console.log("-".repeat(80));

  // 2. Get user IDs for calculation
  const bryan = await prisma.user.findFirst({ where: { role: 'Bryan' } });
  const hweiYeen = await prisma.user.findFirst({ where: { role: 'HweiYeen' } });

  if (!bryan || !hweiYeen) {
    console.error("❌ Users not found in database.");
    return;
  }

  // 3. Manual calculation simulation (replicating expenseService.ts logic)
  const bryanPaid = tx.payerId === bryan.id ? tx.amountSGD : 0;
  const hweiYeenPaid = tx.payerId === hweiYeen.id ? tx.amountSGD : 0;
  
  const bryanPercent = tx.bryanPercentage ?? 0.7;
  const hweiYeenPercent = tx.hweiYeenPercentage ?? 0.3;
  
  const bryanShare = tx.amountSGD * bryanPercent;
  const hweiYeenShare = tx.amountSGD * hweiYeenPercent;
  
  const bryanOwes = Math.max(0, bryanShare - bryanPaid);
  const hweiYeenOwes = Math.max(0, hweiYeenShare - hweiYeenPaid);

  console.log("\n🧮 MANUAL CALCULATION (Single Transaction):");
  console.log("-".repeat(80));
  console.log(`   Bryan Paid: $${bryanPaid.toFixed(2)}`);
  console.log(`   HY Paid: $${hweiYeenPaid.toFixed(2)}`);
  console.log(`   Bryan's Share: $${bryanShare.toFixed(2)} (${(bryanPercent * 100).toFixed(1)}%)`);
  console.log(`   HY's Share: $${hweiYeenShare.toFixed(2)} (${(hweiYeenPercent * 100).toFixed(1)}%)`);
  console.log(`   Bryan Owes: $${bryanOwes.toFixed(2)} = max(0, ${bryanShare.toFixed(2)} - ${bryanPaid.toFixed(2)})`);
  console.log(`   HY Owes: $${hweiYeenOwes.toFixed(2)} = max(0, ${hweiYeenShare.toFixed(2)} - ${hweiYeenPaid.toFixed(2)})`);
  console.log("-".repeat(80));

  // 4. Diagnosis
  console.log("\n🔬 DIAGNOSIS:");
  console.log("-".repeat(80));
  
  if (bryanOwes === 0 && hweiYeenOwes === 0) {
    console.log("🚨 RESULT: Balance contribution from this transaction is $0.00");
    
    if (tx.bryanPercentage === 0 || tx.bryanPercentage === null) {
      if (tx.payerId === hweiYeen.id) {
        console.log("🔥 ROOT CAUSE: DATA CORRUPTION CONFIRMED");
        console.log(`   - Payer: HweiYeen (paid $${tx.amountSGD.toFixed(2)})`);
        console.log(`   - Bryan Percentage: ${tx.bryanPercentage ?? 'NULL'} (should be 1.0)`);
        console.log(`   - Expected: Bryan owes $${tx.amountSGD.toFixed(2)}`);
        console.log(`   - Actual: Bryan owes $0.00`);
        console.log("\n   ✅ VERDICT: Split percentages are incorrect. This is a DATA INTEGRITY issue.");
        console.log("   → Next Step: Create data correction script to fix percentages.");
      } else {
        console.log("⚠️  UNEXPECTED: Payer is Bryan but balance is zero. Investigate further.");
      }
    } else if (tx.bryanPercentage === 1.0 && bryanPaid === tx.amountSGD) {
      console.log("✅ EXPECTED: Bryan paid for his own expense. Balance correctly zero.");
    } else {
      console.log("⚠️  UNEXPECTED: Percentages seem correct but balance is zero.");
      console.log("   → Next Step: Check for other transactions that cancel this out.");
    }
  } else {
    console.log("✅ RESULT: This transaction correctly contributes to balance");
    console.log(`   - Bryan Owes: $${bryanOwes.toFixed(2)}`);
    console.log(`   - HY Owes: $${hweiYeenOwes.toFixed(2)}`);
    console.log("\n   ✅ VERDICT: Single transaction math is correct.");
    console.log("   → Next Step: Check global balance aggregation logic in calculateOutstandingBalance()");
  }

  // 5. Check all unsettled transactions for aggregation
  console.log("\n📋 ALL UNSETTLED TRANSACTIONS:");
  console.log("-".repeat(80));
  const allUnsettled = await prisma.transaction.findMany({
    where: { isSettled: false },
    include: { payer: true },
    orderBy: { id: 'desc' }
  });

  if (allUnsettled.length === 0) {
    console.log("✅ No unsettled transactions found.");
  } else {
    console.log(`Found ${allUnsettled.length} unsettled transaction(s):\n`);
    
    let totalBryanPaid = 0;
    let totalHYPaid = 0;
    let totalBryanShare = 0;
    let totalHYShare = 0;

    for (const t of allUnsettled) {
      const bPct = t.bryanPercentage ?? 0.7;
      const hPct = t.hweiYeenPercentage ?? 0.3;
      
      if (t.payerId === bryan.id) totalBryanPaid += t.amountSGD;
      if (t.payerId === hweiYeen.id) totalHYPaid += t.amountSGD;
      
      totalBryanShare += t.amountSGD * bPct;
      totalHYShare += t.amountSGD * hPct;
    }

    const netBryanOwes = Math.max(0, totalBryanShare - totalBryanPaid);
    const netHYOwes = Math.max(0, totalHYShare - totalHYPaid);

    console.log(`   Total Bryan Paid: $${totalBryanPaid.toFixed(2)}`);
    console.log(`   Total HY Paid: $${totalHYPaid.toFixed(2)}`);
    console.log(`   Total Bryan Share: $${totalBryanShare.toFixed(2)}`);
    console.log(`   Total HY Share: $${totalHYShare.toFixed(2)}`);
    console.log(`\n   Net Bryan Owes: $${netBryanOwes.toFixed(2)}`);
    console.log(`   Net HY Owes: $${netHYOwes.toFixed(2)}`);
    
    if (netBryanOwes === 0 && netHYOwes === 0) {
      console.log("\n   🚨 AGGREGATION RESULT: Net balance is $0.00");
      console.log("   → This explains why the dashboard shows 'All settled!'");
    }
  }
}

diagnose()
  .catch(e => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
