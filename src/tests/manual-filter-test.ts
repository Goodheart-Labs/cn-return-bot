import { shouldSubmitNote } from "../filters/noteEvaluationFilter";

async function testNoteEvaluationFilter() {
  console.log("Testing Note Evaluation Filter...");

  // Test with a sample post ID and note text
  const testPostId = "1234567890123456789"; // Sample tweet ID
  const testNoteText =
    "This claim needs additional context. According to multiple sources, the information presented is misleading. Sources: https://example.com/fact-check";

  try {
    console.log("\n--- Test 1: Normal evaluation ---");
    const result = await shouldSubmitNote(testPostId, testNoteText);

    console.log("Result:", result);

    if (result.shouldSubmit) {
      console.log(`✅ Note PASSED evaluation with score ${result.score}`);
    } else {
      console.log(`❌ Note FAILED evaluation with score ${result.score} (error: ${result.error})`);
    }

    console.log("\n--- Test 2: Custom threshold test ---");
    const resultCustom = await shouldSubmitNote(testPostId, testNoteText, 0.5);

    console.log("Result with 0.5 threshold:", resultCustom);
  } catch (error) {
    console.error("Test failed with error:", error);
  }
}

// Run the test if this file is executed directly
if (import.meta.main) {
  testNoteEvaluationFilter();
}
