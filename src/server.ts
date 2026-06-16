import express, { Request, Response } from 'express';
import { YBBTallyBot } from './bot';
import { CONFIG } from './config';

export function setupServer(bot: YBBTallyBot) {
  const app = express();
  app.use(express.json());

  app.get('/', (req: Request, res: Response) => {
    res.status(200).send('Bot is alive');
  });

  app.get('/health', (req: Request, res: Response) => {
    // Health check should always return 200 once server is up
    // This allows Railway healthchecks to pass even during async initialization
    res.status(200).json({
      status: 'ok',
      message: 'Server is running',
      timestamp: new Date().toISOString()
    });
  });

  app.get('/webhook-status', async (req: Request, res: Response) => {
    try {
      const webhookInfo = await bot.getBot().telegram.getWebhookInfo();
      const botInfo = await bot.getBot().telegram.getMe();
      res.status(200).json({
        status: 'ok',
        bot: botInfo,
        webhook: webhookInfo,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to get webhook info', message: error.message });
    }
  });

  const webhookPath = '/webhook';
  app.use(webhookPath, bot.getBot().webhookCallback());

  app.listen(Number(CONFIG.PORT), '0.0.0.0', () => {
    console.log(`Server listening on port ${CONFIG.PORT}`);
  });

  return app;
}

