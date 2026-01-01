import { prisma } from '../lib/prisma';
import { AIService } from './ai';

export interface EditResult {
  success: boolean;
  message?: string; // Error message or success summary
  transaction?: any; // The updated transaction object (Prisma model)
  changes?: Array<{
    field: string;
    old: number | string; // number for amounts, string for text fields
    new: number | string;
  }>; // For the Diff view - only fields that actually changed
}

export class EditService {
  constructor(private aiService: AIService) {}

  async processEditCommand(userId: bigint, command: string): Promise<EditResult> {
    try {
      // 1. Parse Command
      const editMatch = command.match(/^edit\s+\/?(\d+)\s+(.+)$/i);
      if (!editMatch) {
        return { success: false, message: 'Invalid edit command format. Use: edit /ID [change]' };
      }

      const transactionId = BigInt(editMatch[1]);
      const instruction = editMatch[2].trim();

      if (!instruction) {
        return { success: false, message: 'Please provide an instruction. Use: edit /ID [change]' };
      }

      // 2. Fetch & Validate (Security Check)
      // Fetch user with group relation (if exists in schema)
      const user = await prisma.user.findUnique({
        where: { id: userId },
        // include: { group: true }, // TODO: Uncomment when Group model is added to schema
      });

      if (!user) {
        return { success: false, message: '❌ User not found.' };
      }

      // Fetch transaction with payer relation
      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: { payer: true },
      });

      if (!transaction) {
        return { success: false, message: `❌ Transaction /${editMatch[1]} not found.` };
      }

      // CRITICAL - Security Check: Validate groupId
      // Check if transaction has groupId and it matches user's group
      // This check only enforces if both groupIds exist (backwards compatible if groups not yet implemented)
      const transactionGroupId = (transaction as any).groupId;
      const userGroupId = (user as any).groupId || ((user as any).group as any)?.id;

      // Only enforce group check if both exist and don't match
      if (transactionGroupId !== undefined && transactionGroupId !== null &&
          userGroupId !== undefined && userGroupId !== null &&
          transactionGroupId !== userGroupId) {
        return {
          success: false,
          message: '❌ Unauthorized: You can only edit transactions in your group.',
        };
      }

      // Store original values for diff calculation
      const originalTransaction = {
        amountSGD: transaction.amountSGD,
        description: transaction.description,
        category: transaction.category,
      };

      // 3. Create Mini-DTO for AI processing
      // Note: amountSGD is Float in schema, so it's already a number
      const miniDTO = {
        description: transaction.description || 'Unknown',
        amount: Number(transaction.amountSGD), // amountSGD is Float, convert to ensure number type
        category: transaction.category || 'Other',
        date: transaction.date.toISOString().split('T')[0], // YYYY-MM-DD format
      };

      // 4. AI Processing
      const aiResult = await this.aiService.parseEditIntent(instruction, miniDTO);

      // Check if AI returned any valid fields (check for undefined, not falsy)
      const hasValidFields = 
        (aiResult.amount !== undefined && typeof aiResult.amount === 'number') ||
        (aiResult.description !== undefined && typeof aiResult.description === 'string') ||
        (aiResult.category !== undefined && typeof aiResult.category === 'string');

      if (!aiResult || !hasValidFields) {
        return {
          success: false,
          message: '❌ Sorry, I couldn\'t understand what to change. Try: "edit /15 20" or "edit /15 lunch"',
        };
      }

      // 5. Prepare update data
      const updateData: any = {};

      if (aiResult.amount !== undefined) {
        if (typeof aiResult.amount !== 'number' || aiResult.amount <= 0) {
          return { success: false, message: '❌ Invalid amount. Amount must be a positive number.' };
        }
        updateData.amountSGD = aiResult.amount;
      }

      if (aiResult.description !== undefined) {
        if (typeof aiResult.description !== 'string' || aiResult.description.trim().length === 0) {
          return { success: false, message: '❌ Invalid description. Description cannot be empty.' };
        }
        updateData.description = aiResult.description.trim();
      }

      if (aiResult.category !== undefined) {
        if (typeof aiResult.category !== 'string' || aiResult.category.trim().length === 0) {
          return { success: false, message: '❌ Invalid category. Category cannot be empty.' };
        }
        updateData.category = aiResult.category.trim();
      }

      // 6. Execute Update
      const updatedTransaction = await prisma.transaction.update({
        where: { id: transactionId },
        data: updateData,
        include: { payer: true },
      });

      // 7. Calculate Diff
      const changes: Array<{ field: string; old: number | string; new: number | string }> = [];

      if (aiResult.amount !== undefined) {
        // amountSGD is Float in schema, so it's already a number
        const oldAmount = Number(originalTransaction.amountSGD);
        const newAmount = Number(updatedTransaction.amountSGD);

        if (oldAmount !== newAmount) {
          changes.push({
            field: 'amountSGD',
            old: oldAmount,
            new: newAmount,
          });
        }
      }

      if (aiResult.description !== undefined) {
        const oldDesc = originalTransaction.description || '';
        const newDesc = updatedTransaction.description || '';

        if (oldDesc !== newDesc) {
          changes.push({
            field: 'description',
            old: oldDesc,
            new: newDesc,
          });
        }
      }

      if (aiResult.category !== undefined) {
        const oldCat = originalTransaction.category || '';
        const newCat = updatedTransaction.category || '';

        if (oldCat !== newCat) {
          changes.push({
            field: 'category',
            old: oldCat,
            new: newCat,
          });
        }
      }

      return {
        success: true,
        transaction: updatedTransaction,
        changes,
        message: `✅ Updated transaction /${editMatch[1]}`,
      };
    } catch (error: any) {
      console.error('[EditService] Error processing edit command:', error);
      return {
        success: false,
        message: `❌ Sorry, something went wrong: ${error.message || 'Unknown error'}`,
      };
    }
  }
}

