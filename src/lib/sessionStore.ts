import { prisma } from './prisma';

export const prismaSessionStore = {
  async get(key: string) {
    try {
      const session = await prisma.session.findUnique({ where: { id: key } });
      return session ? JSON.parse(session.data) : undefined;
    } catch (error) {
      console.error('Error getting session from Prisma:', error);
      return undefined;
    }
  },
  async set(key: string, data: any) {
    try {
      await prisma.session.upsert({
        where: { id: key },
        update: { data: JSON.stringify(data) },
        create: { id: key, data: JSON.stringify(data) },
      });
    } catch (error) {
      console.error('Error saving session to Prisma:', error);
    }
  },
  async delete(key: string) {
    try {
      await prisma.session.delete({ where: { id: key } });
    } catch (error) {
      // Ignore errors if session doesn't exist
    }
  },
};

