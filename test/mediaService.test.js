import test from 'node:test';
import assert from 'node:assert';
import { getInstagramReel, getFacebookReel, getTwitterVideo, fetchUniversalMedia } from '../src/mediaService.js';

test('getInstagramReel should detect private/restricted reel and show cannot download message', async () => {
  const privateUrl = 'https://www.instagram.com/reel/C-fake_private_reel_12345/';
  const result = await getInstagramReel(privateUrl);

  assert.strictEqual(result.success, false, 'Private reel must not succeed');
  assert.strictEqual(result.isPrivate, true, 'isPrivate must be true');
  assert.ok(result.error.includes('Cannot download'), 'Error must state Cannot download');
  assert.ok(result.error.includes('not public, restricted, or cannot be seen'), 'Error must state reason');
});

test('getFacebookReel should detect private/restricted reel and show cannot download message', async () => {
  const privateUrl = 'https://www.facebook.com/reel/999999999999999999';
  const result = await getFacebookReel(privateUrl);

  assert.strictEqual(result.success, false, 'Non-existent or private FB reel must not succeed');
  assert.strictEqual(result.isPrivate, true, 'isPrivate must be true');
  assert.ok(result.error.includes('Cannot download'), 'Error must state Cannot download');
  assert.ok(result.error.includes('not public, restricted, or cannot be seen'), 'Error must state reason');
});

test('getTwitterVideo should detect missing video or private tweet and handle gracefully', async () => {
  const fakeTweet = 'https://x.com/fake_user_1234/status/999999999999999999';
  const result = await getTwitterVideo(fakeTweet);

  assert.strictEqual(result.success, false);
  assert.ok(
    result.error.includes('No video found') || result.error.includes('Cannot download'),
    'Error must explain no video found or cannot download'
  );
});

test('getTwitterVideo should successfully download a public X video within limits', async () => {
  const publicTweet = 'https://x.com/NgocQuuw/status/2096870832626897041?s=20';
  const result = await getTwitterVideo(publicTweet);

  assert.strictEqual(result.success, true, 'Public tweet video must succeed');
  assert.strictEqual(result.platform, 'twitter');
  assert.strictEqual(result.mediaType, 'video');
  assert.ok(result.data.filePath, 'Downloaded file path must be present');
  assert.ok(result.data.sizeBytes > 0, 'Size must be greater than 0');
  assert.ok(result.data.duration <= 120, 'Duration must be within 120 seconds limit');

  // Clean up
  const { deleteLocalFile } = await import('../src/fileManager.js');
  await deleteLocalFile(result.data.filePath);
});
