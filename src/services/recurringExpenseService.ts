import { prisma } from '../lib/prisma';
import { getNow } from '../utils/dateHelpers';
import { ExpenseService } from './expenseService';

export interface ProcessRecurringExpenseResult {
  transaction: {
    id: bigint;
    description: string;
    amountSGD: number;
    category: string;
    payerName: string;
    payerRole: string;
  };
  balanceMessage: string;
}

export class RecurringExpenseService {
  constructor(private expenseService: ExpenseService) {}

  /**
   * Process a single recurring expense by creating a transaction
   * This method is used by both the cron job and the "Test Now" feature
   */
  async processSingleRecurringExpense(recurringExpenseId: bigint): Promise<ProcessRecurringExpenseResult> {
    // Fetch the recurring expense with payer information
    const recurringExpense = await prisma.recurringExpense.findUnique({
      where: { id: recurringExpenseId },
      include: { payer: true },
    });

    if (!recurringExpense) {
      throw new Error(`Recurring expense with ID ${recurringExpenseId} not found`);
    }

    if (!recurringExpense.isActive) {
      throw new Error(`Recurring expense with ID ${recurringExpenseId} is not active`);
    }

    // Create the transaction using the same logic as the cron job
    const transaction = await prisma.transaction.create({
      data: {
        amountSGD: recurringExpense.amountOriginal,
        currency: 'SGD',
        category: 'Bills',
        description: recurringExpense.description,
        payerId: recurringExpense.payerId,
        date: getNow(),
        splitType: 'FULL',
      },
      include: {
        payer: true,
      },
    });

    // Get the updated balance message
    const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();

    return {
      transaction: {
        id: transaction.id,
        description: transaction.description || recurringExpense.description,
        amountSGD: transaction.amountSGD,
        category: transaction.category || 'Bills',
        payerName: transaction.payer.name,
        payerRole: transaction.payer.role,
      },
      balanceMessage,
    };
  }
}

