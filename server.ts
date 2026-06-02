/**
 * Simple Express server to serve the Sully AI browser demo
 */
import { execFile } from 'child_process';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

// ES module equivalents for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Get the root directory (one level up from dist)
const rootDir = path.join(__dirname, '..');

// Serve static files from root and dist directories
app.use(express.static(rootDir));
app.use('/dist', express.static(__dirname));

// Serve AudioWorklet script — must be a real URL, cannot be bundled
// Note: the worklet is in the dist/ subdirectory of the package
app.use(
  '/audio-worklet',
  express.static(
    path.join(rootDir, 'node_modules/@speechmatics/browser-audio-input/dist'),
  ),
);

app.get('/health', (_req: express.Request, res: express.Response) => {
  const hasApiKey = Boolean(process.env.SULLY_API_KEY);
  const hasAccountId = Boolean(process.env.SULLY_ACCOUNT_ID);
  const hasApiUrl = Boolean(process.env.SULLY_API_URL);
  res.json({
    ok: hasApiKey && hasAccountId && hasApiUrl,
    hasApiKey,
    hasAccountId,
    hasApiUrl,
  });
});

// Serve the demo page at the root URL
app.get('/', (req: express.Request, res: express.Response) => {
  const htmlPath = path.join(rootDir, 'demo.html');
  console.log('Serving HTML from:', htmlPath);
  res.sendFile(htmlPath);
});

function resolveTokenExpiresIn(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : NaN;
  if (!Number.isFinite(parsed)) {
    return 3600;
  }
  return Math.min(604_800, Math.max(60, Math.floor(parsed)));
}

app.post(
  '/streaming-token',
  async (req: express.Request, res: express.Response) => {
    try {
      const response = await fetch(
        `${process.env.SULLY_API_URL}/v1/audio/transcriptions/stream/token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': process.env.SULLY_API_KEY || '',
            'X-Account-Id': process.env.SULLY_ACCOUNT_ID || '',
          },
          body: JSON.stringify({
            expiresIn: resolveTokenExpiresIn(req.body?.expiresIn),
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Failed to get streaming token');
      }

      const data = await response.json();
      res.json({
        token: data.data.token,
        apiUrl: `${process.env.SULLY_API_URL}/v1`,
        accountId: process.env.SULLY_ACCOUNT_ID,
      });
    } catch (error) {
      console.error('Token generation error:', error);
      res.status(500).json({ error: 'Failed to generate streaming token' });
    }
  },
);

// Error handler for file serving
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error('Error:', err);
    res.status(500).send('Server error: ' + err.message);
  },
);

// Start the server
app.listen(port, () => {
  const url = `http://localhost:${port}`;
  if (process.platform === 'win32') {
    execFile('cmd.exe', ['/c', 'start', url]);
  } else {
    execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
  }

  console.log(`🚀 Server running at http://localhost:${port}`);
  console.log('📋 Available routes:');
  console.log(`   - http://localhost:${port}/ (Demo page)`);
  console.log(`   - http://localhost:${port}/health (Setup check)`);
  console.log(
    `   - http://localhost:${port}/dist/sully-browser-demo.js (Browser client)`,
  );
  console.log('\n📂 Serving files from:');
  console.log(`   Root: ${rootDir}`);
  console.log(`   Dist: ${__dirname}`);
});
