"""Analyze downloaded videos with Gemini models via OpenRouter to detect AI-generated content."""

import base64
import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")
if not OPENROUTER_API_KEY:
    sys.exit("OPENROUTER_API_KEY not set")

SCRIPT_DIR = Path(__file__).parent
RESULTS_FILE = SCRIPT_DIR / "results.json"

# Pricing per million tokens (from openrouter.ai/api/v1/models, March 2026)
MODEL_PRICING = {
    "google/gemini-3.1-pro-preview": {"input": 2.0, "output": 12.0},
    "google/gemini-3-flash-preview": {"input": 0.5, "output": 3.0},
    "google/gemini-3.1-flash-lite-preview": {"input": 0.25, "output": 1.5},
}

MODELS = list(MODEL_PRICING.keys())

AI_DETECTION_PROMPT = """Analyze this video carefully and provide:

1. **Description**: A concise description of what happens in the video (2-4 sentences).

2. **AI Detection Signals**: List any signs that suggest this video may or may not be AI-generated. Known AI video tells include:
   - Multiple short clips stitched together with abrupt transitions
   - Physics errors (unnatural movement, objects behaving impossibly, water/fire/smoke looking wrong)
   - Over-the-top or implausible scenarios that seem engineered for maximum engagement
   - Unnatural textures, lighting inconsistencies, or morphing artifacts
   - Faces or hands with subtle deformities
   - Watermarks from AI generation tools (Veo, Kling, Sora, etc.)
   - Backgrounds that shift or are inconsistent between frames

3. **Verdict**: Is this video AI-generated?
   - Answer: YES / NO / UNCERTAIN
   - Confidence: HIGH / MEDIUM / LOW
   - One-sentence reasoning.

4. **OCR**: Extract ALL text visible in the video — overlays, captions, watermarks, chyrons, signs, subtitles, etc. List each distinct text string you can read.

Respond in this exact JSON format:
{
  "description": "...",
  "ai_signals_found": ["signal 1", "signal 2"],
  "ai_signals_absent": ["counter-signal 1"],
  "verdict": "YES" | "NO" | "UNCERTAIN",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "reasoning": "...",
  "ocr_text": ["text 1", "text 2"]
}"""


def analyze_video(video_path: Path, model: str) -> dict:
    video_bytes = video_path.read_bytes()
    b64 = base64.b64encode(video_bytes).decode("utf-8")
    data_url = f"data:video/mp4;base64,{b64}"

    resp = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/Goodheart-Labs/cn-return-bot",
        },
        json={
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": AI_DETECTION_PROMPT},
                        {"type": "video_url", "video_url": {"url": data_url}},
                    ],
                }
            ],
            "response_format": {"type": "json_object"},
        },
        timeout=300,
    )
    resp.raise_for_status()
    data = resp.json()

    content = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})
    pricing = MODEL_PRICING[model]

    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)
    cost = (prompt_tokens / 1_000_000) * pricing["input"] + (
        completion_tokens / 1_000_000
    ) * pricing["output"]

    return {
        "analysis": json.loads(content),
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "estimated_cost_usd": cost,
        },
    }


def collect_videos(directory: Path, label: str) -> list[dict]:
    if not directory.exists():
        return []
    return [
        {"file": f.name, "path": f, "label": label}
        for f in sorted(directory.glob("*.mp4"))
    ]


def main():
    ai_dir = SCRIPT_DIR / "ai_generated"
    non_ai_dir = SCRIPT_DIR / "non_ai"

    videos = collect_videos(ai_dir, "ai_generated") + collect_videos(
        non_ai_dir, "non_ai"
    )

    # Optional filter: pass a substring to only analyze matching filenames
    filter_arg = sys.argv[1] if len(sys.argv) > 1 else None
    if filter_arg:
        videos = [v for v in videos if filter_arg in v["file"]]
        print(f"Filter: '{filter_arg}' — {len(videos)} video(s) matched\n")

    total_calls = len(videos) * len(MODELS)
    print(
        f"Analyzing {len(videos)} videos with {len(MODELS)} models each ({total_calls} total calls)...\n"
    )

    results = []
    total_cost = 0.0

    for video in videos:
        for model in MODELS:
            short_model = model.split("/")[1]
            print(f"  {video['file']} [{short_model}]... ", end="", flush=True)

            result = {
                "file": video["file"],
                "label": video["label"],
                "model": model,
                "analysis": None,
                "usage": None,
                "error": None,
            }

            try:
                out = analyze_video(video["path"], model)
                result["analysis"] = out["analysis"]
                result["usage"] = out["usage"]
                cost = out["usage"]["estimated_cost_usd"]
                total_cost += cost
                verdict = out["analysis"].get("verdict", "?")
                confidence = out["analysis"].get("confidence", "?")
                print(f"{verdict} ({confidence}) — ${cost:.4f}")
            except Exception as e:
                result["error"] = str(e)
                print(f"ERROR: {e}")

            results.append(result)

    RESULTS_FILE.write_text(json.dumps(results, indent=2))

    # Summary table
    print("\n=== SUMMARY ===\n")
    header = f"{'File':<55} {'Label':<14} {'Model':<30} {'Verdict':<10} {'Conf':<8} {'Cost':<10} {'OK'}"
    print(header)
    print("-" * len(header))

    for r in results:
        short_model = r["model"].split("/")[1]
        verdict = (r["analysis"] or {}).get("verdict", "ERROR")
        conf = (r["analysis"] or {}).get("confidence", "")
        cost = f"${r['usage']['estimated_cost_usd']:.4f}" if r["usage"] else "n/a"

        correct = ""
        if verdict == "YES" and r["label"] == "ai_generated":
            correct = "✓"
        elif verdict == "NO" and r["label"] == "non_ai":
            correct = "✓"
        elif verdict in ("YES", "NO"):
            correct = "✗"

        print(
            f"{r['file']:<55} {r['label']:<14} {short_model:<30} {verdict:<10} {conf:<8} {cost:<10} {correct}"
        )

    print(f"\nTotal estimated cost: ${total_cost:.4f}")
    print(f"Results saved to: {RESULTS_FILE}")

    # Accuracy per model
    print("\n=== ACCURACY PER MODEL ===\n")
    for model in MODELS:
        model_results = [r for r in results if r["model"] == model and r["analysis"]]
        correct_count = sum(
            1
            for r in model_results
            if (r["analysis"]["verdict"] == "YES" and r["label"] == "ai_generated")
            or (r["analysis"]["verdict"] == "NO" and r["label"] == "non_ai")
        )
        model_cost = sum(r["usage"]["estimated_cost_usd"] for r in model_results if r["usage"])
        print(f"  {model}: {correct_count}/{len(model_results)} correct — ${model_cost:.4f}")


if __name__ == "__main__":
    main()
