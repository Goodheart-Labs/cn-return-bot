# AI 2040: Plan A

**Path:** `/supplements/capability-scaling-strategy`

Capability Scaling Strategy
Eli Lifland
Overview
Plan A vs. Plan D capability trajectory
Automated Coder
3× AI R&D uplift
Superhuman AI Researcher
20× AI R&D uplift
Top-Expert-Dominating AI
400× AI R&D uplift
Wildly Superintelligent
10,000× AI R&D uplift
Plan A — capability-shaped uplifts
Automated Coder
3× realized uplift
Top-Expert-Dominating AI
~40× realized uplift
Max-controllable AI
2040: handoff
late 2029
mid 2030
mid 2030
late 2030
late 2034
early 2031
Plan D
no deal — intelligence explosion
Plan A
slowdown deal — controlled takeoff
2026
2028
2030
2032
2034
2036
2038
2040

In the Plan A scenario, why does the Consortium choose to steadily increase capabilities until reaching top-expert-dominating AI (TED-AI) in 2035, then slow down nearly to a pause until handing off to these AIs in 2040? This supplement describes the high level strategy for scaling capabilities and the reasoning behind them.

This supplement explores the reasoning behind these choices.

In one sentence, the high-level scaling strategy in Plan A is to scale as quickly as possible subject to maintaining high confidence that the scaling is safe. In more detail:

First I discuss the high level capability scaling strategy used in Plan A and the reasoning behind it. I split the strategy into 2 stages:

Scale until you’re close to max-controllable-AI, i.e. the maximally capable AI that we are confident we can prevent from causing a catastrophe even if they were misaligned. We predict in the scenario that the max-controllable-AI is roughly TED-AI.

Slow down nearly to a halt, then eventually hand off to AIs.

Then I discuss the costs of taking more time to scale capabilities, most importantly deal decline risk.

Finally, I discuss in more detail the recommended strategy for Stage 1 and Stage 2.

In practice, much more analysis should be done to decide the best strategies than that which we’ve done for this supplement, and furthermore these strategies should be adjusted as information comes in during the execution of Plan A. I’ll describe my current best guess.

I’m confident that we’ve identified the most important considerations pushing toward scaling slower, and I’m moderately but not highly confident that the high-level strategies we describe are correct. I’m not confident in any precise quantitative estimates.

High level strategy
Overall shape of the trajectory

We choose to scale up at all rather than pause indefinitely because of the costs of going slowly, most importantly deal decline, i.e. the risk that the slowdown deal dissolves or becomes less effective.

We aim for a trajectory shaped like the following:

Plan A spends more time at higher capability levels than a uniformly slowed intelligence explosion
Plan A — capability-shaped uplifts
Automated Coder
3× realized uplift
Top-Expert-Dominating AI
~40× realized uplift
2029: two ways to slow down
2040: handoff
early 2035
mid 2030
late 2034
Plan A
slowdown deal — controlled takeoff
Uniform slowdown
uniformly slower uncontrolled intelligence explosion
2026
2028
2030
2032
2034
2036
2038
2040

We break Plan A into 2 high-level stages:

Stage 1: Scale until max-controllable-AI.

Stage 2: Slow down nearly to a halt, then eventually hand off to AIs.

This produces a curve that first increases relatively quickly, though still slower than in an uncontrolled intelligence explosion, and then slows down to near a halt for a while. This contrasts with what we’d get if the intelligence explosion were slowed uniformly.

We choose to aim for this sort of curve because we want to spend as much time as possible with AIs that are very useful for important applications, such as alignment, epistemics, and stabilizing the deal. And we think that going this fast early is manageable while maintaining high confidence in safety.

Stage 1: Scale until max-controllable-AI

During this stage the Consortium scales capabilities until a bit below max-controllable-AI, then ~pauses further scaling. Max-controllable-AI is the maximum capability level at which we are confident that we maintain control over the AIs, i.e. the property that the AIs couldn’t cause catastrophic harm even if they wanted to. We think that this level will be approximately Top-Expert-Dominating AI (TED-AI), i.e. AIs that are at least as good as top humans at every cognitive task.

Strategy: Our best guess is that the Consortium will have a fairly good idea of whether there’s a covert project or not, even though they may not be able to prove it, based on how much compute is unaccounted for. We also predict that there probably won’t be a covert project. If the Consortium thinks there's likely a covert project but shares our current best guess regarding covert project detection (~60% chance within 5 years), then it’s a close call as to whether they should go slower than they otherwise would due to covert projects. If they are substantially more pessimistic than our current best guess about detection, then they should slow down in order to avoid making lots of software progress, hence taking at least ~5 years in Stage 1. If they are instead more optimistic, then the limiting factors on their speed should instead be maintaining high confidence in control and avoiding destabilization. The benefits of scaling quickly are (a) the Consortium gets more capable AIs to automate useful work and to use as experimental subjects and (b) lower risk of deal decline.

Stage 2: Slow down nearly to a halt, then eventually hand off to AIs

Once the Consortium has AIs that are capable enough such that it is difficult to control them, they slow down (close to a pause) for a while. Then they hand off to the AIs, relaxing control measures. By relaxing control measures, I mean that we can give AIs more ability to get things done, at the cost of increasing the chance they could take over the world if they were misaligned. For simplicity, in this supplement I discuss and model handoff as binary.

Strategy: Approximately, the strategy is to wait until the Consortium has high confidence that the AIs are aligned, then hand off. More precisely, the Consortium should wait until the benefits of delaying to increase the chance that the AIs are aligned are outweighed by various risks: the deal declining, covert projects reaching dangerous capabilities, or other existential risks such as pandemics; I think that deal declining is a much bigger factor in Stage 2. Roughly, you should hand off once either of the following is true (see more below):

You have very high confidence that alignment has been solved, e.g. 99.5%, and thus marginal gains from further research are low (e.g., ~0.1%/year).

You have somewhat high confidence that alignment has been solved, e.g. 95%, and thus marginal gains from further research are a little higher (e.g., ~1%/year). However, the Plan A deal seems somewhat unstable. E.g., if there were >5%/year chance of deal decline, that would point toward a handoff.

Costs of taking more time to scale

The following are the biggest costs of taking longer to increase capabilities in Stage 1, or taking longer to hand off to AIs in Stage 2.

First, the deal might dissolve or get worse. We call this deal decline, and it encompasses both of:

Deal dissolution. The deal is officially dissolved.

Deal impairment. The deal becomes substantially less effective than if it were implemented well and adhered to, but isn’t dissolved. Ways the deal could be impaired:

Deal non-enforcement. The deal is not enforced as strongly as before, e.g. a country blatantly not complying is not punished. This leads to increased violations of the letter of the deal.

Deal misexecution. The letter of the deal is followed but is executed poorly.

Deal revision. The deal is explicitly edited to be worse. This could be straightforward weakening, but it could also be making it worse in other ways, such as unnecessarily increasing surveillance.

See the deal decline supplement for more info.

Second, there are risks from illegal model usage in covert projects by state actors or terrorists. If covert projects possess capabilities that would be catastrophic if in the hands of misaligned AIs or bad actors, AI takeover and misuse risks are higher. For Stage 1, unlike in Stage 2, the Consortium should (within plausible Stage 1 lengths) go slower to beat the covert projects; going too fast requires making lots of software progress which helps the covert projects. More discussion below.

Finally, there is direct pre-handoff existential risk incurred before handing off to AIs. This doesn’t include risks from covert projects. This can be split into:

Risks from use of legal (i.e. non-covert) model capabilities.

Risks not derived from legal model capabilities. For example, asteroid risk or a nuclear war not causally downstream of legal frontier AIs.

Additionally, there are shifts in the world not driven by the deal, which could be either a cost or benefit of going slowly. For example, the balance of power could shift so that authoritarian countries have more power relative to democratic countries, or vice versa.

Stage 1: Scale to max-controllable-AI
Benefits and costs of going slowly

During Stage 1 our goal is to decide on a policy for how quickly we should scale training compute and make software progress in the run-up to max-controllable-AI. That is, we want to set a trajectory that has a target end date at which max-controllable-AI is reached, and specify the split of training/software progress at each point. We consider only strategies that specify in advance a target end date and then scale throughout all of Stage 1 toward that date, for simplicity and tractability. In practice the Consortium’s strategy should be adjusted over the course of Stage 1 as they get more information.

We also need to decide the training compute safety tax that we’d like to pay, i.e. the difference between the amount of compute actually used on a training run to reach a given capability level, and the minimum amount of compute required to reach that capability. Paying a higher safety tax means using safer training algorithms at the cost of involving making extra software progress that goes unused but leaks to covert projects.

The primary costs of going slowly in Stage 1 are:

Those laid out above; risk from deal decline due to taking longer, covert projects (if paused for a very long time), and direct existential risks.

Missing out on time with more capable AIs, which can be used to automate useful work (alignment, control, epistemics, etc.) and be used as experimental subjects. These AIs could also help stabilize the deal, reducing risk of decline per year.

The primary benefits of going slowly in Stage 1 are:

A lower fraction of progress comes from software improvements. This is good because software improvements can be copied by covert projects. Software progress and training compute scaling are the two sources of progress. Software progress is mostly made public, meaning it diffuses to covert projects. This means that despite covert projects being a reason that you eventually should scale to superintelligence, they are a reason you should scale slower in Stage 1 unless you’re taking well over a decade.

Less risk of AI takeover due to overestimating to what extent the AIs are controlled.

Less destabilization, which could (among other things) potentially increase the chance of deal decline per year. An example of a destabilizing effect is if we scaled to AIs capable of superpersuasion and it wasn’t properly defended against, leading to degraded epistemics. However, as noted above, better AIs could also be stabilizing and reduce the annual risk of deal decline.

The Consortium’s strategy is also constrained in that it might not be possible to avoid discovering software improvements, for 2 reasons: (a) some software improvements might be required to utilize increased amounts of compute, (b) doing lots of safety R&D likely inevitably leads to some capabilities externalities in the form of software progress. In our simulations, we require that the Consortium make 0.2 OOM of software progress for each OOM of training FLOP/s they gain, and that during Stage 2, the Consortium’s alignment research incurs capabilities externalities at a rate of 0.25 software OOMs/year.

What to do if a covert project seems unlikely

Our best guess is that the Consortium will have a fairly good idea of whether there’s a covert project or not, even though they may not be able to prove it, based on how much compute is unaccounted for. We also predict that there likely won’t be a covert project.

If it seems unlikely that there’s a covert project, my recommendation is to scale as fast as possible while maintaining high confidence in AIs being controlled and avoiding destabilizing society and the deal. This is what happens in our scenario, and we depict the resulting target year of 2035 as a rough guess. I’d weakly guess that the target year should be a little earlier, were we to rewrite the scenario.

Target year’s effect on risk probabilities

If it seems likely that there’s a covert project, then the situation is more complicated because we have to balance deal decline risk, which points toward going faster, with covert project risk, which points toward going slower.

I’ll now do some modeling of how the trajectory of the deal will go. The modeling assumes that the deal begins in 2029 and that it starts being implemented a bit under a year before AC, as in the Plan A scenario. It does not assume that takeoff from AC to TED-AI and AC to ASI is about 1 year as in the scenario. Instead it assumes uncertainty with parameter medians centered around those from the Plan A default trajectory, as we think decision-makers will still have substantial uncertainty over takeoff speeds in 2029. This means that sometimes the Consortium can’t hit the target date; in fact for the earliest target date we consider of mid-2031, it often can’t hit it, as this would be a takeoff of similar length to the default (the default trajectory goes from pre-deal capabilities to TED-AI in ~1.5 years, while in Plan A the training resumption happens at the start of 2030 and the Consortium aims to pay a 1 OOM safety tax above TED-AI).

The below graph shows how the risk of deal decline and risk of covert projects achieving max-controllable-AI change based on the Stage 1 target end date. It assumes our best-guess projections as described in the deal decline and covert project supplements. It looks at the risk of deal decline and covert projects reaching TED-AI in Stage 1 or within the first 5 years of Stage 2. I choose 5 years because this is the length of Stage 2 in the scenario; more discussion below. The latest target date considered is 2037 because this is, with our median takeoff parameters, the year at which TED-AI is reached if the Consortium makes the minimum amount of software progress.

Deal decline and covert project risk trade off as speed varies
Covert detection?
Detection included
No detection
Split deal decline & covert by Stage 1 vs. first 5 years of Stage 2
Deal decline
Covert reaches TED-AI
Deal unimpaired
Assumes a covert project is attempted. All curves represent world state as of 5 years after end of Stage 1.
0%
25%
50%
75%
100%
Highest deal unimpaired (45.2%)
2031
2032
2033
2034
2035
2036
2037
2038
Stage 1 target end date (TED-AI)
Share of worlds
5y after Consortium TED-AI

We can see the tradeoff between minimizing risks from deal decline, and minimizing risk from covert projects reaching TED-AI. Target years between 2032 and 2036 all look to be quite similar in terms of maximizing the chance of getting to 5 years into Stage 2 unimpaired. If we turn off detection, then any of 2034 to 2036 look to be of fairly similar value, with 2032 and especially 2031 looking much worse; this makes sense as covert projects are a bigger factor.

Badness of risks

Does it make sense to treat these risks as equal in badness to each other?

I’ve done some rough estimates of how good various end states to the deal are here (summary here): by year and whether the deal stays unimpaired, or whether it declines or a covert project reaches TED-AI. In those estimates, I assumed that the covert project that reached TED-AI (or the AI that it created) had the ability and desire to essentially take over the world.

I’ll now bin outcomes into whether they happen before or after the start of Stage 2 and calculate the badness based on how much worse the outcome is than the deal surviving 5 years into Stage 2. The shift to Stage 2 is good for improving outcomes from both deal decline and covert TED-AIs, because reaching TED-AI allows the discovery of better alignment techniques, generally improving epistemics, and other useful applications.

I’ll also add a discount for the fact that there might not be human or AI takeover that originates from the covert project that reaches TED-AI.

It seems like the percentage of value lost is very roughly:

	

Pre-Consortium-TED-AI (Stage 1)

	

Post-Consortium-TED-AI, first 5 years (Stage 2)




Covert takeover badness

	

70%

	

55%




Takeover chance

	

55%

	

45%




Covert reaches TED-AI badness

	

39%

	

25%




Deal declines

	

50%

	

25%

Below we can see how deal decline and covert project risk are split up across Stage 1 and the first 5 years of Stage 2.

Deal decline risk is more weighted toward Stage 1 than covert project risk
Covert detection?
Detection included
No detection
Split deal decline & covert by Stage 1 vs. first 5 years of Stage 2
Deal decline (Stage 1)
Deal decline (first 5 years of Stage 2)
Covert reaches TED-AI (Stage 1)
Covert reaches TED-AI (first 5 years of Stage 2)
Assumes a covert project is attempted. All curves represent world state as of 5 years after end of Stage 1.
0%
25%
50%
75%
100%
2031
2032
2033
2034
2035
2036
2037
2038
Stage 1 target end date (TED-AI)
Share of worlds
5y after Consortium TED-AI

We see that a higher percentage of deal decline risk comes in Stage 1 than for covert project risk, especially for target years of 2035 and earlier. This makes deal decline on average worse than covert projects reaching TED-AI, relative to what you’d think if you compared their badness from happening at the same time. Now let’s check out the implications of combining the risk levels with the value lost from the risk materializing:

Expected value lost from deal decline and covert risks, by TED-AI target year
Covert detection?
Detection included
No detection
Value lost if the outcome happens (drag to adjust your own estimates):
Covert reaches TED-AI — Stage 1
39%
if takeover 70%
Covert reaches TED-AI — first 5y of Stage 2
25%
if takeover 55%
Also adjust deal-decline value lost
Reset value lost to defaults
Total value lost
From deal decline
From covert project
Assumes a covert project is attempted. All curves represent world state as of 5 years after end of Stage 1.
0%
10%
20%
30%
Lowest value lost (21.8%)
2031
2032
2033
2034
2035
2036
2037
2038
Stage 1 target end date (TED-AI)
Expected value lost

My simple methodology has the following 2 issues which means that you should interpret the above graph as being too favorable toward earlier target dates relative to later ones

I only consider the percentage of value lost as the outcome variable, but reaching 5 years into Stage 2 has slightly greater value for later target dates than for earlier ones (though the effect size might be small given the use of AIs for safety in the final 5 years swamps that of previous years).

The percentage of value lost might be higher for early target years, especially during Stage 1.

With that said: With my best guess parameter values, it looks like earlier is better from the perspective of deal decline and covert project risks. However, it’s not that big of a difference. The expected percentage of value lost is just ~2% higher with a target year of 2036 than of 2032. This means that adjustments for the issues described above could potentially flip the conclusion.

Not taking into account covert project detection results in a curve that is more flat and at higher amounts of value lost; having there be a covert project and not being able to detect it is a rough situation to be in no matter what you do. All of 2031-2036 result in very similar values, but with adjustments later target dates could be favored.

Including detection but assuming that a covert project or its AI takes over once reaching TED-AI results again in the 2031-2036 targets being very close in value.

Summing up

If the Consortium thinks there's likely a covert project but shares our current best guess regarding covert project detection (~60% chance within 5 years), then it’s a close call as to whether they should go slower than they otherwise would due to covert projects. If they are substantially more pessimistic than our current best guess about detection, then they should slow down in order to avoid making lots of software progress, hence taking at least ~5 years in Stage 1. If they are instead more optimistic, then the limiting factors on their speed should instead be maintaining high confidence in control and avoiding destabilization.

All of the above assumed a constant safety tax of 1 OOM of excess training compute above the minimum required paid at the end of Stage 1. This is my recommendation and the tax portrayed in the scenario. This recommendation is based on a mix of simple modeling and intuitive judgment. I’m not confident in it; the benefit of a higher tax is more confidence in control at higher capability levels, while the downsides are leaking software to covert projects and creating an overhang of foregone software improvements that can be used by projects post-deal-decline (especially post-dissolution).

Stage 2: Slow down nearly to a halt, then eventually hand off to AIs

Once at max-controllable-AI (TED-AI in the Plan A scenario), we need to decide how long to pause before handing off trust to AIs. For the purposes of this analysis we are treating this stage as a pause, though in practice and in the scenario there are a few deviations from a complete pause: (a) it may be desirable to scale up very slowly, as the max controllable level might increase due to improved control techniques and/or tighter uncertainty bounds, and (b) safety research will have at least minor capabilities externalities, meaning software progress will be made, which will leak to covert projects even if it isn't applied to improve legal AIs.

The costs of delaying handoff in Stage 2 are as laid out above; risk from deal decline, covert projects, and direct existential risks. We think that deal decline will generally be the dominant consideration because covert projects will likely have already been detected, if they existed in the first place.

The primary benefit of delaying handoff in Stage 2 is increasing the likelihood that the AIs we hand off to are aligned. This mostly comes from alignment research that helps figure out how to align AIs and evaluate their alignment, and paying “safety taxes” such as training a model with more compute than is required to reach a given capability level, in order to use a safer training process. Note that this is specifically regarding the AI that we hand off to; it’s possible that an aligned AI might not succeed in aligning its successors (especially if circumstances change negatively in some way after handoff).

A secondary benefit is increasing the probability that the future goes very well conditional on alignment; this is also highly important but probably depends less on the timing than does probability of alignment. Additionally, it’s possible that waiting too long eventually ends up being marginally negative for outcomes conditional on alignment; it might be better to hand off to an aligned max-controllable-AI earlier rather than later so that it has more free rein to improve the situation.

To decide when to hand off in Stage 2, we recommend calculating the marginal benefits and costs of delaying handoff and handing off once the costs outweigh the benefits. We expect the best strategy to be something like handing off once we have high confidence that the AIs are aligned.

See below for specific concrete case studies on deciding what strategy is best.

Concrete case study of possible 2040 handoff decisions

We’ll now discuss case studies regarding whether to hand off. To make things concrete, we’ll assume that we are making a decision regarding whether to hand off in 2040 some time after max-controllable-AI was reached, which is when handoff happens in the Plan A scenario.

To keep things simple, we’ll assume that the only factors for whether to delay handoff are:

Benefit: Increased alignment probability. See below for discussion of what the trajectory of alignment progress will look like.

Cost: Deal decline risk. Covert project risk is the main other contender for a substantial reason to hand off faster. However, our guess is that covert project risk is probably very low in this case study, because (a) probably if there was a covert project it would have been detected by now and (b) we haven’t done non-safety-externality software progress in 5 years, so covert projects haven’t been getting much help.

Below you can try out different settings for the relevant variables and see what recommendation they lead to regarding whether to delay hand off. I’ve set the default values to roughly match what they are during the handoff in the scenario, and have added plausible presets that set either the alignment or deal dissolution/impairment parameters.

Caveat: this calculator only weighs the single most important factor on each side — the alignment probability gained by delaying vs. the deal decline risk avoided by handing off.
ALIGNMENT SCENARIO
High confidence alignment solution
Alignment probably solved
Alignment likely solved
Alignment clearly unsolved
Alignment gain (a_change)
0.1%/yr
Extra p(alignment) bought per year of delay.
Alignment probability (a_prob)
99.5%
Current p(alignment). Deal dissolution or impairment is more costly the more likely alignment is.
DEAL DECLINE SCENARIO
Low risk
Medium risk
High risk
Deal decline probability (d_prob)
3%/yr
Yearly chance the deal dissolves or is substantialy impaired without official dissolution.
Deal decline badness (d_loss)
20%
Percentage of the future's value lost if the deal dissolves or is impaired.
P(ALIGNMENT) CHANGE BY HANDING OFF INSTEAD OF DELAYING A YEAR
+0.50%
Recommendation: Hand off now (weak)
u_handoff_minus_u_delay = d_prob·a_prob·d_loss − a_change
= (3% × 99.5% × 20%) − 0.1%
Benefit of handing off: 0.60%
Cost of handing off: 0.10%
Reset to defaults
RECOMMENDATION BY SCENARIO
	Low risk
d_prob 0.5%/yr · d_loss 10%
	Medium risk
d_prob 3%/yr · d_loss 20%
	High risk
d_prob 10%/yr · d_loss 35%

High confidence alignment solution
a_prob 99.5% · a_change 0.1%/yr
	
Delay
−0.05%
	
Hand off
+0.50%
	
Hand off
+3.38%

Alignment probably solved
a_prob 95% · a_change 1%/yr
	
Delay
−0.95%
	
Delay
−0.43%
	
Hand off
+2.33%

Alignment likely solved
a_prob 80% · a_change 3%/yr
	
Delay
−2.96%
	
Delay
−2.52%
	
Delay
−0.20%

Alignment clearly unsolved
a_prob 10% · a_change 2%/yr
	
Delay
−2.00%
	
Delay
−1.94%
	
Delay
−1.65%
Should we hand off or delay? - ai-2040.com

Reasoning for the medium deal decline probabilities and badness estimates can be found in the Deal Decline supplement.

Trajectory of estimated alignment probability

How steadily will alignment progress? There are 2 extremes we could use to model the situation.

All or nothing: We start very confidently believing that the AIs are misaligned, then at one point we make a breakthrough which quickly makes us confident that they’re now aligned.

Smooth, predictable progress: Our estimate of whether the AIs are aligned increases steadily and predictably.

Our high-uncertainty best guess is that the trajectory of our confidence in AIs’ alignment will be in between, perhaps slightly closer to the All or nothing option. It could also be a combination: we think that progress may look smooth/predictable for a while, until there’s a sudden breakthrough. For example, if ambitious mechanistic interpretability is solved and we understand all of AIs’ reasoning processes, this may give very high confidence in alignment.

For example, if we weren’t yet confident in AIs’ alignment, in 2040 there might be a ~5%/year chance of an alignment breakthrough that makes us confident, in addition to continuous improvements until we get the breakthrough; if we are confident (as in the scenario), then perhaps we’re at 0.01-1%/year alignment probability increase since we’re already close to 100%.

### Additional content revealed by tabs / alternate choices

- 1%/yr
- 95%
- Recommendation: Delay handoff (weak)
- = (3% × 95% × 20%) − 1%
- Benefit of handing off: 0.57%
- Cost of handing off: 1.00%
- 80%
- Recommendation: Delay handoff (strong)
- = (3% × 80% × 20%) − 3%
- Benefit of handing off: 0.48%
- Cost of handing off: 3.00%
- 2%/yr
- = (3% × 10% × 20%) − 2%
- Benefit of handing off: 0.06%
- Cost of handing off: 2.00%
- 0.5%/yr
- Recommendation: Delay handoff (very weak)
- = (0.5% × 99.5% × 10%) − 0.1%
- Benefit of handing off: 0.05%
- 10%/yr
- 35%
- Recommendation: Hand off now (strong)
- = (10% × 99.5% × 35%) − 0.1%
- Benefit of handing off: 3.48%

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
- [https://ai-2040.com/supplements/capability-scaling-strategy#overview](https://ai-2040.com/supplements/capability-scaling-strategy#overview)
- [Overview](https://ai-2040.com/supplements/capability-scaling-strategy#overview)
- [https://ai-2040.com/supplements/capability-scaling-strategy#high-level-strategy](https://ai-2040.com/supplements/capability-scaling-strategy#high-level-strategy)
- [High level strategy](https://ai-2040.com/supplements/capability-scaling-strategy#high-level-strategy)
- [https://ai-2040.com/supplements/capability-scaling-strategy#overall-shape-of-the-trajectory](https://ai-2040.com/supplements/capability-scaling-strategy#overall-shape-of-the-trajectory)
- [Overall shape of the trajectory](https://ai-2040.com/supplements/capability-scaling-strategy#overall-shape-of-the-trajectory)
- [https://ai-2040.com/supplements/capability-scaling-strategy#stage-1-scale-until-max-controllable-ai](https://ai-2040.com/supplements/capability-scaling-strategy#stage-1-scale-until-max-controllable-ai)
- [Stage 1: Scale until max-controllable-AI](https://ai-2040.com/supplements/capability-scaling-strategy#stage-1-scale-until-max-controllable-ai)
- [https://ai-2040.com/supplements/capability-scaling-strategy#stage-2-slow-down-nearly-to-a-halt-then-eventually-hand-off-to-ais](https://ai-2040.com/supplements/capability-scaling-strategy#stage-2-slow-down-nearly-to-a-halt-then-eventually-hand-off-to-ais)
- [Stage 2: Slow down nearly to a halt, then eventually hand off to AIs](https://ai-2040.com/supplements/capability-scaling-strategy#stage-2-slow-down-nearly-to-a-halt-then-eventually-hand-off-to-ais)
- [https://ai-2040.com/supplements/capability-scaling-strategy#costs-of-taking-more-time-to-scale](https://ai-2040.com/supplements/capability-scaling-strategy#costs-of-taking-more-time-to-scale)
- [Costs of taking more time to scale](https://ai-2040.com/supplements/capability-scaling-strategy#costs-of-taking-more-time-to-scale)
- [https://ai-2040.com/supplements/capability-scaling-strategy#stage-1-scale-to-max-controllable-ai](https://ai-2040.com/supplements/capability-scaling-strategy#stage-1-scale-to-max-controllable-ai)
- [Stage 1: Scale to max-controllable-AI](https://ai-2040.com/supplements/capability-scaling-strategy#stage-1-scale-to-max-controllable-ai)
- [https://ai-2040.com/supplements/capability-scaling-strategy#benefits-and-costs-of-going-slowly](https://ai-2040.com/supplements/capability-scaling-strategy#benefits-and-costs-of-going-slowly)
- [Benefits and costs of going slowly](https://ai-2040.com/supplements/capability-scaling-strategy#benefits-and-costs-of-going-slowly)
- [https://ai-2040.com/supplements/capability-scaling-strategy#what-to-do-if-a-covert-project-seems-unlikely](https://ai-2040.com/supplements/capability-scaling-strategy#what-to-do-if-a-covert-project-seems-unlikely)
- [What to do if a covert project seems unlikely](https://ai-2040.com/supplements/capability-scaling-strategy#what-to-do-if-a-covert-project-seems-unlikely)
- [https://ai-2040.com/supplements/capability-scaling-strategy#target-years-effect-on-risk-probabilities](https://ai-2040.com/supplements/capability-scaling-strategy#target-years-effect-on-risk-probabilities)
- [Target year’s effect on risk probabilities](https://ai-2040.com/supplements/capability-scaling-strategy#target-years-effect-on-risk-probabilities)
- [https://ai-2040.com/supplements/capability-scaling-strategy#badness-of-risks](https://ai-2040.com/supplements/capability-scaling-strategy#badness-of-risks)
- [Badness of risks](https://ai-2040.com/supplements/capability-scaling-strategy#badness-of-risks)
- [https://ai-2040.com/supplements/capability-scaling-strategy#summing-up](https://ai-2040.com/supplements/capability-scaling-strategy#summing-up)
- [Summing up](https://ai-2040.com/supplements/capability-scaling-strategy#summing-up)
- [https://ai-2040.com/supplements/capability-scaling-strategy#concrete-case-study-of-possible-2040-handoff-decisions](https://ai-2040.com/supplements/capability-scaling-strategy#concrete-case-study-of-possible-2040-handoff-decisions)
- [Concrete case study of possible 2040 handoff decisions](https://ai-2040.com/supplements/capability-scaling-strategy#concrete-case-study-of-possible-2040-handoff-decisions)
- [https://ai-2040.com/supplements/capability-scaling-strategy#trajectory-of-estimated-alignment-probability](https://ai-2040.com/supplements/capability-scaling-strategy#trajectory-of-estimated-alignment-probability)
- [Trajectory of estimated alignment probability](https://ai-2040.com/supplements/capability-scaling-strategy#trajectory-of-estimated-alignment-probability)
- [https://ai-2040.com/supplements/capability-scaling-strategy#top-toc](https://ai-2040.com/supplements/capability-scaling-strategy#top-toc)
- [I discuss](https://ai-2040.com/supplements/capability-scaling-strategy#high-level-strategy)
- [I discuss](https://ai-2040.com/supplements/capability-scaling-strategy#costs-of-taking-more-time-to-scale)
- [deal decline](https://ai-2040.com/supplements/deal-decline)
- [Stage 1](https://ai-2040.com/supplements/capability-scaling-strategy#stage-1-scale-to-max-controllable-ai)
- [Stage 2](https://ai-2040.com/supplements/capability-scaling-strategy#stage-2-slow-down-nearly-to-a-halt-then-eventually-hand-off-to-ais)
- [costs of going slowly](https://ai-2040.com/supplements/capability-scaling-strategy#costs-of-taking-more-time-to-scale)
- [deal decline](https://ai-2040.com/supplements/deal-decline#eli-lifland)
- [Scale until max-controllable-AI](https://ai-2040.com/supplements/capability-scaling-strategy#stage-1-scale-until-max-controllable-ai)
- [Slow down nearly to a halt, then eventually hand off to AIs](https://ai-2040.com/supplements/capability-scaling-strategy#stage-2-slow-down-nearly-to-a-halt-then-eventually-hand-off-to-ais)
- [stabilizing the deal.](https://ai-2040.com/supplements/deal-decline#eli-lifland)
- [max-controllable-AI](https://ai-2040.com/supplements/alignment-roadmap#appendix-capability-threshold-definitions)
- [deal declining](https://ai-2040.com/supplements/deal-decline)
- [covert projects](https://ai-2040.com/supplements/covert-ai-projects)
- [below](https://ai-2040.com/supplements/capability-scaling-strategy#concrete-case-study-of-possible-2040-handoff-decisions)
- [deal decline supplement](https://ai-2040.com/supplements/deal-decline)
- [covert projects](https://www.ai-2040.com/supplements/covert-ai-projects)
- [below](https://ai-2040.com/supplements/capability-scaling-strategy#stage-2-slow-down-nearly-to-a-halt-then-eventually-hand-off-to-ais)
- [training compute safety tax](https://ai-2040.com/supplements/comparing-possible-plans#training-compute-safety-tax-definition)
- [above](https://ai-2040.com/supplements/capability-scaling-strategy#costs-of-taking-more-time-to-scale)
- [epistemics](https://www.ai-2040.com/supplements/ai-for-epistemics)
- [The modeling](https://www.ai-2040.com/supplements/takeoff-supplement)
- [Plan A default trajectory](https://www.ai-2040.com/supplements/takeoff-supplement)
- [safety tax](https://ai-2040.com/supplements/comparing-possible-plans#training-compute-safety-tax-definition)
- [covert project](https://ai-2040.com/supplements/covert-ai-projects)
- [here](https://docs.google.com/spreadsheets/d/1MVdjISa09Y4qO3jT5eXYFz-s45gQm4NTXcZqEsFSowU/edit?gid=2143764324#gid=2143764324)
- [here](https://docs.google.com/spreadsheets/d/1MVdjISa09Y4qO3jT5eXYFz-s45gQm4NTXcZqEsFSowU/edit?gid=1504118452#gid=1504118452)
- [It seems like](https://docs.google.com/spreadsheets/d/1MVdjISa09Y4qO3jT5eXYFz-s45gQm4NTXcZqEsFSowU/edit?gid=1504118452#gid=1504118452)
- [below](https://ai-2040.com/supplements/capability-scaling-strategy#trajectory-of-estimated-alignment-probability)
- [Deal Decline supplement](https://ai-2040.com/supplements/deal-decline#likelihood-of-deal-decline)
- [Plan A default](https://www.ai-2040.com/supplements/takeoff-supplement)

---
