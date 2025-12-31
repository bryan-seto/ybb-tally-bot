import { getNow, getDayOfMonth, getStartOfDay } from '../utils/dateHelpers';
import { prisma } from '../lib/prisma';
import { ExpenseService } from './expenseService';

export class RecurringExpenseService {
  constructor(private expenseService: ExpenseService) {}

  /**
   * Process a single recurring expense
   * @param expense - The recurring expense to process
   * @param force - If true, bypasses day-of-month and already-processed checks (for testing)
   * @returns The created transaction with balance message if processed, null if skipped
   */
  async processSingleRecurringExpense(expense: any, force: boolean = false): Promise<{ transaction: any; message: string } | null> {
    const today = getDayOfMonth();
    
    // Check if expense is due today (skip if force mode)
    if (!force && expense.dayOfMonth !== today) {
      return null;
    }
    
    // Check if already processed today (skip if force mode)
    if (!force && expense.lastProcessedDate) {
      const lastProcessed = getStartOfDay(expense.lastProcessedDate);
      const todayStart = getStartOfDay(getNow());
      
      if (lastProcessed.getTime() === todayStart.getTime()) {
        return null; // Already processed today
      }
    }
    
    // Create transaction
    const transaction = await prisma.transaction.create({
      data: {
        amountSGD: expense.amountOriginal,
        currency: 'SGD',
        category: 'Bills',
        description: expense.description,
        payerId: expense.payerId,
        date: getNow(),
        splitType: 'FULL',
      },
    });
    
    // Update lastProcessedDate
    await prisma.recurringExpense.update({
      where: { id: expense.id },
      data: { lastProcessedDate: getNow() },
    });
    
    // Get balance message using the injected service
    const message = await this.expenseService.getOutstandingBalanceMessage();
    
    return { transaction, message };
  }
}
