import { prisma } from '../lib/prisma';
import { GroupService } from './groupService';

export interface SplitMember {
  id: bigint;
  name: string;
  type: 'real' | 'virtual';
  isSelected: boolean;
}

export class SplitService {
  private groupService: GroupService;

  constructor() {
    this.groupService = new GroupService();
  }

  /**
   * Get all members for split selection (real + virtual)
   */
  async getSplitMembers(groupId: bigint): Promise<SplitMember[]> {
    const { realUsers, virtualUsers } =
      await this.groupService.getAllGroupMembers(groupId);

    const members: SplitMember[] = [
      ...realUsers.map((u) => ({
        id: u.id,
        name: u.name,
        type: 'real' as const,
        isSelected: true, // Default: all selected
      })),
      ...virtualUsers.map((v) => ({
        id: v.id,
        name: v.name,
        type: 'virtual' as const,
        isSelected: true, // Default: all selected
      })),
    ];

    return members;
  }

  /**
   * Create expense with splits
   */
  async createExpenseWithSplits(
    groupId: bigint,
    amount: number,
    description: string,
    category: string | null,
    payerId: bigint,
    payerType: 'real' | 'virtual',
    selectedMemberIds: bigint[],
    memberTypes: Map<bigint, 'real' | 'virtual'>
  ): Promise<bigint> {
    // Calculate split amount per person
    const splitAmount = amount / selectedMemberIds.length;

    // Create expense
    const expense = await prisma.expense.create({
      data: {
        groupId,
        amountSGD: amount,
        currency: 'SGD',
        category,
        description,
        payerId,
        payerType: payerType === 'real' ? 'real' : 'virtual',
        date: new Date(),
        isSettled: false,
      },
    });

    // Create splits for each selected member
    const splits = selectedMemberIds.map((memberId) => {
      const memberType = memberTypes.get(memberId) || 'real';
      return {
        expenseId: expense.id,
        amount: splitAmount,
        ...(memberType === 'real'
          ? { debtorId: memberId }
          : { virtualDebtorId: memberId }),
      };
    });

    await prisma.split.createMany({
      data: splits,
    });

    // Update virtual user outstanding debt
    for (const memberId of selectedMemberIds) {
      const memberType = memberTypes.get(memberId);
      if (memberType === 'virtual') {
        await prisma.virtualUser.update({
          where: { id: memberId },
          data: {
            outstandingDebt: {
              increment: splitAmount,
            },
          },
        });
      }
    }

    return expense.id;
  }

  /**
   * Format split preview message
   */
  formatSplitPreview(
    amount: number,
    members: SplitMember[]
  ): string {
    const selectedCount = members.filter((m) => m.isSelected).length;
    const splitAmount = selectedCount > 0 ? amount / selectedCount : 0;

    let message = `💰 **Expense Split Preview**\n\n`;
    message += `Amount: SGD $${amount.toFixed(2)}\n`;
    message += `Split between ${selectedCount} person(s): SGD $${splitAmount.toFixed(2)} each\n\n`;
    message += `**Participants:**\n`;

    members.forEach((member) => {
      const status = member.isSelected ? '✅' : '❌';
      message += `${status} ${member.name}\n`;
    });

    return message;
  }
}

