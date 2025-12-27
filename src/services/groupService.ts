import { prisma } from '../lib/prisma';

export class GroupService {
  /**
   * Get or create user by Telegram ID
   * Uses Telegram user object to get proper name (first_name, username, or fallback)
   */
  async getOrCreateUser(telegramId: number, telegramUser?: any): Promise<bigint> {
    let user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
    });

    // Get name from Telegram user object (prefer first_name, then username, then fallback)
    let name: string;
    if (telegramUser) {
      name = telegramUser.first_name || 
             (telegramUser.username ? `@${telegramUser.username}` : null) || 
             `User ${telegramId}`;
    } else {
      name = `User ${telegramId}`;
    }

    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId: BigInt(telegramId),
          name: name,
        },
      });
    } else if (name && user.name !== name && name !== `User ${telegramId}`) {
      // Update name if provided and different (but don't update if it's just the fallback)
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name },
      });
    }

    return user.id;
  }

  /**
   * Get group by chat ID
   */
  async getGroupByChatId(chatId: number) {
    return await prisma.group.findUnique({
      where: { chatId: BigInt(chatId) },
      include: {
        members: true,
        virtualUsers: {
          where: { linkedUserId: null },
        },
      },
    });
  }

  /**
   * Add member to group
   */
  async addMemberToGroup(groupId: bigint, userId: bigint): Promise<void> {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: true },
    });

    if (!group) {
      throw new Error('Group not found');
    }

    // Check if user is already a member
    const isMember = group.members.some((m) => m.id === userId);
    if (!isMember) {
      await prisma.group.update({
        where: { id: groupId },
        data: {
          members: {
            connect: { id: userId },
          },
        },
      });
    }
  }

  /**
   * Get all members (real + virtual) for a group
   */
  async getAllGroupMembers(groupId: bigint) {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: true,
        virtualUsers: true,
      },
    });

    if (!group) {
      return { realUsers: [], virtualUsers: [] };
    }

    return {
      realUsers: group.members,
      virtualUsers: group.virtualUsers,
    };
  }

  /**
   * Create virtual user
   */
  async createVirtualUser(groupId: bigint, name: string): Promise<bigint> {
    const virtualUser = await prisma.virtualUser.create({
      data: {
        groupId,
        name,
      },
    });

    return virtualUser.id;
  }

  /**
   * Merge virtual user to real user
   */
  async mergeVirtualToReal(
    virtualUserId: bigint,
    realUserId: bigint
  ): Promise<void> {
    // Update all splits that reference this virtual user
    await prisma.split.updateMany({
      where: { virtualDebtorId: virtualUserId },
      data: {
        virtualDebtorId: null,
        debtorId: realUserId,
      },
    });

    // Link virtual user to real user
    await prisma.virtualUser.update({
      where: { id: virtualUserId },
      data: {
        linkedUserId: realUserId,
      },
    });

    // Recalculate outstanding debt for the real user
    // (This would be done by summing all splits where they are debtors)
  }

  /**
   * Get unlinked virtual users with outstanding debt for a group
   */
  async getUnlinkedVirtualUsersWithDebt(groupId: bigint) {
    return await prisma.virtualUser.findMany({
      where: {
        groupId,
        linkedUserId: null,
        outstandingDebt: {
          gt: 0,
        },
      },
      include: {
        splits: {
          where: {
            expense: {
              isSettled: false,
            },
          },
        },
      },
    });
  }
}

