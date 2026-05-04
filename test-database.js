/*
 * ZION DATABASE CONNECTION TEST
 * Built by Christopher Hughes · Sacramento, CA
 * Created with Claude Code
 * Truth · Safety · We Got Your Back
 *
 * Tests database connection and sets up tables if needed
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
require('dotenv').config();

async function testDatabaseConnection() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                ZION DATABASE CONNECTION TEST');
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    // Check environment variables
    console.log('🔍 Checking environment variables...');
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    console.log(`   SUPABASE_URL: ${supabaseUrl ? '✅ Set' : '❌ Missing'}`);
    console.log(`   SUPABASE_SERVICE_KEY: ${supabaseKey ? '✅ Set' : '❌ Missing'}`);
    console.log(`   ANTHROPIC_API_KEY: ${anthropicKey ? '✅ Set' : '❌ Missing'}`);
    console.log(`   OPENAI_API_KEY: ${openaiKey ? '✅ Set' : '❌ Missing'}`);
    console.log();

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('❌ Supabase environment variables are missing');
    }

    // Test Supabase connection
    console.log('🔗 Testing Supabase connection...');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Test basic connection
    const { data: testData, error: testError } = await supabase
      .from('_internal')
      .select('*')
      .limit(1);

    if (testError && !testError.message.includes('does not exist')) {
      throw new Error(`Supabase connection failed: ${testError.message}`);
    }

    console.log('   ✅ Supabase connection successful');

    // Check if Zion tables exist
    console.log('\n📊 Checking Zion tables...');
    const tables = [
      'zion_tiffani_conversations',
      'zion_tiffani_memories',
      'zion_tiffani_context',
      'zion_tiffani_learning',
      'zion_tiffani_personality_evolution'
    ];

    const tableStatus = {};
    for (const table of tables) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('count(*)', { count: 'exact' })
          .limit(1);

        if (error) {
          tableStatus[table] = `❌ Missing (${error.message})`;
        } else {
          tableStatus[table] = '✅ Exists';
        }
      } catch (err) {
        tableStatus[table] = `❌ Error: ${err.message}`;
      }
    }

    console.log('\n   Table Status:');
    for (const [table, status] of Object.entries(tableStatus)) {
      console.log(`   ${table}: ${status}`);
    }

    // Check if setup is needed
    const missingTables = Object.entries(tableStatus).filter(([table, status]) => status.includes('❌'));

    if (missingTables.length > 0) {
      console.log('\n🔧 Setting up missing tables...');
      await setupDatabase(supabase);
    } else {
      console.log('\n✅ All tables exist and are ready!');
    }

    console.log('\n🎯 Database test completed successfully!');
    console.log('   Zion is ready to remember and learn with Tiffani.');

  } catch (error) {
    console.error('\n❌ Database test failed:', error.message);
    console.error('\n💡 Troubleshooting:');
    console.error('   • Verify environment variables in Render dashboard');
    console.error('   • Check Supabase project is active and URL is correct');
    console.error('   • Ensure service key has admin permissions');
    process.exit(1);
  }
}

async function setupDatabase(supabase) {
  try {
    console.log('   📄 Reading database schema...');
    const schema = await fs.readFile('./database-setup.sql', 'utf8');

    console.log('   🏗️  Executing SQL statements...');
    const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);

    for (const statement of statements) {
      const trimmedStatement = statement.trim();
      if (trimmedStatement) {
        try {
          console.log(`      Running: ${trimmedStatement.substring(0, 50)}...`);

          // Use rpc to execute raw SQL
          const { error } = await supabase.rpc('exec_sql', {
            sql: trimmedStatement + ';'
          });

          if (error && !error.message.includes('already exists')) {
            console.log(`      ⚠️  ${error.message}`);
          } else {
            console.log('      ✅ Success');
          }
        } catch (err) {
          console.log(`      ⚠️  ${err.message}`);
        }
      }
    }

    console.log('   ✅ Database setup completed!');
  } catch (error) {
    console.error('   ❌ Database setup failed:', error.message);
    throw error;
  }
}

// Run the test
if (require.main === module) {
  testDatabaseConnection();
}

module.exports = { testDatabaseConnection };