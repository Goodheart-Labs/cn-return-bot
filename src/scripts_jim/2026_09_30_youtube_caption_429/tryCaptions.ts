/** GOO-276: runs the real fetchYoutubeCaptions on videos that failed with a
 *  429 in production, plus a few that worked, and prints what came back. */
import { fetchYoutubeCaptions } from "../../pipeline/media/youtubeCaptions";
import { fetchVideo } from "../../pipeline/media/youtubeDataApi";

const VIDEO_IDS = [
  "SCbpjgol-Gk", "uuTG3gFHzbE", "JW6u12FbRGw", "bivyc7JmJXM", "1l3SMlL1n0c", "ttVUZOkTxuM", "o5NRO4E3GzY", "v0QqkLJeJqE", "CTnY6TiVmVQ",
  "XIhZ8kdGDiw", "hAoP1zVVkOE", "i7KASWvezUY", "LbjW3F5AFIY",
  "ibbwFzmht9Y", "IxDJvqHlpbQ", "UKZt1vq8bKI", "qZ-h-zQwDOQ", "dYPXINFcvmI",
];

for (const id of VIDEO_IDS) {
  const started = Date.now();
  try {
    const video = await fetchVideo(`https://www.youtube.com/watch?v=${id}`);
    const cues = await fetchYoutubeCaptions(video);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`${id} audio=${video.audioLanguage} ${seconds}s ${cues ? `${cues.length} cues: ${cues.slice(0, 3).map((c) => c.text).join(" / ").slice(0, 120)}` : "NO CAPTIONS"}`);
  } catch (err: any) {
    console.log(`${id} FAILED ${((Date.now() - started) / 1000).toFixed(1)}s ${err?.message?.slice(0, 200)}`);
  }
}
