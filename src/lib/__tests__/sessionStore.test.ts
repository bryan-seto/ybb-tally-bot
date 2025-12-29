import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaSessionStore } from '../sessionStore';
import { prisma } from '../prisma';

vi.mock('../prisma', () => ({
  prisma: {
    session: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe('PrismaSessionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('get', () => {
    it('should return parsed session data when session exists', async () => {
      const mockSession = { id: 'test-key', data: '{"userId":"123","step":"confirm"}' };
      vi.mocked(prisma.session.findUnique).mockResolvedValue(mockSession);

      const result = await prismaSessionStore.get('test-key');

      expect(prisma.session.findUnique).toHaveBeenCalledWith({ where: { id: 'test-key' } });
      expect(result).toEqual({ userId: '123', step: 'confirm' });
    });

    it('should return undefined when session does not exist', async () => {
      vi.mocked(prisma.session.findUnique).mockResolvedValue(null);

      const result = await prismaSessionStore.get('non-existent-key');

      expect(result).toBeUndefined();
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(prisma.session.findUnique).mockRejectedValue(new Error('DB Error'));

      const result = await prismaSessionStore.get('error-key');

      expect(result).toBeUndefined();
    });
  });

  describe('set', () => {
    it('should upsert session data', async () => {
      const sessionData = { userId: '456', step: 'pending' };
      vi.mocked(prisma.session.upsert).mockResolvedValue({
        id: 'test-key',
        data: JSON.stringify(sessionData),
      });

      await prismaSessionStore.set('test-key', sessionData);

      expect(prisma.session.upsert).toHaveBeenCalledWith({
        where: { id: 'test-key' },
        update: { data: JSON.stringify(sessionData) },
        create: { id: 'test-key', data: JSON.stringify(sessionData) },
      });
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(prisma.session.upsert).mockRejectedValue(new Error('DB Error'));

      await expect(prismaSessionStore.set('error-key', { test: 'data' })).resolves.not.toThrow();
    });
  });

  describe('delete', () => {
    it('should delete session', async () => {
      vi.mocked(prisma.session.delete).mockResolvedValue({ id: 'test-key', data: '{}' });

      await prismaSessionStore.delete('test-key');

      expect(prisma.session.delete).toHaveBeenCalledWith({ where: { id: 'test-key' } });
    });

    it('should handle errors gracefully when session does not exist', async () => {
      vi.mocked(prisma.session.delete).mockRejectedValue(new Error('Not found'));

      await expect(prismaSessionStore.delete('non-existent-key')).resolves.not.toThrow();
    });
  });
});

