/*
  Zion — The Powerful AI · Tiffani's Personal Companion
  Server entrypoint. PR 2 adds: art, email, converse, activity SSE,
  governance admin routes, and proactive-communication initialization
  on boot.
*/

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { seedConfiguredUsers, summarizeResults } = require('./lib/seed-users');
const { proactiveCommunication } = require('./lib/proactive-communication');

let cachedZionHtml = null;

function loadZionHtml() {
  const raw = fs.readFileSync(path.join(__dirname, 'public/zion-interface.html'), 'utf8');
  cachedZionHtml = raw
    .replace(/__SUPABASE_URL__/g, process.env.SUPABASE_URL || '')
    .replace(/__SUPABASE_ANON_KEY__/g, process.env.SUPABASE_ANON_KEY || '');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('[ZION] CRITICAL: Supabase env vars missing. Auth will not work.');
  }
}

const chatRoutes       = require('./routes/chat');
const memoryRoutes     = require('./routes/memory');
const voiceRoutes      = require('./routes/voice');
const authRoutes       = require('./routes/auth');
const tiffRoutes       = require('./routes/tiff');
const artRoutes        = require('./routes/art');
const emailRoutes      = require('./routes/email');
const activityRoutes   = require('./routes/activity');
const governanceRoutes = require('./routes/governance');
const converseRoutes   = require('./routes/converse');

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
      connectSrc: [
        "'self'",
        process.env.SUPABASE_URL,
        "https://api.anthropic.com",
        "https://api.openai.com",
        "https://api.tavily.com"
      ].filter(Boolean),
      imgSrc: ["'self'", "data:", "blob:", "https://*.blob.core.windows.net", "https://*.openai.com", "https://oaidalleapiprodscus.blob.core.windows.net"],
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

app.use('/api/auth',       authRoutes);
app.use('/api/chat',       chatRoutes);
app.use('/api/memory',     memoryRoutes);
app.use('/api/voice',      voiceRoutes);
app.use('/api/tiff',       tiffRoutes);
app.use('/api/art',        artRoutes);
app.use('/api/email',      emailRoutes);
app.use('/api/activity',   activityRoutes);
app.use('/api/governance', governanceRoutes);
app.use('/api/converse',   converseRoutes);

app.get('/health', (req, res) => {
  const pkg = require('./package.json');
  res.json({
    status: 'live',
    service: 'Zion — Tiff\'s AI',
    version: pkg.version,
    api_status: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai:    !!process.env.OPENAI_API_KEY,
      supabase:  !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
      tavily:    !!process.env.TAVILY_API_KEY,
      pinecone:  !!process.env.PINECONE_API_KEY,
      email:     process.env.PROACTIVE_EMAIL_ENABLED === 'true'
    },
    auth: {
      owner_configured: !!process.env.ZION_OWNER_EMAIL,
      admin_configured: !!process.env.ZION_ADMIN_EMAIL
    },
    governance: {
      claspion_enabled: process.env.CLASPION_ENABLED === 'true',
      claspion_url: process.env.CLASPION_URL || null
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/version', (req, res) => {
  const pkg = require('./package.json');
  res.json({ version: pkg.version, name: pkg.name, description: pkg.description });
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
  console.log(`  Tavily:     ${process.env.TAVILY_API_KEY ? 'connected' : 'disabled'}`);
  console.log(`  Pinecone:   ${process.env.PINECONE_API_KEY ? 'connected' : 'disabled'}`);
  console.log(`  Email:      ${process.env.PROACTIVE_EMAIL_ENABLED === 'true' ? 'enabled' : 'disabled'}`);
  console.log(`\nGovernance: ${process.env.CLASPION_ENABLED === 'true' ? 'CLASPION active' : 'CLASPION dormant'}`);
  console.log(`Owner tz:   ${process.env.ZION_OWNER_TIMEZONE || 'America/Los_Angeles'}`);
  console.log(`Allowed:    ${[process.env.ZION_OWNER_EMAIL, process.env.ZION_ADMIN_EMAIL].filter(Boolean).join(', ') || '(NONE)'}`);
  console.log(`Port:       ${PORT}`);
  console.log(`Env:        ${process.env.NODE_ENV || 'development'}`);
  console.log('='.repeat(60) + '\n');
}

app.listen(PORT, async () => {
  logSystemStatus();
  console.log(`Zion is running on port ${PORT}`);

  // Seed users from env.
  try {
    const results = await seedConfiguredUsers();
    console.log('\nUser seeding:');
    console.log(summarizeResults(results));
    console.log('');
  } catch (err) {
    console.error('[seed-users] unexpected error:', err.message);
  }

  // Initialize proactive communication (email transporter, queue worker).
  // Best-effort; never crashes the server.
  try {
    await proactiveCommunication.initialize();
  } catch (err) {
    console.warn('[proactive] init skipped:', err.message);
  }
});
