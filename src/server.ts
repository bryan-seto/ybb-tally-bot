import express, { Request, Response } from 'express';
import { YBBTallyBot } from './bot';
import { CONFIG } from './config';

export function setupServer(bot: YBBTallyBot) {
  const app = express();
  app.use(express.json());

  app.get('/', (req: Request, res: Response) => {
    console.log('[SERVER] Root endpoint hit');
    res.status(200).send('Bot is alive');
  });

  app.get('/health', (req: Request, res: Response) => {
    console.log('[SERVER] Health check endpoint hit');
    res.status(200).json({
      status: 'ok',
      message: 'Bot is alive',
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
  app.post(webhookPath, (req, res, next) => {
    console.log(`[WEBHOOK] Received update from Telegram`);
    console.log(`[WEBHOOK] Update type: ${req.body?.message ? 'message' : req.body?.callback_query ? 'callback_query' : 'other'}`);
    if (req.body?.message?.text) {
      console.log(`[WEBHOOK] Message text: ${req.body.message.text}`);
    }
    next();
  }, bot.getBot().webhookCallback(webhookPath));

  const server = app.listen(Number(CONFIG.PORT), '0.0.0.0', () => {
    console.log(`✅ Server listening on port ${CONFIG.PORT}`);
    console.log(`🌐 Health check: http://0.0.0.0:${CONFIG.PORT}/health`);
    console.log(`📡 Webhook endpoint: http://0.0.0.0:${CONFIG.PORT}/webhook`);
  });

  server.on('error', (error: any) => {
    console.error('❌ Server error:', error);
  });

  return app;
}

