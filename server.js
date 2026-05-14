/*
  Zion — The Powerful AI · Tiffani's Personal Companion
  Built by Christopher Hughes for Tiffani
  Cloned from Splendor's architecture, soul doc swapped for Tiff.
*/

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { seedConfiguredUsers, summarizeResults } = require('./lib/seed-users');

let cachedZionHtml = null;

function loadZionHtml() {
  const raw = fs.readFileSync(
    path.join(__dirname, 'public/zion-interface.html'),
    'utf8'
  );
  cachedZionHtml = raw
    .replace(/__SUPABASE_URL__/g, process.env.SUPABASE_URL || '')
    .replace(/__SUPABASE_ANON_KEY__/g, process.env.SUPABASE_ANON_KEY || '');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('[ZION] CRITICAL: Supabase env vars missing. Auth will not work.');
  }
}

const chatRoutes = require('./routes/chat');
const memoryRoutes = require('./routes/memory');
const voiceRoutes = require('./routes/voice');
const authRoutes = require('./routes/auth');
const tiffRoutes = require('./routes/tiff');

loadZionHtml();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", process.env.SUPABASE_URL, "https://api.anthropic.com", "https://api.openai.com", "https://api.tavily.com"].filter(Boolean),
      imgSrc: ["'self'", "data:", "blob:", "https://*.blob.core.windows.net", "https://*.openai.com"],
      mediaSrc: ["'self'", "data:", "blob:"]
    }
  }
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.ZION_PUBLIC_ORIGIN || 'https://zion-the-powerful-ai.onrender.com']
    : ['http://localhost:3000'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public', { index: false }));

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/tiff', tiffRoutes);

app.get('/health', (req, res) => {
  const pkg = require('./package.json');
  res.json({
    status: 'live',
    service: 'Zion — Tiff\'s AI',
    version: pkg.version,
    api_status: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
      tavily: !!process.env.TAVILY_API_KEY
    },
    auth: {
      owner_configured: !!process.env.ZION_OWNER_EMAIL,
      admin_configured: !!process.env.ZION_ADMIN_EMAIL
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/version', (req, res) => {
  const pkg = require('./package.json');
  res.json({
    version: pkg.version,
    name: pkg.name,
    description: pkg.description
  });
});

app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(cachedZionHtml);
});

app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ error: 'Something went wrong — try again' });
});

function logSystemStatus() {
  const pkg = require('./package.json');
  console.log('\n' + '='.repeat(60));
  console.log(`ZION — TIFF'S AI v${pkg.version}`);
  console.log('='.repeat(60));
  console.log('\nAPI CONNECTIVITY:');
  console.log(`  Anthropic:  ${process.env.ANTHROPIC_API_KEY ? 'connected' : 'MISSING'}`);
  console.log(`  OpenAI:     ${process.env.OPENAI_API_KEY ? 'connected' : 'MISSING'}`);
  console.log(`  Supabase:   ${process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY ? 'connected' : 'MISSING'}`);
  console.log(`  Tavily:     ${process.env.TAVILY_API_KEY ? 'connected' : 'disabled (legal search unavailable)'}`);
  console.log(`\nOwner timezone: ${process.env.ZION_OWNER_TIMEZONE || 'America/Los_Angeles'}`);
  console.log(`Allowed users:  ${[process.env.ZION_OWNER_EMAIL, process.env.ZION_ADMIN_EMAIL].filter(Boolean).join(', ') || '(none configured!)'}`);
  console.log(`Port:           ${PORT}`);
  console.log(`Environment:    ${process.env.NODE_ENV || 'development'}`);
  console.log('='.repeat(60) + '\n');
}

app.listen(PORT, async () => {
  logSystemStatus();
  console.log(`Zion is running on port ${PORT}`);

  // Auto-seed Supabase Auth users from environment so Tiff and Chris
  // can sign in immediately on first boot, no dashboard work required.
  // Idempotent: re-running just resyncs passwords if env values change.
  try {
    const results = await seedConfiguredUsers();
    console.log('\nUser seeding:');
    console.log(summarizeResults(results));
    console.log('');
  } catch (err) {
    console.error('[seed-users] unexpected error:', err.message);
  }
});
