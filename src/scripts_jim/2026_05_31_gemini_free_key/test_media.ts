/**
 * End-to-end check that media analysis now runs through the native Gemini
 * client (with free→paid key routing) and returns a parsed description.
 */
import { analyzeMediaGemini } from "../../pipeline/media/mediaAnalysisGemini";

const IMG = "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png";

const result = await analyzeMediaGemini([{ type: "photo", url: IMG }]);
console.log(JSON.stringify(result, null, 2));
