/**
 * Test the opus-research pipeline on old tweets and generate an interactive HTML report
 */

import { getSupabaseClient } from "../../api/supabaseClient";
import { xai } from "../../pipeline/llm/xai";
import { generateText } from "ai";
import * as fs from "fs";

// Requires OPENROUTER_API_KEY in environment
import "dotenv/config";

const supabase = getSupabaseClient();

const MODELS = {
  research: "anthropic/claude-opus-4.6",
  analysis: "anthropic/claude-opus-4.6",
  grokSearch: "grok-4-fast",
};

interface PipelineStep {
  name: string;
  input: string;
  output: string;
  timestamp: string;
}

interface TweetRun {
  tweetId: string;
  tweetText: string;
  steps: PipelineStep[];
}

// Simple LLM call via OpenRouter
async function llmCall(model: string, prompt: string): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// Grok search
async function searchXWithGrok(tweetId: string, tweetText: string): Promise<string> {
  if (!process.env.XAI_API_KEY) {
    return "XAI_API_KEY not set - skipping Grok search";
  }

  const tweetUrl = `https://x.com/i/status/${tweetId}`;
  const prompt = `Search X/Twitter for tweets surrounding this specific tweet. Is it replying to any specific tweets, quoting any tweets, or are there notable replies?

Do not talk in general, nor offer commentary. Give the text of the preceding 0-3 tweets, the quoted tweet if any, and 0-3 relevant replies. Otherwise respond with nothing.

Tweet URL: ${tweetUrl}
Tweet text: "${tweetText}"

Output format:

### Preceding Tweets in thread

[Username, ID, tweet text]/[None]

### Quoted Tweet

[Username, ID, tweet text]/[None]

### Replies

[Username, ID, tweet text]/[None]
`;

  const { text } = await generateText({
    model: xai.responses(MODELS.grokSearch) as any,
    prompt,
    tools: {
      x_search: xai.tools.xSearch({
        enableImageUnderstanding: true,
      }) as any,
    },
  });

  return text;
}

// Run pipeline on a single tweet
async function runPipelineOnTweet(tweetId: string, tweetText: string): Promise<TweetRun> {
  const steps: PipelineStep[] = [];

  // Step 1: Grok X Search
  console.log(`  [1/4] Running Grok X search...`);
  const grokPrompt = `Tweet ID: ${tweetId}\nTweet: ${tweetText}`;
  const grokResult = await searchXWithGrok(tweetId, tweetText);
  steps.push({
    name: "Grok X Search",
    input: grokPrompt,
    output: grokResult,
    timestamp: new Date().toISOString(),
  });

  // Step 2: Claude First Search (in parallel with Grok in real pipeline, but sequential here for clarity)
  console.log(`  [2/4] Running Claude first search...`);
  const claudeFirstPrompt = `Research this social media post to fact-check it. Find relevant sources and URLs that could support or refute the claims made.

POST TO FACT-CHECK:
${tweetText}
`;
  const claudeFirstResult = await llmCall(MODELS.research, claudeFirstPrompt);
  steps.push({
    name: "Claude First Search",
    input: claudeFirstPrompt,
    output: claudeFirstResult,
    timestamp: new Date().toISOString(),
  });

  // Step 3: Analyze Gaps
  console.log(`  [3/4] Running gap analysis...`);
  const combinedResearch = `--- Grok X Search ---\n${grokResult}\n\n--- Claude Initial Research ---\n${claudeFirstResult}`;
  const analyzeGapsPrompt = `You are analyzing research about a tweet to determine if there are gaps that need filling.

POST TO FACT-CHECK:
${tweetText}

GROK'S X SEARCH RESULTS:
${grokResult}

CURRENT RESEARCH (after 1 round):
${combinedResearch}

Does the current research make sense? Do you understand what is going on in both the tweet and in reality? Search important aspects that confuse you.

We've also included Grok's research as to surrounding tweets. Grok isn't perfect, so take it with a pinch of salt.

Output URLs to support claims.

At the end after your answer, write if you think there are still major questions in relation to the tweet that need answering in the following format.

RESEARCH_REQUEST: [If YES, what to search for next. If NO, write "None"]`;

  const gapAnalysisResult = await llmCall(MODELS.analysis, analyzeGapsPrompt);
  steps.push({
    name: "Gap Analysis 1",
    input: analyzeGapsPrompt,
    output: gapAnalysisResult,
    timestamp: new Date().toISOString(),
  });

  // Check if follow-up research is needed
  const requestMatch = gapAnalysisResult.match(/RESEARCH_REQUEST:\s*(.+?)$/is);
  const researchRequest = requestMatch?.[1]?.trim() || "None";
  const needsFollowUp = researchRequest.toLowerCase() !== "none" && researchRequest !== "";

  let allResearch = combinedResearch;

  if (needsFollowUp) {
    // Step 4: Follow-up Research
    console.log(`  [4/6] Running follow-up research...`);
    const followUpPrompt = `Context: Original tweet: "${tweetText}"\n\nPlease research: ${researchRequest}`;
    const followUpResult = await llmCall(MODELS.research, followUpPrompt);
    steps.push({
      name: "Follow-up Research",
      input: followUpPrompt,
      output: followUpResult,
      timestamp: new Date().toISOString(),
    });

    allResearch = `${combinedResearch}\n\n--- Claude Follow-up Research ---\n${followUpResult}`;

    // Step 5: Gap Analysis 2
    console.log(`  [5/6] Running second gap analysis...`);
    const gapAnalysis2Prompt = `You are analyzing research about a tweet to determine if there are gaps that need filling.

POST TO FACT-CHECK:
${tweetText}

GROK'S X SEARCH RESULTS:
${grokResult}

CURRENT RESEARCH (after 2 rounds):
${allResearch}

Does the current research make sense? Do you understand what is going on in both the tweet and in reality? Search important aspects that confuse you.

We've also included Grok's research as to surrounding tweets. Grok isn't perfect, so take it with a pinch of salt.

Output URLs to support claims.

At the end after your answer, write if you think there are still major questions in relation to the tweet that need answering in the following format.

RESEARCH_REQUEST: [If YES, what to search for next. If NO, write "None"]`;

    const gapAnalysis2Result = await llmCall(MODELS.analysis, gapAnalysis2Prompt);
    steps.push({
      name: "Gap Analysis 2",
      input: gapAnalysis2Prompt,
      output: gapAnalysis2Result,
      timestamp: new Date().toISOString(),
    });

    allResearch = `${allResearch}\n\n--- Gap Analysis 2 ---\n${gapAnalysis2Result}`;
    console.log(`  [6/6] Writing note...`);
  } else {
    console.log(`  [4/4] Writing note (no follow-up needed)...`);
  }

  // Final Step: Write Note
  const writeNotePrompt = `TASK: Analyze this X post and determine if it contains factual errors that require correction.

CRITICAL ANALYSIS STEPS:
1. IDENTIFY THE SPECIFIC CLAIM: What exact factual assertion is the post making?
2. VERIFY ACCURACY: Does the research directly contradict this specific claim?
3. SOURCE RELEVANCE: Do the sources directly address this claim (not general background)?
4. DIRECTNESS: Can you definitively say "this specific claim is false" based on the evidence in the research?

ONLY correct posts with clear factual errors supported by direct, relevant sources. Avoid:
- General background context that doesn't contradict the claim
- Sources about different timeframes than what the post discusses
- Correcting things the post never actually claimed
- Vague corrections that don't directly address the core assertion

CRITICAL LENGTH CONSTRAINT: Your note text MUST be under 275 characters. URLs are shortened by X and count as only 1 character toward this limit. Be concise - every word must earn its place.

STYLE: Respond in a calm professional style. Do not use asterisks around claims.

Please start by responding with one of the following statuses "TWEET NOT SIGNIFICANTLY INCORRECT" "NO MISSING CONTEXT" "CORRECTION WITH TRUSTWORTHY CITATION" "CORRECTION WITHOUT TRUSTWORTHY CITATION"

Format:
[Status]
[Direct correction stating exactly what is wrong - MUST be under 275 chars with URLs counting as 1]
[URL that specifically contradicts the claim]

Post to fact-check:
\`\`\`
${tweetText}
\`\`\`

Accumulated research:
\`\`\`
${allResearch}
\`\`\``;

  const noteResult = await llmCall(MODELS.analysis, writeNotePrompt);
  steps.push({
    name: "Write Note",
    input: writeNotePrompt,
    output: noteResult,
    timestamp: new Date().toISOString(),
  });

  return {
    tweetId,
    tweetText,
    steps,
  };
}

// Generate HTML
function generateHTML(runs: TweetRun[]): string {
  const runsJson = JSON.stringify(runs, null, 2);

  return `<!DOCTYPE html>
<html>
<head>
  <title>Opus Research Pipeline Test</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
      background: #1a1a2e;
      color: #eee;
    }
    h1 { color: #fff; margin-bottom: 10px; }
    .subtitle { color: #888; margin-bottom: 30px; }

    .tweet-selector {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .tweet-btn {
      padding: 10px 20px;
      background: #16213e;
      border: 2px solid #0f3460;
      color: #fff;
      cursor: pointer;
      border-radius: 8px;
      transition: all 0.2s;
    }
    .tweet-btn:hover { background: #0f3460; }
    .tweet-btn.active { background: #e94560; border-color: #e94560; }

    .tweet-text {
      background: #16213e;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      border-left: 4px solid #e94560;
    }
    .tweet-text h3 { margin: 0 0 10px 0; color: #e94560; }
    .tweet-text p { margin: 0; white-space: pre-wrap; line-height: 1.6; }

    .step-nav {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 20px;
      margin-bottom: 20px;
    }
    .nav-btn {
      padding: 15px 30px;
      background: #e94560;
      border: none;
      color: #fff;
      cursor: pointer;
      border-radius: 8px;
      font-size: 18px;
      transition: all 0.2s;
    }
    .nav-btn:hover:not(:disabled) { background: #ff6b6b; }
    .nav-btn:disabled { background: #333; cursor: not-allowed; }
    .step-indicator {
      font-size: 18px;
      color: #888;
    }
    .step-name {
      font-size: 24px;
      font-weight: bold;
      color: #e94560;
    }

    .step-content {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    .panel {
      background: #16213e;
      border-radius: 8px;
      overflow: hidden;
    }
    .panel-header {
      background: #0f3460;
      padding: 15px 20px;
      font-weight: bold;
      color: #fff;
    }
    .panel-body {
      padding: 20px;
      max-height: 600px;
      overflow-y: auto;
      white-space: pre-wrap;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 13px;
      line-height: 1.5;
    }

    .timestamp {
      color: #666;
      font-size: 12px;
      margin-top: 10px;
    }

    /* Scrollbar styling */
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #1a1a2e; }
    ::-webkit-scrollbar-thumb { background: #0f3460; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #e94560; }

    @media (max-width: 1000px) {
      .step-content { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <h1>Opus Research Pipeline Test</h1>
  <p class="subtitle">Generated: ${new Date().toISOString()}</p>

  <div class="tweet-selector" id="tweetSelector"></div>

  <div class="tweet-text" id="tweetText">
    <h3>Tweet</h3>
    <p id="tweetContent"></p>
  </div>

  <div class="step-nav">
    <button class="nav-btn" id="prevBtn" onclick="prevStep()">← Previous</button>
    <div>
      <div class="step-indicator" id="stepIndicator">Step 1 of 4</div>
      <div class="step-name" id="stepName">Grok X Search</div>
    </div>
    <button class="nav-btn" id="nextBtn" onclick="nextStep()">Next →</button>
  </div>

  <div class="step-content">
    <div class="panel">
      <div class="panel-header">Input (Prompt)</div>
      <div class="panel-body" id="inputPanel"></div>
    </div>
    <div class="panel">
      <div class="panel-header">Output (Response)</div>
      <div class="panel-body" id="outputPanel"></div>
    </div>
  </div>

  <div class="timestamp" id="timestamp"></div>

  <script>
    const runs = ${runsJson};

    let currentTweet = 0;
    let currentStep = 0;

    function renderTweetSelector() {
      const selector = document.getElementById('tweetSelector');
      selector.innerHTML = runs.map((run, i) =>
        \`<button class="tweet-btn \${i === currentTweet ? 'active' : ''}" onclick="selectTweet(\${i})">
          Tweet \${i + 1}
        </button>\`
      ).join('');
    }

    function selectTweet(index) {
      currentTweet = index;
      currentStep = 0;
      renderTweetSelector();
      render();
    }

    function render() {
      const run = runs[currentTweet];
      const step = run.steps[currentStep];

      document.getElementById('tweetContent').textContent = run.tweetText;
      document.getElementById('stepIndicator').textContent = \`Step \${currentStep + 1} of \${run.steps.length}\`;
      document.getElementById('stepName').textContent = step.name;
      document.getElementById('inputPanel').textContent = step.input;
      document.getElementById('outputPanel').textContent = step.output;
      document.getElementById('timestamp').textContent = \`Completed: \${step.timestamp}\`;

      document.getElementById('prevBtn').disabled = currentStep === 0;
      document.getElementById('nextBtn').disabled = currentStep === run.steps.length - 1;
    }

    function prevStep() {
      if (currentStep > 0) {
        currentStep--;
        render();
      }
    }

    function nextStep() {
      const run = runs[currentTweet];
      if (currentStep < run.steps.length - 1) {
        currentStep++;
        render();
      }
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') prevStep();
      if (e.key === 'ArrowRight') nextStep();
    });

    // Initial render
    renderTweetSelector();
    render();
  </script>
</body>
</html>`;
}

async function main() {
  const numTweets = parseInt(process.argv[2] || "3");

  console.log(`Fetching ${numTweets} recent tweets from database...`);

  // Get recent pipeline runs with tweet text
  const { data: notes, error } = await supabase
    .from("pipeline_runs")
    .select("tweet_id, tweet_text")
    .not("tweet_text", "is", null)
    .eq("outcome", "submitted")
    .order("created_at", { ascending: false })
    .limit(numTweets);

  if (error || !notes?.length) {
    console.error("Error fetching notes:", error);
    return;
  }

  console.log(`Found ${notes.length} tweets. Running pipeline...\n`);

  const runs: TweetRun[] = [];

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]!;
    console.log(`[${i + 1}/${notes.length}] Processing tweet ${note.tweet_id}...`);
    console.log(`  Text: ${note.tweet_text?.substring(0, 80)}...`);

    try {
      const run = await runPipelineOnTweet(note.tweet_id, note.tweet_text || "");
      runs.push(run);
      console.log(`  Done!\n`);
    } catch (err) {
      console.error(`  Error:`, err);
    }
  }

  const html = generateHTML(runs);
  const outputPath = "/tmp/opus-research-test.html";
  fs.writeFileSync(outputPath, html);
  console.log(`\nReport written to ${outputPath}`);

  // Open in browser
  const { exec } = require("child_process");
  exec(`open ${outputPath}`);
}

main();
