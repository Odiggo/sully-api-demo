/**
 * Simple Express server to serve the Sully AI browser demo
 */
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

// Get the root directory (one level up from dist)
const rootDir = path.join(__dirname, '..');

// Serve static files from root and dist directories
app.use(express.static(rootDir));
app.use('/dist', express.static(__dirname));

// Serve the demo page at the root URL
app.get('/', (req: express.Request, res: express.Response) => {
  const htmlPath = path.join(rootDir, 'demo.html');
  console.log('Serving HTML from:', htmlPath);
  res.sendFile(htmlPath);
});

// Remove the api-config endpoint and add a token endpoint
app.post(
  '/streaming-token',
  async (req: express.Request, res: express.Response) => {
    try {
      const response = await fetch(
        `${process.env.SULLY_API_URL}/audio/transcriptions/stream/token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': process.env.SULLY_API_KEY || '',
            'X-Account-Id': process.env.SULLY_ACCOUNT_ID || '',
          },
          body: JSON.stringify({ expiresIn: 60 }),
        },
      );

      if (!response.ok) {
        throw new Error('Failed to get streaming token');
      }

      const data = await response.json();
      res.json({
        token: data.data.token,
        apiUrl: process.env.SULLY_API_URL,
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
  console.log(`🚀 Server running at http://localhost:${port}`);
  console.log('📋 Available routes:');
  console.log(`   - http://localhost:${port}/ (Demo page)`);
  console.log(
    `   - http://localhost:${port}/dist/sully-browser-demo.js (Browser client)`,
  );
  console.log('\n📂 Serving files from:');
  console.log(`   Root: ${rootDir}`);
  console.log(`   Dist: ${__dirname}`);
});
