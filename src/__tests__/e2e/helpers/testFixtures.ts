import { prisma } from './prismaTestSetup';
import { UserRole } from '@prisma/client';

export async function createTestUsers() {
  // Create Bryan and HweiYeen users matching the actual schema
  const bryan = await prisma.user.upsert({
    where: { id: BigInt(1001) },
    update: {},
    create: {
      id: BigInt(1001),
      name: 'Bryan',
      role: 'Bryan' as UserRole,
    },
  });

  const hweiYeen = await prisma.user.upsert({
    where: { id: BigInt(1002) },
    update: {},
    create: {
      id: BigInt(1002),
      name: 'Hwei Yeen',
      role: 'HweiYeen' as UserRole,
    },
  });

  return { bryan, hweiYeen };
}

export async function createTestTransaction(data: {
  amountSGD: number;
  description: string;
  category: string;
  payerId: bigint;
  isSettled?: boolean;
  bryanPercentage?: number;
  hweiYeenPercentage?: number;
}) {
  return await prisma.transaction.create({
    data: {
      amountSGD: data.amountSGD,
      currency: 'SGD',
      description: data.description,
      category: data.category,
      payerId: data.payerId,
      isSettled: data.isSettled ?? false,
      bryanPercentage: data.bryanPercentage ?? 0.7,
      hweiYeenPercentage: data.hweiYeenPercentage ?? 0.3,
      date: new Date(),
    },
    include: {
      payer: true,
    },
  });
}

