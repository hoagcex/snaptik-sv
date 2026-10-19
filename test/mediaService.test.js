import test from 'node:test';
import assert from 'node:assert';
import { getInstagramReel, getFacebookReel, fetchUniversalMedia } from '../src/mediaService.js';

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

test('fetchUniversalMedia should route instagram and facebook reels properly', async () => {
  const igRes = await fetchUniversalMedia('https://www.instagram.com/reel/C-fake_private_reel_12345/');
  assert.strictEqual(igRes.success, false);
  assert.strictEqual(igRes.isPrivate, true);

  const unknownRes = await fetchUniversalMedia('https://twitter.com/user/status/123456');
  assert.strictEqual(unknownRes.success, false);
  assert.strictEqual(unknownRes.platform, 'unknown');
});
