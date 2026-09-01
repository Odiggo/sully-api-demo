import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../', import.meta.url);

test('retires the mixed note CLI and keeps a streaming-only entrypoint', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('package.json', repositoryRoot), 'utf8'),
  ) as { scripts?: Record<string, string> };

  assert.equal(packageJson.scripts?.['start:note'], undefined);
  assert.equal(packageJson.scripts?.['start:stream'], 'tsx sully-stream-demo.ts');
  await assert.rejects(access(new URL('sully-demo.ts', repositoryRoot)));

  const streamingCli = await readFile(
    new URL('sully-stream-demo.ts', repositoryRoot),
    'utf8',
  );
  assert.doesNotMatch(streamingCli, /\/v1\/notes|createStyle|demonstrateNote/);
});
