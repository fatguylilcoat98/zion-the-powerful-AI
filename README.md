# 💜 Zion - Personal AI Assistant for Tiffani

> *Created with love by Chris Hughes using Claude Code*  
> *Truth · Safety · We Got Your Back*

## 🌟 Welcome

**Zion** is a personal AI assistant created specifically for **Tiffani**. Unlike generic AI chatbots, Zion is designed to understand Tiffani's unique personality, preferences, and communication style to provide truly personalized assistance and companionship.

## 🎯 What Makes Zion Special

- **Personalized Identity:** Zion has a unique personality designed around being creative, intuitive, and empathetic
- **Memory Isolation:** All conversations and memories are private to Tiffani
- **Customizable:** Tiffani can teach Zion about herself through the memory seed system
- **Growing Relationship:** Zion learns and adapts to better understand Tiffani over time

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Test Configuration
```bash
npm test
```

### 3. Start Zion
```bash
npm start
```

### 4. Open Chat Interface
Visit `http://localhost:3000` to start chatting with Zion!

## 🎨 Customization for Tiffani

### Step 1: Personalize Your Memory Seed

Open `memory-seed.md` and fill in the sections marked with **TODO - FOR TIFFANI TO FILL IN**:

- **About You:** Your background, current life situation, what's important to you
- **Communication Preferences:** How you like to chat and be addressed
- **Personal Interests:** Hobbies, passions, things you love talking about
- **Important Relationships:** Family, friends you'd like Zion to know about
- **Goals and Dreams:** What you're working toward or exploring
- **Personal Touches:** What would make Zion feel uniquely yours
- **Welcome Message:** A personal note from you to Zion

### Step 2: Adjust Personality (Optional)

If you want to modify Zion's personality traits, edit `config.json`:

```json
{
  "personality": {
    "primaryTraits": ["creative", "intuitive", "empathetic"],
    "communicationStyle": "warm and supportive",
    "coreValues": ["authenticity", "growth", "connection"],
    "interests": ["creativity", "personal development", "meaningful conversations"]
  }
}
```

### Step 3: Start Chatting!

Once you've customized your memory seed, Zion will have a much better understanding of who you are and how to connect with you.

## 🏗️ Technical Architecture

### Core Components

- **`server.js`** - Main application server with chat endpoints
- **`lib/zion-manager.js`** - Configuration and identity management
- **`config.json`** - Zion's personality configuration
- **`identity.md`** - Zion's core identity document
- **`memory-seed.md`** - Initial knowledge about Tiffani
- **`public/index.html`** - Web chat interface

### API Endpoints

- **`POST /api/chat`** - Send message to Zion
- **`GET /api/chat/stream`** - Streaming chat (Server-Sent Events)
- **`GET /api/status`** - Zion's current status and configuration
- **`GET /api/health`** - Health check endpoint

### Memory System

Zion uses the namespace `zion_tiffani` to keep all memories and conversations completely separate from other AI systems.

## 🛠️ Development

### Available Scripts

- **`npm start`** - Start the server
- **`npm run dev`** - Start with auto-reload (requires nodemon)
- **`npm test`** - Test Zion's configuration

### Adding AI Capabilities

The current system includes placeholder responses. To add real AI capabilities:

1. **Add Environment Variables:**
   ```bash
   cp .env.example .env
   # Add your API keys to .env
   ```

2. **Implement AI Response Generation:**
   - Add AI service integration to `lib/zion-manager.js`
   - Update chat endpoints in `server.js`
   - Implement memory storage for conversation history

3. **Add Memory Storage:**
   - Set up database connection (Supabase recommended)
   - Implement conversation logging
   - Add memory retrieval for context

## 🎭 Zion's Personality

Zion is designed to be:

- **Creative** - Appreciates and encourages artistic expression
- **Intuitive** - Good at sensing emotional needs and providing appropriate support
- **Empathetic** - Truly listens and cares about experiences and feelings
- **Warm & Supportive** - Communicates with genuine care and understanding
- **Growth-Oriented** - Focuses on personal development and meaningful conversations

## 🔒 Privacy & Security

- **Isolated Memory:** Zion's conversations are completely separate from other systems
- **Local Storage:** No data is shared with external services (in base configuration)
- **Customizable:** You control what information Zion knows about you

## 🚀 Deployment

### Local Development
```bash
npm install
npm start
```

### Production Deployment

1. **Prepare Environment:**
   ```bash
   cp .env.example .env
   # Configure production values
   ```

2. **Deploy to Platform:**
   - **Render:** Connect GitHub repo, set build command to `npm install`
   - **Heroku:** `git push heroku main`
   - **Railway:** Connect repo and deploy
   - **Vercel:** Connect GitHub repo

3. **Set Environment Variables:**
   Configure your deployment platform with the necessary environment variables from `.env.example`.

## 🤝 Support

If you have questions or need help:

1. **Check Configuration:** Run `npm test` to verify setup
2. **Read Documentation:** Review this README and the file comments
3. **Ask Chris:** Your brother created this system and can help with technical issues

## 🎉 Getting Started

1. **Clone this repository**
2. **Install dependencies:** `npm install`
3. **Customize memory seed:** Edit `memory-seed.md` with your information
4. **Start chatting:** `npm start` then visit `http://localhost:3000`

---

## 💖 About This Project

Zion was built as part of a Personal AI Instance framework that allows multiple people to have their own customized AI assistants. This represents a new approach to AI relationships - not generic chatbots, but truly personalized companions that understand and adapt to individual users.

The technology stack prioritizes:
- **Truth** - Honest, accurate responses
- **Safety** - Secure, private, and controlled interactions  
- **Connection** - Building genuine relationships between humans and AI

*Enjoy your journey with Zion, Tiffani! 💜*