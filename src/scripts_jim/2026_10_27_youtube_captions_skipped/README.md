# GOO-603: videos with English captions ended as "no captions"

- `listSkipped.ts` lists every video ended as "no captions" since a day, with the
  tracks YouTube's Data API `captions.list` reports for it.
- `probeYtDlp.sh` runs yt-dlp on the services box exactly as `fetchYoutubeCaptions`
  does and prints the tracks it found and its warnings. `CLIENT=<name>` picks
  another YouTube player client.
- `probeWatchPage.sh` saves the raw watch page yt-dlp downloads and prints the
  country YouTube saw and whether the page lists caption tracks.

## Findings, 2026-10-27

- All 62 videos ended as "no captions" from 18 to 27 Oct were feed items. The
  feed run fetches captions in GitHub Actions, which installs the newest yt-dlp
  (2026.10.26) on every run. So the old yt-dlp on the services box did not cause
  them. Only reader requests fetch captions there.
- 34 of the 62 have an English automatic track in `captions.list`. 25 of those 34
  are CNN.
- For CNN's FtOrcFEStbE, YouTube's player response holds no caption tracks at
  all. That held for yt-dlp 2026.08.19 and 2026.10.26, for the player clients
  web, mweb, web_safari, tv, tv_simply, web_embedded, ios and android_vr, and for
  exits in Italy, Spain, Belgium, Germany and the US. yt-dlp reported correctly
  what YouTube served.
- Every failing CNN video has `contentDetails.caption = false` in the Data API,
  meaning no captions a person uploaded. Every CNN video the pipeline did read
  has `caption = true`. Other channels' videos with `caption = false` (Fireship,
  Hank Green, Last Week Tonight) do get their automatic track served.
- Jim opened FtOrcFEStbE on his Mac: there is no CC button, signed in or not.
  So YouTube shows these automatic tracks to nobody, and "no captions" is the
  true answer. `captions.list` lists tracks that YouTube does not publish to
  viewers, so it overcounts what we can read. Nothing was requeued.
