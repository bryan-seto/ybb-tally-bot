import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Hard reset balance to $301.41 (source of truth)
 * Then add medical bills on top to reach $457.38
 * 
 * Strategy:
 * 1. Find and identify the two medical transactions (Jane Yap & STO+G)
 * 2. Settle all OTHER transactions (keep medical ones unsettled)
 * 3. Create a "Balance Forward" adjustment transaction that results in $301.41 balance
 * 4. Verify final balance is $457.38
 */

async function resetBalanceForward() {
  try {
    console.log('🔄 Starting Balance Forward Reset...\n');
    console.log('='.repeat(80));

    // Get users
    const bryan = await prisma.user.findFirst({ where: { role: 'Bryan' } });
    const hweiYeen = await prisma.user.findFirst({ where: { role: 'HweiYeen' } });

    if (!bryan || !hweiYeen) {
      console.error('❌ Users not found!');
      return;
    }

    console.log(`✅ Found users: ${bryan.name} (ID: ${bryan.id}), ${hweiYeen.name} (ID: ${hweiYeen.id})\n`);

    // Find the two medical transactions (from screenshot: /110 and /109)
    console.log('🔍 Finding medical transactions...');
    
    // Try to find by ID first (most reliable)
    let janeYapTx = await prisma.transaction.findUnique({
      where: { id: BigInt(110) },
      include: { payer: true },
    });

    let stoGTx = await prisma.transaction.findUnique({
      where: { id: BigInt(109) },
      include: { payer: true },
    });

    // Fallback: search by description if IDs not found
    if (!janeYapTx) {
      const medicalTransactions = await prisma.transaction.findMany({
        where: {
          description: {
            contains: 'JANE YAP',
          },
        },
        include: { payer: true },
        orderBy: { id: 'desc' },
        take: 5,
      });
      janeYapTx = medicalTransactions.find(t => 
        t.description?.includes('JANE YAP') || t.description?.includes('CHEST & MEDICAL')
      );
    }

    if (!stoGTx) {
      const stoGTransactions = await prisma.transaction.findMany({
        where: {
          description: {
            contains: 'STO',
          },
        },
        include: { payer: true },
        orderBy: { id: 'desc' },
        take: 5,
      });
      stoGTx = stoGTransactions.find(t => 
        t.description?.includes('STO') && t.description?.includes('CLINIC')
      );
    }

    console.log('\n📋 Medical Transactions Found:');
    if (janeYapTx) {
      console.log(`   ✅ /${janeYapTx.id} - ${janeYapTx.description} - $${janeYapTx.amountSGD.toFixed(2)} (Paid by: ${janeYapTx.payer.name})`);
    } else {
      console.log('   ❌ Jane Yap transaction not found');
    }
    if (stoGTx) {
      console.log(`   ✅ /${stoGTx.id} - ${stoGTx.description} - $${stoGTx.amountSGD.toFixed(2)} (Paid by: ${stoGTx.payer.name})`);
    } else {
      console.log('   ❌ STO+G transaction not found');
    }

    if (!janeYapTx || !stoGTx) {
      console.log('\n⚠️  Could not find both medical transactions. Searching all recent transactions...\n');
      const allRecent = await prisma.transaction.findMany({
        where: { isSettled: false },
        include: { payer: true },
        orderBy: { id: 'desc' },
        take: 10,
      });
      console.log('Recent unsettled transactions:');
      allRecent.forEach(tx => {
        console.log(`   /${tx.id} - ${tx.description || 'No description'} - $${tx.amountSGD.toFixed(2)} - ${tx.category || 'No category'}`);
      });
      console.log('\n⚠️  Please verify the transaction IDs manually and update the script.');
      return;
    }

    const medicalIds = [janeYapTx.id, stoGTx.id];

    // Step 1: Settle all transactions EXCEPT the medical ones
    console.log('\n📝 Step 1: Settling all transactions except medical bills...');
    const settleResult = await prisma.transaction.updateMany({
      where: {
        id: { notIn: medicalIds },
        isSettled: false,
      },
      data: { isSettled: true },
    });
    console.log(`   ✅ Settled ${settleResult.count} transactions`);

    // Step 2: Calculate what balance forward transaction we need
    // We want: Final balance = $457.38
    // Current medical bills will contribute some amount
    // So we need: Balance Forward + Medical Contribution = $457.38
    // Which means: Balance Forward = $457.38 - Medical Contribution

    // Calculate what the medical bills contribute to the balance
    console.log('\n🧮 Step 2: Calculating medical bills contribution...');
    
    let medicalBryanPaid = 0;
    let medicalHweiYeenPaid = 0;
    let medicalBryanShare = 0;
    let medicalHweiYeenShare = 0;

    [janeYapTx, stoGTx].forEach((tx) => {
      if (tx.payerId === bryan.id) {
        medicalBryanPaid += tx.amountSGD;
      } else if (tx.payerId === hweiYeen.id) {
        medicalHweiYeenPaid += tx.amountSGD;
      }

      const bryanPercent = tx.bryanPercentage ?? 0.5;
      const hweiYeenPercent = tx.hweiYeenPercentage ?? 0.5;

      medicalBryanShare += tx.amountSGD * bryanPercent;
      medicalHweiYeenShare += tx.amountSGD * hweiYeenPercent;
    });

    const medicalBryanNet = medicalBryanPaid - medicalBryanShare;
    const medicalHweiYeenNet = medicalHweiYeenPaid - medicalHweiYeenShare;

    console.log(`   Medical bills - Bryan paid: $${medicalBryanPaid.toFixed(2)}, share: $${medicalBryanShare.toFixed(2)}, net: $${medicalBryanNet.toFixed(2)}`);
    console.log(`   Medical bills - HweiYeen paid: $${medicalHweiYeenPaid.toFixed(2)}, share: $${medicalHweiYeenShare.toFixed(2)}, net: $${medicalHweiYeenNet.toFixed(2)}`);

    // Calculate what balance forward should result in
    // Target: Final balance = $457.38 where HweiYeen owes Bryan
    // Medical contribution will be: Math.abs(medicalHweiYeenNet) if medicalHweiYeenNet < 0, or 0 if medicalBryanNet > 0
    let medicalContribution = 0;
    if (medicalBryanNet > 0 && medicalHweiYeenNet < 0) {
      medicalContribution = Math.abs(medicalHweiYeenNet);
    } else if (medicalHweiYeenNet > 0 && medicalBryanNet < 0) {
      medicalContribution = Math.abs(medicalBryanNet);
    } else {
      medicalContribution = Math.abs(medicalHweiYeenNet);
    }

    console.log(`   Medical bills will contribute: $${medicalContribution.toFixed(2)} to balance`);

    // Source of Truth: Balance Forward should be exactly $301.41
    const balanceForwardAmount = 301.41;
    console.log(`   Balance forward (Source of Truth): $${balanceForwardAmount.toFixed(2)}`);

    // Step 3: Create balance forward transaction
    // To get HweiYeen to owe Bryan $balanceForwardAmount:
    // - Bryan pays $balanceForwardAmount * 2 with 50/50 split
    // - This gives: Bryan paid = $balanceForwardAmount * 2, Bryan share = $balanceForwardAmount, Bryan net = $balanceForwardAmount
    // - HweiYeen paid = 0, HweiYeen share = $balanceForwardAmount, HweiYeen net = -$balanceForwardAmount
    // - Result: hweiYeenOwes = $balanceForwardAmount

    const balanceForwardTransactionAmount = balanceForwardAmount * 2;

    console.log('\n💰 Step 3: Creating Balance Forward transaction...');
    console.log(`   Amount: $${balanceForwardTransactionAmount.toFixed(2)}`);
    console.log(`   Payer: ${bryan.name}`);
    console.log(`   Split: 50/50 (Bryan 50%, HweiYeen 50%)`);
    console.log(`   Expected result: HweiYeen owes Bryan $${balanceForwardAmount.toFixed(2)}`);

    // Check if balance forward transaction already exists
    const existingBalanceForward = await prisma.transaction.findFirst({
      where: {
        description: { contains: 'Balance Forward' },
        isSettled: false,
      },
    });

    if (existingBalanceForward) {
      console.log(`\n⚠️  Balance Forward transaction already exists (ID: ${existingBalanceForward.id})`);
      console.log('   Updating existing transaction...');
      await prisma.transaction.update({
        where: { id: existingBalanceForward.id },
        data: {
          amountSGD: balanceForwardTransactionAmount,
          payerId: bryan.id,
          bryanPercentage: 0.5,
          hweiYeenPercentage: 0.5,
          category: 'Other',
          description: 'Balance Forward (Source of Truth: $301.41)',
          date: new Date(),
          isSettled: false,
        },
      });
      console.log(`   ✅ Updated transaction /${existingBalanceForward.id}`);
    } else {
      const balanceForward = await prisma.transaction.create({
        data: {
          amountSGD: balanceForwardTransactionAmount,
          currency: 'SGD',
          category: 'Other',
          description: 'Balance Forward (Source of Truth: $301.41)',
          payerId: bryan.id,
          date: new Date(),
          isSettled: false,
          bryanPercentage: 0.5,
          hweiYeenPercentage: 0.5,
        },
      });
      console.log(`   ✅ Created Balance Forward transaction /${balanceForward.id}`);
    }

    // Step 4: Verify the final balance
    console.log('\n✅ Step 4: Verifying final balance...');
    
    const allUnsettled = await prisma.transaction.findMany({
      where: { isSettled: false },
      include: { payer: true },
    });

    let totalBryanPaid = 0;
    let totalHweiYeenPaid = 0;
    let totalBryanShare = 0;
    let totalHweiYeenShare = 0;

    allUnsettled.forEach((t) => {
      if (t.payerId === bryan.id) {
        totalBryanPaid += t.amountSGD;
      } else if (t.payerId === hweiYeen.id) {
        totalHweiYeenPaid += t.amountSGD;
      }

      const bryanPercent = t.bryanPercentage ?? 0.5;
      const hweiYeenPercent = t.hweiYeenPercentage ?? 0.5;

      totalBryanShare += t.amountSGD * bryanPercent;
      totalHweiYeenShare += t.amountSGD * hweiYeenPercent;
    });

    const totalBryanNet = totalBryanPaid - totalBryanShare;
    const totalHweiYeenNet = totalHweiYeenPaid - totalHweiYeenShare;

    let finalBryanOwes = 0;
    let finalHweiYeenOwes = 0;

    if (totalBryanNet > 0 && totalHweiYeenNet < 0) {
      finalHweiYeenOwes = Math.abs(totalHweiYeenNet);
    } else if (totalHweiYeenNet > 0 && totalBryanNet < 0) {
      finalBryanOwes = Math.abs(totalBryanNet);
    } else if (totalBryanNet < 0 && totalHweiYeenNet < 0) {
      finalBryanOwes = Math.abs(totalBryanNet);
      finalHweiYeenOwes = Math.abs(totalHweiYeenNet);
    } else {
      finalBryanOwes = Math.max(0, -totalBryanNet);
      finalHweiYeenOwes = Math.max(0, -totalHweiYeenNet);
    }

    console.log(`\n📊 FINAL BALANCE CALCULATION:`);
    console.log(`   Unsettled transactions: ${allUnsettled.length}`);
    console.log(`   Bryan paid: $${totalBryanPaid.toFixed(2)}, share: $${totalBryanShare.toFixed(2)}, net: $${totalBryanNet.toFixed(2)}`);
    console.log(`   HweiYeen paid: $${totalHweiYeenPaid.toFixed(2)}, share: $${totalHweiYeenShare.toFixed(2)}, net: $${totalHweiYeenNet.toFixed(2)}`);
    console.log(`\n   💰 FINAL BALANCE:`);
    if (finalBryanOwes > 0) {
      console.log(`      Bryan owes HweiYeen: $${finalBryanOwes.toFixed(2)}`);
    }
    if (finalHweiYeenOwes > 0) {
      console.log(`      HweiYeen owes Bryan: $${finalHweiYeenOwes.toFixed(2)}`);
    }
    if (finalBryanOwes === 0 && finalHweiYeenOwes === 0) {
      console.log(`      ✅ All settled!`);
    }

    const expectedBalance = 457.38;
    const actualBalance = finalHweiYeenOwes > 0 ? finalHweiYeenOwes : finalBryanOwes;
    const difference = Math.abs(actualBalance - expectedBalance);

    console.log(`\n🎯 VERIFICATION:`);
    console.log(`   Expected final balance: $${expectedBalance.toFixed(2)}`);
    console.log(`   Actual final balance: $${actualBalance.toFixed(2)}`);
    console.log(`   Balance forward: $${balanceForwardAmount.toFixed(2)}`);
    console.log(`   Medical bills contribution: $${medicalContribution.toFixed(2)}`);
    console.log(`   Calculated total: $${(balanceForwardAmount + medicalContribution).toFixed(2)}`);
    
    if (difference < 0.01) {
      console.log(`\n   ✅ SUCCESS! Balance matches expected amount.`);
    } else {
      console.log(`\n   ⚠️  WARNING: Difference of $${difference.toFixed(2)}`);
      console.log(`   Note: Medical bills split percentages may need adjustment.`);
      console.log(`   If medical bills use custom splits, the contribution calculation may differ.`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Balance Forward Reset Complete!\n');

  } catch (error) {
    console.error('\n❌ Error during balance forward reset:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
resetBalanceForward()
  .then(() => {
    console.log('Script completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
