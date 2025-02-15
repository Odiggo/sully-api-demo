# Sully API Demo
Demo code showcasing the Sully.ai API capabilities for healthcare tech companies to build on

## 🚀 Quick Start Guide

### Prerequisites
- Node.js 14+ installed ([Download](https://nodejs.org))
- Sully API credentials:
  - API Key
  - Account ID
- System audio dependencies:
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
```

3. Configure environment:
```bash
# Create/Edit .env with your details:
SULLY_API_URL=your_api_url_here
SULLY_API_KEY=your_api_key_here
SULLY_ACCOUNT_ID=your_account_id_here
```

### 🎯 Running the Demo
```bash
# Basic demo with file transcription
npx tsx sully-demo.ts note

# With custom audio file
npx tsx sully-demo.ts note /path/audio.wav

# Include live streaming demo (10-second default)
npx tsx sully-demo.ts stream

# Client side with custom duration
npx tsx sully-demo.ts stream -m client -d 20

# Start the browser-based demo
npm run start:browser
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

#### 3. Browser-Based Demo
- Interactive web interface for real-time transcription
- WebSocket-based streaming directly from browser
- Visual status indicators and controls
- Accessible at `http://localhost:3000` after starting the server

To use the browser demo:
1. Start the server: `npm run start:browser`
2. Open `http://localhost:3000` in your browser
3. Click "Start Recording" to begin streaming
4. Grant microphone permissions when prompted
5. Speak into your microphone to see real-time transcription
6. Click "Stop Recording" to end the session

### 📊 Example Output

#### File Transcription Demo
```bash
🚀 Initializing Sully API Demo
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
- `sully-demo.ts`: Main demo script
- `server.ts`: Express server for browser demo
- `sully-browser-demo.ts`: Browser-based streaming implementation
- `demo.html`: Web interface for browser demo
- `audio/`: Sample audio files
- `.env.example`: Environment template
- `README.md`: Documentation

### ⚠️ Important Notes
- Maximum audio file size: 50MB
- Supported audio formats: MP3, WAV, M4A, OGG
- API credentials must be valid and active
- Microphone access required for streaming demo
- System audio dependencies (sox) required for streaming
- Browser demo requires modern browser with WebSocket support
- Microphone permissions required for browser-based streaming