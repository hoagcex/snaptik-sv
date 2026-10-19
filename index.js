import { config } from './src/config.js';
import { createBot } from './src/bot.js';
import { createServer } from './src/server.js';
import { sweepOrphanFiles } from './src/fileManager.js';

async function main() {
  console.log('='.repeat(50));
  console.log('🚀 Starting SnapTik TikTok Telegram Bot');
  console.log(`📦 Node.js Version: ${process.version}`);
  console.log(`⏱️ Duration Limit: < ${config.maxDurationSeconds}s (2 minutes)`);
  console.log(`📦 File Size Limit: ${config.maxFileSizeMB} MB`);
  console.log(`📁 Local Storage: ${config.downloadsDir}`);
  console.log('='.repeat(50));

  // Clean any leftover orphan files from previous runs
  await sweepOrphanFiles(0);

  // Set up periodic sweep every 20 minutes
  setInterval(() => sweepOrphanFiles(20), 20 * 60 * 1000);

  // Initialize Bot
  const bot = createBot();

  // Initialize Express App
  const app = createServer(bot);

  // Start Express Server
  const server = app.listen(config.port, () => {
    console.log(`🌐 Express web dashboard running at http://localhost:${config.port}`);
    console.log(`🩺 Health check available at http://localhost:${config.port}/health`);
  });

  // Start Bot Polling or Webhook
  if (bot) {
    if (config.isWebhookMode) {
      console.log(`🔗 Configuring Telegram Webhook to: ${config.webhookUrl}/webhook`);
      await bot.api.setWebhook(`${config.webhookUrl}/webhook`);
      console.log('✅ Webhook registered with Telegram.');
    } else {
      console.log('🤖 Starting Telegram Bot in Long Polling mode...');
      bot.start({
        onStart: (botInfo) => {
          console.log(`✅ Telegram Bot @${botInfo.username} is ONLINE and ready!`);
        }
      }).catch((err) => {
        console.error('❌ Failed to start Telegram Bot polling:', err.message);
      });
    }
  } else {
    console.warn('⚠️ Bot is not connected because TELEGRAM_BOT_TOKEN is missing.');
    console.warn('👉 Please create a .env file with your token from @BotFather.');
  }

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    if (bot) {
      try {
        await bot.stop();
      } catch (e) {}
    }
    server.close(() => {
      console.log('👋 Express server closed. Goodbye!');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
