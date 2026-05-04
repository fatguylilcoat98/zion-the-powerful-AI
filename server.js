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
require('dotenv').config();

const { getZionInstance, generateZionResponse } = require('./lib/zion-manager');

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
    })}\\n\\n`);

    // Generate AI response and stream it back
    const response = await generateZionResponse(message, userId);

    // Stream the response word by word for better UX
    const words = response.split(' ');
    for (let i = 0; i < words.length; i++) {
      const chunk = words[i] + ' ';
      res.write(`data: ${JSON.stringify({
        type: 'chunk',
        content: chunk
      })}\\n\\n`);

      // Small delay to create natural streaming effect
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Send completion signal
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      memoryNamespace: zion.memoryNamespace
    })}\\n\\n`);

    res.end();

  } catch (error) {
    console.error('[ZION] Streaming error:', error.message);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: 'Sorry, I encountered an error while streaming.'
    })}\\n\\n`);
    res.end();
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

  // Check customization status on startup
  const customization = checkCustomizationStatus();
  if (customization.status === 'needs_customization') {
    console.log(`⚠️  Customize me: ${customization.remainingTodos} TODOs remaining in memory-seed.md`);
  } else if (customization.status === 'fully_customized') {
    console.log('✨ Fully customized and ready for deep conversations!');
  }
});