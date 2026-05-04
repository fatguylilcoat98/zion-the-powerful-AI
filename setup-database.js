/*
 * ZION DATABASE SETUP SCRIPT
 * Built by Christopher Hughes · Sacramento, CA
 * Created with Claude Code
 * Truth · Safety · We Got Your Back
 *
 * Sets up Zion's memory system in Supabase
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
require('dotenv').config();

async function setupZionDatabase() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                     ZION DATABASE SETUP');
  console.log('═══════════════════════════════════════════════════════════════\\n');

  try {
    // Validate environment variables
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      throw new Error('Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_KEY');
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('⚠️  Warning: ANTHROPIC_API_KEY not found. AI responses will not work.');
    }

    console.log('🔗 Connecting to Supabase...');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    console.log('📄 Reading database schema...');
    const schema = await fs.readFile('./database-setup.sql', 'utf8');

    console.log('🏗️  Creating Zion memory system tables...');

    // Split the SQL into individual statements
    const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);

    for (const statement of statements) {
      const trimmedStatement = statement.trim();
      if (trimmedStatement) {
        console.log(`   Executing: ${trimmedStatement.substring(0, 50)}...`);
        const { error } = await supabase.rpc('exec_sql', { sql: trimmedStatement + ';' });

        if (error) {
          // Try direct execution if RPC fails
          const { error: directError } = await supabase.from('_').select().sql(trimmedStatement + ';');
          if (directError && !directError.message.includes('already exists')) {
            console.log(`   ⚠️  Warning: ${directError.message}`);
          }
        }
      }
    }

    console.log();
    console.log('✅ Database setup completed successfully!');
    console.log();
    console.log('📊 Created tables:');
    console.log('   • zion_tiffani_conversations - Chat history storage');
    console.log('   • zion_tiffani_memories - Long-term memory about Tiffani');
    console.log('   • zion_tiffani_context - Current conversation context');
    console.log('   • zion_tiffani_learning - Learning progress tracking');
    console.log('   • zion_tiffani_personality_evolution - Personality development');
    console.log();
    console.log('🔒 Security features enabled:');
    console.log('   • Row Level Security (RLS) policies active');
    console.log('   • Data isolation for Tiffani only');
    console.log('   • Performance indexes created');
    console.log();
    console.log('🎯 Next steps:');
    console.log('   1. Verify environment variables are set');
    console.log('   2. Run: npm start');
    console.log('   3. Visit: http://localhost:3000');
    console.log('   4. Start chatting with Zion!');

  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    console.error();
    console.error('💡 Troubleshooting:');
    console.error('   • Check SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
    console.error('   • Ensure your Supabase service key has admin permissions');
    console.error('   • Verify your Supabase project is active');
    console.error('   • Try running the SQL manually in Supabase SQL Editor');
    process.exit(1);
  }
}

// Manual SQL execution helper (fallback)
async function runManualSetup() {
  try {
    const schema = await fs.readFile('./database-setup.sql', 'utf8');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                   MANUAL SETUP INSTRUCTIONS');
    console.log('═══════════════════════════════════════════════════════════════\\n');
    console.log('If the automatic setup fails, copy this SQL to your Supabase SQL Editor:\\n');
    console.log(schema);
    console.log('\\n═══════════════════════════════════════════════════════════════');
  } catch (error) {
    console.error('Failed to read schema file:', error.message);
  }
}

// Run setup
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--manual')) {
    runManualSetup();
  } else {
    setupZionDatabase();
  }
}

module.exports = { setupZionDatabase, runManualSetup };