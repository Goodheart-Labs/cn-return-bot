# AI 2040: Plan A

**Path:** `/supplements/deal-decline`

Deal Decline
Eli Lifland
Introduction

A consideration pushing toward scaling faster in Plan A is deal decline: the possibility of the deal either dissolving or becoming substantially less effective (which we call deal impairment).

In this supplement, I’ll estimate the likelihood and badness of deal decline. I’m confident that deal decline is at least 10% likely to occur within Plan A’s first 10 years, and that a 2035 decline leads to the expected value of the future being at least 5% lower than if there were a 2035 handoff within the deal. Since deal decline seems worryingly likely, and scaling capabilities within the Plan A deal seems much safer than an AI race once it’s declined, I’m confident that deal decline is a substantial consideration, likely the biggest one, in favor of scaling up AI capabilities faster and handing off to AIs earlier (rather than something like a very long pause). But I’m not precisely confident in any of the numbers estimated below; I could easily update substantially toward being more or less worried about deal decline.

Despite a substantial chance of decline, I think Plan A remains much more valuable than the other plans. Even if deal decline happens within a few years of the deal, the outcome will probably still be substantially better than no deal. And I think it’s plausible that a long-lasting effective deal can be achieved, via mechanisms such as automated lie detection and robust institutional design.

Overview

After categorizing types of deal decline, my analysis consists of:

Causes of deal decline: I split causes into (a) deliberate deprioritization of effective deal maintenance due to leadership change, (b) deliberate deprioritization due to a change in existing leadership’s priorities , and (c) destabilizing events.

Likelihood of deal decline: Informed by base rates from other international agreements and a decomposition into possible causes, I estimate the chance of deal decline per year at ~12% in the first 2 years of the deal, ~7% in years 2-5, and ~4% in years 5-10. The risk is roughly equally split across dissolution and impairment. This implies a 37% chance of decline within 5 years and 48% within 10. During the deal and to some extent leading up to it, society will have much more information than I have today about how robust the deal is, as such their probabilities may be quite different.

Badness of deal decline: I compare the situation after deal decline to the situation before there was any deal at all. The most important ways the situation is better post-deal-decline (relative to the situation without a deal) come from having used AIs to do lots of useful stuff (e.g. safety research) and from additional calendar time yielding more societal awareness and preparation. On the other hand, if Plan A’s compute destruction mechanisms fail, there will be much more compute in the world post-deal-decline, leading to a faster and more dangerous takeoff. Overall, it seems that a post-deal-decline situation would be substantially better than if there were no deal at all, while being significantly worse than doing handoff within the deal. When the deal decline happens matters a lot; the later, the better.

Preparing for deal decline: We recommend investing lots of resources into preventing deal decline, as well as mitigating it. Our main recommendation for mitigating deal decline is to ensure that nearly all of the compute in the world is destroyed in the case that the deal dissolves. Without this destruction, takeoff might be extremely fast due to an overhang of compute that wasn't being used for developing more generally capable AIs.

Types of deal decline

The following are the types of deal decline:

Deal dissolution. The deal is officially dissolved.

Deal impairment. The deal becomes substantially less effective than if it were implemented well and adhered to, but isn’t dissolved. For simplicity, this is modeled as a binary in this supplement; in practice, it would likely be gradual. Ways the deal could be impaired:

Deal non-enforcement. The deal is not enforced as strongly as before, e.g. a country blatantly not complying is not punished. This leads to increased violations of the letter of the deal.

Deal misexecution. The letter of the deal is followed but is executed poorly.

Deal revision. The deal is explicitly edited to be worse. This could be straightforward weakening, but it could also be making it worse in other ways, such as unnecessarily increasing surveillance.

The deal could also end via a covert project reaching takeover-capable AIs or via an existential catastrophe (e.g., via AI takeover, AI-enabled bioweapons, or AI-developed superweapons). These end conditions are out of scope for this supplement and aren’t considered to be deal decline in our terminology. They are included separately in our analysis of the Plan A capability scaling strategy.

Causes of deal decline

One path for deal decline to happen is via deliberate deprioritization of maintaining an effective deal. The path for this is:

At least one of the US or China leadership decides to deprioritize the deal, which could happen for a variety of reasons, some of which are listed below.

If this only happens inside of one of the countries, then the other country must either try to use their leverage to prevent deal decline and fail, or let the deal decline happen (e.g. because they are scared of escalation). Other countries will also have some leverage at pressuring countries in ways that prevent deal decline.

We can split out ways that (1), i.e. US or Chinese leadership’s priorities changing, might happen into either (a) change of leadership (e.g. a US election) or (b) a change in existing leadership’s priorities.

Why might existing leadership’s priorities change? The most likely reasons we can think of are:

Concern regarding how future domestic leaders would handle things.

Wanting to gain power by developing superintelligence before a leadership transition.

Becoming more optimistic about winning the AI race in a world in which the deal has declined.

Becoming less concerned about risks from superhuman AIs such as AI takeover or extreme concentration of power.

Wanting to illegitimately grab power and thinking the deal impedes this.

Becoming less optimistic about the deal working, e.g., they think misuse risk is too high and difficult to mitigate within the deal. This could lead to a failed negotiation to revise the deal.

And then there’s an “Other” bucket of many reasons that we haven’t thought of.

Another possible reason the deal might decline is via a destabilizing event. The most likely we can think of are:

Geopolitical shock, e.g. war.

A country being caught cheating: a covert project getting caught, or another way of cheating such as trying to undermine the inference-only verification.

A sub-existential catastrophe.

Likelihood of deal decline
Overall view

Below I estimate the likelihood of deal decline in Plan A by year, focusing on the first 10 years (as that’s when handoff happens in the scenario). During the deal and to some extent leading up to it, society will have much more information than I have today about how robust the deal is, as such their probabilities may be quite different.

I use 2 methods:

Base rates plus adjustments: A Claude-done analysis, focused on the base rate of international deals declining, estimates the chance of deal decline per year at: ~15%/year in the first 2 years of the deal, ~12%/year in years 2-5, and ~11%/year in years 5-10. I adjust these downward because Plan A has especially strong verification and implementing it is evidence of high political will to maintain it. After adjustment, risk is roughly equally split across dissolution and impairment.

Decomposition into causes: Decomposing into possible causes of deal decline and then combining these estimates gives me ~10%/year deal decline in the first 5 years of the deal, and ~6%/year in years 5-10. This moves me up a little from the base rates plus adjustments method, but the results are overall fairly similar across methods.

My overall view is, aggregating the above 2 methods:

Phase (years)

	

p(dissolution)/yr

	

p(impairment)/yr

	

p(decline)/yr

	

p(decline) this time period

	

Cumulative p(decline)




0-2

	

6%

	

6%

	

11.6%

	

21.9%

	

21.9%




2-5

	

3.5%

	

3.5%

	

6.9%

	

19.2%

	

37%




5-10

	

2.0%

	

2.0%

	

4.0%

	

18.3%

	

48%

When doing modeling for the Capability Scaling Strategy and the Plan A portion of Comparing Possible Plans, I use the following hazard rates with linear interpolation in between. The CDF is very similar to the above table.

Years after deal start

	

Hazard (any decline)

	

Cumulative p(decline)




0

	

0.12

	

0%




3

	

0.08

	

25.9%




6

	

0.06

	

39.9%




8

	

0.04

	

45.7%




11

	

0.03

	

51.1%




16

	

0.02

	

56.8%

Deal decline risk reaches ~50% by 2040 handoff
0%
25%
50%
75%
100%
hazard — p(decline)/yr:
12%/yr
8%/yr
6%/yr
4%/yr
3%/yr
2%/yr
51.1% by 2040 (handoff)
56.8%
2029
2031
2033
2035
2037
2039
2041
2043
2045
Year
Cumulative p(deal decline)
Assumes the deal starts in 2029. Hazard interpolates linearly between my anchor estimates; risk is roughly equally split between dissolution and impairment.
cumulative = 1 − exp(−∫ hazard)
Base rates plus adjustments
Data collection methodology

We had Claude do analysis of base rates and adjustments, then manually reviewed and edited its outputs. A summary of the approach (read its full analysis below):

Claude collates a list of 31 past international agreements approximately similar to Plan A in scale and nature. For each agreement, it identifies time-to-first-impairment and time-to-dissolution, and also gives a qualitative ranking of how applicable the agreement was to Plan A.

Base hazard rates are computed for each phase (number of years since the deal started) via an average rate weighted by applicability scores, separately for dissolution vs impairment:

For impairment, this is computed as a weighted number of years before first impairment divided by the weighted number of impairment exposure.

For dissolution, this is the weighted sum of dissolved agreements divided by the weighted number of dissolution-exposure years.

Claude also identifies the reasons for impairment and dissolution. It finds that dissolution is roughly hump-shaped centered around 5-10 years, and impairment is front-loaded.

Claude finds that improved verification correlates with delayed impairment, and dissolution usually occurs as a result of political withdrawal, rather than inherent deal failure.

Base rate (plus adjustments) forecasts

Below are Claude’s collected base rates.

Method

	

Dissolution hazard/yr

	

Impairment hazard/yr




Weighted base rate (HEADLINE)

	

3.4%

	

7.9%




Unweighted (all treaties equal)

	

1.8%

	

4.8%

I’ll now discuss how the hazard rate changes over time. I’ll focus on the first 10 years as that’s how long the deal is in the scenario. A note on 10+ years: the impairment hazard holds at ~6%/yr in years 10–20 rather than continuing to decline, before falling to ~4%/yr past 20. Here are base rates by how long the deal has been in force:

Phase (years)

	

Dissolution hazard/yr

	

Impairment hazard/yr

	

Combined hazard/yr

	

Cumulative dissolution (by end of phase)

	

Cumulative impairment (by end of phase)

	

Cumulative combined (by end of phase)




0-2

	

0.0%

	

15.5%

	

15.5%

	

0.0%

	

28.6%

	

28.6%




2-5

	

3.4%

	

9.4%

	

12.5%

	

9.9%

	

46.9%

	

52.1%




5-10

	

5.8%

	

5.9%

	

11.4%

	

33.2%

	

60.9%

	

73.8%

I make adjustments to the base rate as follows:

Phase (years)

	

Base diss/yr

	

Base imp/yr

	

Adjusted diss/yr

	

Adjusted imp/yr

	

Adjusted combined/yr

	

Rationale




0-2

	

0.0%

	

15.5%

	

5.0%

	

5.0%

	

9.8%

	

Dissolution from 0 to 5%: 0% is to some extent an artifact of limited dataset size, plus it's easy to imagine ways Plan A could dissolve quickly (e.g. a covert project getting caught).

Impairment from 15 to 5%: Plan A has especially strong verification and requires a very high amount of political will to initiate, making it less likely it is very quickly impaired.




2-5

	

3.4%

	

9.4%

	

3%

	

3%

	

5.9%

	

Decaying impairment in a way that is roughly similar to the base rate, but slightly more aggressively due to AI-assisted verification/epistemics/etc.. For dissolution, decaying in a similar way (partly for simplicity, maybe it should be slightly different).




5-10

	

5.8%

	

5.9%

	

1.50%

	

1.50%

	

3.0%

	

Continuing to decay, slightly more aggressively than above.

There are 2 effects which lead me to estimate substantially lower deal decline risk as time goes on:

If the deal has gone on for longer, this provides evidence that it is less likely per unit time to decline.

As AI capabilities improve during the deal and there is time to put them to good use, they allow for building technology that helps stabilize the deal. For example, there might be automated lie detection or use of AI to improve epistemics or verification.

Surprisingly, the base rate data above has p(dissolution) increasing over time, while p(impairment) decreases in a fashion closer to what I expect for Plan A. Notably, the base rate data doesn’t include effect (2) above, or at least includes a much weaker version of it. So I expect the trend of decreasing deal decline risk to be more pronounced than it is in the data on previous agreements.

Decomposition into causes

An alternative method for estimating the chance of deal decline is to individually estimate the chance for each possible cause, then aggregate them together. This gives me an estimate of 10% p(decline)/year in the early 2030s and 6% in the late 2030s, leading to a cumulative p(decline) of ~50% by 2035 and ~60% by 2040. I think the methodology of listing a bunch of possible ways something could happen and then aggregating these probabilities tends to produce numbers on the high side, which I take into account when aggregating this methodology with the base rate plus adjustments method.

	

	

2029-2034, p(decline)/year

	

2035-2039, p(decline)/year




Deliberate deprioritization

	

US leadership change

	

0.02

	

0.01




China leadership change

	

0.01

	

0.01




Concern regarding future leaders

	

0.01

	

0.01




Optimism about winning post-deal-decline

	

0.01

	

0.005




Less concerned about AI safety

	

0.005

	

0.003




Other deliberate deprioritization

	

0.01

	

0.005




Destabilizing event

	

Geopolitical shock

	

0.01

	

0.005




Country caught cheating

	

0.015

	

0.015




Sub-x-risk catastrophe

	

0.01

	

0.005




Other destabilizing event

	

0.015

	

0.01




All sources

	

p(decline)/year from all sources

	

0.10

	

0.06




p(decline) this time period

	

0.49

	

0.27




Cumulative p(decline)

	

0.49

	

0.62

Unlike for most sources, the risk from a country being caught cheating might not go down in the late 2030s relative to the early 2030s, due to detection methods getting better.

Badness of deal decline
Overview

I compare the situation after deal decline to the situation before there was any deal at all. The most important advantages of post-deal-decline worlds over no-deal worlds are 1) having more time for capable AIs to do useful things like safety research and 2) having more time to build societal awareness and preparation.

On the other hand, there will be much more compute in the world post-deal-decline, by default leading to a faster and more dangerous takeoff. Because of this, Plan A is set up so that the compute is likely destroyed upon deal dissolution; more on this below.

I made some quantitative estimates of how bad deal decline would be. The headline results are:

Deal dissolution and impairment are similarly bad, perhaps impairment is a bit worse. While impairment has the benefit of there still being a deal, it has the downside of not triggering compute destruction.

Pre-max-controllable-AI, I propose modeling p(alignment | deal decline) as interpolating linearly in logit space between p(alignment; pre-deal unconditional) in 2029 and p(alignment | deal decline at max-controllable-AI target date). For a target date of 2035, perhaps p(alignment | deal decline at max-controllable-AI target date) is ~70%.

Post-max-controllable-AI, I propose modeling p(alignment | decline at time t) as roughly 90% of p(alignment | handoff within deal at time t).

High level situation

What would happen in Plan A if the deal declined and we hadn’t implemented any specific preparatory measures? Let’s start by considering the case of the deal fully dissolving.

There will be to some extent a return to the default world conditions, but with some important changes compared to if no deal had happened at all.

Positives:

Progress due to AI usage and studying AIs: Due to the alignment and control research that’s occurred since the start of the deal, the state of knowledge regarding safety techniques has improved. This is true to a greater extent the longer the Consortium has had to use and study more capable AIs. There are also other benefits of AI usage such as improving epistemics and verification tech.

More societal awareness and preparation: Aside from using AIs to make progress, the extra calendar time that the deal has bought helps in various ways by giving society more time to adapt. Furthermore, people, including policymakers, are more aware of current and projected AI capabilities than they were before. An important example of this is that there are likely lots more human AI safety researchers than there were at the start of the deal.

Training compute safety tax paid: The most capable models have been trained with more compute than would be needed to reach their level of capabilities, to allow use of safer methods. This is unlike what happens in a closely contested AI race. You may maintain the ability to use this model after dissolution. This positive is potentially minor because: (a) If AIs are not close to max-controllable-AI, we will have to retrain them in order to reach handoff-level capabilities, forfeiting our safety tax. (b) Even if AIs are close to max-controllable-AI, projects likely choose to not incur safety taxes on successor AIs and instead race to higher capabilities.

Negative: By default, more compute would lead to faster takeoff, but Plan A sets things up so that the compute is likely destroyed upon dissolution. By default, there is now more compute in the world than there was in 2029, which makes the default takeoff faster. In the Plan A scenario, compute stock increases by roughly 0.7 OOMs/year from 2030 to 2033 and 0.1-0.3 OOMs/year from 2034 to 2040. Naively applying a 5.5x speedup for a 10x increase in compute stock would imply that 3 OOMs would speed takeoff up by ~150x! There might be some compute destroyed though, for example due to a war or due to targeted sabotage of datacenters. There is also more industrial capacity in the world, which could allow the manufacturing of dangerous weapons, potentially after an industrial explosion. Because of this issue, Plan A is set up so that the compute is likely destroyed upon deal dissolution. This likely averts an extremely fast takeoff, though our best guess is that it still takes about 1-2 years to do the rest of takeoff; see below for discussion.

Unclear: Different geopolitical circumstances. Depending on how the deal dissolves, the geopolitical circumstances might be very different after dissolution than in the default world. For example, there might be a war going on, and if not, the deal dissolution might still make lower levels of coordination less feasible. On the other hand, great powers have signaled that they care a lot about AI safety by implementing the deal and depending on how dissolution happens this might carry through into better outcomes. It’s plausible that a new international deal could be struck not long after the deal dissolving.

For deal impairment, nearly all aspects of the world are at least somewhat better than in dissolution because the deal is still in effect. For example: not only is the training compute safety tax already paid, but the deal is still partly functional so you may be able to continue paying a tax. How much better things look than dissolution depends on the circumstances of the impairment.

The main downside is that the extra compute likely hasn’t been destroyed, as it’s harder to set up a system which destroys compute upon impairment as opposed to destroying it upon dissolution. While there’s a ton of compute in the world, the deal is likely still constraining takeoff to some extent. That is, you may not be able to use a large fraction of compute in the world to take off as fast as possible.

Quantitative estimates

I’ve made some rough quantitative estimates that attempt to take into account the above factors. See here for a sheet that contains estimates of the value of the future, conditional on deal dissolution at various times (among estimates of other deal end states). I think that deal impairment would on average be similarly bad to deal dissolution, with the pros and cons described at the end of the previous section roughly canceling out.

Overall, my view is roughly that we can interpolate value in logit space over the course of Stage 1 of the deal, i.e. pre-max-controllable-AI, between the default world and the end state in which the deal declines at max-controllable-AI. For Stage 2, max-controllable-AI and onward, perhaps the value of deal decline in a given year is roughly 75-80% of handing off within the deal in that year.

Preparing for deal decline

Given how big of a threat deal decline is, we recommend making it a top priority in Plan A to prevent and mitigate it. For example, I think at least 5% as much as the effort that goes into technical safety research in Plan A should go into preventing and preparing for deal decline (and potentially much more). These implications are discussed in the Capability Scaling Strategy supplement.

One way to reduce the risks of and mitigate the downsides of deal decline is to scale AI capabilities faster and handoff faster.

Preventing deal decline

Here are some avenues that we think are promising for preventing deal decline:

Automated highly-adversarially-robust lie detection: This would drastically reduce the chance of being surprised by an actor attempting to pull out of the deal.

Institutional design: The deal and Consortium should be designed in a way that best sets up incentives for the countries involved, and leads to reasonable regulatory decisions. Additionally, domestic institutions should be improved to be robust to the whims of a single person shifting; for example, ideally the deal should be ratified as an official treaty in the US.

United diplomatic pressure: All countries in the deal should make it clear that any country pulling out of the deal would be an unacceptable threat to all other countries’ national security and sovereignty, and will be treated as such. Any country that is considering pulling out of the deal should know that they will be heavily sanctioned, cyberattacked, and would potentially have to fight a war in which they are heavily outnumbered.

AI for epistemics: Generally improving societal epistemics seems important for creating a robust, effective deal. Example applications of AI that would be especially useful are forecasting failure modes of the deal and helping with the institutional design mentioned above.

Preparing stockpiles to align incentives

We recommend the following to improve the post-deal-dissolution situation and improve incentives around defection.

The US and China each get hardened stockpiles of 2% of their pre-deal compute. 2% is the factor used in the Plan A scenario, in practice it should depend on the amount of missing compute.

One potential incentive for the US and China to create a covert project is that they could pull out of the deal, destroy the centralized compute (e.g. with bombing, or with other mechanisms, e.g. by withholding offline licensing keys). Then, if one side did a covert project and the other did not, the side that had a covert project might get a large lead over the other, and beat them to an intelligence explosion.

One solution to this is to allow each side to have a cache of GPUs that are hardened but aren’t plugged into power, and so can’t be used for AI research while the deal is in place. In practice this stockpile could be stored in a secure facility on the home soil of each party, and is deliberately designed to not be destroyable by the other in the case of a deal dissolution, but where inspectors can still verify these chips aren’t in use for the duration of the deal.

This cache could be on the order of 2% of each side’s pre-deal compute. This is probably more compute than a covert project could have, but is a relatively small fraction of post-deal compute, because new chips dominate the overall chip supply.

Now, if the deal were to break down, and the verified datacenters were stopped, then both sides would return back to the counterfactual of racing with a proportional amount of compute as they had before the deal; this also favors the US given that the US has more compute pre-deal.

In the same stockpile the US and China each get a cold, heavily monitored copy of the frontier model weights.

Reasoning for doing this:

This reduces the incentive to exfiltrate the frontier weights and then immediately pull out of the deal to get a huge advantage. It also reduces the incentive to do a covert project.

The benefits of the training compute safety tax that was paid to create the frontier model weights doesn’t have to be re-paid. However, there are also downsides to preserving the weights; for example, it makes AI progress faster. It’s unclear that you would want to keep the weights in cold storage for only this reason.

A proposal to store the weights:

There’s a hard drive that needs US+China permission to unlock. That’s the only cold storage.

Other storage is volatile memory, so if you turn off power memory goes away

To stop physical exfiltration, you have a bunch of physical defenses that automatically turn off power

Mutually assured compute destruction: destroying compute, fabs, and robots

A central potential problem with Plan A is that if the deal dissolves, there is so much compute in the world that we might get an extremely fast intelligence explosion. For example, suppose the deal breaks down at the start of 2035; there are 100B H100e in the world at that time. That’s about 2.3 OOMs more compute than were in the world at the start of 2030 in the default world (~500M), and so a takeoff that would have taken 1 year, might instead happen 5^2.3=40x faster, or in 9 days. This would, of course, be an extremely dangerous situation. Therefore, if the Plan A deal breaks down, it becomes extremely important that a large fraction of the compute in the world be destroyed.

In this section, we’ll discuss our policies for ensuring mutually assured compute destruction; as well as making sure that the rebuilding process does not result in an unacceptably fast takeoff. The priority order for achieving this is:

Ensure that almost all of the compute is destroyed.

Ensure that almost all of the fabs are destroyed.

Ensure that almost all of the robot capacity is destroyed.

We’ll discuss each of the above in turn, and then analyze how long an intelligence explosion would take in the case of a deal dissolution.

Compute

This table gives point estimates for each type of compute in the Plan A scenario:

	

Amount of effective H100e

	




Type of compute

	

2030

	

2035

	

2040

	

What happens if the deal dissolves?




AI datacenter compute (world)

	

~500M

	

~100B

	

~1T

	

Self-destruct or are bombed




Verified consumer hardware and edge compute (world)

	

~0

	

100M

	

10B

	

Not useful for AI training because of verification or fundamental design.




Cap-and-traded consumer hardware and edge compute

(world)

	

25M

	

30M

	

30M

	

~10% can be diverted to an AI project, because the compute is spread across countries and also non-authoritarian countries probably wouldn’t round up this compute.




Stockpile (US/China/RoW)

	

n/a

	

5M/500k/700k

	

5M/500k/700k

	

~100% can be diverted to an AI project




Covert project (US&China)

	

1M

	

1M

	

1M

	

~100% can be diverted to an AI project




Exempt military compute (US&China, others lower)

	

10K

	

10K

	

10K

	

~100% can be diverted to an AI project

The policies for how to achieve this are as follows:

AI datacenters. Both the US and China build datacenters in deliberately vulnerable locations, thus incentivizing them to self-destruct if the deal breaks down. This is discussed more in the 2034 section of the scenario. Almost all compute is in this category (as shown above), and so it’s very important to ensure destroyability.

Consumer hardware and edge compute. This includes all compute used in phones, consumer laptops, etc. This compute is distributed throughout the world and could be diverted to an AI project after the deal dissolves. Therefore, we must either (i) verify so that it can’t be directed to training or (ii) cap the total amount of chips in this category. We recommend a cap and trade regime on unverified chips in this category of compute at 30M effective-H100e. We estimate the pre-deal stock to be around 25M effective-H100e, so normal production levels can continue in the short term but then for new AI-capable edge compute to be produced old hardware needs to be traded in / verifiably destroyed. If extremely robust on-chip verification can be developed to activate further chips, or methods of building chips that fundamentally cannot be repurposed to training then this can get an exception from the cap. One approach that could accomplish this is to bake a restrictive computational structure into chips during the manufacturing process (e.g. Etched).

Stockpile. See above.

Exempt military compute. We recommend minimizing AI relevant exempt military compute, or only exempting a tiny number of GPUs, such as 10,000 H100e.

Fabs

In Plan A, all of the AI-relevant fabs in the world are moved to destroyable special economic zones (SEZs) by 2032. These fabs are located either on the ocean or nearby adversarial superpowers with self-destruct mechanisms in them. Pre-deal fabs without these properties (e.g. TSMC Arizona) are decommissioned. Fortunately, decommissioning isn’t costly because it’s such a small fraction of the compute built in the 2030s.

Year

	

2030

	

2032

	

2034

	

2036

	

2038

	

2040




Flow (H100e)

	

363M

	

13.5B

	

43B

	

93B

	

233B

	

1T




Time to build 100M H100e

	

100 days

	

3 days

	

20 hours

	

9.4 hours

	

3.8hours

	

53 minutes

100M H100e is roughly the amount of compute needed to do an intelligence explosion (from Automated coder to TED-AI) in 1 year. By the end of the decade in Plan A, industrial capacity is so high that we’re producing that amount of compute every 53 minutes. Therefore, it’s extremely important for the fabs to be destroyed if the deal breaks down, particularly towards the end of the decade. Fortunately, the fabs are extremely fragile by nature, and the same mechanism as the AI datacenters above (putting them in locations where self-destruction is incentivized) can be used.

Robots

Robots can be used to build fabs, which can build GPUs, which can then be used to do an intelligence explosion. When there are enough robots, this process can happen extremely quickly.

Our basic strategy with robots mirrors that with GPUs and fabs. Almost all robot production and use will occur in designated SEZs:

	

Human-equivalent quantity

	




Type of Robot

	

2030

	

2035

	

2040

	

What happens if the deal dissolves?




SEZ

	

0

	

1B

	

70B

	

Self-destruct or bombed




Civilian

	

100K

	

10M

	

1B

	

Self-destruct or backdoored or not useful for building fabs




Exempt military robots

	

1K

	

100K

	

100K

	

Can be used to make AI progress

The policy for robots is:

High and growing cap for robots produced in destroyable SEZs, so almost all robots are produced there.

A mandate for civilian robots to have sufficient offline licensing + self destruct features so that they stop working if the deal breaks down, or robust edge verification such that they can’t be used to do any part of the work in rebuilding a compute supply chain (e.g., a self-driving car with baked weights).

Cap of 100K total exempt military robots for US and China, without offline licensing.

Post-dissolution takeoff length

A big question is whether or not a rapid intelligence explosion could occur on the stock of compute produced within the deal, or whether compute production is required.

There are two major sources of progress that can be pursued in parallel, but might have tradeoffs (e.g., if you use your compute to help run robots or tell humans what to do to produce new compute).

First source of progress: Produce new compute. The post-deal-decline AI project could attempt to use robots and/or humans to rebuild a semiconductor supply chain and increase their compute. The difficulty of doing so is probably further increased by potentially aggressive sabotage in a post-deal context against such efforts. That being said, around 100K exempt military robots, and maybe some small fraction of civilian robots e.g., 0.1%, or around 1M, can be stripped for useful parts post-self-destruct and/or have their security measures circumvented. Let's assume there’s a fleet of around 1M human-equivalent robots that can work on this. In 2026 the semiconductor supply chain has around 2M people working, and over the last 5 years they have built around 100M H100e/yr of total production capacity at 2026-technology levels (chip design and manufacturing process) So we have a rough 10M worker-years to 100M 2026-tech H100e/yr capacity mapping. Assuming the 2026-tech improves by around 1 OOM by 2032 and another OOM by 2036 (assuming total compute in the world improves roughly 50% due to technology improvements and 50% due to production scale), this implies the mapping will be 10M worker-years to 1B H100e/yr with 2032-tech and 10B with 2036-tech. So the 1M robots would take 1 year to build 100M H100e in 2032 and 1 month in 2036. We expect there to be serial bottlenecks that somewhat push these purely parallel estimates up, as well as potential startup problems and sabotage problems.

Second source of progress: Use existing compute for R&D. The post-deal-dissolution AI project has transparent algorithms from the deal, cold-storage weights, and any consumer hardware that they are able to repurpose. Assuming they are the US and they use their cold-storage GPUs or they can get ~10% of world consumer hardware, then they have ~25x less compute relative to the default leading project in Jan 2030 (~5M H100e in US stockpile vs. ~130M in 2030 by default); so -1.3 OOMs. This 25x compute disadvantage means that at the same capability level they should go ~10x slower all else equal (assuming 10x less compute means ~5.5x slower).

However, all else is not equal: at least if the dissolution happens before the 2040 handoff in the Plan A scenario, the post-dissolution project has less efficient software/algorithms than the default project when they were at the same capability level. This is because in Plan A we deliberately make progress via a much higher ratio of training compute to software than the default. Because the software is worse, training efficiency is lower. On the other hand, there’s more remaining promising software ideas out there, so a given amount of research effort goes further.

Meanwhile, the transparent algorithms from the deal can be split into ones that have been implemented, and ones that have been foregone to pay a training compute safety tax, which we recommend paying roughly 1 OOM of by TED-AI. The project would need to actually train some using these foregone algorithms, but they could probably quickly capture lots of the gains.

Putting everything together. If dissolution happens after pausing at TED-AI, let’s say in 2037: The TED-AI to ASI time under the default (no slowdown) Plan A trajectory is ~1.5 months. Naively applying the 10x slowdown due to lower training compute would give ~15 months. Taking into account the post-dissolution project having lower software results in a takeoff to ASI of ~2.75 years (and setting there to be no post-dissolution compute growth, which further slows things relative to the default trajectory). Enabling 1 OOM/year post-dissolution compute growth results in a takeoff of ~1 year.

Compute destruction slows post-dissolution takeoff from ~1 week to ~1 year
Within the deal (identical in both worlds)
Dissolution — compute destroyed
Dissolution — compute not destroyed
1x
10x
100x
1,000x
10,000x
Automated coder (3x)
Superhuman AI Researcher (20x)
Top-Expert-Dominating AI (400x)
ASI (1,000x)
Deal dissolves
ASI ~1 week after dissolution
ASI ~1 year
after dissolution
2029
2030
2031
2032
2033
2034
2035
2036
2037
2038
2039
Year
AI R&D uplift (vs. 2026)
Trajectories: compute destroyed, no compute destroyed. Compute destroyed parameters: leading company has ~7% of the pre-deal frontier (via hardened stockpiles), rebuilt at 1 OOM/yr. Note that uplift numbers don't take into account Plan A capability shaping, which reduces AI R&D uplift at a fixed capability level.

Now let’s consider dissolution happening in 2032, a bit below SAR. SAR to TED-AI takes ~0.3 years by default. Naively applying the 10x slowdown due to lower training compute would give a bit over 3 years. Accounting for lower software and let’s say 0.5 OOMs/year post-dissolution compute growth results in achieving TED-AI after about 2 years.

Acknowledgments

Thanks to Dillon Nguyen for fact-checking Claude’s base rate analysis and helping create figures. Thanks to Thomas Larsen and Romeo Dean drafting the sections on post-dissolution compute destruction.

Appendix: Claude’s analysis of base rates

Claude’s full base rate analysis is attached below for reasoning transparency. Dates and events were hand-verified. The text has been very mildly updated based on the issues found.

Claude’s Analysis

This tab holds the overall reasoning behind the outside-view, base-rate estimate of how likely the Plan A US–China slowdown deal is to dissolve or become impaired, year by year from its formation (~2029) through handoff (~2040). The treaty-by-treaty dataset and the per-treaty reasoning live in the "Base rates" tab of the companion Deal Decline spreadsheet; this tab explains the method, the reference-class choices, the central finding, and how I adjusted from raw base rates to a Plan-A-specific year-by-year hazard. Drafted by Claude (Opus 4.8), 2026-06-29. Historical dates and fates were web-verified, but the synthesis into year-by-year numbers is a first-pass draft and a judgment call.

Method and choice of reference classes

The approach is the standard "outside view": rather than reasoning from Plan A's specifics, I assembled ~31 past international agreements that resemble it, recorded how long each lasted before it was first impaired and before it dissolved, and converted the pooled experience into annual hazard rates. I use the same two outcome categories as the supplement—DISSOLUTION (formally terminated, withdrawn-from, or collapsed) and IMPAIRMENT (substantially less effective without formal dissolution: non-enforcement, tolerated violations, suspension, or weakening revision)—and I track three things separately that analysts often blur: time-to-first-impairment, time-to-dissolution, and the failure mode (who broke it and why), because Plan A's design bears very differently on each. I assign each agreement a numeric applicability weight (0–3: 3 = rival great-power capability deal, the closest analogue; ~1.5–2 = informative analogue; ~1 = broad multilateral convention; ~0.25–0.5 = low-defection-incentive or toothless), then compute the base rate as a weighted hazard—Σ(weight × events) / Σ(weight × years-at-risk)—separately for dissolution and impairment. The weights, the per-treaty inputs, and the live formulas all sit in the spreadsheet (Parts 1–2), so the aggregation is fully transparent and editable: change a weight and the base rate recomputes. A pooled hazard is still crude—it treats 1922 naval cheating and a 2023 treaty suspension as draws from one urn—so I report it alongside an unweighted version, a closest-analogues-only version, and—most importantly—a version that lets the hazard vary by PHASE (years since the deal started, Part 2b), then adjust for Plan A's specifics.

I grouped the agreements into three tiers by similarity to Plan A. MOST APPLICABLE: rival great-power deals that cap a decisive military/strategic technology under strong incentives to defect—the interwar naval treaties (Washington/London), the bilateral US–USSR/Russia strategic arms-control treaties (ABM, SALT, INF, START, New START, Open Skies), and the two "rivals'-deal" nonproliferation bargains (JCPOA, the US–DPRK Agreed Framework)—plus the IR alliance-termination literature, the closest thing to a quantitative base rate for how long deals between rivals last (mean alliance life ~9–10 years pre-1945; ~1/3 violated when tested). MODERATELY APPLICABLE: broad multilateral nonproliferation/verification conventions (NPT, CWC, BWC, CTBT), useful mainly for what they reveal about verification and as the optimistic bound; and the dual-use export-control regimes (Wassenaar/MTCR/NSG), the closest analogue to controlling AI chips and chronically leaky by design. LEAST APPLICABLE but informative: durable low-incentive conventions (Outer Space, Tlatelolco, PTBT) and the toothless climate accords (Kyoto, Paris), which bracket the extremes—near-permanent when nobody wants to defect, near-useless when nothing is binding. The single closest historical analogue is the Washington/London naval system: peer rivals capping a decisive military technology, both tempted to defect, with self-declaration verification. It ran ~13–14 years before Japan walked out, and was cheated on throughout.

Central finding: verification delays cheating, but politics kills the deal

Two patterns dominate the data and drive the whole estimate.

First, verification strength is the cleanest predictor of how long a deal lasts unimpaired-by-cheating. Strongly verified regimes (INF, START I, New START, Open Skies, NPT/IAEA, CWC/OPCW) went roughly 8–35 years before significant impairment, versus 0–4 years for weakly verified ones—a real but less clean separation than it first appears, because dating impairment to violation onset rather than detection shortens the verified deals' records (INF's violative testing began ~2008, six years before the US formal charge; Open Skies restrictions began in 2010). Verification detected cheating eventually, but with meaningful latency, and detection did not by itself reverse the violation. The one clean reversal in the dataset is the Montreal Protocol, where cheap atmospheric monitoring caught illicit CFC-11 production within years and enforcement restored compliance—the deal never became substantially less effective and is coded as unimpaired. Weakly or un-verified regimes (the naval treaties, the Anglo-German agreement, OPEC quotas, the whaling moratorium, and above all the BWC—which had no verification and was violated on a massive scale by the USSR for its entire early life) were impaired almost immediately, within 0–4 years. This is the strongest structural reason for optimism about Plan A: its verification regime is unusually strong by historical standards and is explicitly designed to make cheating detectable and auto-punishable.

Second, and crucially: strong verification does essentially nothing to prevent death by political withdrawal. The ABM Treaty (30 years), INF (31 years), Open Skies (~19 years), and the JCPOA (2.3 years) all died because a government decided to exit, not because verification failed. The JCPOA is the sharpest warning—the best verification regime ever negotiated was discarded in ~2 years by a change of US administration. So verification protects against the impairment-by-cheating failure mode, but offers little protection against the dissolution-by-regime-change / change-of-heart / geopolitical-shock failure mode, which the alliance literature (Leeds & Savun 2007) identifies as the dominant driver of premature termination. This is why I keep the dissolution hazard meaningfully above zero even though Plan A's verification is excellent.

How Plan A differs from the base rate (the adjustments)

Pushing the hazard UP relative to a generic high-salience treaty: (1) It is a rival deal over the single most decisive technology imaginable, so it belongs to the harsh ~7–12%/yr naval/rival/alliance class, not the benign ~0%/yr convention class. (2) It is an executive agreement, not a ratified treaty—the scenario says so explicitly, citing New START (2010) as the last significant ratified US treaty. Every deal in the dataset that one administration could exit unilaterally (ABM, INF, Open Skies, JCPOA) was exitable precisely because exit didn't require undoing a ratified commitment. (3) The stakes and the rate of technological change are both unprecedented, which compresses the "first major shock" that historically kills these deals—and the prize for defecting grows as capabilities approach handoff. (4) US elections in 2032 and 2036 and the Chinese leadership succession around 2033 (Xi turns 80) are scheduled regime-change risks, exactly the events Leeds & Savun find spike the termination hazard. (5) The scenario stipulates unusually competent US execution.

Pushing the hazard DOWN: (1) Unusually strong verification plus automatic enforcement (offline licensing, cryptographic shutoff of compute on exit) pushes the impairment-by-cheating component toward the INF/New-START low end (~2–4%/yr) rather than the naval-treaty high end. (2) An unusually strong SHARED interest: unlike a pure capability race, both sides genuinely fear loss of control and extinction. This is closer to MAD-stabilized nuclear restraint (which held for decades) than to a zero-sum arms race, and it is the best structural reason Plan A might beat its reference class—though it has no clean historical precedent.

Net: I anchor on the rival-deal class (~7%/yr dissolution) but discount the dissolution rate somewhat (to ~4–7%/yr depending on the year) for the shared-survival interest and competent execution, and hold the impairment-by-cheating component low (~2.5–5%/yr) because of strong verification—while keeping impairment nonzero for non-enforcement, misexecution, and weakening revision, none of which verification prevents.

Headline base rates and the year-by-year shape

The pooled weighted base rate (all ages together) is 3.4%/yr for dissolution and 7.9%/yr for impairment (unweighted 1.8% / 4.8%; closest-analogues-only subset 6.6% / 8.3%). But the more useful object is the base rate BY PHASE (Part 2b), because the historical hazard depends strongly on how long a deal has already survived. DISSOLUTION is hump-shaped, not front-loaded: 0% in years 0–2 (no deal in the dataset formally dissolved within two years), rising to a peak of ~5–6%/yr at years 5–10, then declining to ~2%/yr for deals that survive past 20 years—rival deals take a few years to die. IMPAIRMENT is strongly front-loaded: ~15.5%/yr in years 0–2, falling to ~9%/yr (years 2–5) and ~6%/yr (years 5–10), with a late bump (~6%/yr at years 10–20, from the New START suspension and Syria/CWC). Across the full dataset impairment is more common than formal dissolution—many regimes get hollowed out rather than killed. Feeding the phase curve into the deal timeline, the pure base rate implies ~79% cumulative chance of some breakdown by 2040 (~39% dissolution, ~65% impairment). These are the "Base-rate" columns in Part 3; my "Adjusted" columns overlay the Plan-A-specific reasoning below, yielding ~62% cumulative breakdown (~43% dissolution, ~33% impairment).

My adjusted shape departs from the base rate in two deliberate ways. First, I lift EARLY dissolution above the base rate's 0%: the historical 0% in years 0–2 is partly survivorship (deals that collapse during negotiation never enter an "entered-into-force" dataset), whereas Plan A's setup is genuinely fragile, so I use ~5%/yr in 2029–30. Second, I cut impairment far below the base rate throughout (≈2.5–5% vs the base's 15.5%→3%), because Plan A's strong verification specifically suppresses the cheating-driven and born-impaired failures that dominate the historical impairment record. On top of that I add discrete dissolution spikes at the scheduled regime-change events (US elections 2032/2036, Chinese succession ~2033), and I keep the late-2030s hazard from decaying to near-zero because the prize for defecting grows as handoff and aligned superintelligence approach.

Comparison to the inside view, caveats, and where the detail lives

My adjusted estimate (~62% cumulative breakdown, ~43% cumulative dissolution by 2040) is more pessimistic than the inside-view "Overall deal decline probability view" tab (Eli's ~48% cumulative), and the pure unadjusted base rate is harsher still (~79% breakdown). I think that gap is real and informative: base rates for rival deals over decisive technologies are harsh, and the inside view may be under-weighting how reliably this reference class fails. On the components: the weighted dissolution base rate (3.4%/yr) sits just above the "0.5–3%/yr" generic-high-salience-treaty anchor in the spreadsheet note, while the impairment base rate (7.9%/yr) is far higher—because the most applicable reference class is rival capability deals (naval treaties, JCPOA, Agreed Framework, alliances), not high-salience treaties in general, and because the dominant historical killer—political withdrawal—is not neutralized by Plan A's verification, however strong.

Main caveats. (1) Pooled hazard rates hide enormous heterogeneity; the "right" number depends heavily on how much weight you put on the shared-survival-interest stabilizer, which has no clean precedent. (2) N is small and the rival-deal subclass is dominated by a handful of cases. (3) The outside and inside views should NOT simply be averaged—they partly double-count (regime change appears both as the base-rate driver here and as an explicit sub-cause in the decomposition tab). (4) I have treated benign endings (planned expiry, supersession by a stronger successor—SALT I, START I, SORT) as non-failures; counting them as dissolutions would push the dissolution rate higher. (5) Two structural features of Plan A genuinely lack good historical analogues—automatic compute-destruction-on-exit, and a genuinely shared existential interest—and both could justify materially lower numbers than the raw base rate if you believe they bind.

Where the detail lives: the 31-agreement dataset (per-treaty reasoning in column O), the live weighted-hazard computation (Part 2), the IR-literature anchors, and the full year-by-year base-rate-vs-adjusted table (Part 3) are all in the "Base rates" tab of the Deal Decline spreadsheet. Each treaty row records signed/in-force years, verification strength, a numeric applicability weight (column G, the input to the base-rate formula), exposure years, dissolved/impaired flags, years-lasted-unimpaired, years-to-dissolution, the dominant failure mode, reasoning, and sources.

Smooth fit (parametric survival)

The phase/step base rate (Part 2b) is noisy with only 31 agreements, so I also fit smooth parametric survival curves to the treaty-level data by weighted, right-censored maximum likelihood (Part 2c), comparing exponential, Weibull, log-logistic, and lognormal by AIC. LOGNORMAL fits best for both outcomes (dissolution AIC 301.8; impairment AIC 275.4) and reproduces the shapes the step rates show. The fitted dissolution hazard rises from ~0.2%/yr at age 0.5 to a ~4.4%/yr plateau by years 8–11—a hump, confirming dissolution is not front-loaded—while the fitted impairment hazard decays smoothly from ~17%/yr at age 0.5 to ~5.6%/yr by age 11.5 (front-loaded). Weibull is a reasonable simpler alternative (impairment k=0.71, a monotonically decreasing hazard; dissolution k=1.1, near-flat) but it cannot produce a hump, so it underfits dissolution; log-logistic is in between. The fitted per-year hazards live in Part 3 columns L–M, next to the step base rate; over 2029–2040 they imply ~34% cumulative dissolution and ~69% cumulative impairment—close to the step-function figures (39% / 65%), which is reassuring. Caveat: with N=31 and heavy weighting toward a handful of rival deals, the fitted curves are best read as smoothed summaries of a small sample, not precise estimates—the parameters in Part 2c are editable if you want to stress-test them.

### Links on this page

- [AI 2040](https://ai-2040.com/)
- [PDF](https://ghjyjqzwz4.ufs.sh/f/9qHa0cBclQ7sf6FVzqbp2gHFXC1IbGS5ZA7DmNBusfM4YJRP)
- [Supplements](https://ai-2040.com/supplements)
- [FAQFAQ](https://ai-2040.com/supplements/faq)
- [How Plan A solves our 5 biggest problemsHow Plan A solves our 5 biggest problems](https://ai-2040.com/supplements/how-plan-a-solves-our-5-biggest-problems)
- [Covert AI ProjectsCovert AI Projects](https://ai-2040.com/supplements/covert-ai-projects)
- [Verification PlanVerification Plan](https://ai-2040.com/supplements/verification-plan)
- [Transparency PlanTransparency Plan](https://ai-2040.com/supplements/transparency-plan)
- [Capability Scaling StrategyCapability Scaling Strategy](https://ai-2040.com/supplements/capability-scaling-strategy)
- [Security in Plan ASecurity in Plan A](https://ai-2040.com/supplements/security-in-plan-a)
- [Plan A AssumptionsPlan A Assumptions](https://ai-2040.com/supplements/plan-a-assumptions)
- [Comparing Possible PlansComparing Possible Plans](https://ai-2040.com/supplements/comparing-possible-plans)
- [Deal DeclineDeal Decline](https://ai-2040.com/supplements/deal-decline)
- [Takeoff SupplementTakeoff Supplement](https://ai-2040.com/supplements/takeoff-supplement)
- [Economics of Plan AEconomics of Plan A](https://ai-2040.com/supplements/economics-of-plan-a)
- [Compute in Plan ACompute in Plan A](https://ai-2040.com/supplements/compute-supplement)
- [Economic Growth ExplorerEconomic Growth Explorer](https://ai-2040.com/supplements/econ-explorer)
- [Space Governance PlanSpace Governance Plan](https://ai-2040.com/supplements/space-governance-plan)
- [AI for EpistemicsAI for Epistemics](https://ai-2040.com/supplements/ai-for-epistemics)
- [Alignment RoadmapAlignment Roadmap](https://ai-2040.com/supplements/alignment-roadmap)
- [About](https://ai-2040.com/about)
- [https://ai-futures.org/](https://ai-futures.org/)
- [https://ai-2040.com/supplements/deal-decline#introduction](https://ai-2040.com/supplements/deal-decline#introduction)
- [Introduction](https://ai-2040.com/supplements/deal-decline#introduction)
- [https://ai-2040.com/supplements/deal-decline#overview](https://ai-2040.com/supplements/deal-decline#overview)
- [Overview](https://ai-2040.com/supplements/deal-decline#overview)
- [https://ai-2040.com/supplements/deal-decline#types-of-deal-decline](https://ai-2040.com/supplements/deal-decline#types-of-deal-decline)
- [Types of deal decline](https://ai-2040.com/supplements/deal-decline#types-of-deal-decline)
- [https://ai-2040.com/supplements/deal-decline#causes-of-deal-decline](https://ai-2040.com/supplements/deal-decline#causes-of-deal-decline)
- [Causes of deal decline](https://ai-2040.com/supplements/deal-decline#causes-of-deal-decline)
- [https://ai-2040.com/supplements/deal-decline#likelihood-of-deal-decline](https://ai-2040.com/supplements/deal-decline#likelihood-of-deal-decline)
- [Likelihood of deal decline](https://ai-2040.com/supplements/deal-decline#likelihood-of-deal-decline)
- [https://ai-2040.com/supplements/deal-decline#badness-of-deal-decline](https://ai-2040.com/supplements/deal-decline#badness-of-deal-decline)
- [Badness of deal decline](https://ai-2040.com/supplements/deal-decline#badness-of-deal-decline)
- [https://ai-2040.com/supplements/deal-decline#preparing-for-deal-decline](https://ai-2040.com/supplements/deal-decline#preparing-for-deal-decline)
- [Preparing for deal decline](https://ai-2040.com/supplements/deal-decline#preparing-for-deal-decline)
- [https://ai-2040.com/supplements/deal-decline#acknowledgments](https://ai-2040.com/supplements/deal-decline#acknowledgments)
- [Acknowledgments](https://ai-2040.com/supplements/deal-decline#acknowledgments)
- [https://ai-2040.com/supplements/deal-decline#appendix-claudes-analysis-of-base-rates](https://ai-2040.com/supplements/deal-decline#appendix-claudes-analysis-of-base-rates)
- [Appendix](https://ai-2040.com/supplements/deal-decline#appendix-claudes-analysis-of-base-rates)
- [https://ai-2040.com/supplements/deal-decline#claudes-analysis](https://ai-2040.com/supplements/deal-decline#claudes-analysis)
- [Claude’s Analysis](https://ai-2040.com/supplements/deal-decline#claudes-analysis)
- [https://ai-2040.com/supplements/deal-decline#method-and-choice-of-reference-classes](https://ai-2040.com/supplements/deal-decline#method-and-choice-of-reference-classes)
- [Method and choice of reference classes](https://ai-2040.com/supplements/deal-decline#method-and-choice-of-reference-classes)
- [https://ai-2040.com/supplements/deal-decline#central-finding-verification-delays-cheating-but-politics-kills-the-deal](https://ai-2040.com/supplements/deal-decline#central-finding-verification-delays-cheating-but-politics-kills-the-deal)
- [Central finding: verification delays cheating, but politics kills the deal](https://ai-2040.com/supplements/deal-decline#central-finding-verification-delays-cheating-but-politics-kills-the-deal)
- [https://ai-2040.com/supplements/deal-decline#how-plan-a-differs-from-the-base-rate-the-adjustments](https://ai-2040.com/supplements/deal-decline#how-plan-a-differs-from-the-base-rate-the-adjustments)
- [How Plan A differs from the base rate (the adjustments)](https://ai-2040.com/supplements/deal-decline#how-plan-a-differs-from-the-base-rate-the-adjustments)
- [https://ai-2040.com/supplements/deal-decline#headline-base-rates-and-the-year-by-year-shape](https://ai-2040.com/supplements/deal-decline#headline-base-rates-and-the-year-by-year-shape)
- [Headline base rates and the year-by-year shape](https://ai-2040.com/supplements/deal-decline#headline-base-rates-and-the-year-by-year-shape)
- [https://ai-2040.com/supplements/deal-decline#comparison-to-the-inside-view-caveats-and-where-the-detail-lives](https://ai-2040.com/supplements/deal-decline#comparison-to-the-inside-view-caveats-and-where-the-detail-lives)
- [Comparison to the inside view, caveats, and where the detail lives](https://ai-2040.com/supplements/deal-decline#comparison-to-the-inside-view-caveats-and-where-the-detail-lives)
- [https://ai-2040.com/supplements/deal-decline#smooth-fit-parametric-survival](https://ai-2040.com/supplements/deal-decline#smooth-fit-parametric-survival)
- [Smooth fit (parametric survival)](https://ai-2040.com/supplements/deal-decline#smooth-fit-parametric-survival)
- [https://ai-2040.com/supplements/deal-decline#top-toc](https://ai-2040.com/supplements/deal-decline#top-toc)
- [scaling faster](https://ai-2040.com/supplements/capability-scaling-strategy)
- [scaling up AI capabilities faster and handing off to AIs earlier](https://ai-2040.com/supplements/capability-scaling-strategy)
- [much more valuable than the other plans](https://www.ai-2040.com/supplements/comparing-possible-plans)
- [the outcome will probably still be substantially better than no deal](https://ai-2040.com/supplements/deal-decline#overview)
- [mechanisms such as automated lie detection and robust institutional design](https://ai-2040.com/supplements/deal-decline#preventing-deal-decline)
- [types of deal decline](https://ai-2040.com/supplements/deal-decline#types-of-deal-decline)
- [Causes of deal decline:](https://ai-2040.com/supplements/deal-decline#causes-of-deal-decline)
- [Badness of deal decline](https://ai-2040.com/supplements/deal-decline#overview)
- [Plan A’s compute destruction mechanisms](https://ai-2040.com/supplements/deal-decline#mutually-assured-compute-destruction-destroying-compute-fabs-and-robots)
- [ensure that nearly all of the compute in the world](https://ai-2040.com/supplements/deal-decline)
- [is destroyed](https://ai-2040.com/supplements/deal-decline)
- [covert project](https://www.ai-2040.com/supplements/covert-ai-projects)
- [analysis of the Plan A capability scaling strategy](https://ai-2040.com/supplements/capability-scaling-strategy)
- [covert project](https://docs.google.com/document/u/3/d/1lOzL0Wb9lyZE8-kfUKMoUHHcShtyCig3l41JuooZsS0/edit)
- [Base rates](https://ai-2040.com/supplements/deal-decline#base-rates-plus-adjustments)
- [https://ai-2040.com/supplements/deal-decline#base-rates-plus-adjustments](https://ai-2040.com/supplements/deal-decline#base-rates-plus-adjustments)
- [plus adjustments](https://ai-2040.com/supplements/deal-decline#base-rates-plus-adjustments)
- [Decomposition into causes](https://ai-2040.com/supplements/deal-decline#decomposition-into-causes)
- [Capability Scaling Strategy](https://ai-2040.com/supplements/capability-scaling-strategy)
- [Comparing Possible Plans](https://www.ai-2040.com/supplements/comparing-possible-plans)
- [below](https://ai-2040.com/supplements/deal-decline#appendix-claudes-analysis-of-base-rates)
- [AI to improve epistemics](https://ai-2040.com/supplements/ai-for-epistemics)
- [below](https://ai-2040.com/supplements/deal-decline#mutually-assured-compute-destruction-destroying-compute-fabs-and-robots)
- [quantitative estimates](https://ai-2040.com/supplements/deal-decline#quantitative-estimates)
- [improving epistemics](https://ai-2040.com/supplements/ai-for-epistemics)
- [sets things up so that the compute is likely destroyed upon dissolution](https://ai-2040.com/supplements/deal-decline#mutually-assured-compute-destruction-destroying-compute-fabs-and-robots)
- [5.5x speedup for a 10x increase in compute stock](https://www.lesswrong.com/posts/7jcPg79p3kD5ir3CL/how-much-slower-does-takeoff-go-with-10-less-compute)
- [industrial explosion](https://www.forethought.org/research/the-industrial-explosion)
- [set up so that the](https://ai-2040.com/supplements/deal-decline#mutually-assured-compute-destruction-destroying-compute-fabs-and-robots)
- [compute](https://ai-2040.com/supplements/deal-decline#mutually-assured-compute-destruction-destroying-compute-fabs-and-robots)
- [is likely destroyed upon deal dissolution](https://ai-2040.com/supplements/deal-decline#mutually-assured-compute-destruction-destroying-compute-fabs-and-robots)
- [below](https://ai-2040.com/supplements/deal-decline#post-dissolution-takeoff-length)
- [here](https://docs.google.com/spreadsheets/d/1MVdjISa09Y4qO3jT5eXYFz-s45gQm4NTXcZqEsFSowU/edit?gid=2143764324#gid=2143764324)
- [Capability Scaling Strategy supplement](https://ai-2040.com/supplements/capability-scaling-strategy)
- [AI for epistemics](https://ai-2040.com/supplements/ai-for-epistemics)
- [effective](https://ai-2040.com/supplements/compute-supplement#appendix-the-effective-h100e-model)
- [Etched](https://www.etched.com/)
- [above](https://ai-2040.com/supplements/deal-decline#preparing-stockpiles-to-align-incentives)
- [SEZs](https://ai-2040.com/supplements/verification-plan#2032-cap-and-trade-for-robots-and-compute)
- [assuming 10x less compute means ~5.5x slower](https://www.lesswrong.com/posts/7jcPg79p3kD5ir3CL/how-much-slower-does-takeoff-go-with-10-less-compute)
- [research effort](https://www.aifuturesmodel.com/#section-researcheffortandairduplift)
- [training compute safety tax](https://ai-2040.com/supplements/comparing-possible-plans#training-compute-safety-tax-definition)
- [~2.75 years](https://ai-rates-calculator-git-fixed-training-compute-lesswrong.vercel.app/covert?k.enable_deal_breakdown=true&k.deal_breakdown_years_after_pause_end=7&k.post_breakdown_compute_growth_rate=0)
- [~1 year](https://www.ai-2040.com/supplements/takeoff-supplement?k.enable_deal_breakdown=true&k.deal_breakdown_years_after_pause_end=7&k.breakdown_compute_reduction=0.07&k.total_h100e_frac=0.008194244310987836)
- [compute destroyed](https://www.ai-2040.com/supplements/takeoff-supplement?k.enable_deal_breakdown=true&k.deal_breakdown_years_after_pause_end=7&k.breakdown_compute_reduction=0.07&k.total_h100e_frac=0.008194244310987836)
- [no compute destroyed](https://www.ai-2040.com/supplements/takeoff-supplement?k.enable_deal_breakdown=true&k.deal_breakdown_years_after_pause_end=7&k.breakdown_compute_mode=world_at_breakdown&k.breakdown_compute_reduction=0.2&k.post_breakdown_compute_growth_rate=0.1)
- [results in](https://ai-rates-calculator-git-fixed-training-compute-lesswrong.vercel.app/covert?k.enable_deal_breakdown=true&k.deal_breakdown_years_after_pause_end=2&k.post_breakdown_compute_growth_rate=0.5)
- ["Base rates" tab of the companion Deal](https://docs.google.com/spreadsheets/d/15i_TFnC8bTyRT2xOsok3ql0IZ2qesQg4V7LkoWYO2L0/edit?gid=1499542947#gid=1499542947)
- [Decline](https://docs.google.com/spreadsheets/d/15i_TFnC8bTyRT2xOsok3ql0IZ2qesQg4V7LkoWYO2L0/edit?gid=1499542947#gid=1499542947)
- [spreadsheet](https://docs.google.com/spreadsheets/d/15i_TFnC8bTyRT2xOsok3ql0IZ2qesQg4V7LkoWYO2L0/edit?gid=1499542947#gid=1499542947)
- ["Overall deal decline probability view" tab](https://docs.google.com/spreadsheets/d/15i_TFnC8bTyRT2xOsok3ql0IZ2qesQg4V7LkoWYO2L0/edit?gid=215047343#gid=215047343)

---
