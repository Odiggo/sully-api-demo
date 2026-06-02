# Sully API Demo
Demo code showcasing the Sully.ai API capabilities for healthcare tech companies to build on

## 🚀 Quick Start Guide

### Prerequisites
- Node.js 18+ installed ([Download](https://nodejs.org))
- Sully API credentials:
  - API Key
  - Account ID
  - API URL
- System audio dependencies for streaming demos:
  ```bash
  # Ubuntu/Debian
  sudo apt-get install sox libsox-fmt-all

  # macOS
  brew install sox

  # Windows
  # Download and install Sox from https://sourceforge.net/projects/sox/
  ```

### 🛠️ Setup
1. Clone the repository:
```bash
git clone https://github.com/Odiggo/sully-api-demo.git
cd sully-api-demo
```

2. Install dependencies:
```bash
npm install
# or if you prefer bun:
# bun install
```

3. Configure environment:
```bash
# Create .env file with your Sully API credentials:
cp .env.example .env
# Edit .env with your actual values:
SULLY_API_URL=your_api_url_here
SULLY_API_KEY=your_api_key_here
SULLY_ACCOUNT_ID=your_account_id_here
```

### 🎯 Running the Demos

#### Browser-Based Demo (Default)
```bash
# Start the web server — browser opens automatically
npm start
```

Before recording, configure:

- **Language** — tags from [supported languages](https://docs.sully.ai/api-reference/audio-transcriptions/languages) (including `multi`)
- **Session duration** — manual stop, or auto-stop at 30s / 1m / 5m
- **Dictation formatting** — sends `dictation=true` on the WebSocket
- **Word debug** — optional table of word timings/confidence from the API

**Session flow:** Click record → *initializing* (token) → *connecting* (WebSocket) → *live* (mic + transcript). The timer runs only while live. **Space** toggles record when focus is not in a form field.

**Transcript:** Italic = interim · solid = finalized. **Copy** exports text; **New session** clears transcript and event log.

Settings persist in `localStorage`. On load, `GET /health` checks `.env` and shows a setup banner if credentials are missing.

### Browser demo troubleshooting

| Symptom | What to try |
|--------|-------------|
| Setup banner on load | Set `SULLY_API_KEY`, `SULLY_ACCOUNT_ID`, `SULLY_API_URL` in `.env` and restart `pnpm start` |
| Mic denied | Allow microphone for `localhost` in browser settings |
| No transcript while “live” | Confirm status pill is *connected*; check event log for `ERROR` |
| Connection lost banner | Network blip — demo retries up to 5 times; start a new session if it fails |
| 16 kHz error | Use Chrome or close other apps using the microphone |

#### File Transcription & Note Generation Demo
```bash
# Basic demo with default sample audio file
npm run start:note

# With custom audio file
npx tsx sully-demo.ts note /path/to/your/audio.wav
```

#### Live Audio Streaming Demo
```bash
# Server-side streaming (10-second default)
npm run start:stream

# Client-side streaming with custom duration
npx tsx sully-demo.ts stream -m client -d 20

# With specific language
npx tsx sully-demo.ts stream -l en-US -d 15
```

### 📋 Demo Workflow
The script demonstrates three main Sully API capabilities:

#### 1. File Transcription & Note Generation
1. **Note Style Creation**
   - Sets up custom formatting rules
   - Configures note structure preferences

2. **Audio Transcription**
   - Validates audio file format and size
   - Uploads/transcribes audio via Sully API
   - Retrieves transcription results

3. **Clinical Note Generation**
   - Processes transcription
   - Applies note style template
   - Generates structured clinical note

4. **Note Management**
   - Retrieves formatted note
   - Demonstrates note deletion

#### 2. Live Audio Streaming (Optional)
- Real-time audio capture and transcription
- Streams microphone input directly to Sully API
- Shows live transcription results
- Configurable duration (default: 10 seconds)
- Supports both client-side and server-side streaming modes

#### 3. Browser-Based Demo
- Interactive web interface for real-time transcription
- WebSocket-based streaming directly from browser
- Visual status indicators and controls
- Accessible at `http://localhost:3000` after starting the server

To use the browser demo:
1. Start the server: `pnpm start`
2. Browser opens at `http://localhost:3000`
3. Confirm there is no setup banner (`http://localhost:3000/health` should report `"ok": true`)
4. Choose language, duration, and options; click **record**
5. Grant microphone permission when prompted
6. Speak — interim text appears italic; finalized phrases turn solid
7. Click **stop**, wait for auto-stop, or press **Space** to end/start

### 📊 Example Output

#### File Transcription Demo
```bash
🚀 Initializing Sully API Demo
ℹ️  Using API endpoint: https://api.sully.ai
ℹ️  Processing audio file: audio/demo_audio.wav

🚀 Step 1: Creating Note Style Template
ℹ️  Configuring note style with sample format and instructions...
✅ Note style template created successfully

🚀 Step 2: Transcribing Audio File
ℹ️  Starting audio transcription process...
ℹ️  Reading audio file...
ℹ️  Uploading audio...
ℹ️  Transcription ID: tr_abc123xyz
ℹ️  Waiting for transcription...
ℹ️  Waiting for transcription...
✅ Audio transcription completed
📋 Transcription Result:
{
  "text": "Patient is a 45-year-old female presenting with severe headache for the past 3 days. Pain is described as throbbing and located in the frontal region. Patient rates pain as 8/10. No previous history of migraines..."
}

🚀 Step 3: Generating Clinical Note
ℹ️  Creating clinical note from transcription...
✅ Clinical note created with ID: note_def456uvw

🚀 Step 4: Retrieving Generated Note
ℹ️  Fetching the generated clinical note...
ℹ️  Note still processing...
ℹ️  Note still processing...
✅ Note retrieved successfully
📋 Generated Note Content:
{
  "soap": {
    "subjective": {
      "chiefComplaint": "Headache",
      "hpi": {
        "onset": "3 days ago",
        "severity": "8/10",
        "quality": "throbbing",
        "location": "frontal region",
        "associated_symptoms": [],
        "modifying_factors": []
      },
      "pmh": {
        "migraines": "No previous history",
        "chronic_conditions": [],
        "medications": []
      },
      "allergies": [],
      "family_history": [],
      "social_history": {}
    },
    "objective": {
      "vital_signs": {},
      "physical_exam": {}
    },
    "assessment": {
      "diagnoses": [],
      "differential_diagnoses": []
    },
    "plan": {
      "medications": [],
      "tests": [],
      "procedures": [],
      "follow_up": ""
    }
  }
}

🚀 Step 5: Cleanup
ℹ️  Deleting note with ID: note_def456uvw
✅ Note deleted successfully
✅ Demo completed successfully
```

#### Streaming Demo Output
```bash
🎤 ==========================================
🎤 LIVE AUDIO STREAMING IS NOW ACTIVE
🎤 Start speaking! Your voice will be transcribed in real-time
🎤 ==========================================

⏱️  Time remaining: 9 seconds
🗣️  Hello, this is a test of the streaming audio...
🗣️  The transcription appears in real-time as you speak...

🎤 ==========================================
🎤 STREAMING DEMO COMPLETED
🎤 ==========================================
```

### 📁 Project Structure
```
sully-api-demo/
├── audio/
│   └── demo_audio.wav          # Sample audio file for testing
├── dist/                       # Compiled TypeScript output
├── .data/                      # Runtime data directory
├── sully-demo.ts              # Main CLI demo script
├── server.ts                  # Express server for browser demo
├── sully-browser-demo.ts      # Browser-based streaming client
├── demo.html                  # Web interface for browser demo
├── package.json               # Dependencies and scripts
├── tsconfig.json              # TypeScript configuration
├── tsconfig.browser.json      # Browser-specific TypeScript config
├── .env                       # Environment variables (create from .env.example)
├── .gitignore                 # Git ignore rules
├── .prettierrc.yml           # Code formatting configuration
└── README.md                  # This file
```

### 🔧 Available Scripts
- `npm start` - Build and launch the browser demo (opens automatically)
- `npm run start:note` - Run the file transcription & note generation demo
- `npm run start:stream` - Run the live audio streaming demo
- `npm test` - Run tests (placeholder)

### 🎵 Supported Audio Formats
The API supports the following audio formats for file transcription:
- `.mp3` - MPEG Audio Layer 3
- `.wav` - Waveform Audio File Format
- `.m4a` - MPEG-4 Audio
- `.ogg` - Ogg Vorbis

### 🔑 Environment Variables
Required environment variables in your `.env` file:
- `SULLY_API_URL` - The Sully API endpoint URL
- `SULLY_API_KEY` - Your API key for authentication
- `SULLY_ACCOUNT_ID` - Your account identifier

Optional:
- `PORT` - Port for the browser demo server (default: 3000)

### 🛠️ Development
The project uses TypeScript with ES modules. Key technologies:
- **TypeScript** - Type-safe JavaScript
- **Node.js** - Runtime environment
- **Express** - Web server for browser demo
- **WebSocket** - Real-time streaming communication
- **Commander.js** - CLI argument parsing
- **node-microphone** - Audio capture for streaming

### 🔍 Troubleshooting
- **Audio file not found**: Ensure the audio file path is correct and the file exists
- **API authentication errors**: Verify your `.env` file contains valid credentials
- **Microphone access denied**: Grant microphone permissions in your browser/system
- **WebSocket connection failed**: Check your network connection and API endpoint
- **Transcription timeout**: Large audio files may take longer to process

### 📚 API Documentation
For detailed API documentation and additional features, visit the [Sully AI Documentation](https://docs.sully.ai).