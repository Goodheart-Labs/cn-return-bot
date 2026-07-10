# Takeoff Supplement

**Path:** `/supplements/takeoff-supplement`

Takeoff Supplement
Brendan Halstead

This supplement explains how we forecast AI capabilities in various parts of Plan A. We modified the AI Futures Model to simulate four situations:

the default trajectory, if there had been no deal to slow down capabilities progress,

the Plan A consortium trajectory, which scales to TED-AI in a controlled manner, then halts to do alignment research,

a covert project defecting from the deal and trying to build AGI in secret, and

the trajectory after deal dissolution, where most of the post-deal compute is destroyed and the leading project resumes racing.

The rest of this document is structured accordingly. Section 1 covers the differences between the Plan A model and the December 2025 AI Futures Model: a major change to training run modeling, our updated compute forecasts, and the changes to the default parameters. In sections 2 through 4, we explain the various extensions added on to simulate the three additional situations. If you haven’t read the AI Futures Model documentation, we recommend reading it here first.

Modifications to the core model

Here we describe the three ways this model differs from the December 2025 AI Futures Model. These apply across all trajectories simulated.

Explicit modeling of the frontier training run

Like most other AI takeoff models, the AI Futures Model (December 2025 version) defined effective training compute 
𝐸
(
𝑡
)
E(t) at a given time as the cumulative training compute 
𝐶
(
𝑡
)
C(t) of the frontier model (in FLOP) times the software efficiency level 
𝑆
(
𝑡
)
S(t) at that time (in present-day-FLOP per FLOP):

𝐸
(
𝑡
)
=
𝐶
(
𝑡
)
⋅
𝑆
(
𝑡
)
.
E(t)=C(t)⋅S(t).

In reality, training runs take time, and the formulation above assumes that today’s software efficiency applies retroactively to the training run for the model that’s already in use. One consequence is slightly overestimating how fast takeoff can proceed. But more importantly for Plan A, this model gives us no good way of dealing with situations where the training system performance (in FLOP/yr) of an AI project suddenly becomes very small compared to the system that was used to train the best model available to that project (as is the case for covert projects and after deal dissolution).

In the Plan A version, we instead model effective training compute as increasing continuously as part of one long training run, at a rate determined by the training system performance 
𝑇
(
𝑡
)
T(t) and the software efficiency of the known training methods:

𝐸
′
(
𝑡
)
=
𝑇
(
𝑡
)
⋅
𝑆
(
𝑡
)
.
E
′
(t)=T(t)⋅S(t).

We call this rate the effective training system performance and abbreviate it as ETSP.

When all inputs grow exponentially, ETSP and effective compute also grow exponentially at the same rate, so this model behaves like the simpler one. All other equations are unchanged from the December 2025 AI Futures Model.

Changes to the compute and labor time series

The AI Futures Model depends on exogenously-supplied forecasts of compute and labor. The Plan A version uses two sets of time series: one representing the default world if Plan A had not been implemented, and one that branches off from the default when the deal comes into effect. The modeling behind both of these is discussed in our Compute Supplement. In summary,

The default time series before 2029 has been updated to be slightly more bullish compared to that in the AI Futures Model

The Plan A time series from 2030 to 2035 reflects the controlled-but-massive compute buildout enabled by robotics, then slows down from 2035 to 2040.

One limitation is that the human labor projections are not very realistic; we did not put much effort into these because human labor plays a very small role in the model dynamics after AI R&D is automated.

Changes to the default parameters

The default parameters governing timelines and takeoff in the scenario were set to reflect scenario first-author Thomas Larsen’s views. However, since capabilities forecasting was not the main focus of AI 2040, they do not reflect as much consideration as do the values used in the AI Futures Model, and were sometimes adjusted ad-hoc as the scenario narrative and modeling were being written concurrently. Nevertheless, they deviate only slightly from Daniel Kokotajlo’s median values as of April 2026, and all authors find the default trajectory entirely plausible. Below we include a table describing each parameter that was changed from Daniel’s median.

Parameter

	

Change

	

Rationale




Gap years

	

1.1 2025-effective-flop-growth

	

Set to achieve the AC milestone at Jan 2030.




Time horizon required for AC (before gap)

	

10 work years




Median-to-top taste multiplier

	

5.28x

	

Set to reach ASI roughly one year after AC, while leaving ~3 OOMs of effective compute between AC and TED-AI.




AI research taste slope

	

3.5 SDs per 2025-effective-flop-growth




Median-to-top-human jumps above SAR needed to reach TED-AI

	

1.5

Modeling the consortium trajectory

Unlike all other actors we model, the consortium is not racing to build better AIs as fast as they possibly can. The specific strategies are discussed in more detail in the Capabilities Scaling Strategy supplement, but at a high level, the strategy is to scale smoothly to Top-Expert-Dominating AI (TED-AI), then pause to do alignment research before eventually handing over control to AIs.

Here, we consider strategies that vary along two axes:

How far into the deal consortium aims to reach Top-Expert-Dominating AI (TED-AI), and

How much of a safety tax the consortium aims to be paying when TED-AI is reached.

The safety tax is the difference between the capability level of the actual consortium AI and the capability level of the best AI the consortium could have trained, had they used all their training compute and the best-known algorithms for capabilities training. One example of “paying a safety tax” would be discovering neuralese training, finding that it would be much more efficient, but deciding not to use it to make control easier. We expect that in reality the consortium would want to pay some safety tax.

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

The rough shape of the consortium’s capabilities trajectory: a brief halt, then smooth scaling, then a long near-pause before handoff.

The consortium trajectory is simulated according to slightly different rules during each of the following stages.

Stage 0: AI Training Pause

This phase starts some number of years before AC would have happened on the default path. (In the scenario, about 9 months before). Though effective compute is forced to stay flat (training is paused!), training system performance can still increase as the leading company within the consortium ends up with more compute at the end of the period.

AI R&D is also essentially paused during Phase 0. However, we model the software efficiency of the leading actor within the consortium as growing by a set number of OOMs during this period. This is because of Total Research Transparency: by the time scaling resumes at the end of Phase 0, essentially company IP is public. We expect the companies to have made non-overlapping software discoveries prior to the deal; hence pooling the intellectual property will increase software efficiency at the frontier.

Stage 1: Scale to max-controllable AI

During this phase, effective compute increases with effective training system performance via the usual 
𝐸
′
=
𝑇
⋅
𝑆
E
′
=T⋅S. TSP grows via the exogenously-supplied Plan A time series, and software efficiency growth is carefully controlled in order to reach TED-AI at a particular time. We assume a mandatory minimum amount of software progress is required per OOM of TSP increase.

To keep track of the safety tax paid at each point, we actually simulate two different trajectories:

One represents the legal project’s realizable capabilities. This trajectory aims to maintain the (constant) software progress rate that achieves TED-AI plus the desired safety tax amount at the target time.

One represents the legal project’s realized capabilities. This trajectory aims to maintain the (constant) software progress rate that reaches TED-AI at the same time that realizable capabilities reach TED-AI+tax.

At each timestep the trajectories moderate their research effort from the theoretical maximum, choosing instead the value which brings them closest to the pre-selected software progress path.

Upper and lower limits imposed on software progress

Stage 2: Slow down nearly to a halt, then eventually hand off to AIs

For simplicity, we model this stage as a literal halt for the consortium’s realized capabilities. In reality, we expect them to slow down more smoothly, then continue increasing very slowly as control techniques improve and the threshold for “max-controllable AI” inches upward.

The consortium’s realizable capabilities continue increasing however. TSP growth slows down but continues. As for software efficiency growth, we specify a constant rate of software progress in OOMs per year to represent the capabilities externalities incurred by the huge amounts of alignment research that happen during stage 2. (As an example, dramatic advances in mechanistic interpretability, while promising for alignment, could plausibly also enable much more efficient training methods.)

Since the realized capabilities effectively halt while the realizable capabilities continue growing, the safety tax paid increases dramatically during this period.

In reality, the consortium will choose to hand off to AIs at some point (in our scenario, it happens roughly five years into Stage 2). We do not currently model handoff explicitly however, because none of our analyses depend significantly on the dynamics after handoff. This is why the consortium capabilities line remains flat indefinitely in the explorer, rather than eventually jumping up as we would expect after handoff.

Modeling covert projects

At the moment that AI training is paused (Stage 0), the covert project is assumed to start with the following resources:

A total R&D compute budget equal to some fraction of the leading company’s R&D compute. We assume the covert project allocates between training, experiments, and internal inference in the same proportions as the leading lab did.

An engineering labor force equal to that same fraction of the leading lab’s labor force,

AI capabilities, software efficiency, and research stock matching those of the pre-deal leading company.

We also assume that the covert project’s supply of compute and labor stays constant over time. Finally, we assume that the covert project cannot begin training or R&D for some period during which covert datacenters are being constructed.

With only these factors considered, our modeling indicates that covert projects would probably progress quite slowly. In the median case, each OOM of R&D compute reduction (compared to the leading lab at the start of the deal) would cause the covert project to take over 6x as long to reach TED-AI than would the leading lab.

However, we also assume that the covert project is uplifted to some degree by consortium AI progress. The primary factor, and the only one we model explicitly, is the leakage of software improvements from the consortium to the covert project. To account for this, we include a parameter for the fraction of the consortium’s software progress rate that gets added on to the covert project’s indigenous software progress rate. We conservatively assume covert projects will make full use of any algorithms discovered by the consortium, even those deemed potentially dangerous, so we take the realizable software efficiency growth rate as the quantity to steal from rather than the realized software efficiency growth rate.

Due to software proliferation, the consortium’s scaling strategy is extremely important to the covert project’s ability to catch up. The less software progress the consortium needs to make to reach TED-AI at the desired time, the less the covert project is uplifted. As a result, accepting a longer scaling duration that requires less software progress increases the consortium’s ETSP lead at TED-AI, and typically also increases the time between the consortium reaching TED-AI and the covert project reaching TED-AI.

Modeling deal dissolution

The modeling of deal dissolution is relatively simple.

The effectiveness of mutually assured compute destruction is represented by the fraction of world compute available to the new leading project at the time of dissolution.

We also include a parameter for the growth rate of R&D compute after the deal dissolves, representing the output of any non-destroyed or newly-constructed fabs.

As with covert projects, we technically assume that human R&D labor varies in proportion to compute. Though this might be unrealistic, the effect of human labor is essentially negligible after AC.

The post-dissolution leading project starts with the frontier model weights (from the realized consortium trajectory) and all discovered software improvements (from the realizable consortium trajectory) from before the deal dissolved.

We assume that the leading project after a deal dissolves proceeds at full speed, as in the default trajectory.

### Additional content revealed by tabs / alternate choices

- If the chosen scaling duration and takeoff parameters demand faster software progress than would be naturally possible at a given point, the research effort may not be moderated at all. Often, once AI capability level increases enough, the consortium is able to catch up to the desired software path. Occasionally, the consortium may not be capable of reaching TED-AI by the desired time, e.g. in worlds where reaching TED-AI from the pause level would naturally have taken ten years but where the consortium attempts to reach it in just one.
- Conversely, a sufficiently long scaling period or a sufficiently narrow effective compute gap from the pause level to TED-AI can mean that hardware scaling alone (plus the mandatory minimum software growth rate) would reach TED-AI before the target year. In this case, the consortium simply reaches TED-AI early.

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
- [https://ai-2040.com/supplements/takeoff-supplement#modifications-to-the-core-model](https://ai-2040.com/supplements/takeoff-supplement#modifications-to-the-core-model)
- [Modifications](https://ai-2040.com/supplements/takeoff-supplement#modifications-to-the-core-model)
- [https://ai-2040.com/supplements/takeoff-supplement#explicit-modeling-of-the-frontier-training-run](https://ai-2040.com/supplements/takeoff-supplement#explicit-modeling-of-the-frontier-training-run)
- [Explicit modeling of the frontier training run](https://ai-2040.com/supplements/takeoff-supplement#explicit-modeling-of-the-frontier-training-run)
- [https://ai-2040.com/supplements/takeoff-supplement#changes-to-the-compute-and-labor-time-series](https://ai-2040.com/supplements/takeoff-supplement#changes-to-the-compute-and-labor-time-series)
- [Changes to the compute and labor time series](https://ai-2040.com/supplements/takeoff-supplement#changes-to-the-compute-and-labor-time-series)
- [https://ai-2040.com/supplements/takeoff-supplement#changes-to-the-default-parameters](https://ai-2040.com/supplements/takeoff-supplement#changes-to-the-default-parameters)
- [Changes to the default parameters](https://ai-2040.com/supplements/takeoff-supplement#changes-to-the-default-parameters)
- [https://ai-2040.com/supplements/takeoff-supplement#modeling-the-consortium-trajectory](https://ai-2040.com/supplements/takeoff-supplement#modeling-the-consortium-trajectory)
- [Modeling the consortium trajectory](https://ai-2040.com/supplements/takeoff-supplement#modeling-the-consortium-trajectory)
- [https://ai-2040.com/supplements/takeoff-supplement#modeling-covert-projects](https://ai-2040.com/supplements/takeoff-supplement#modeling-covert-projects)
- [Modeling covert projects](https://ai-2040.com/supplements/takeoff-supplement#modeling-covert-projects)
- [https://ai-2040.com/supplements/takeoff-supplement#modeling-deal-dissolution](https://ai-2040.com/supplements/takeoff-supplement#modeling-deal-dissolution)
- [Modeling deal dissolution](https://ai-2040.com/supplements/takeoff-supplement#modeling-deal-dissolution)
- [covert project](https://ai-2040.com/supplements/covert-ai-projects)
- [deal dissolution](https://ai-2040.com/supplements/deal-decline)
- [here](https://www.aifuturesmodel.com/)
- [https://ai-2040.com/supplements/takeoff-supplement#top-toc](https://ai-2040.com/supplements/takeoff-supplement#top-toc)
- [slightly overestimating](https://www.forethought.org/research/will-the-need-to-retrain-ai-models)
- [Compute Supplement](https://www.ai-2040.com/supplements/compute-supplement)
- [Stage 1: Scale to max-controllable AI](https://www.ai-2040.com/supplements/capability-scaling-strategy#stage-1-scale-to-max-controllable-ai)
- [Stage 2: Slow down nearly to a halt, then eventually hand off to AIs](https://www.ai-2040.com/supplements/capability-scaling-strategy#stage-2-slow-down-nearly-to-a-halt-then-eventually-hand-off-to-ais)
- [Stage 0](https://ai-2040.com/supplements/takeoff-supplement#id.vl6mrc27nrwz)
- [In the median case, each OOM of R&D compute reduction (compared to the leading lab at the start of the deal) would cause the covert project to take over 6x as long to reach TED-AI than would the leading lab.](https://www.lesswrong.com/posts/7jcPg79p3kD5ir3CL/how-much-slower-does-takeoff-go-with-10-less-compute)
- [mutually assured compute destruction](https://ai-2040.com/supplements/deal-decline#mutually-assured-compute-destruction-destroying-compute-fabs-and-robots)
- [Verification Plan](https://www.ai-2040.com/supplements/verification-plan)

---
