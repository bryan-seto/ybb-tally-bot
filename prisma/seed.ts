import { PrismaClient, UserRole } from '@prisma/client';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // 1. Clear existing data
  await prisma.transaction.deleteMany();
  await prisma.recurringExpense.deleteMany();
  await prisma.systemLog.deleteMany();
  await prisma.user.deleteMany();

  // 2. Create Users
  const bryan = await prisma.user.create({
    data: {
      name: 'Bryan',
      role: UserRole.Bryan,
      id: BigInt(109284773), // Matching CONFIG.BRYAN
    },
  });

  const hweiYeen = await prisma.user.create({
    data: {
      name: 'Hwei Yeen',
      role: UserRole.HweiYeen,
      id: BigInt(424894363), // Matching CONFIG.HWEI_YEEN
    },
  });

  const users = [bryan, hweiYeen];
  const categories = ['Food', 'Transport', 'Shopping', 'Bills', 'Travel', 'Other'];

  // 3. Create Transactions (last 30 days)
  console.log('💸 Creating transactions...');
  for (let i = 0; i < 50; i++) {
    const payer = faker.helpers.arrayElement(users);
    const amount = parseFloat(faker.commerce.price({ min: 5, max: 200 }));
    const date = faker.date.recent({ days: 30 });

    await prisma.transaction.create({
      data: {
        amountSGD: amount,
        currency: 'SGD',
        category: faker.helpers.arrayElement(categories),
        description: faker.commerce.productName(),
        payerId: payer.id,
        date: date,
        isSettled: faker.datatype.boolean(0.8), // 80% settled
      },
    });
  }

  // 4. Create some unsettled transactions
  console.log('💰 Creating unsettled transactions...');
  for (let i = 0; i < 10; i++) {
    const payer = faker.helpers.arrayElement(users);
    const amount = parseFloat(faker.commerce.price({ min: 10, max: 100 }));
    
    await prisma.transaction.create({
      data: {
        amountSGD: amount,
        currency: 'SGD',
        category: faker.helpers.arrayElement(categories),
        description: faker.commerce.productName(),
        payerId: payer.id,
        date: new Date(),
        isSettled: false,
      },
    });
  }

  console.log('✅ Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

