/*
 * ZION - Personal AI Assistant for Tiffani
 * Built by Christopher Hughes · Sacramento, CA
 * Created with Claude Code
 * Truth · Safety · We Got Your Back
 *
 * Dedicated server for Zion - Tiffani's personal AI
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const { getZionInstance, generateZionResponse } = require('./lib/zion-manager');
const { transcribeAudio, textToSpeech, getVoiceConfig, validateAudioFormat, isVoiceAvailable } = require('./lib/zion-voice');

// Configure multer for audio uploads
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const supportedTypes = ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/m4a'];
    if (supportedTypes.includes(file.mimetype) || file.originalname.match(/\.(mp3|mp4|wav|webm|m4a)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported audio format'), false);
    }
  }
});

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      mediaSrc: ["'self'", "blob:", "data:"],
      connectSrc: ["'self'", "https:", "wss:"]
    }
  }
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGINS?.split(',') || true
    : true,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from public directory
app.use(express.static('public'));

// ═══════════════════════════════════════════════════════════════════════════════
// ZION CHAT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Main chat endpoint for Zion
 * POST /api/chat
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId = 'tiffani' } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log(`[ZION] Processing message from ${userId}: "${message.substring(0, 50)}..."`);

    // Load Zion's configuration and identity
    const zion = await getZionInstance();

    // Generate AI response using Claude with memory integration
    const response = await generateZionResponse(message, userId);

    res.json({
      response,
      zion: {
        name: zion.config.instanceName,
        humanName: zion.config.humanName,
        memoryNamespace: zion.memoryNamespace
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[ZION] Chat error:', error.message);
    res.status(500).json({
      error: 'Sorry, I encountered an error. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Streaming chat endpoint for Zion
 * GET /api/chat/stream
 */
app.get('/api/chat/stream', async (req, res) => {
  try {
    const { message, userId = 'tiffani' } = req.query;

    if (!message) {
      return res.status(400).json({ error: 'Message parameter is required' });
    }

    // Set up Server-Sent Events headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const zion = await getZionInstance();

    // Send connection confirmation
    res.write(`data: ${JSON.stringify({
      type: 'connected',
      message: `Hello Tiffani! Zion is ready to chat.`
    })}\n\n`);

    // Generate AI response and stream it back
    const response = await generateZionResponse(message, userId);

    // Stream the response word by word for better UX
    const words = response.split(' ');
    for (let i = 0; i < words.length; i++) {
      const chunk = words[i] + ' ';
      res.write(`data: ${JSON.stringify({
        type: 'chunk',
        content: chunk
      })}\n\n`);

      // Small delay to create natural streaming effect
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Send completion signal
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      memoryNamespace: zion.memoryNamespace
    })}\n\n`);

    res.end();

  } catch (error) {
    console.error('[ZION] Streaming error:', error.message);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: 'Sorry, I encountered an error while streaming.'
    })}\n\n`);
    res.end();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ZION VOICE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transcribe audio to text
 * POST /api/zion/transcribe
 */
app.post('/api/zion/transcribe', audioUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    console.log(`[ZION VOICE] Received audio file: ${req.file.originalname} (${req.file.size} bytes)`);

    // Validate audio format
    validateAudioFormat(req.file.originalname, req.file.buffer);

    // Transcribe audio
    const transcript = await transcribeAudio(req.file.buffer, req.file.originalname);

    res.json({
      transcript,
      filename: req.file.originalname,
      size: req.file.size,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[ZION VOICE] Transcription error:', error.message);
    res.status(500).json({
      error: 'Failed to transcribe audio',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Process audio with parallel transcription and AI response
 * POST /api/zion/voice-chat
 */
app.post('/api/zion/voice-chat', audioUpload.single('audio'), async (req, res) => {
  try {
    const { userId = 'tiffani', generateSpeech = 'true' } = req.body;
    const shouldGenerateSpeech = generateSpeech === 'true';

    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    console.log(`[ZION VOICE] Processing voice chat: ${req.file.originalname} (${req.file.size} bytes)`);

    // Validate audio format
    validateAudioFormat(req.file.originalname, req.file.buffer);

    // Run transcription and AI processing in parallel
    const [transcriptionResult, aiResponseResult] = await Promise.allSettled([
      // Transcribe audio to text
      transcribeAudio(req.file.buffer, req.file.originalname),

      // Process audio directly for AI response with optional voice output
      (async () => {
        // First transcribe for AI processing
        const transcript = await transcribeAudio(req.file.buffer, req.file.originalname);

        // Generate AI response
        const aiResponse = await generateZionResponse(transcript, userId);

        // Generate voice response only if requested
        let audioBuffer = null;
        if (shouldGenerateSpeech) {
          const voiceConfig = getVoiceConfig();
          audioBuffer = await textToSpeech(aiResponse, voiceConfig);
        }

        return {
          transcript,
          aiResponse,
          audioBuffer
        };
      })()
    ]);

    // Handle transcription result
    let transcript = '';
    if (transcriptionResult.status === 'fulfilled') {
      transcript = transcriptionResult.value;
    } else {
      console.error('[ZION VOICE] Transcription failed:', transcriptionResult.reason);
    }

    // Handle AI response result
    let aiResponse = '';
    let audioData = null;
    if (aiResponseResult.status === 'fulfilled') {
      const result = aiResponseResult.value;
      transcript = result.transcript; // Use the transcript from AI processing
      aiResponse = result.aiResponse;
      if (result.audioBuffer) {
        audioData = result.audioBuffer.toString('base64');
      }
    } else {
      console.error('[ZION VOICE] AI processing failed:', aiResponseResult.reason);
      aiResponse = 'I had trouble processing your message. Could you try again?';
    }

    res.json({
      transcript,
      response: aiResponse,
      audio: audioData ? {
        data: audioData,
        format: 'mp3',
        voice: 'onyx'
      } : null,
      zion: {
        name: 'Zion',
        humanName: 'Tiffani',
        memoryNamespace: 'zion_tiffani'
      },
      timestamp: new Date().toISOString(),
      processingTime: {
        parallel: true,
        note: 'Transcription and AI response processed simultaneously'
      }
    });

  } catch (error) {
    console.error('[ZION VOICE] Voice chat error:', error.message);
    res.status(500).json({
      error: 'Failed to process voice message',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Chat endpoint specifically for Zion with voice integration
 * POST /api/zion/chat
 */
app.post('/api/zion/chat', async (req, res) => {
  try {
    const { message, userId = 'tiffani', generateSpeech = false } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log(`[ZION] Processing message from ${userId}: "${message.substring(0, 50)}..."`);

    // Generate AI response using Claude with memory integration
    const response = await generateZionResponse(message, userId);

    const result = {
      response,
      zion: {
        name: 'Zion',
        humanName: 'Tiffani',
        memoryNamespace: 'zion_tiffani'
      },
      timestamp: new Date().toISOString()
    };

    // Generate speech if requested
    if (generateSpeech) {
      try {
        const voiceConfig = getVoiceConfig();
        const audioBuffer = await textToSpeech(response, voiceConfig);

        // Convert to base64 for JSON response
        result.audio = {
          data: audioBuffer.toString('base64'),
          format: 'mp3',
          voice: voiceConfig.voice
        };
      } catch (speechError) {
        console.error('[ZION VOICE] Speech generation failed:', speechError.message);
        result.speechError = 'Failed to generate speech';
      }
    }

    res.json(result);

  } catch (error) {
    console.error('[ZION] Chat error:', error.message);
    res.status(500).json({
      error: 'Sorry, I encountered an error. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Generate speech from text
 * POST /api/zion/speak
 */
app.post('/api/zion/speak', async (req, res) => {
  try {
    const { text, voice = 'onyx', speed = 1.0 } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    console.log(`[ZION VOICE] Generating speech: "${text.substring(0, 50)}..."`);

    const voiceConfig = { voice, speed };
    const audioBuffer = await textToSpeech(text, voiceConfig);

    // Set appropriate headers for audio response
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Content-Disposition': 'inline; filename="zion-response.mp3"'
    });

    res.send(audioBuffer);

  } catch (error) {
    console.error('[ZION VOICE] Speech generation error:', error.message);
    res.status(500).json({
      error: 'Failed to generate speech',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Get voice capabilities status
 * GET /api/zion/voice-status
 */
app.get('/api/zion/voice-status', (req, res) => {
  try {
    const voiceStatus = isVoiceAvailable();
    const voiceConfig = getVoiceConfig();

    res.json({
      available: voiceStatus.configured,
      speechToText: voiceStatus.speechToText,
      textToSpeech: voiceStatus.textToSpeech,
      voiceConfig: voiceConfig,
      supportedFormats: ['mp3', 'mp4', 'wav', 'webm', 'm4a']
    });

  } catch (error) {
    console.error('[ZION VOICE] Voice status error:', error.message);
    res.status(500).json({
      error: 'Failed to get voice status',
      available: false
    });
  }
});

/**
 * Get Zion's current configuration and status
 * GET /api/status
 */
app.get('/api/status', async (req, res) => {
  try {
    const zion = await getZionInstance();

    res.json({
      name: "Zion",
      status: "active",
      humanName: zion.config.humanName,
      personality: zion.config.personality,
      memoryNamespace: zion.memoryNamespace,
      systemPromptLength: zion.systemPrompt.length,
      version: require('./package.json').version,
      customizationStatus: checkCustomizationStatus()
    });

  } catch (error) {
    console.error('[ZION] Status error:', error.message);
    res.status(500).json({
      error: 'Unable to get status',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Health check endpoint
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Zion Personal AI'
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC FILE SERVING & FALLBACK
// ═══════════════════════════════════════════════════════════════════════════════

// Serve the main chat interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if Tiffani has customized her memory seed
 */
function checkCustomizationStatus() {
  const fs = require('fs');
  try {
    const memorySeed = fs.readFileSync('./memory-seed.md', 'utf8');
    const todoCount = (memorySeed.match(/TODO - FOR TIFFANI TO FILL IN/g) || []).length;

    return {
      hasCustomized: todoCount === 0,
      remainingTodos: todoCount,
      status: todoCount === 0 ? 'fully_customized' : 'needs_customization'
    };
  } catch (error) {
    return {
      hasCustomized: false,
      status: 'error',
      error: 'Unable to read memory seed file'
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER STARTUP
// ═══════════════════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                    ZION - Personal AI Assistant                 ║');
  console.log('║                        Created for Tiffani                       ║');
  console.log('║                 Truth · Safety · We Got Your Back               ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`🤖 Zion is ready and listening on port ${PORT}`);
  console.log(`🌐 Chat interface: http://localhost:${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api/chat`);
  console.log(`📊 Status check: http://localhost:${PORT}/api/status`);
  console.log();
  console.log('💜 Welcome to your personal AI journey, Tiffani!');

  // Environment variable status check
  console.log('\n🔍 Environment Configuration:');
  console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL ? '✅ Set' : '❌ Missing'}`);
  console.log(`   SUPABASE_SERVICE_KEY: ${process.env.SUPABASE_SERVICE_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`   ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`   OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);

  // Database connection test
  const { getZionInstance } = require('./lib/zion-manager');
  try {
    console.log('\n🗃️  Testing database connection...');
    // Test if supabase is initialized
    const testInstance = getZionInstance();
    console.log('   ✅ Zion memory system ready');
  } catch (error) {
    console.log(`   ❌ Database connection failed: ${error.message}`);
  }

  // Check customization status on startup
  const customization = checkCustomizationStatus();
  if (customization.status === 'needs_customization') {
    console.log(`⚠️  Customize me: ${customization.remainingTodos} TODOs remaining in memory-seed.md`);
  } else if (customization.status === 'fully_customized') {
    console.log('✨ Fully customized and ready for deep conversations!');
  }
});