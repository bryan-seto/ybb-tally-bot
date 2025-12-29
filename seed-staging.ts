import { prisma } from './src/lib/prisma';
import { USER_IDS } from './src/config';
import dotenv from 'dotenv';

dotenv.config();

async function seedStaging() {
  console.log('🌱 Seeding staging data...');

  const bryanId = BigInt(USER_IDS.BRYAN);
  const hweiYeenId = BigInt(USER_IDS.HWEI_YEEN);

  // Add a few "unsettled" expenses to create a balance
  const transactions = [
    {
      description: 'Weekly Groceries',
      amountSGD: 90.00,
      payerId: bryanId,
      category: 'Groceries',
      isSettled: false,
    },
    {
      description: 'Dinner last night',
      amountSGD: 60.00,
      payerId: hweiYeenId,
      category: 'Food',
      isSettled: false,
    }
  ];

  for (const tx of transactions) {
    await prisma.transaction.create({ data: tx });
  }

  console.log('✅ Staging data seeded! You now have an active balance to test with.');
}

seedStaging()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());

