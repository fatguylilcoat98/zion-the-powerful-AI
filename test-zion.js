/*
 * ZION TEST SCRIPT
 * Built by Christopher Hughes · Sacramento, CA
 * Created with Claude Code
 * Truth · Safety · We Got Your Back
 *
 * Test script to verify Zion is configured properly
 */

const {
  getZionInstance,
  validateZion,
  getCustomizationStatus,
  getZionPersonality
} = require('./lib/zion-manager');

async function testZion() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                     TESTING ZION CONFIGURATION');
  console.log('═══════════════════════════════════════════════════════════════\\n');

  try {
    // Test 1: Basic validation
    console.log('🔍 Testing Zion validation...');
    const isValid = await validateZion();
    console.log(`Zion validation: ${isValid ? '✅ PASSED' : '❌ FAILED'}`);

    if (!isValid) {
      console.log('❌ Zion validation failed. Check configuration files.');
      return;
    }
    console.log();

    // Test 2: Load personality
    console.log('🤖 Testing personality configuration...');
    const personality = await getZionPersonality();
    console.log(`Name: ${personality.name}`);
    console.log(`Created for: ${personality.humanName}`);
    console.log(`Relationship: ${personality.relationship}`);
    console.log(`Traits: ${personality.traits.join(', ')}`);
    console.log(`Communication Style: ${personality.communicationStyle}`);
    console.log(`Values: ${personality.values.join(', ')}`);
    console.log(`Memory Namespace: ${personality.memoryNamespace}`);
    console.log();

    // Test 3: System prompt generation
    console.log('📝 Testing system prompt generation...');
    const zion = await getZionInstance();
    console.log(`System prompt length: ${zion.systemPrompt.length} characters`);
    console.log(`Identity document length: ${zion.identity.length} characters`);
    console.log(`Memory seed length: ${zion.memorySeed.length} characters`);
    console.log();

    // Test 4: Customization status
    console.log('⚙️ Testing customization status...');
    const customization = await getCustomizationStatus();
    console.log(`Customization status: ${customization.status}`);
    console.log(`Has customized: ${customization.hasCustomized}`);
    console.log(`Remaining TODOs: ${customization.remainingTodos}`);
    console.log(`Completion: ${customization.percentComplete}%`);

    if (customization.nextSteps) {
      console.log('Next steps:');
      customization.nextSteps.forEach(step => console.log(`  • ${step}`));
    }
    console.log();

    // Test 5: Configuration summary
    console.log('📊 Zion Configuration Summary:');
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log(`│ Name: ${personality.name.padEnd(52)} │`);
    console.log(`│ Human: ${personality.humanName.padEnd(51)} │`);
    console.log(`│ Traits: ${personality.traits.join(', ').padEnd(50)} │`);
    console.log(`│ Memory NS: ${personality.memoryNamespace.padEnd(46)} │`);
    console.log(`│ Customized: ${(customization.hasCustomized ? 'Yes' : 'No').padEnd(48)} │`);
    console.log('└─────────────────────────────────────────────────────────────┘');
    console.log();

    console.log('✨ All Zion tests completed successfully!');
    console.log();

    if (!customization.hasCustomized) {
      console.log('💡 Next step: Have Tiffani customize the memory-seed.md file');
      console.log('   by filling in the TODO sections with her personal information.');
    } else {
      console.log('🎉 Zion is fully customized and ready for conversations!');
    }

  } catch (error) {
    console.error('❌ Zion test failed:', error.message);
    console.error('\\nStack trace:', error.stack);
  }
}

// Run the test
if (require.main === module) {
  testZion();
}

module.exports = { testZion };