# Sully API Demo
Demo code and apps for how to use the Sully.ai public API

## Quick Start Guide

### Prerequisites
- Node.js 14+ installed ([Download](https://nodejs.org))
- A Sully API account with:
  - API Key
  - Account ID

### Setup
```bash
# Clone the repository
git clone https://github.com/Odiggo/sully-api-demo.git
cd sully-api-demo

# Install dependencies
npm install

# Configure your environment
cp .env.example .env
# Edit .env with your API credentials:
# SULLY_API_KEY=your_api_key_here
# SULLY_ACCOUNT_ID=your_account_id_here
```

### Run the Demo
```bash
# Run with the included sample audio
npx ts-node sully-demo.ts audio/demo_audio.wav

# Or run with your own audio file (MP3, WAV, M4A, or OGG format, max 30MB)
npx ts-node sully-demo.ts path/to/your/audio.mp3
```

### What the Demo Shows
The demo script demonstrates:
1. Audio transcription
2. Clinical note generation
3. Custom note styling
4. Note retrieval and management

### Example Output
```bash
=== Creating Note Style ===
Note style created successfully

=== Transcribing Audio ===
Reading audio file...
Uploading audio...
Transcription complete
Text: [transcription output]

=== Creating Clinical Note ===
Note created: note_abc123

=== Retrieving Note ===
Note content: [formatted clinical note]

=== Cleaning Up ===
Note deleted successfully
```

### Sample Files
- `audio/demo_audio.wav`: Sample audio file for testing
- `sample-note.txt`: Example note format for custom styling