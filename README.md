# Sully API Demo
Demo code showcasing the Sully.ai API capabilities for healthcare tech companies to build on

## 🚀 Quick Start Guide

### Prerequisites
- Node.js 14+ installed ([Download](https://nodejs.org))
- Sully API credentials:
  - API Key
  - Account ID
- (optional)Audio file for transcription (MP3, WAV, M4A, or OGG format)

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
SULLY_API_KEY=your_api_key_here
SULLY_ACCOUNT_ID=your_account_id_here
```

### 🎯 Running the Demo
```bash
# Using the sample audio
npx ts-node sully-demo.ts audio/demo_audio.wav

# Or with your own audio file
npx ts-node sully-demo.ts path/to/your/audio.mp3
```

### 📋 Demo Workflow
The script demonstrates an example Sully API workflow:

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

### 📊 Example Output
```bash
🚀 Initializing Sully API Demo
ℹ️  Using API endpoint: https://dev01-copilot-api.np.services.sully.ai/api/v2/ext
ℹ️  Processing audio file: audio/demo_audio.wav

🚀 Step 1: Creating Note Style Template
✅ Note style template created successfully

🚀 Step 2: Transcribing Audio File
ℹ️  Starting audio transcription process...
✅ Audio transcription completed
📋 Transcription Result:
{
  "text": "[transcription content]"
}

... [additional output] ...
```

### 📁 Project Structure
- `sully-demo.ts`: Main demo script
- `audio/`: Sample audio files
- `.env.example`: Environment template
- `README.md`: Documentation

### ⚠️ Important Notes
- Maximum audio file size: 30MB
- Supported audio formats: MP3, WAV, M4A, OGG
- API credentials must be valid and active