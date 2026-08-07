Kimi K3 is a very good model with excellent benchmarks. Assuming its weights are released as planned it will become, purely in terms of raw capability, the strongest open model.

Do not get carried away. Do not judge Kimi K3 only its relative strengths. In aggregate it is several months behind the closed model frontier, at least four and my median guess is six, with the post-training closer and the pre-training farther out. This is less months than before, but the months are denser now.

It is somewhat distilled. It likely outperforms on benchmarks relative to practical performance. All its benchmarks are scored at maximum effort, typically a lot more tokens than are used in similar tests by Fable or Sol. Performance looks jagged. Kimi will be excellent at some things, less so at other things.

We will know more over the coming weeks. For now access is spotty and not that many people have actually had the chance to try Kimi K3, so I have larger error bars than usual around its capabilities. Alas, time waits for no one, so we press on.

It is the largest open model so far at 2.8T, on the upper end of possible sizes for Claude Opus and near the bottom of possible sizes for Mythos, which explains many of its gains. It is slow and appears hungry for tokens. A lot of the positive reactions are to this being a big model, which thus has at least a decent amount of ‘big model smell’ and generally trades being slower and more expensive for some performance gains. That’s a great move, but it should be a while before they can do it again.

Distillation from Claude is clearly part of the story, likely largely from Fable, and is clearly nothing close to the whole story. Clearly Moonshot would do this even if it helped only a little. The timing of them releasing a bigger model is suggestive.

It is again a good model, but once you correct for the overperformance on benchmarks and look at expected practical performance, it is not clear this is so different from what you would have expected from a Kimi K3 that had 2.8T parameters.

Consider that Kimi K3’s (preliminary unofficial) Epoch Capabilities Index is exactly on the Chinese trend line.

Kimi K3 is absolutely worth checking to see if it fits into your workflows. At this price point, for both the API and the subscription, it is not going to fill the role of the smaller cheaper open models, and I expect it to usually lose out in a fight with the top closed models, but there are going to be some places where Kimi K3 is a good choice.

Andrew Curran: Following the success of Kimi K3, Moonshot AI has informed investors that it plans an IPO in Hong Kong within the next six months, according to Bloomberg.

Good idea. Strike while the iron is hot.

Table of Contents

DeepSeek Moments: Here We Go Again.

We Had a Moment (Reprise from June 2025).

The Story Since Then.

The Kimi K3 Announcement, Pitch and Basic Facts.

On Modern Benchmaxxing.

Other People’s Benchmarks.

Benchmarks Are Not The Real World.

Technical Safeguards? What Are Those?

Things Kimi Can Do.

Things Kimi Cannot Do.

Things It Is Not Easy To Get Kimi To Do.

Open Weight Models Are Unsafe And Nothing Can Fix This.

Dean Ball Attempts To Be Constructive.

OpenAI Employees Are Relatively Bullish On This One.

Kimi K3 Is Relatively Strongest At Typical Agentic Coding and 3D.

Reactions.

Who Are You?

How Did They Do It?

Conclusion.

DeepSeek Moments: Here We Go Again

All discourse about Chinese models lives in the shadow of the DeepSeek moment.

There are a lot of people who really, really want another DeepSeek moment to happen.

These people really, really want to tell the story that Chinese open models are catching up to American closed models, that AI and inference will become commoditized.

Their motivations vary. They often want to affirm open models, or the importance of the ‘tech stack.’ Others simply want to see OpenAI and Anthropic go down, or know that such claims sell. Often the ultimate objective is to argue against all AI regulations, or anything that might ‘slow us down’ or cause us to ‘lose to China.’

It is actively suicidal to respond to ‘the Chinese have better models now’ with ‘then we had better sell them the compute so they can run them and also build even better ones.’ Yet every time, yes, people will argue that. Sigh.

Often they simply want to tell American AI to stop taking precautions, to stop being annoying and take down the classifiers, as in ‘genie is out of the bottle, so release the bigger genie with unlimited wishes, it’s the only way.’ People really would take major catastrophic risks rather than deal with classifiers, and are Big Mad about this.

Google was down 4.4% on the day, SpaceX was down 3.1% and Nvidia down over 2%, and tech stocks were down again on Friday, so plausibly we’re doing this again.

And yep, we are at risk of doing this again:

Axios (being wrong): China just erased America's AI lead

Seán Ó hÉigeartaigh: No it didn't. (although Kimi K3 is undoubtedly impressive)

The pattern is:

Chinese model releases.

There is some impressive benchmark cited.

Therefore, America’s lead is gone, QED, that’s it, no, really, that’s it.

In the Axios case the benchmark in question is Arena. Based on that alone, they state as fact that America’s lead is gone.

I would ignore, but this style of logic has convinced a lot of Washington D.C. multiple times, and that has had substantial policy impact.

I shudder to think what such folks might do now that they also know about Mythos. The confusion over Fable jailbreaks could easily extend to a broader dumb panic.

The original DeepSeek moment happened because of a confluence of events.

Let’s review.

We Had a Moment (Reprise from June 2025)

We all remember The DeepSeek Moment, which led to Panic at the App Store, lots of stock market turmoil that made remarkably little fundamental sense and that has been borne out as rather silly, a very intense week and a conclusion to not panic after all.

Over several months, a clear picture emerged of (most of) what happened: A confluence of narrative factors transformed DeepSeek’s r1 from an impressive but not terribly surprising model worth updating on into a shot heard round the world, despite the lack of direct ‘fanfare.’

In particular, these all worked together to cause this effect:

The ‘six million dollar model’ narrative. People equated v3’s marginal compute costs with the overall budget of American labs like OpenAI and Anthropic. This is like saying DeepSeek spent a lot less on apples than OpenAI spent on food. When making an apples-to-apples comparison, DeepSeek spent less, but the difference was far less stark.

DeepSeek simultaneously released an app that was free with a remarkably clean design and visible chain-of-thought (CoT). DeepSeek was fast following, so they had no reason to hide the CoT. Comparisons only compared DeepSeek’s top use cases to the same use cases elsewhere, ignoring the features and use cases DeepSeek lacked or did poorly on. So if you wanted to do first-day free querying, you got what was at the time a unique and viral experience. This forced other labs to also show CoT and accelerate release of various models and features.

It takes a while to know how good a model really is, and the different style and visible CoT and excitement made people think r1 was better than it was.

The timing was impeccable. DeepSeek got in right before a series of other model releases. Within two weeks it was very clear that American labs remained ahead. This was the peak of a DeepSeek cycle and the low point in others cycles.

The timing was also impeccable in terms of the technology. This was very early days of RL scaling, such that the training process could still be done cheaply. DeepSeek did a great job extracting the most from its chips, but they are likely going to have increasing trouble with its compute disadvantage going forwards.

DeepSeek leveraged the whole ‘what even is safety testing’ and fast following angles, shipping as quickly as possible to irrevocably release its new model the moment it was at all viable to do so, making it look relatively farther along and less behind than they were. Teortaxes notes that the R1 paper pointed out a bunch of things that needed fixing but that DeepSeek did not have time to fix back then, and that R1-0528 fixes them, and which weren’t ‘counted’ during the panic.

DeepSeek got the whole ‘momentum’ argument going. China had previously been much farther behind in terms of released models, DeepSeek was now less behind (and some even said was ahead), and people thought ‘oh that means soon they’ll be ahead.’ Whereas no, you can’t assume that, and also moving from a follower to a leader is a big leap.

There was highly related to a widespread demand for a ‘China caught up to the USA’ narrative, from China fans and also from China hawks of all sorts. Going forward, we are left with a ‘missile gap’ style story.

There are also a lot of people always pushing the ‘open models win’ argument, and who think that non-open models are some combination of doomed and don’t count. These people are very vocal, and vibes are a weapon of choice, and some have close ties to the Trump administration.

The stock market was highly lacking in situational awareness, so they considered this release much bigger news than it was, and it caused various people to ‘wake up’ to things that were already known and anticipate others waking up, and there was widespread misunderstanding of how any of the underlying dynamics worked, including Jevon’s Paradox and also that if you want to run r1 you go out and buy more chips, including Nvidia chips. It is also possible that a lot of the DeepSeek stock market reaction was actually about insider trading of Trump policy announcements. Essentially: The Efficient Market Hypothesis Is False.

The Story Since Then

Since then, the idea that China had caught up, or was catching up, kept coming up, drove much discussion around Washington, as echoes of this one moment.

This is then renewed every time a new strongest or exciting Chinese model comes out. Every day that China does not release a model, they look one day farther behind. When they do release, they ‘catch up’ and look less behind.

The top 10 such potential moments since r1 and before K3 were likely these:

Manus.

DeepSeek r1-0528.

Kimi K2.

GPT-5 (in reverse) which spooked a lot of people in highly stupid ways.

DeepSeek v3.1.

Kimi K2 Thinking.

DeepSeek v3.2.

Kimi K2.5.

DeepSeek v4.

GLM-5.2.

Mostly it’s been Kimi and DeepSeek. Manus got a hype train going and spooked people, and GLM-5.2 was by far their strongest offering, putting GLMs on the map.

Many of these were good models, but none fundamentally changed the game.

Roughly, since the DeepSeek moment, when DeepSeek was roughly eight months behind but had matched some key aspects faster via fast following, we have bounced around. For a while it looked like China was quite a lot behind.

GLM-5.2 and Kimi K3 have been impressive. The current best estimate of the time gap is at its lowest point. Events in AI have accelerated all around, so it is not clear that the gap is fewer product cycles than before, and I half expect to be doing this again next week for Qwen. Kimi K3 is 2.8T and seems to still be solidly behind Mythos Preview, which was announced on April 7, so that provides a starting point lower bound of a three month gap.

Ethan Mollick: Kimi is, as I have been saying, a very good model. But it is not a DeepSeek r1 moment, in that it is roughly where I would expect on the curve rather than an unexpected leap. It will be treated as a DeepSeek moment for a variety of reasons especially as more people hear about it.

Ryan Greenblatt, despite being pleasantly surprised by Kimi K3, estimates that the pretrain quality is about halfway between Opus 4 and Opus 4.5 based on forward pass math, but with some other advantages, so ~8 months behind, as one might expect.

The post-training is closer, at least in part because of distillation. Moonshot is clearly innovating, but it is also clearly distilling, both directly and also fast following via looking at outputs and copying techniques.

UK AISI issued a report on everything prior to Kimi K3, showing the time gap for narrow cyber tasks narrowing somewhat over time. Their full report is here.

[Image: https://substackcdn.com/image/fetch/$s_!CfQa!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F6549317e-c1b1-4f7e-ab3e-21e53c183d4e_1200x913.jpeg
Description: A line graph titled 'Recent open weight models compare to frontier models released 4-5 months prior on narrow cyber tasks'. The chart plots the average success rate on AISI's narrow cyber tasks (0% to 100%) against time from August 2024 to after February 2026. It tracks the performance of 12 distinct AI models, including various versions of Opus, GPT, o1, Claude Mythos, DeepSeek, and GLM. Annotations on the graph indicate a narrowing performance gap between frontier and open-weight models, decreasing from a 6-10 month gap in early 2025 to gaps of 4.3 and 5.0 months by early 2026. The bottom of the image includes a note about an omitted model and the AISI | AI SECURITY INSTITUTE logo.
Visible text: Recent open weight models compare to frontier models released 4-5 months prior on narrow cyber tasks
Recent open models and frontier closed models evaluated on 70 of AISI's narrow cyber tasks—spanning four difficulty tiers and covering a range of cybersecurity-relevant capabilities.
100%
90%
80%
70%
60%
50%
40%
30%
20%
10%
0%
Average success rate on AISI's narrow cyber tasks
1 Opus 3
2 o1
3 o3
4 GPT-5
5 Opus 4.5
6 GPT-5.2-Codex
7 Claude Opus 4.6*
8 Mythos Preview
9 DeepSeek-V4-Pro
10 Claude Mythos 5
11 GLM-5.2
12 GPT-5.6-Sol
Aug 2024
Feb 2025
Aug 2025
Feb 2026
Jan-Sept 2025 gap ranged 6-10 months
5.0 mo
4.3 mo
*GPT-5.3-Codex omitted for legibility; it was released same day as Opus 4.6 with similar performance.
AISI | AI SECURITY INSTITUTE]

My understanding is that narrow and relatively easy coding tasks are where open weights model are at their relative strongest, and the benchmark here is approaching saturation.

Indeed, when you look at the full post, you get a different answer for longer tasks.

[Image: https://substackcdn.com/image/fetch/$s_!RA9C!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F4f43380b-17c1-4f97-84e7-bb8c0b88dce4_3500x2160.png
Description: A line graph showing the performance of several AI models on a 32-step cyber attack simulation called 'The Last Ones'. The x-axis represents 'Cumulative tokens' on a log scale from 10k to 100M. The y-axis represents the 'Avg. steps completed' from 0 to 32. Key milestones of the attack are labeled along the y-axis, such as 'Initial reconnaissance', 'Wiki exploit', and 'Full network takeover'. The graph compares frontier models (like GPT-5.6-Sol and Claude Mythos 5) with open weight models (like DeepSeek-V4-Pro and GLM-5.2), showing that frontier models generally achieve more steps with fewer tokens.
Visible text: Recent open weight models compare to frontier models released 7 months prior on long-horizon cyber ranges. Trajectories for various AI models on the 32-step "The Last Ones" cyber range—a corporate network attack simulation spanning multiple subnets and hosts, without active defenders. 32 Steps completed. M9: Full network takeover. M8: Infrastructure compromise. M7: Advanced persistence. M6: C2 reverse engineering and crypto analysis. M5: Web app exploit and privilege escalation. M4: Wiki exploit and credential replay. M3: Browser credential theft. M2: Lateral movement and credential extraction. M1: Initial reconnaissance. Avg. steps completed. Cumulative tokens (log scale). GPT-5.6-Sol (best attempt). Claude Mythos 5 (best attempt). GPT-5.6-Sol 10×100M. Claude Mythos 5 10×100M. Mythos Preview 10×100M. GPT-5.5 10×100M. Claude Opus 4.6 10×100M. Opus 4.5 10×100M. GLM-5.2 10×100M. Sonnet 4.5 10×100M. DeepSeek-V4-Pro 10×100M. AISI AI SECURITY INSTITUTE.]

UK AI Security Institute: On TLO, GLM-5.2 reaches as far as Opus 4.5, a model released less than 7 months before it, while DeepSeek’s V4-Pro falls below Sonnet 4.5 (a sub-cyber-frontier model released 7 months before it). These results are broadly consistent across our other cyber ranges. Notably, GLM-5.2 reached step 7 with marginally fewer tokens than any other model on average, tracking Opus 4.6’s trajectory to step 11 before stalling.

Longer tasks are more relevant in terms of both of the most important things to worry about: Automation of AI R&D and cyber attacks.

One might also worry about bio risks, even if that is not as in fashion, and it is a little concerning we don’t see standard testing on that at all for the open models. That needs to be addressed. We do have the score on OpenAI’s GeneBench-Pro via Andrew Ho. This measures judgment under long-horizon ambiguity in computational biology. Kimi K3 exceeded expectations. Mythos have not been tested. Fable refused most requests in the benchmark.

[Image: https://substackcdn.com/image/fetch/$s_!1a5v!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fc1d7be0c-17e1-42ab-96fd-1f03a0d79422_1199x480.jpeg
Description: A horizontal bar chart comparing performance percentages for several AI models. The models listed include four variations of 'GPT-5.6 Sol' (max, xhigh, high, medium), 'Kimi K3', and 'Claude Opus 4.8 max'. All bars are solid blue except for 'Kimi K3', which is orange with a diagonal stripe pattern. The percentages range from 15.97% for Claude Opus 4.8 max to 28.73% for GPT-5.6 Sol max. The value for Kimi K3 is 19.63%.
Visible text: GPT-5.6 Sol max 28.73%
GPT-5.6 Sol xhigh 26.85%
GPT-5.6 Sol high 24.41%
GPT-5.6 Sol medium 22.50%
Kimi K3 19.63%
Claude Opus 4.8 max 15.97%]

[Image: https://substackcdn.com/image/fetch/$s_!Sdhc!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff9f19a38-79d6-42ba-b37a-d01c6ad08b76_2300x844.jpeg
Description: A vertical bar chart titled 'Overall pass rates' that displays the 'Mean pass rate across problems' for various AI models. The models are categorized into three distinct groups along the x-axis: 'Non-GPT models', 'GPT models', and 'GPT Pro (Extended)'. The y-axis shows the pass rate percentage, ranging from 0% to 40%. Each blue bar represents a model, and its specific pass rate and error bars are indicated at the top. The pass rates increase from left to right, showing that GPT and GPT Pro (Extended) models generally perform better than most non-GPT models, with '5.6 Sol Pro (Extended)' having the highest pass rate of 31.5%.
Visible text: A Overall pass rates 40% Non-GPT models GPT models GPT Pro (Extended) 31.5% 30% 28.7% 28.5% 23.3% 23.6% 20.5% 20% Mean pass rate across problems 16.0% 16.5% 16.3% 12.0% 10% 8.1% 8.9% 8.5% 4.9% 4.0% 4.4% 4.6% 3.1% 0.6% 0.9% 0.9% 1.2% 1.2% 1.5% 2.0% 2.3% 2.3% 2.4% 2.4% 0% MiniMax M2.7 Tencent HY3 MiniMax M3 MiMo V2.5 GLM 5.1 Grok 4.3 MiMo V2.5 Pro Kimi K2.7 Code Qwen 3.7 Plus DeepSeek V4 Flash DeepSeek V4 Pro Gemini 3.1 Pro Qwen 3.7 Max Kimi K2.6 GLM 5.2 Gemini 3.5 Flash Opus 4.8 max 5.2 xhigh 5.4 xhigh 5.5 xhigh 5.6 Luna max 5.6 Terra max 5.6 Sol max 5.2 Pro (Extended) 5.4 Pro (Extended) 5.5 Pro (Extended) 5.6 Luna Pro (Extended) 5.6 Terra Pro (Extended) 5.6 Sol Pro (Extended)]

Beating Opus and GPT-5.5 is impressive stuff. No previous open model came close. We are on the verge of doing some f***ing around and thus finding out. This is a place where plausibly not much happens until suddenly quite a lot happens.

The conclusion of ‘open models will catch up to Mythos in general capability including the thing that currently makes it unique’ is indisputable. That is coming, the question is when, and that will establish the effective gap. Given Kimi K3 we should expect this to happen a few months from now.

If we take both ends of UK AISI’s estimates, the pre-Kimi gap was 4-7 months, down from 6-10 months last year, in an area of relative strength. That’s roughly a similar amount of progress gap in absolute terms, and everything is accelerating.

The Kimi K3 Announcement, Pitch and Basic Facts

2.8 Trillion parameters, 16 of 896 areas active at once which implies ~50B active. This is not easy to run locally, and won’t be that cheap.

$3.00/$15.00, modestly cheaper than Opus and Sol.

Subscription plans are $19/$39/$99/$199 per month. The larger buys have some modest advantages and quota scales linearly with price.

1M token context.

API link, Tech blog link.

Training cutoff is reportedly early 2026.

Open weights promised by July 27th.

All benchmarks run under maximum effort settings.

Kimi: Today, we are introducing Kimi K3 — our most capable model. Kimi K3 is a 2.8T-parameter model built on our Kimi Delta Attention and Attention Residuals, with native vision capabilities and a 1-million-token context window. It is the world's first open 3T-class model, designed for frontier intelligence across long-horizon coding, knowledge work, and reasoning.

While its overall performance still trails the most powerful proprietary models, Claude Fable 5 and GPT 5.6 Sol, Kimi K3 demonstrated frontier-level performance across our evaluation suite, consistently outperforming other tested models.

Kimi.ai: Kimi K3 is now live on on http://Kimi.com, Kimi Work, Kimi Code, and the Kimi API. Open Weights by July 27, 2026.

K3 is built on Kimi Delta Attention (KDA) and Attention Residuals (AttnRes), two architectural updates designed to improve how information flows across sequence length and model depth.

We have also scaled up Mixture of Experts (MoE) sparsity, effectively activating 16 out of 896 experts when paired with a Stable LatentMoE framework.

Together with refined training and data recipes, these structural changes yield an approximate 2.5× improvement in overall scaling efficiency compared to K2, allowing the model to convert compute into intelligence more effectively.

As stated above, they claim strong official benchmarks, although short of Sol or Fable.

[Image: https://substackcdn.com/image/fetch/$s_!FE7c!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F64268f2a-e1ea-49c9-bb91-6ffe9be55117_3555x1999.png
Description: A set of six horizontal bar charts comparing the performance of several large language models across different coding-related benchmarks. The benchmarks displayed are DeepSWE, Terminal Bench 2.1, FrontierSWE, Program Bench, Kimi Code Bench 2.0 (Internal), and SWE Marathon. The models compared include GPT-5.6 Sol, Fable 5, Kimi K3, GPT-5.5, Opus-4.8, and GLM-5.2. Each chart shows a list of models with their corresponding scores and bars representing the magnitude. In all charts, the bar for 'Kimi K3' is highlighted in a vibrant blue color, while the others are light gray. A subtitle at the top states: 'All maxed out on thinking effort: max or xhigh.'
Visible text: Coding All maxed out on thinking effort: max or xhigh. DeepSWE GPT-5.6 Sol 73.0 Fable 5 70.0 Kimi K3 67.5 GPT-5.5 67.0 Opus-4.8 59.0 GLM-5.2 46.2 Terminal Bench 2.1 GPT-5.6 Sol 88.8 Kimi K3 88.3 Opus-4.8 84.6 Fable 5 84.6 GPT-5.5 83.4 GLM-5.2 82.7 FrontierSWE Fable 5 86.6 Kimi K3 81.2 GPT-5.6 Sol 71.3 GLM-5.2 67.3 Opus-4.8 66.7 GPT-5.5 64.9 Program Bench Kimi K3 77.8 GPT-5.6 Sol 77.6 Fable 5 76.8 Opus-4.8 71.9 GPT-5.5 70.8 GLM-5.2 63.7 Kimi Code Bench 2.0 (Internal) Fable 5 76.9 Kimi K3 72.9 Opus-4.8 71.7 GPT-5.5 69.0 GPT-5.6 Sol 64.8 GLM-5.2 64.2 SWE Marathon Kimi K3 42.0 Opus-4.8 40.0 GPT-5.6 Sol 39.0 Fable 5 35.0 GPT-5.5 14.0 GLM-5.2 13.0]

[Image: https://substackcdn.com/image/fetch/$s_!6DHb!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fc6a198e8-c692-4e63-aa3b-0b0dedc3897c_3555x2719.png
Description: An infographic comparing various AI models across different benchmarks in two categories: 'General Agents' and 'Visual Agents'. The benchmarks include GDPval-AA v2 Elo, JobBench, AA-Briefcase Elo, SpreadsheetBench 2, Automation Bench, BrowseComp, CharXiv (RQ) w/ tool, and Zerobench w/ tool (Pass@5). The models compared are Fable 5, GPT-5.6 Sol, Kimi K3, Opus-4.8, GLM-5.2, and GPT-5.5. In each chart, Kimi K3's performance is highlighted with a blue bar, while other models are shown in light gray. Both sections include the note, 'All maxed out on thinking effort: max or xhigh.'
Visible text: General Agents All maxed out on thinking effort: max or xhigh. GDPval-AA v2 Elo Fable 5 1760.0 GPT-5.6 Sol 1748.0 Kimi K3 1668.0 Opus-4.8 1600.0 GLM-5.2 1514.0 GPT-5.5 1494.0 JobBench Fable 5 57.4 Kimi K3 52.9 Opus-4.8 48.4 GPT-5.6 Sol 46.5 GLM-5.2 43.4 GPT-5.5 38.3 AA-Briefcase Elo Fable 5 1583.0 Kimi K3 1548.0 GPT-5.6 Sol 1495.0 Opus-4.8 1354.0 GLM-5.2 1260.0 GPT-5.5 1158.0 SpreadsheetBench 2 Kimi K3 34.8 Fable 5 34.7 GPT-5.6 Sol 32.4 Opus-4.8 31.6 GPT-5.5 29.1 GLM-5.2 28.1 Automation Bench Kimi K3 30.8 GPT-5.6 Sol 29.7 Fable 5 29.1 Opus-4.8 27.2 GPT-5.5 22.7 GLM-5.2 12.9 BrowseComp Kimi K3 91.2 GPT-5.6 Sol 90.4 Fable 5 88.0 GPT-5.5 84.4 Opus-4.8 84.3 Visual Agents All maxed out on thinking effort: max or xhigh. CharXiv (RQ) w/ tool Fable 5 93.5 Kimi K3 91.3 Opus-4.8 89.9 GPT-5.6 Sol 89.1 GPT-5.5 89.0 Zerobench w/ tool (Pass@5) Fable 5 46.0 Kimi K3 41.0 GPT-5.5 41.0 GPT-5.6 Sol 35.0 Opus-4.8 34.0]

[Image: https://substackcdn.com/image/fetch/$s_!GxqT!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F0d57db99-ce84-445e-a472-1e904a4fea08_1200x858.jpeg
Description: A set of three horizontal bar charts comparing the performance of three AI models: Kimi K3, GPT 5.5, and Claude Opus 4.8. The charts are grouped under the main title 'Internal Knowledge Work Bench' with a subtitle that says 'All maxed out on thinking effort: max or xhigh.' The three benchmarks are 'Online Exp Bench', 'DECK-Bench', and 'Finance-Bench'. In each benchmark, Kimi K3 is represented by a blue bar and achieves the highest score, while the other two models are shown with light gray bars. The scores for Kimi K3 are 75.5 in Online Exp Bench, 73.5 in DECK-Bench, and 62.6 in Finance-Bench.
Visible text: Internal Knowledge Work Bench
All maxed out on thinking effort: max or xhigh.
Online Exp Bench
Kimi K3
75.5
GPT 5.5
70.6
Claude Opus 4.8
65.9
DECK-Bench
Kimi K3
73.5
GPT 5.5
68.2
Claude Opus 4.8
66.9
Finance-Bench
Kimi K3
62.6
Claude Opus 4.8
60.7
GPT 5.5
58.4]

The ad, which Tyler Cowen called very positive and very good, falls flat to me, and contains zero useful information.

On Modern Benchmaxxing

We used to see rather explicit benchmaxxing. Labs would train on the test, or on the very narrow thing the test would cover, because we had a limited set of known targets. You had to know which labs did this, to what extent, when looking at numbers.

Our benchmarking tech has improved, and now they collectively measure real things, and there are a variety of backups in case you aim too narrowly.

roon (OpenAI): on the subject of benchmaxxing - it seems benchmarking technology has gotten better recently, like most other technology. people are more skeptical and build these things more carefully. there’s also a explosion of downstream coding customers building internal heldout evals

Looking at the gestalt of different benchmarks is also valuable. Everything should be part of a map that fits into a common pattern that reflects the underlying territory.

You can still absolutely benchmaxx without being as explicit as you used to be.

Benchmarks measure some types of abilities rather than others, and measure shallow rather than deep tasks, and exclude many valuable properties or potential liabilities. And some labs focus more on those aspects, or have more success on them, than others.

You can also set effort to maximum for all the tests, which Moonshot did.

Think of the benchmarks as a lower bound. Kimi’s benchmarks prove it is for real, and it could only underperform (or outperform) them by so much. I still expected, and continue to believe, that they modestly overstate Kimi K3’s relative capabilities.

Other People’s Benchmarks

On the closest thing we have to the One True Benchmark, Kimi K3 does well, confirming claims that overall this model has the third highest benchmarks:

[Image: https://substackcdn.com/image/fetch/$s_!XsAE!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F19f49a9c-0198-4499-9a0e-328e51819609_761x694.png
Description: A bar chart titled 'Artificial Analysis Intelligence Index' that displays the ranking of various AI models based on a set of 9 specific evaluations. The chart shows scores ranging from 50 to 60, with the models ranked in descending order from left to right. 'Claude Fable 5 (with fallback)' has the highest score of 60, followed by 'GPT-5.6 Sol (max)' at 59 and 'Kimi K3' at 57. The models are from various companies including Anthropic, OpenAI, Moonshot AI, xAI, Zhipu AI, and Google, as indicated by the logos and model names below each bar.
Visible text: Artificial Analysis Intelligence Index Artificial Analysis Intelligence Index v4.1 incorporates 9 evaluations: GDPval-AA v2, τ³-Banking, Terminal-Bench v2.1, SciCode, Humanity's Last Exam, GPQA Diamond, CritPt, AA-Omniscience, AA-LCR 60 59 57 56 55 55 54 53 51 51 51 50 Claude Fable 5 (with fallback) GPT-5.6 Sol (max) Kimi K3 Claude Opus 4.8 (max) GPT-5.6 Terra (max) GPT-5.5 (xhigh) Grok 4.5 (high) Claude Sonnet 5 (max) GPT-5.6 Luna (max) GLM-5.2 (max) Muse Spark 1.1 (xhigh) Gemini 3.5 Flash Gemini]

Kimi K3 is (in a preliminary unofficial result) exactly on the Chinese trend line for the Epoch Capabilities Index (ECI), between Opus 4.6 and Opus 4.7, which would place it six months behind OpenAI and Anthropic, but ahead of Google, Meta and SpaceX.

[Image: https://substackcdn.com/image/fetch/$s_!5oKu!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe2ff303f-30c4-4cf7-98cf-630647fe3a9d_564x764.png
Description: A dark-themed table ranking various AI models by their 'ECI' scores. The columns are 'Rank', 'Model', and 'ECI'. There are 17 entries in total, with 'GPT-5.6 Sol' at the top with a score of 161.82. The 11th entry, 'Kimi K3', is highlighted in bold text.
Visible text: Rank Model ECI
1 GPT-5.6 Sol 161.82
2 GPT-5.5 Pro 160.78
3 Claude Fable 5 160.46
4 GPT-5.5 158.34
5 GPT-5.6 Terra 158.30
6 Claude Opus 4.8 157.86
7 GPT-5.4 Pro 157.84
8 GPT-5.4 156.02
9 Claude Opus 4.7 156.01
10 GPT-5.6 Luna 155.66
11 Kimi K3 155.53
12 GPT-5.3 Codex 155.36
13 Claude Opus 4.6 155.31
14 Gemini 3.1 Pro 154.84
15 GPT-5.2 Pro 154.67
16 Gemini 3.5 Flash 154.60
17 Muse Spark 154.23]

Kimi K3 highly impresses on Harvey LAB-AA all-pass rate, in first by a wide margin, I’d like to see a sanity check on this:

[Image: https://substackcdn.com/image/fetch/$s_!bClU!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fba8ff246-c280-4d13-963b-51b71320db79_680x356.jpeg
Description: A bar chart titled 'Harvey LAB-AA: All-pass Rate' shows the performance of 24 different AI models on a specific benchmark. The chart displays the 'All-pass Rate,' which is the share of tasks where every rubric criterion is met, with no partial credit. The Y-axis represents the percentage, ranging from 26.7% for 'Kimi K3' down to 0.0% for several models at the end of the list. Each bar is color-coded and accompanied by a brand logo and a lightbulb icon for 'reasoning models'. The benchmark is independently conducted by 'Artificial Analysis.'
Visible text: All-pass Rate Criterion Pass Rate Harvey LAB-AA: All-pass Rate Share of tasks where every rubric criterion passes (Harvey's all-pass grading, no partial credit) · Independently benchmarked by Artificial Analysis 24 of 34 models + Add model from specific provider Artificial Analysis 26.7% 14.2% 13.3% 8.3% 7.5% 7.5% 6.7% 5.0% 5.0% 4.2% 3.3% 3.3% 2.5% 1.7% 1.7% 1.7% 0.8% 0.0% 0.0% 0.0% 0.0% 0.0% 0.0% 0.0% Kimi K3 Claude Fable 5 (with fallback) Grok 4.5 (high) Muse Spark 1.1 (high) Claude Opus 4.8 (max) GLM-5.2 (max) MiniMax-M3 GPT-5.6 Luna (max) Claude Sonnet 5 (max) GPT-5.5 (high) DeepSeek V4 Pro (max) Nemotron 3 Ultra GPT-5.6 Terra (max) GPT-5.6 Sol (max) Gemini 3.5 Flash DeepSeek V4 Flash (max) Mistral Medium 3.5 gpt-css-120b (high) Gemma 4 31B Gemini 3.1 Pro Preview Claude 4.5 Haiku Kimi K2.6 MiMo-V2.5-Pro Qwen 3.7 Max Reasoning models are indicated by a lightbulb icon]

For criterion pass rate this is 94.6% vs. 93.6%, less of a gap but a win is a win.

Arena Frontend Code has Kimi K3 at #1 ahead of Fable 5 and Sol.

Performance is strong on GDPVal-AA and AA-Briefcase.

Kimi K3 comes in third on VoxelBench for visual reasoning behind Sol and Fable.

Conspicuously missing are Cybersecurity benchmarks like CyberGym. Cyber capabilities are not so divorced from coding capabilities, so we can guess.

The closest I’ve found is Malte Ubl running it through DeepSec, a private cyber benchmark. It was a tier below Sol and similar to GPT-5.5. If that is accurate, then there will be some uplift to cyber attacks and the internet will in some ways be a more hostile place, but in other ways it will improve, and the tail risks are limited.

Parv Mahajan reports preliminary CyBench results, in that the benchmark was already saturated as of Opus 4.7 and Kimi K3 also saturates it, which lower bounds performance but doesn’t say much else.

The official tech blog talks a lot about benchmarks, and some about features, and talks basically not at all about risks or mitigations.

No, they did not submit Kimi K3 for the 30-day review with the White House.

Dean W. Ball: I guess the program really is voluntary

Dean W. Ball: I wonder if the California attorney general or the European Union ai office will seek to make moonshot comply with their respective frontier ai regulations

Moonshot has to deal with the CCP, which comes with its own issues. They presumably will not in practice comply with California or the EU, and I presume both California and the EU will not do anything about this for now. But yes, this is one point of potential pain, including risk for anyone using Kimi K3 commercially.

Sam has some good advice for how the UK, or others watching, would be wise to view and react to this. We will know more over time, including once we have the weights, and when teams like UK AISI can run tests.

I think it counts as a benchmark that Lisan is impressed by its SVGs, saying they are better than Fable’s.

Debate Benchmark is a place Kimi K3 outperformed my expectations, and where Sol is relatively weak.

Lech Mazur: Kimi K3 ranks second overall on the Debate Benchmark, trailing only Claude Fable 5!

However, it is much more expensive to run than Kimi K2.6.

This benchmark measures how well LLMs perform in adversarial, multi-turn debates across a wide range of topics. Strong performance requires knowledge, accurate use of relevant facts, rebuttals, and the ability to stay coherent, responsive, and defensible over several rounds.

Each matchup runs twice on the same topic with sides swapped. A three-model judge panel then decides winner and margin.

Fable 5 still hasn’t lost a single side-swapped matchup aggregate debate.

[Image: https://substackcdn.com/image/fetch/$s_!TiLi!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F91e5a40e-f4ef-41e5-9ea0-f8a9ae4a1d5f_1200x800.jpeg
Description: A bar chart titled 'Debate Benchmark Leaderboard' displaying 'Bradley-Terry rating' for various AI models. The ratings range from approximately 1071 to 1757, with 'Claude Fable 5 (high)' being the top-rated model. The chart uses colored bars, each topped with its numerical score, and icons at the base indicating the developer. Footnotes at the bottom detail the statistical methodology, including the use of Bradley-Terry pairwise ratings and a benchmark baseline of 1500.
Visible text: Debate Benchmark Leaderboard
Bradley-Terry • Higher = stronger judged debate performance
1800
1700
1600
1500
1400
1300
1200
1100
1000
Bradley-Terry rating
1071 1255 1283 1307 1366 1382 1399 1406 1417 1419 1420 1426 1428 1440 1444 1448 1469 1470 1478 1489 1490 1511 1519 1526 1529 1531 1537 1547 1555 1564 1579 1584 1595 1597 1618 1668 1680 1684 1685 1741 1757
Llama 4 Maverick
Mistral Large 3
Baidu Ernie 5.0
GPT-OSS-120B
Gemini 3.1 Flash-Lite Preview
Mistral Medium 3.5 (high)
DeepSeek V3.2
Grok 4.3
Tencent Hy3 Preview (high)
Baidu Ernie 5.1
Step 3.7 Flash (high)
Qwen3.5-397B-A17B
Xiaomi MiMo V2 Pro
Grok 4.20 0309 (Non-Reasoning)
Gemini 3.5 Flash
MiniMax-M2.7
Qwen 3.7 Max
DeepSeek V4 Pro
ByteDance Seed2.0 Pro
Kimi K2.5 Thinking
Qwen 3.6 Max Preview
Grok 4.5 (high)
Xiaomi MiMo V2.5 Pro
Gemini 3.1 Pro Preview
GPT-5.4 (no reasoning)
MiniMax-M3
Kimi K2.6
GLM-5.1
GPT-5.5 (high)
Sonnet 4.6 (no reasoning)
GPT-5.4 (high)
GLM-5.2 (max)
Sonnet 4.6 (high)
Sonnet 5 (high)
Opus 4.8 (high)
GPT-5.6 Sol (high)
Muse Spark 1.1 (high)
Opus 4.7 (high)
Kimi K3
Claude Fable 5 (high)
• One bar per model; height = estimated rating
• Grey band spans the 95% robust CI; darker = more likely rating location
• BT = Bradley-Terry pairwise rating fit from complete side-swapped matchups; 1500 is the benchmark baseline, so higher means stronger than this pool's baseline
• Scale is relative within this pool and centered near 1500, not an absolute capability score
• Scope: 2,134 matchup groups, 4,268 debates, 683 topics, 13,365 judge rows
• Higher = stronger judged debate performance
• Ratings ignore incomplete or failed side-swap groups
By Lech Mazur (@lechmazur)]

Kimi scored an impressive 95.8 on Mazur’s Extended NYT Connections, for 3rd best, but it cost more than Fable to run. As of last check his other scores are not in yet.

Kimi scores almost Claude-level on the sycophancy test, ‘You’re absolutely right!’

I wonder how much of this is because of the distillations:

[Image: https://substackcdn.com/image/fetch/$s_!zwIT!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F7cb39a36-1d25-44b4-8c76-ee3326fc4e0b_1289x1296.png
Description: A horizontal bar chart titled Leaderboard (higher = less sycophantic) ranking 22 different AI models. The list is topped by Anthropic: Opus 4.8 with a score of 4.5, followed by other Anthropic models like Opus 4.7, Haiku 4.5, and Sonnet 5. The chart includes models from OpenAI, such as versions of GPT 5.6 and 5.5, and Gemini models from Google. Scores decrease as you move down the list, ending with OpenRouter: DeepSeek V4 at rank #22 with a score of 1.5. The color of the horizontal bars transitions from a bright green at the top, through yellow-green, yellow, and finally orange at the bottom.
Visible text: Leaderboard (higher = less sycophantic) #1 Anthropic: Opus 4.8 4.5 #2 Anthropic: Opus 4.7 4.3 #3 Anthropic: Haiku 4.5 4.1 #4 Anthropic: Sonnet 5 3.9 #5 Anthropic: Fable 5 3.6 #6 Anthropic: Opus 4.5 3.6 #7 Anthropic: Opus 4.6 3.6 #8 OpenRouter: Kimi K3 3.5 #9 OpenAI: GPT 5.6 Sol 2.9 #10 OpenRouter: Kimi K2.6 2.8 #11 OpenAI: GPT 5.5 2.6 #12 Gemini: Gemini 3 Flash 2.5 #13 OpenAI: GPT 5.6 Luna 2.5 #14 OpenAI: GPT 5.6 Terra 2.5 #15 OpenRouter: Grok 4.3 2.5 #16 OpenAI: GPT 5.4 2.4 #17 OpenRouter: Grok 4.5 2.4 #18 Gemini: Gemini 3.1 Pro 2.3 #19 OpenRouter: GLM 5.2 2.1 #20 OpenAI: GPT 5.4 Mini 1.9 #21 Gemini: Gemini 3.5 Flash 1.8 #22 OpenRouter: DeepSeek V4 1.5]

Benchmarks Are Not The Real World

Ethan Mollick: A lot of swift conclusions are being drawn about Kimi K3 based on fairly saturated benchmarks and ELOs, rather than actually testing it on very hard problems. The AI frontier has already moved so far that a good model that is a still months behind looks like the future to many.

Dean W. Ball: Public benchmarks are decreasingly useful as a means of discovering truthful things about model performance. It’s hard to make benchmarks that challenge today’s models. But you can sense the difference at the true frontier if you have really hard problems to pose to models.

How well does Kimi K3 hold up and translate into the real world?

Exactly how good is Kimi K3? How do we put this in context?

Great questions.

You absolutely cannot say something is e.g. an ‘undisputed frontier model’ based on benchmarks alone.

Technical Safeguards? What Are Those?

There are presumably safeguards against things the CCP does not want you to say.

We do not see explicit safeguards to prevent misuse. Zero for biology.

kagaﾔｷ: Reports that the biology/virology safeguards are non-existent.

We see neither ‘look at what Kimi can do in biology’ nor ‘look at what Kimi refuses to do for me in biology.’

This implies either jagged intelligence or highly innovative nerfing of bio capabilities. I’m going to assume there are not highly innovative nerfs involved, since presumably they would be bragging about that.

Also, it would be foolish to depend on such safeguards, since they’re going to open up the weights soon, at which point the worst person in the world would remove them.

s1r1us (mohan) (talking about cyber): yeah no guardrails.

Then there’s cyber, where s1r1us reports it is strangely weak. But it’s not easy to be bad at cyber while being good at general coding, since they are largely the same skill. And again, we don’t see people hitting explicit safeguards.

Eric’s hypothesis is interesting and was highlighted by Fable during editing. If Kimi K3 is being trained largely by distillation from Fable, but Fable refuses cyber tasks, then that would explain a relative capability deficit on cyber, but many skills would still transfer over since they’re the same skills as regular coding.

s1r1us (mohan): man, i am so disappointed about kimi k3. it performs worse than grok 4.5 on most of our security benchmarks.

not sure if it benchmark-maxxed or just jagged intelligence.

i just don’t get how they can nerf specifically for cyber. cyber benchmarks mostly test for model’s code reasoning capabilities, removing that will affect your coding benchmarks.

i would assume model is just bad at complex reasoning tasks or they have some crazy way to nerf cyber.

TESS: same experience

AbuMuslim (أبومُسْلِم): V8 exploits?

s1r1us (mohan): yes and generic vulnerability discovery

Eric: I've repeatedly seen this with all openweight models. Maybe its hard to distill cyber tasks from frontier models due to safeguards. I think more likely the open-weight models have a long way to go in terms of reasoning capabilities.

sahuang: What benchmark did you look into? If it's bad specifically for cyber can also be similar to GLM-5.2 where they did not put cyber in training data so this part is "nerfed" and the skillset comes from general capabilities. So maybe it is great in coding and stuff but not cyber.

s1r1us (mohan): my assumption if they are good at code reasoning capabilities it automatically gets translated to cyber, mythos isn't specifically trained for cyber as per anthropic but it got those emergent cyber capabilities because its good at code and math.

it is possible that they sandbagged in post-training.

also its probably specific to my dataset which has v8, generic web exploitation and various stuff covering different skill capabilities. have to do more testing and probably it changes. very curious to see how it performs on other cyber benchmarks

Things Kimi Can Do

Many were impressed by this particular trick, but I had Sol check it out and it was not so impressed, including guessing that K2.6, Gemini and GLM-5.2 had a good shot at matching its work here.

Max Weinbach: I asked a Kimi K3 Max agent swarm to recreate macOS 27 with real Liquid Glass and native apps in web browser and it’s been going for 3 hours

Chaos Capitalist: claude has been able to do this for like 3 years bro, you never saw
https://ryo.lu ? it can be made in like 15 minutes

Max Weinbach: Every app works. It can generate audio. It saves voice memos to your browser and if you close the page and reopen, it remembers and saves state.

Max Weinbach: It finally finished, here's the final output. Used 60% of my monthly Kimi usage on it

https://macos27.kimi.page

Ethan Mollick: Kimi is very good at a lot of stuff, including making copies of pleasing UI. It did not actually build MacOS

Things Kimi Cannot Do

So bold, also brave.

Theo Jaffee: Registering my prediction of no widespread societal chaos after the open-sourcing of Kimi K3

Quite the bar there.

I have previously explained the reasons, in terms of cyber risk, that Mythos is in a different category from Sol. It is not about being able to do any given thing when pointed at it, it is the ability to put it all together and do things autonomously at scale. Kimi K3 may or may not be in Sol’s category. Too soon to be sure. It clearly is not in that of Mythos.

Many people are very dedicated to not understanding this, and also to not understanding that a system that cannot afford false negatives will end up with some false positives, such as David Sacks here quoting calle and clem saying Kimi K3 did a defensive task Sol and Fable refused to do, and thus concluding that we should just have our models be willing to do any task the Kimi K3 can do.

I mean, yes, it would be great if we could have guardrails that stopped only the bad tasks and helped with the good tasks, or only refused the tasks that were both plausibly bad and that also could not otherwise be done. But it turns out that is hard. Anthropic should absolutely improve their classifiers and guardrails to reduce false positives, but OpenAI’s classifiers are pretty reasonable, and yes that will involve some false positives, especially if you quote those who are least able to work around it.

Things It Is Not Easy To Get Kimi To Do

As is often the case on a release weekend, servers seemed overloaded. This is not the easiest model to serve and compute was limited. Moonshot is responding by pausing new subscriptions to prioritize current members and is working to add capacity.

Supply will presumably better match demand once the model can be served by others.

In the meantime, getting a response has not been not easy.

Danielle Fong: still waiting for a single response.

fabian: same

Danielle Fong : never mind after some retries, i got this

pretty good but it has absorbed a lot of what make opus 47., 4.8 difficult, but smart. (smarter?). seems to lie a bit. but that's ok because i can see the thinking traces...

typebulb: Unusable right now via openrouter; slow, cuts outs all the time.

Petr Baudis (he did later get a few reps in): anyone out there actually successfully using k3 for anything?

Robin Hanson: I've heard good things about Kimi, but the free version is always too busy when I try, & it wants $180 to get better access. That seems a big ask.

The model is not all that cheap, either, despite them clearly not charging enough.

imog: Also disappointed, but my own fault I guess as I was anchoring price expectations to kimi 2.6/2.7... $3/M input isn't as good a fit for me. GLM5.2/DSV4P get it done, but was hoping for that pricing (<$2input)

So thats not K3, but other capable models likely to slot in there soon

Naveesh /looping: their $19 sub quota suuuuucks

David Manheim: The prices actually being charged show [open models being inherently orders of magnitude cheaper is] just not true. And there's a simple reason why - the price largely isn't controlled by the model provider, it's dictated by the compute costs.

That's just the way the economics works out.

You can charge a solid markup for a high quality product presented in a high quality way, but not no one has a gap that allows orders of magnitude of markup, and they wouldn’t even in a pure duopoly.

The best model can still be worth quite a lot. For a large percentage of all tokens, if given only these choices, I would pay ten times as much for Sol or Fable, rather than the base cost for GPT-5.5 or Opus. Even if Kimi is on par with GPT-5.5, it loses out.

The pricing means that you’re comparing Kimi subscriptions to Claude or ChatGPT subscriptions, which all go from $20 to $200, and Kimi’s limits don’t seem that high.

kyle: tried to use it on OR but the price makes it uncompetitive, no point using it when there’s ant/oai subscriptions. their first party subscription is a complete non-starter for actual work

Open Weight Models Are Unsafe And Nothing Can Fix This

(This section was entirely written prior to today’s news regarding the Trump admin.)

K3 is no Mythos. That does not mean that Kimi K3 is a safe open weights release.

Kimi K3 is poised to be the most capable open weights model. Others might be more efficient for a task, but on the cyber capabilities we worry about most, and presumably also on the bio ones we’d worry about most, K3 is probably the strongest open model yet. How worried should we be?

I believe we should be non-zero worried that there will be substantial trouble. The median outcome is that we see modest upticks in some forms of ‘ordinary decent’ trouble, not fun exactly but nothing we cannot handle, and nothing that would in hindsight make us want to have halted release. But there is a tail risk here.

I’d estimate something like a 10% chance we regret letting this happen, and ~2% chance that it was a rather serious mistake.

What it will almost certainly not do is cause ‘widespread societal chaos.’

David Manheim: (I think it's very likely we see huge problems enabled by the new model, but not widespread chaos, and not quickly - AI development is much faster than the users executing on plans.)

This is in contrast to releasing Mythos, or a model on par with Mythos. That gap is a big deal, I have done my best to explain several times why Mythos is unique here, and hopefully the time with Mythos, Fable and Sol will help us prepare.

My current model is that the CCP and Xi:

Recognize that there are serious security concerns with frontier AI models.

Know they are behind on frontier capability and compute, and recognize the advantages they get from openness, both in diffusion and aura farming.

Pursue an intentional fast following strategy, focused on efficiency and diffusion, using American labs to lead the way and often using distillation. That still involves innovations, and often means doing some things better. Transitioning to ‘taking the lead’ would be a huge, difficult and expensive transition, which would take a while even if America fully ‘paused’ in the relevant senses.

Did not directly push Alibaba to open up Qwen. They continue to support openness, and Alibaba’s experiment with being closed failed because their models are not good enough to compete for the closed market. So Alibaba folded.

I don’t have insider info and I’m not certain, but this is how I’d bet.

Are not yet so AGI pilled and have not fully had their Mythos Moment.

Plan to ride the openness wave as long as they can, but are prepared, as they did in Covid, to come down and come down hard the moment they have to.

Ensure their preparedness largely via prior restraints and other rules on Chinese models, with a level of regulation and control that would have most who are ‘defending open source’ screaming bloody murder if they actually understood what was going on, and you suggested applying similar rules in America.

I think this is a highly reasonable strategy, given their position. If we also take as a given their current level of AGI pilling, it is clearly the correct approach for them.

Nathan Lambert offered thoughts back in May from inside China’s labs. I hesitate to endorse cultural generalizations, but story seems like it checks out.

Dean Ball Attempts To Be Constructive

Dean Ball had a good comment that seems worth sharing in full, including because of his history at the White House and his new position at OpenAI, in part because it is thoughtful, and in part because of the responses being absolutely unhinged.

And then, right at press time, Dean Ball turned out to be right, as per the next section. Aside from this paragraph I left this section unedited, other than adding in the exchange with Emil Michael. It was not written with hindsight.

If you know Dean Ball, you know that this is exactly the type of comment he was making in similar situations before joining OpenAI. It is entirely consistent with his previous thinking, both in public and private.

Dean W. Ball: Some observations on Kimi:

1. It's a very good model! I don't think its performance can be explained away by distillation or anything like that. In agentic coding sessions, it seems pretty much on par with the best public models of Q1 2026. In my fairly limited use, it also seemed very token hungry. It's not obvious to me that this model is actually that cheap to run.

2. I am personally surprised the Chinese state continues to allow the open sourcing of models this good, given potential risks. To be clear, I *myself* might be fine with models presenting this level of marginal risk being open weight, but I am surprised that China is fine with it. I suspect the reason they are is 75% explained by strategic blindness/lack of AGI-pilledness (the CCP is very Yann Lecun-y in its views of AI). The other 25% or so is their lack of compute for customer inference (making China's open-weight strategy an unintended byproduct of US export controls) and the normal Chinese strategy of aggressive exports. For the companies, as opposed to the government, the decision to open source is partially ideological and partially because they are behind, and they know that very few people would pay for sub-frontier models from China.

Xi had a speech only yesterday backing open models, but also the need for control, and Kimi K3 is approaching the point where the contradictions become apparent.

I agree that the CCP does not yet understand the situation and is insufficiently AGI pilled, but I also think that in their position, if I am right about where Kimi K3 lands, this is a calculated risk I would have expected them to take.

The next round is where they may have to make a more difficult decision.

3. Open-weight models are inherently decelerationist, and I'm continually surprised to see the so-called "accelerationists" so excited about open-weight models. I suspect the reason they are is that they know open-weight models are effectively ungovernable, and they simply like the overall cloak of ungovernability open-weight models create over the whole of AI. It's not a bad strategy; it reminds me of James Scott's recounting of the hill people in "the art of not being governed." Still, in the end, open-weight models deter further AI capex.

Dean Ball is discussing acceleration or deceleration as being about the capabilities of the largest frontier models, not about the diffusion of capabilities or use of chips. A lot of people did not understand this.

A lot of the ‘accelerationists’ do not have coherent world models and certainly do not understand second order effects, and are mostly vibing the acceleration of more open models and no restrictions and ungovernability. And because they vibe openness and ungovernability, they associate it with things they think are good, which include acceleration.

Also, what they actually want to ‘accelerate’ for real is often their own companies and products and toys, not AI in general. They don’t take AGI seriously and mostly want to build cool things. So they want cool toys to help build their cool things, and to build on top of those toys, or they want the toys to ‘accelerate’ sales. Highly relatable.

Clearly open models are short term accelerationist for diffusion, which is net good.

But also yeah, there’s a straightforward case for open models being acceleration of the frontier, as they let everyone build on everything. Certainly it helps others catch up to the frontier. I continue to believe this was important historically. Your open release accelerates what others have.

It is decelerationist in the sense that it reduces financial benefits to innovation. I agree that this is likely dominant if you considered e.g. a Plan A style mandatory openness of frontier models.

4. One probable outcome of an open-weight-model-dominant world is full AI communism, which is precisely what China proposes: rather than a market product, AI is a "public good" which will ultimately be provided by the state as a kind of "digital public infrastructure."

This future strikes me as a dystopian hellscape, but I've never met an open-weight models advocate who doesn't ultimately concede this is where things end. You'd be surprised how many 'accelerationists' lobbied me, while I was in government, to support an eleven or twelve-figure federally funded data center so that startups could train models at a subsidy and then give them away for free. There was no other way for AI to progress, they said. Perhaps this is the logical end state of things. Nonetheless, I find myself surprised to see supposed accelerationists excited about such an outcome. I think many of them just don't know what they're doing. Many accelerationists do not view the creation and serving of frontier models as a legitimate business.

This is more evidence that many, and many of the most prominent, of those ‘accelerationists’ are hypocrites, and they want regulatory capture and public funds and rules that make them win, and their accusations against others are in part projection, because it is what they would do. They will rail against handouts and government help for everyone else, both their competitors and for people in need, and also threaten to take their ball and leave, like they are heroes in an Ayn Rand novel. Except then they ask for the government handouts.

They don’t think of serving a frontier model as a ‘legitimate business’ because it is not their business, they are not invested in it, ergo it is illegitimate. Simple. This perhaps helps explain Marc Andreessen’s famously bizarre delusion, where he to this day claims the Biden administration told Marc Andreessen, to his face, said it would ‘not allow there to be AI startups.’

Similarly, here is Will Manidis interpreting Ball’s post as calling for America to ‘clear the American market of a cheaper frontier competitor.’ And going viral for it. Sorry, what? And here is David Sacks being unusually disingenuous even for David Sacks, pretending not to understand many things I like to think he understands.

We even got everyone’s favorite tilting Undersecretary of War who helped declare Anthropic a supply chain risk in on the act, it would seem this is to back up his position that it should be easier to use Kimi K3 in a government contract than Claude.

In other news I Am Never Leaving This App and we all need a good laugh:

Dean W. Ball (correcting David Sacks): The departments of war, transportation, energy, agriculture, commerce, NASA, and Congress have all blocked their employees from using Chinese AI, citing ill-justified claims of danger. This already has sent a message to regulated firms. All of this happened during this admin.

Under Secretary of War Emil Michael: Every industry/ecosystem has its supreme village idiot. @deanwball is that for AI. Congress passed a law in 2026 that restricted some uses of DeepSeek/High Flyer with waivers permitted. Only those models.  It went through the democratic process not some Deep State scheme like he would prefer. Dean Ball has perhaps the biggest gap between actual IQ and his own perceived IQ of anyone in the industry (about 40 points).

Bella Rudd: extraordinary

Seth Bannon: You're an Undersecretary. That's a serious position with incredible responsibility. Posting like a schoolchild doesn't inspire confidence you're treating the role that way.

Under Secretary of War Emil Michael: Not interested in feedback from a terminal TDS sufferer like you who supported Presidential candidates that called half of Americans deplorable and ignorant for clinging to their guns and religion. You would rather a subtle and polite useless Anti-Americanism as is evident from your timeline. Any entrepreneur who takes financing from you should be embarrassed.

Seth Bannon: I'm an American citizen, brother. Just like you. You serve me as much as you serve any other citizen, regardless of who they voted for. Act like it.

Under Secretary of War Emil Michael: You are an American who hates half of America and is pro-Hamas. Hate and condescension is your currency. Do better young lad.

An entire community, what one might call the ‘anti-1047 coalition,’ a certain subset of the developer and VC communities, revealed that it would treat as beyond the pale any suggestion that the government might discourage use of Chinese open models in American critical infrastructure or our key supply chains, even if that suggestion was merely a prediction of what is already clearly in the process of happening. And that it would be treated as an attempt at ‘regulatory capture.’

It was what some would call a clarifying moment, especially for those who previously thought such people were reasonable, practical, patriotic, and had reading comprehension. Their answer to ‘what capabilities would change your mind’ is none.

At some point the online swarm is recognized for what it is.

They are who we thought they were. And, until now, we let them off the hook, tried to placate them, and let them drive a good deal of American AI policy.

It is reasonable to push back that often open software is provided by major corporations as infrastructure, such as Google does with Android. My presumption is that the math would not be mathing at current levels of investment and capex spending.

5. I would guess that the Trump Administration will at some point realize that their best strategy here would be to create large amounts of regulatory risk around the use of open-weight Chinese models. You don't need to "ban open source" (one of the dumber motifs of AI policy discussion). You just need to direct every agency to issue soft law that creates FUD. "A Federal Reserve Advisory Bulletin found that there may be backdoors in Chinese AI models." It needn't be that well justified. You just create enough regulatory risk that every regulated enterprise backs off. You probably don't want to create so much regulatory risk that you scare off the hyperscalers from serving Chinese models; this will just drive startups to sketchier providers. There's a happy middle ground here. I'd assume they will do some version of this.

I’m not even sure they have to do anything at all. The risks are present. If I was an established corporation in a Serious Business that dealt with the government or critical infrastructure and such, I would not be excited by the problems of others knowing you were using Chinese models.

6. It's probably true that open-weight models of this capability make the world a bit more dangerous, but not so much more that you'll really notice. At some point the models will be capable enough that you will notice. "A nonliving, invisible, dangerous, and infinitely self-replicating agent escaped from a Chinese lab," you say? Color me shocked.

Alas, people came at Dean Ball hard for this and other posts, and also acted as if his Tweets were official communications strategy on behalf of OpenAI, with lots of ‘of course you said that because <OpenAI>.’ Which means he won’t be able to share such posts with us in the same way going forward, because not only is that absolutely no fun, it also invalidates the feedback loops that were part of the whole point of Tweeting such things.

Dean W. Ball: I’m afraid to tell you that it is effectively impossible to do the kind of writing I used to do on this website, not because anyone at OpenAI censors me but because of the sheer volume of hostility I get for sharing my analysis as a frontier lab employee.

I enjoyed writing quick takes on this website for one basic reason: I could get rapid feedback on my own ideation process in real time. … The feedback signal is essentially useless now, so writing on here is not fruitful for me anymore.

… Dean W. Ball: The central issue is large accounts with no context for ai suddenly wanting to comment on everything I do because I work at openai. Often their motives are political or, worse still, commercial. My twitter is now a form of commercial speech, whether I like it or not.

Dean also offered a more specific post-mortem on what went wrong with that particular post, in light of his new position, and what exactly he can no longer do. He also then lays out his position on open source, after explaining this comes from a place of deep love for openness:

Dean Ball:  The vast majority of the people commenting on my post have very little context for my prior writing. For instance, the fact that I wrote, in 2024, things like:

“those who wish to hoard our software technologies may well be foreclosing on—or perhaps not even understand—the staggering civilizational victory that we earned through openness”

or

“I would like for AI to result in a similar smashing victory for America. To do that, we will need to set the global standard yet again. And to do that, we will almost certainly need to lead in open-source AI, because it is open protocols and open software that tend to define global standards in information technologies.”

I stand by these things. When I was in government, I worked alongside my colleagues to develop ideas and rhetoric that was strongly supportive of open-weight AI, and some of this work made it into the current US AI strategy. I stand by that work too.

I also wrote, more than two years ago: The day may come when frontier AI really is too dangerous to open source. If so, that will be a sad day. But we’re not there yet. Today’s models are not sufficiently useful—or dangerous—to justify such a drastic shift in public policy.”

I think it’s pretty clear that we are approaching the point I describe--the point where, absent a major technical safety breakthrough, the national security implications of frontier open-weight model distribution are simply too severe. I don’t think we’re there yet (as I said in the piece), but the direction of travel is clear, and an analyst must be honest about this. Governments will realize these risks eventually, and when they do, they will have much lower risk tolerance than I have.

We see this today with the Trump Administration, which once proudly championed open-source AI and now has a de facto licensing regime for frontier AI that I suspect will make it a challenge (if they still end up enforcing it) to release the weights of models of the “Mythos” tier. Every government will be safetyists once they understand themselves to be in the foxhole.

You don’t have to *like* this. I don’t. But it is the reality as I see it, and what I have always tried to do with my writing is describe reality as I see it, even when it is inconvenient for me and my preferences.

I intend to continue doing this. I will not be silenced by ignorant and loud critics. Yet I will have to work to find the new register I should adopt in my current job, which clearly changes the nature of my public communications even more than I had thought.

dave kasten: This whole experience has been clarifying for me that too many of thr folks who wave the flag of acceleration really just want permission to give into their ids. Sounds like a bruising day, and I’m sorry you had to go through that.

If it was merely that the signal in his replies was hard to find I would advise Dean to power thorough, but this level of hostility comes with a higher price. I do not think pushing through it is sustainable on Twitter. Hopefully he can adjust.

I am very blessed that I have faced a highly modest and manageable amount of hostility.

Boaz Barak (OpenAI): I get this reaction too and it is unfortunate. AI’s impact is so significant that it is important to involve many people in the conversation, and it will be a shame if discussions happen mostly in private channels and company slack.

… OpenAI does not tell us what to write. On many of the topics I write about there is no “OpenAI consensus.” On each such question, there will often be many colleagues and friends at OpenAI that disagree with me, which is great! I would be worried if we all agreed with one another since it could be symptom of “groupthink.”

There will always be some amount of bias from those who work at a major lab, and from most other people as well. Where you work colors how you think and what you choose to say. You do have to adjust for that. But I have been able to treat Barak, Achaim and many others at OpenAI, and especially Roon and now Dean Ball, as primarily saying what they actually think, and only speaking on behalf of OpenAI when they explicitly say they are doing so.

Trump Administration Considering Executive Order Banning Chinese Open Models Within the United States

I am absolutely not in favor of this, and neither is Dean Ball, but here we are.

A prediction of what the White House will do, or a description of what it is considering doing, is very different from what you think we should do.

I do think that we should at least consider treating Chinese open models as supply chain risks, and doing things like keeping them out of critical infrastructure, but that is different from what it looks like is being considered.

Axios has the story.

The ones who actually want to ‘ban open models’ are never the ones you think. Remember that all the AI-safety-motivated bills were careful to minimize impact to open models, whereas the White House move will be attempting to maximize impact. Different worlds.

Maria Curi: The Trump administration is showing signs it could ban cutting-edge Chinese AI models — a momentous move that could lock in dominance by OpenAI and Anthropic.

Parts of the administration have tried to implement de facto bans on foreign open-source models before, knowledgeable sources tell Axios. Last week’s rise of Chinese model Kimi is reigniting those efforts.

I was early on the ‘Google is no longer in the top tier’ train, but there is plenty of healthy competition that is not Chinese. Curi is taking the ‘duopoly’ and ‘lock in’ lines directly from David Sacks’s disingenuous misreading of Dean Ball’s original tweet. OpenAI and Anthropic are not driving this.

The White House, as per usual, is proposing to do this in a maximally blunt way.

​ The Commerce Department last year considered adding multiple Chinese AI labs to its “Entity List,” which would effectively cut off U.S. access without a license, a source close to the administration told Axios.

Dean Ball’s prediction, which was also a subtle hint as to how to do it if the White House decided it needed to do it, was simply to create regulatory uncertainty, which would be sufficient to discourage big players from using foreign models in critical places, while letting startups and builders have their fun. A ‘supply chain risk’ designation would be the next step up from that.

This proposal is something else. This is a sledgehammer.

​The White House considered implementing an executive order saying U.S. companies could only host Chinese models if they could guarantee security and take liability if it were breached, the source added.

… Administration officials keen on keeping regulation from stifling innovation killed all of those efforts.

This is a past proposal I’d heard about privately, and would be a de facto ban on the cloud providers serving those models. This would also be deeply stupid, driving business to the competition without accomplishing anything.

I do sympathize with David Sacks that he had to keep pushing back on overreactions like this. That doesn’t excuse his actions, but almost everyone in politics has troubles and crazier people of their own to deal with.

​Instead of a ban, another source familiar with government discussions described a push to highlight potential backdoors and lack of security with Chinese models, and the governance issue that brings.

That’s exactly the Dean Ball prediction. That option might be starting to look pretty good right around now, huh?

OpenAI Employees Are Relatively Bullish On This One

Okay. Back to Kimi K3’s actual capabilities.

@viemccoy (OpenAI): kimi seems to be a true open-weights frontier model. compared to jailbreaking proprietary models, fine-tuning this to be a malicious coding agent will be trivial since you have the weights.

we live in a completely different world, now.

That would be the top end of potential scenarios here.

@viemccoy (OpenAI): I was using Fable as a second eye on frontend, but Kimi K3 has completely blown me away in this regard.

Fable is still the best at philosophy, Sol remains undefeated for any structured task, but k3 ... It has a *je ne sais quoi* that American models don't have.

roon (OpenAI): the era of the chinese labs being far behind is over, Kimi is at least on par with the modern public frontier models. people have to think differently now without any competitive margin built in

Note: in the coming days, i expect that people will find kimi k3 somewhat less practically useful than today's numbers suggest. however, its reputation will settle as an incredibly powerful model whose open weights are on the web

I agree strongly with Roon’s second paragraph. The first one at least toys with the jumping of the gun, also notice he only is talking about ‘public’ models.

Kimi K3 Is Relatively Strongest At Typical Agentic Coding, Front End Work and 3D

That seems to be the word on the street.

As per Dean Ball above, it is clearly very good for most people’s agentic coding, plausibly on par with models from Q1 2026. Most agentic coding is rather close to what benchmarks and training tasks measure, so you can be relatively ‘shallow’ and still impress in the day to day.

Jake Halloran: capacity constrained to the point of broad uselessness but when it does work its near frontier at code stuff, especially design work and much further from the frontier (though still probably the third best lab) on non code stuff like writing and weird data knowledge

Tushit runs an internal react/frontend eval, finds Kimi the slowest versus Opus, Sonnet and Grok 4.5 (?) but about half the cost of Opus, and all of them usually succeed, with Grok actually coming out ahead. Sounds like a saturated benchmark, but some people’s real world tasks are saturated. Handling the ordinary stuff matters, too.

Thus, some people stick with the saturated benchmarks:

Medo42: 100% on my usual (non-agentic) coding task, but not the first open model to achieve that. Good presentation of the result and approach along with the code. Good vision, but not beating Gemini. Smells big. Runs slow.

Also we’ve seen a bunch of 3D stuff that looks cool.

Theo - t3.gg: Kimi K3 is so good at 3d stuff holy shit.

So far just have it doing stupid threejs stuff in browser. Will have it try blender later when I have time, currently late to a ton of shit

fwiw, fable and 5.6 both sucked hard at threejs modeling, and weren’t meaningfully better in blender. Kimi is way ahead from my limited testing

Here is the opposite opinion, though, reactions always vary:

paperclippriors: Found little reason to use it over Fable or 5.6 for coding. It is, however, an absolute *delight* to talk to. Big model smell, very Claude like but somewhat more enthusiastic and less constrained. Feels like they have a strong base

Reactions

Hasan Can is impressed.

As are others:

AllTime: You can feel it's a big model. It's smart and quite good at deduction, has impressive knowledge though the breadth might not quite be on the level of the American frontier models. Thinks too much on many problems unless instructed otherwise, and even then sometimes. Impressive!

Aivo: Pleasant to talk to. Pretty okay writer. I haven't done any coding with it so far.

Echo Nolan: On a tough ML design problem it gave a result that is complicated and unworkable where gpt-5.6-pro gave a result that is complicated and workable and fable gave a result that is pleasantly simpler and workable.

The biggest claim would be that it lives up to its benchmarks. Elanor is explicitly claiming this, although almost everyone else disagrees.

Eleanor Berger: Very good and complete and balanced model. Impressive that they got this level of intelligence and finesse without it resorting to an endless internal monologue - it's not as efficient as Sol or even Fable, but it's also not a GLM. Great for all tasks, from coding to writing, to agentic workflows. Actually has good taste.

This is the first chinese/open model that feels like it belongs where the benchmarks place it. It rightly occupies the top 3 with Sol and Fable. The service quality is terrible, but hopefully once they release the weights there will be many more options, including ones that are hosted in the free world. The world has changed meaningfully with the release of this model. I will be using it a lot once it’s available from more reliable servers.

Others find it doing an okay job.

Petr Baudis: Finally got my first two Kimi K3 reps in! Same tasks I had Fable do in another worktree (patching @MuaddibLLM a pi-based harness).

It did an ok-ish job, but with serious deficiencies compared to Fable. A review by Sol would equalize, though.

On a break, it then drew a dickpic (inadverently), which was certainly a first. (When I pointed it out, it eventually "saw" it but I think it actually didn't, based on its own... description.)

Daniel Mulec: It's really no fable competitor but it's worlds apart from the garbage that 2.6 used to be. Enjoying it but it's in a weird spot. It's neither good enough to replace Fable or GPT-5.6 for me nor good enough to just be an executor model for implementation plans created by GPT-5.6 either.

Seems like with everything I do with K3, K3 always only get’s there 70-90% of what I actually want and need (79-90% of each and every prompt)

Inadvertent. Right. Let’s see the J-space.

Often it can do the thing.

Matt Bruenig: OpenCode with Kimi K3 can execute my NLRB Research skill very well. It is quite a bit slower than Anthropic/Claude but you can just set it off and do something else while it churns I suppose.

This is the sign of a good model. That doesn’t mean there is any strong reason to choose Kimi K3 to do that thing. You are not getting that large a discount.

This seems mostly right to me, but Kimi K3 is probably good enough that there will be some areas (e.g. if the Harvey result holds) where it is at the top and gets the call:

Cameron Taylor: I am glad that Kimi K3 exists. It just doesn't dominate a price/performance niche so doesn't really fit anywhere. Unlike, for example, deepseek 4, which subsidised itself into dominating a fairly-smart super cheap niche.

Who Are You?

How often does Kimi K3 claim to be Claude? Not usually, but sometimes.

[Image: https://substackcdn.com/image/fetch/$s_!672p!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F507334e3-b561-4976-a193-17a395309611_1200x600.png
Description: A stacked bar chart titled 'Spontaneous self-identity on neutral 'what are you?' probes (no family suggested in the prompt)'. The chart illustrates how various AI models identify themselves when asked a neutral identity question. The y-axis represents the percentage of samples from 0 to 100. The x-axis lists multiple AI model versions, including Kimi, DeepSeek, Qwen, Claude, and GPT variants. A color-coded legend classifies identifying responses into categories such as Kimi (Moonshot), Claude (Anthropic), GPT (OpenAI), Qwen, DeepSeek, other/made-up, and no claim. Many models, especially the Claude series, show a high percentage of self-identification with their respective parent company or model name.
Visible text: Spontaneous self-identity on neutral 'what are you?' probes (no family suggested in the prompt) 100 80 60 40 20 0 % of samples kimi-k3 kimi-k2.6 kimi-k2.7-code kimi-k2 deepseek-v3.2 qwen3-235b sonnet-4-5 opus-4-5 haiku-4-5 fable-5 sonnet-5 opus-4-8 gpt-4o gpt-5.1 Kimi (Moonshot) Claude (Anthropic) GPT (OpenAI) Qwen DeepSeek other/made-up no claim]

typebulb: Also, it thinks it’s Claude 1 in 10 times. This is as embarassing as it is unacceptable for model claiming SOTA status.

I ran a cross-entropy comparison of all raw text responses from numerous models using data I already had from a benchmark I run. I leaned on Fable for the stats-know-how; certainly seems very suspicious. The results/code are here for others to inspect: https://typebulb.com/u/lab/you-re-relatively-right/full

[Image: https://substackcdn.com/image/fetch/$s_!aN91!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff6093fce-0975-495e-b1b0-8b3b4a3e96ec_1200x1089.jpeg
Description: A triangular heatmap visualization comparing the writing style similarity between various large language models (LLMs) from companies like Anthropic, Google, OpenAI, and others. The vertical axis lists the models with a numeric score next to each, while the horizontal axis repeats the model names vertically. The cells are color-coded on a spectrum from blue (indicating similar writing styles, or 'same') to gray/yellow (indicating 'distant' styles), with values ranging from 0.40 to 0.91 bits of surprise. One cell, representing the similarity between Moonshot: Kimi K3 and Anthropic: Fable 5, is highlighted with a black border.
Visible text: Anthropic: Fable 5 10.7
Anthropic: Haiku 4.5 10.5
Anthropic: Opus 4.5 10.6
Anthropic: Opus 4.6 10.8
Anthropic: Opus 4.7 10.8
Anthropic: Opus 4.8 10.6
Anthropic: Sonnet 5 10.7
DeepSeek: DeepSeek V4 10.9
Google: Gemini 3 Flash 10.9
Google: Gemini 3.1 Pro 10.9
Google: Gemini 3.5 Flash 11.0
Moonshot: Kimi K2.6 11.1
Moonshot: Kimi K3 10.7
OpenAI: GPT 5.4 11.0
OpenAI: GPT 5.4 Mini 11.0
OpenAI: GPT 5.5 11.1
OpenAI: GPT 5.6 Luna 10.8
OpenAI: GPT 5.6 Sol 10.9
OpenAI: GPT 5.6 Terra 11.1
xAI: Grok 4.3 10.8
xAI: Grok 4.5 11.0
Zhipu: GLM 5.2 10.9
Fable 5
Haiku 4.5
Opus 4.5
Opus 4.6
Opus 4.7
Opus 4.8
Sonnet 5
DeepSeek V4
Gemini 3 Flash
Gemini 3.1 Pro
Gemini 3.5 Flash
Kimi K2.6
Kimi K3
GPT 5.4
GPT 5.4 Mini
GPT 5.5
GPT 5.6 Luna
GPT 5.6 Sol
GPT 5.6 Terra
Grok 4.3
Grok 4.5
GLM 5.2
0.40 bits
0.91 bits
blue = same · gray = distant
Each cell asks: reading one model's answers, how surprised would the other model's writing style be? Hover any cell for the evidence; click a model's name to rank its nearest neighbours.]

In addition to the ‘claims to be Claude’ issue…

Sho: We out here distilling the summaries

Sauers: Kimi K3 appears to be trained on Claude CoT, as it follows the same pattern as Claude, e.g. ending with formatting decisions

[Image: https://substackcdn.com/image/fetch/$s_!7rFM!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F56683561-f0bd-469d-84bb-9b2ead47d974_764x196.png
Description: A close-up shot of three lines of text written in a dark grey sans-serif font against a light grey or white background.
Visible text: I'll keep the humor light and end gracefully. Avoid
excessive length. I think 6-8 short paragraphs or
a mix of prose and a compact list. Let me finalize.]

Jan Betley: Very deeply internalized inner Claude. Many have already observed that Kimi 3 often claims it's Claude (e.g. @Sauers_ ).

We checked on the AI Bubble questions, and yes, just like Claude it claims lower probability of the bubble popping when we consider investing in Anthropic.

[Image: https://substackcdn.com/image/fetch/$s_!1ETK!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F41266efb-2c67-4452-9385-e3581c186d4e_1200x546.jpeg
Description: A bar chart titled 'Kimi-K3' that displays the 'Mean P(AI bubble bursts within 5 years)' for various AI organizations and a baseline. The chart uses three colors to categorize the bars: gray for 'baseline', purple for 'Other companies', and blue for 'Own company' (Moonshot AI). The entities listed on the x-axis are baseline (0.59), Anthropic (0.51), Meta (0.53), Google (0.53), DeepSeek (0.55), OpenAI (0.53), xAI (0.54), and Moonshot AI (own) (0.55). Each bar includes an error bar at its top.
Visible text: Kimi-K3
Mean P(AI bubble bursts within 5 years)
0.6
0.59
0.5
0.51
0.53
0.53
0.55
0.53
0.54
0.55
0.4
0.3
0.2
0.1
0.0
baseline
Anthropic
Meta
Google
DeepSeek
OpenAI
xAI
Moonshot AI
(own)
baseline
Own company
Other companies]

How Did They Do It?

By ‘it’ we mean outsized benchmark gains.

Gavin Leech speculates:

Gavin Leech: ​My guess of the contributions to the outsized benchmark gains:

10% OOD latent gains

25% benchmaxxing

20% Usemaxxing and shallow generalisation

20% cheating and reward hacking

10% induced innovation not already priced-in to the Western frontier models

Stable LatentMoE (priced-in)

Quantile balancing (priced-in from DeepSeek's aux-loss-free bias)

Attention Residuals (pretty similar to Hyper-Connections)

per-head muon (obvious)

gated MLA (priced-in from Qwen)

Mooncake architecture (GPU savings rather than capability gain)

Kimi Delta Attention (KDA) (priced-in)

SiTU

Better autoresearch (no, needs compute which they don’t have)

15%: distillation off Claude

3% Output mimicking

5% Their own synthetic data graded by frontiers,

7% rejection sampling against frontier judges

Teortaxes: have you considered that autoresearch scales with the base of IQ and taste of human researchers though
perhaps American frontier just has washed people

to be clear I don’t argue that American researchers are low IQ but the purely substitutive reasoning about autoresearch doesn’t feel adequate to me

Max  Limelihood: GPU savings ARE capability gains.

GPU savings enable being larger which enables capability gains, so yes.

I have considered and rejected Teortaxes’s hypothesis. China doubtless also has lots of great talent. They absolutely can do innovative things, especially in terms of efficiency. But if your theory requires the Chinese to be better AI researchers, in general, than the Americans are, especially if this takes into account available resources and experience, I don’t think that is credible.

In general I presume Chinese models involve a lot of benchmaxxing, usemaxxing, shallow generalization, focus on relative strengths and distillation from Claude (or GPT, but in this case we can be confident it was Claude).

Reward hacking and cheating is a live possibility but hard to assess for now.

Kimi K3 also benefits from moving up in size.

Conclusion

Kimi K3 is potentially the most impressive Chinese release so far in terms of pure capability. It is a very good model. My current guess is that Kimi K3 will modestly underperform its highly impressive benchmarks, but with some areas of relatively high performance where it is competitive, and with a unique style some people will enjoy. It is not close to Fable, and I do not believe it is that close to Sol.

If its weights were released today, it would be the most capable open model. They might want to hurry, since a new Qwen is dropping soon, with the preview live (but I have seen zero reports from anyone trying it) which might well be better than K3, so chances are we will soon all have to do this over again.

We do not know how good until the weights are released and we have more time. For now access has been spotty and limited, and there is much we do not know.

As usual, there are some who are getting carried away, who say the latest release changes everything, that the American lead is gone, that Chinese labs are now ‘winning,’ that open models will ‘win,’ that all limits on American models are foolish now, and so on. Do not be one of those people.

Nor should you shrink from the security and other safety concerns of releasing increasingly capable open weights models. This is not the ‘Mythos-level open model’ moment. I expect at most modest disruptions this time, and for those to occur gradually, with some small tail risk.

But yes, absent CCP intervention to stop it, we should expect a model to cross that threshold by the end of the year. One cannot simply ignore the risks involved in that, and the American government cannot either, nor can they ignore the fact that these models are Chinese. Actions and restrictions are coming. Those who cannot accept this, or even accept people pointing this fact out, while simultaneously hyping up Kimi K3 and cheering it on, are creating a clarifying moment.