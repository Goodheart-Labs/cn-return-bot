/** What the Data API says about some videos: channel, length, language, and
 *  whether the uploader supplied captions. */
import "dotenv/config";
const ids = process.argv.slice(2).join(",");
const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${ids}&key=${process.env.YOUTUBE_DATA_V3_API_KEY}`;
const body: any = await (await fetch(url)).json();
for (const v of body.items ?? []) {
  console.log(`${v.id} · ${v.snippet.channelTitle} · ${v.contentDetails.duration} · audio ${v.snippet.defaultAudioLanguage ?? "-"} · uploader captions ${v.contentDetails.caption} · ${v.status.privacyStatus} · ${v.snippet.title.slice(0, 50)}`);
}
