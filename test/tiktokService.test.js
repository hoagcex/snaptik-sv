import test from 'node:test';
import assert from 'node:assert';
import { formatDuration, formatBytes, getTikTokVideo } from '../src/tiktokService.js';
import { config } from '../src/config.js';

test('formatDuration should correctly format durations', () => {
  assert.strictEqual(formatDuration(45), '45s');
  assert.strictEqual(formatDuration(62), '1m 02s');
  assert.strictEqual(formatDuration(120), '2m 00s');
  assert.strictEqual(formatDuration(125), '2m 05s');
});

test('formatBytes should correctly format file sizes', () => {
  assert.strictEqual(formatBytes(1024), '1.00 KB');
  assert.strictEqual(formatBytes(1048576), '1.00 MB');
  assert.strictEqual(formatBytes(16937255), '16.15 MB');
});

test('config limits should be valid and enforce Telegram cloud limits', () => {
  assert.ok(config.maxDurationSeconds > 0, 'Duration limit must be positive');
  assert.ok(config.maxFileSizeMB > 0, 'Max file size must be positive');
  assert.ok(config.telegramUploadLimitMB <= 50 || config.isLocalBotApi, 'Cloud upload limit must not exceed 50MB unless local Bot API is enabled');
});

test('getTikTokVideo should fetch valid video info within duration limit', async () => {
  const url = 'https://www.tiktok.com/@tobz2k19/video/7451777267107187986';
  const result = await getTikTokVideo(url);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.mediaType, 'video');
  assert.ok(result.data.videoUrl, 'Video URL must be present');
  assert.ok(result.data.duration <= 120, 'Duration must be under 120 seconds');
});

test('getTikTokVideo should fetch photo post images', async () => {
  const photoUrl = 'https://www.tiktok.com/@tx_thao/photo/7696854617610571024';
  const result = await getTikTokVideo(photoUrl);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.mediaType, 'photo');
  assert.ok(result.data.images?.length > 0, 'Photos array must not be empty');
});
