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
   * For VIP users (109284773, 424894363), only return database members
   * For all other groups, get all Telegram group members
   */
  async getSplitMembers(
    groupId: bigint,
    chatId?: number,
    telegramBot?: any,
    payerTelegramId?: number
  ): Promise<SplitMember[]> {
    // Check if payer is VIP (only Bryan and HweiYeen should use database-only flow)
    const VIP_IDS = [109284773, 424894363];
    const isVIP = payerTelegramId && VIP_IDS.includes(payerTelegramId);

    if (isVIP) {
      // Legacy flow: Only use database members (Bryan and HweiYeen)
      const { realUsers, virtualUsers } =
        await this.groupService.getAllGroupMembers(groupId);

      const members: SplitMember[] = [
        ...realUsers.map((u) => ({
          id: u.id,
          name: u.name,
          type: 'real' as const,
          isSelected: true,
        })),
        ...virtualUsers.map((v) => ({
          id: v.id,
          name: v.name,
          type: 'virtual' as const,
          isSelected: true,
        })),
      ];

      return members;
    }

    // New flow: Get all Telegram group members
    const members: SplitMember[] = [];

    if (chatId && telegramBot) {
      try {
        // Get all chat members from Telegram
        const chatMembers = await telegramBot.telegram.getChatMembersCount(chatId);
        
        // Get administrators (they're always members)
        const administrators = await telegramBot.telegram.getChatAdministrators(chatId);
        
        // Add all administrators as members
        for (const admin of administrators) {
          if (!admin.user.is_bot) {
            const userId = await this.groupService.getOrCreateUser(
              admin.user.id,
              admin.user.first_name || `User ${admin.user.id}`
            );
            members.push({
              id: userId,
              name: admin.user.first_name || admin.user.username || `User ${admin.user.id}`,
              type: 'real' as const,
              isSelected: true,
            });
          }
        }

        // Note: Telegram API doesn't provide a direct way to get all members
        // So we'll use database members + virtual users as fallback
        // Users will be added to database as they interact with the bot
        const { realUsers, virtualUsers } =
          await this.groupService.getAllGroupMembers(groupId);

        // Add database members (excluding duplicates)
        const existingIds = new Set(members.map(m => m.id.toString()));
        for (const user of realUsers) {
          if (!existingIds.has(user.id.toString())) {
            members.push({
              id: user.id,
              name: user.name,
              type: 'real' as const,
              isSelected: true,
            });
          }
        }

        // Add virtual users
        for (const virtual of virtualUsers) {
          members.push({
            id: virtual.id,
            name: virtual.name,
            type: 'virtual' as const,
            isSelected: true,
          });
        }
      } catch (error) {
        console.error('Error getting Telegram members, falling back to database:', error);
        // Fallback to database members
        const { realUsers, virtualUsers } =
          await this.groupService.getAllGroupMembers(groupId);
        
        members.push(
          ...realUsers.map((u) => ({
            id: u.id,
            name: u.name,
            type: 'real' as const,
            isSelected: true,
          })),
          ...virtualUsers.map((v) => ({
            id: v.id,
            name: v.name,
            type: 'virtual' as const,
            isSelected: true,
          }))
        );
      }
    } else {
      // Fallback: use database members
      const { realUsers, virtualUsers } =
        await this.groupService.getAllGroupMembers(groupId);

      members.push(
        ...realUsers.map((u) => ({
          id: u.id,
          name: u.name,
          type: 'real' as const,
          isSelected: true,
        })),
        ...virtualUsers.map((v) => ({
          id: v.id,
          name: v.name,
          type: 'virtual' as const,
          isSelected: true,
        }))
      );
    }

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
    members: SplitMember[],
    description?: string,
    payerTelegramId?: number,
    isManual?: boolean
  ): string {
    const selectedCount = members.filter((m) => m.isSelected).length;
    const splitAmount = selectedCount > 0 ? amount / selectedCount : 0;
    const VIP_IDS = [109284773, 424894363];
    const isVIP = payerTelegramId && VIP_IDS.includes(payerTelegramId);

    // Use different header for manual vs receipt
    const header = isManual 
      ? `✏️ **Manually Entered:** SGD $${amount.toFixed(2)}`
      : `🧾 **Receipt Scanned:** SGD $${amount.toFixed(2)}`;
    
    let message = `${header}\n`;
    if (description) {
      message += `**Description:** ${description}\n`;
    }
    message += `**Paid by:** You\n`;
    
    if (isVIP) {
      message += `**Split with:** Database members (${selectedCount} people)\n\n`;
    } else {
      message += `**Split with:** ${selectedCount} person${selectedCount !== 1 ? 's' : ''}\n\n`;
    }
    
    message += `**Share:** SGD $${splitAmount.toFixed(2)} each\n\n`;
    message += `**Participants:**\n`;

    members.forEach((member) => {
      const status = member.isSelected ? '✅' : '❌';
      message += `${status} ${member.name}\n`;
    });

    return message;
  }
}

