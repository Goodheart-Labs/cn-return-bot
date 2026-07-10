# Security in Plan A

**Path:** `/supplements/security-in-plan-a`

Security in Plan A
Romeo Dean, Thomas Larsen

Security is an area where expertise and access to classified information is particularly important for having an informed opinion. Nonetheless, this supplement provides a high-level overview of the security needed in Plan A in our best understanding, and why we think it is tractable.

We think it useful to think about three types of security, in increasing levels of difficulty from our point of view:

Model weights security: Defending the exfiltration of model weights, and other large datasets.

Metric we care about: Exfiltration bandwidth. I.e., how much can the attacker steal in a given amount of time?

Verification integrity security: Can we trust the results of our verification measures?

Metric we care about: Assurance level (the confidence-coverage curve explained in the verification supplement). I.e., how confident are we that the maximum unverified compute usage was less than X% (for values of X between 0 and 100%).

Algorithmic confidentiality: Defending the exfiltration of code, algorithmic secrets, and anything else that doesn’t classify as ‘large datasets’.

Metric we care about: We are unsure. On the one hand, we could think about algorithmic security in terms of exfiltration bandwidth as well, but algorithmic secrets might be tiny and have an unpredictable mapping from data size to usefulness. Therefore it’s probably best to think about the percentage of algorithmic efficiency that is exfiltrated and usable by the attacker.

Throughout this supplement, we assume an OC5 attacker per RAND’s definition, because in Plan A the US and China will be worried about each other being potential attackers.

Plan A security summary

In our scenario, we assume that SL5 security for model weights and to detect verification tampering is viable with extreme effort; this is our low confidence best guess. It may turn out to be impossible, in which case Plan A would need to be modified, which we discuss here.

The security level desirable in Plan A is as follows:

	

Model Weights

	

Algorithmic Secrets

	

Verification




Inference Datacenters

	

SL5-100TB-5y

(Maximum exfiltration of 100TB over 5y)

	

n/a

	

SL5

(increasing assurance over time as compute scales)




R&D Datacenters

	

SL5-100TB-5y

	

Depends on the transparency regime. In Total Research Transparency, most are intentionally transparent, small fraction SL5.

	

SL5

(increasing assurance over time with compute scale)

Model weights security

Goal: We think the goal for model weights security in Plan A requires that frontier model weights (and similarly large important datasets) cannot be exfiltrated and used by potential adversaries and/or covert projects.

Concretely, we think the goal should be to defend against around 100TB of exfiltration over 5 years. Which we define as: weights security level 5, for 100TB over 5 years, or SL5-100TB-5y for short. We don’t think this will be trivial, but we do think it is highly tractable.

The following figure shows the size we expect frontier models to be in Plan A (and we also expect other datasets to be of similar magnitude, since data and parameters should continue to trade off with each other in compute optimal scaling).

Frontier training compute, 2026 to 2040
Model sizeTraining compute
our training compute
Nesov (pretraining)
1e25
1e26
1e27
1e28
1e29
1e30
1e31
1e32
2022
2026
2029
2032
2035
2038
2040
FLOP per year
2026 anchor
2029 deal
GPT-4 ~2e25
Nesov 2.2e29
4.0e28
2.0e32
Plan A implementation

The inference data centers have SL-5 model weights security via defenses including:

They are surrounded by an information boundary, which is the datacenter walls, including a copper box (a faraday cage) preventing signals from coming in or out, except for one cable in and out of the datacenter, and a secure exchange chamber for other things that need to cross the perimeter.

For the output cable (which needs to exist, in order to communicate with the outside world), we make sure that the only information coming out of that wire is verified tokens produced by whitelisted models. You can read more in our verification supplement. This is also similar to the proposal in this paper.

For the other things that need to cross the boundary, power in, heat out, people in and out, we have further side channel mitigations and total bandwidth capping.

The R&D datacenters have two deliberate channels that allow information to leave the datacenter: (1) physically sending model weights to the inference datacenters, and (2) the fully transparent output channel used by researchers and for queries.

The transportation of the model weights to the inference datacenters. When a model is approved for public deployment, a package including the weights file, and any approved inference code (e.g., control scaffolds) gets downloaded on devices encrypted (sequentially) by both the US and China and physically escorted by both sides to inference clusters. At the inference clusters, they are added to the inference whitelist to allow for inference verification on public deployment.

The transparent output channel caps the total bandwidth coming off the datacenter at 1 MB/s, which means that over a 5 year period, 157 TB leave the datacenter. This is enough to let 50,000 people continuously read outputs at around 10 tokens / second (which might have thousands of corresponding internal chain of thought / scaffold tokens that don’t need to be outputted). Model weights of a current frontier model are currently on the order of 1T parameters (which corresponds to 1TB), so exfiltrating model weights via this channel would require hijacking .6% of the (fully transparent) output channel continuously for 5 years (or a larger fraction for a smaller duration of time), which would very likely be noticed. In Plan A, with compute scaling favoured over algorithmic progress, we expect the model weights of frontier models to become closer to 100T parameters, so a full exfiltration would require a continuous 60% of the output bandwidth for 5 years, ignoring compressibility which shouldn’t be a huge factor. There are additional layers of defense against model weight exfiltration within the datacenter: notably, we attempt to keep model weights on the opaque internal database.

The remaining threat models involve side channel attacks (such as staff members carrying small flash drives), and we don’t have a creative solution here: access to all of the data centers is tightly controlled, and well-funded, creative security teams are constantly red teaming and hardening the facilities. It also helps that the datacenters in Plan A are built from scratch in areas with low background radiofrequency (RF) noise with security top of mind.

Finally, the model weights also need to be regularly transported between the R&D datacenters (where they are trained) and the inference datacenters. We imagine that this could happen by transporting the model weights using several physical storage devices that are locked and continuously monitored by representatives of both the US and China for the entire duration of the transportation.

Verification integrity

Goal: The goal for verification integrity should be to achieve a desirable assurance curve: The assurance curve captures information about the level of coverage (the % of the AI compute that the verification solution makes claims about) and confidence (with what probability is the verification solution correct about the claims it makes on the covered resources). We define an assurance curve as a set of relevant (coverage, confidence) values.

For example, with the middle curve, there is 99.99% confidence that 99.9% of the compute was verified to have been used correctly. Of course, such curves are theoretical and will be hard to measure, but conceptually we think its useful to think about the verification integrity goal in terms of this curve.

We think that the verification integrity goal should compare the risk incurred from verification integrity subversions (i.e., internal rogue compute uses) to external ongoing risk from other sources of rogue compute usage, i.e., covert projects, and aim for the possible internal rogue compute uses to be negligible in terms of additional risk vs. the external uses. Since internal rogue compute might have access to the opaque internal information (frontier weights, datasets and potentially some defended algorithms/code depending on the transparency regime) it is potentially much riskier than an equivalent amount of external covert project compute usage. A good approximation of ‘how much riskier’ might be to consider the gap in algorithmic efficiency available inside the R&D datacenters vs. in the potential covert projects.

Concretely, we think we should take something like the 90th percentile estimate of covert project effective compute (in terms of the frontier project’s current software level, so it's scaled to be comparable to internal compute use), and then set the verification integrity target such that we are 90% confident that the coverage of internal compute usage is at the level X (e.g., X=99.999% of the internal compute) such that the potential rogue internal compute (1-X) would be 10x smaller than the covert project’s effective compute. This basically would be like saying “we are 90% confident that rogue internal deployments would be about equivalent to a 10x smaller covert project than what we think might exist.”

Plan A implementation

Verification in both R&D and inference datacenters needs to be mutually trusted by the US and China, so that they are both confident only the approved training runs, experiments, and inference workloads are running. In our concrete proposal, inference and R&D verification both rely mostly on network taps for evidence collection and trusted recomputation servers for verification. In order to have durable trust in this verification solution, these devices should be mutually trusted (or alternatively, trusted optical splitters and unilaterally trusted devices). There also needs to be physical security to check these devices don’t get tampered with or modified, and trust in the software stack they build on top of them (which probably means it should be extremely simple, and maybe even formally verified).

Outside of the verification devices themselves, verification will also rely on wider security properties of the cluster that overlap with model weights security. For example, there not being side channels that could let an attacker smuggle out the results of rogue internal computations.

Over time, the verification assurance will need to improve drastically with the scale of compute. We discuss this in more detail in our verification supplement.

Algorithmic security

Goal: This depends on the transparency regime that we are aiming for, which is discussed in our transparency supplement.

More concerned about
poor regulation
More concerned about
covert projects
Proposal #1:
Radical Transparency
Proposal #2:
Filtered Transparency
Proposal #3:
Algorithmic Security
Transparency proposals spectrum - ai-2040.com
Plan A: Total Research Transparency

To a first approximation, there will no longer be any algorithmic secrets in AI under the Total Research Transparency version of Plan A. There are a few exceptions:

Massive (potentially synthetic) datasets have similar properties to model weights (in particular, are very large), and so it is viable to limit their output via upload limits out of the R&D datacenter. This isn’t sufficient for preventing the exfiltration of any given data; but could prevent the exfiltration of most data. Data progress is a substantial fraction of overall algorithmic progress, and so securing data might be both tractable and important.

Hyperparameters found via computationally intensive procedures. For some hyperparameters, efficient settings for them are found via expensive procedures like sweeps over the possible values, and then tests for the training run. These values are small, but do not have to be known by any human. The code for selecting these hyperparameters can be transparent, but we can prevent anyone from knowing the value that running the code found, because it is computationally expensive to determine the value.

### Additional content revealed by tabs / alternate choices

- Frontier model size, 2022 to 2040
- reported
- ours (α=0.5)
- α ∈ [0.2, 0.8]
- Nesov
- 1
- 10
- 100
- 1k
- 10k
- 100k
- 1M
- Trillion parameters
- GPT-4 ~1.8T
- α=0.8
- α=0.2
- ~650T (Nesov)
- 31,000T
- ~158T

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
- [https://ai-2040.com/supplements/security-in-plan-a#plan-a-security-summary](https://ai-2040.com/supplements/security-in-plan-a#plan-a-security-summary)
- [Plan A security summary](https://ai-2040.com/supplements/security-in-plan-a#plan-a-security-summary)
- [https://ai-2040.com/supplements/security-in-plan-a#model-weights-security](https://ai-2040.com/supplements/security-in-plan-a#model-weights-security)
- [Model weights security](https://ai-2040.com/supplements/security-in-plan-a#model-weights-security)
- [https://ai-2040.com/supplements/security-in-plan-a#plan-a-implementation](https://ai-2040.com/supplements/security-in-plan-a#plan-a-implementation)
- [Plan A implementation](https://ai-2040.com/supplements/security-in-plan-a#plan-a-implementation)
- [https://ai-2040.com/supplements/security-in-plan-a#verification-integrity](https://ai-2040.com/supplements/security-in-plan-a#verification-integrity)
- [Verification integrity](https://ai-2040.com/supplements/security-in-plan-a#verification-integrity)
- [https://ai-2040.com/supplements/security-in-plan-a#algorithmic-security](https://ai-2040.com/supplements/security-in-plan-a#algorithmic-security)
- [Algorithmic security](https://ai-2040.com/supplements/security-in-plan-a#algorithmic-security)
- [https://ai-2040.com/supplements/security-in-plan-a#plan-a-total-research-transparency](https://ai-2040.com/supplements/security-in-plan-a#plan-a-total-research-transparency)
- [Plan A: Total Research Transparency](https://ai-2040.com/supplements/security-in-plan-a#plan-a-total-research-transparency)
- [OC5 attacker](https://www.rand.org/pubs/research_reports/RRA2849-1.html)
- [https://ai-2040.com/supplements/security-in-plan-a#top-toc](https://ai-2040.com/supplements/security-in-plan-a#top-toc)
- [here](https://ai-2040.com/supplements/plan-a-assumptions#less-central-updates)
- [verification supplement](https://www.ai-2040.com/supplements/verification-plan)
- [this paper](https://arxiv.org/abs/2511.02620)
- [optical splitters and unilaterally trusted devices](https://nacicankaya.substack.com/p/catching-misreporting-about-ml-hardware-bd2)
- [transparency supplement](https://www.ai-2040.com/supplements/transparency-plan)
- [optimal compute-optimal curve](https://arxiv.org/abs/2203.15556)
- [huffman encoding](https://en.wikipedia.org/wiki/Huffman_coding)
- [https://arxiv.org/abs/2210.17323](https://arxiv.org/abs/2210.17323)
- [GPTQ](https://arxiv.org/abs/2210.17323)
- [https://arxiv.org/abs/2306.00978](https://arxiv.org/abs/2306.00978)
- [AWQ](https://arxiv.org/abs/2306.00978)
- [https://arxiv.org/abs/2211.10438](https://arxiv.org/abs/2211.10438)
- [SmoothQuant](https://arxiv.org/abs/2211.10438)
- [https://arxiv.org/abs/2402.04396](https://arxiv.org/abs/2402.04396)
- [QuIP#](https://arxiv.org/abs/2402.04396)
- [https://arxiv.org/abs/2401.06118](https://arxiv.org/abs/2401.06118)
- [AQLM](https://arxiv.org/abs/2401.06118)
- [https://arxiv.org/abs/2106.09685](https://arxiv.org/abs/2106.09685)
- [LoRA](https://arxiv.org/abs/2106.09685)
- [https://arxiv.org/abs/2305.14314](https://arxiv.org/abs/2305.14314)
- [QLoRA](https://arxiv.org/abs/2305.14314)
- [https://arxiv.org/abs/2310.11454](https://arxiv.org/abs/2310.11454)
- [VeRA](https://arxiv.org/abs/2310.11454)
- [https://arxiv.org/abs/2402.09353](https://arxiv.org/abs/2402.09353)
- [DoRA](https://arxiv.org/abs/2402.09353)
- [https://arxiv.org/abs/2303.10512](https://arxiv.org/abs/2303.10512)
- [AdaLoRA](https://arxiv.org/abs/2303.10512)

---
