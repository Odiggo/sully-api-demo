# Sully API Demo
Demo code showcasing the Sully.ai API capabilities for healthcare tech companies to build on

## 🚀 Quick Start Guide

### Prerequisites
- Node.js 14+ installed ([Download](https://nodejs.org))
- Sully API credentials:
  - API Key
  - Account ID

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

### 📁 Project Structure
- `sully-demo.ts`: Main demo script
- `audio/`: Sample audio files
- `.env.example`: Environment template
- `README.md`: Documentation

### ⚠️ Important Notes
- Maximum audio file size: 30MB
- Supported audio formats: MP3, WAV, M4A, OGG
- API credentials must be valid and active