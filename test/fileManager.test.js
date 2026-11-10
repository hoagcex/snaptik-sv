import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createDirectMediaStream, deleteLocalFile, sweepOrphanFiles } from '../src/fileManager.js';
import { config } from '../src/config.js';

test('createDirectMediaStream should stream bytes directly in memory and track size', async () => {
  const payload = Buffer.alloc(64 * 1024, 0x42);
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': String(payload.byteLength)
    });
    res.end(payload);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const { stream, contentLength, getTransferredBytes } = await createDirectMediaStream(
      `http://127.0.0.1:${port}/video.mp4`,
      1024 * 1024
    );
    assert.strictEqual(contentLength, payload.byteLength);

    let received = 0;
    for await (const chunk of stream) {
      received += chunk.byteLength;
    }
    assert.strictEqual(received, payload.byteLength);
    assert.strictEqual(getTransferredBytes(), payload.byteLength);
  } finally {
    server.close();
  }
});

test('deleteLocalFile should remove an existing file', async () => {
  const testFile = path.join(config.downloadsDir, `test_delete_${Date.now()}.tmp`);
  await fs.promises.writeFile(testFile, 'temporary test video data');
  assert.ok(fs.existsSync(testFile), 'File should exist before deletion');

  const deleted = await deleteLocalFile(testFile);
  assert.strictEqual(deleted, true);
  assert.ok(!fs.existsSync(testFile), 'File must be removed from disk');
});

test('deleteLocalFile should gracefully handle non-existent file', async () => {
  const nonExistent = path.join(config.downloadsDir, 'does_not_exist.tmp');
  const result = await deleteLocalFile(nonExistent);
  assert.strictEqual(result, false);
});

test('sweepOrphanFiles should clean old files while preserving gitkeep', async () => {
  const orphanFile = path.join(config.downloadsDir, 'orphan_old.tmp');
  await fs.promises.writeFile(orphanFile, 'old data');

  // Backdate mtime
  const pastTime = new Date(Date.now() - 25 * 60 * 1000);
  await fs.promises.utimes(orphanFile, pastTime, pastTime);

  await sweepOrphanFiles(15);
  assert.ok(!fs.existsSync(orphanFile), 'Old orphan file should be swept');
  assert.ok(fs.existsSync(path.join(config.downloadsDir, '.gitkeep')), '.gitkeep should never be swept');
});
