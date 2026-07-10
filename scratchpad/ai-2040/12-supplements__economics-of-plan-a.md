# Economics of Plan A

**Path:** `/supplements/economics-of-plan-a`

Economics of Plan A
Romeo Dean, Thomas Larsen

We project that AIs will, at some point in the next 15 years, be capable of automating all human labor: both physical and cognitive. We believe that this will have extraordinary economic impacts, causing output to grow explosively at a historically unprecedented rate (barring an AI-caused catastrophe). Most of our view comes from simple arguments about the future of AI. However, over the course of our thinking, we also found it useful to make a detailed economic model. This document is organized into the following sections:

Core arguments behind our views on explosive growth from AI (link)

Why we disagree with mainstream economists (link)

A simple two-factor explorer that shows the core dynamics (link)

A summary of the outputs from our full economic model in the context of Plan A (link)

The core disagreement between us and most economists is our different expectations for AI capabilities. We believe that AIs will be able to fully automate all economically relevant work (in a median of ~6 years), while most economists believe that AIs will behave more like normal technology. We’ve already made many arguments about AGI timelines elsewhere, so this post centrally argues for why, conditional on AI that can automate all economically relevant tasks, we expect unprecedented explosive economic growth.

Core arguments for explosive growth

Right now, the size of the economy is closely tied to human labor, so if the population were to grow massively, this would cause nearly proportional growth in total output. Once AIs can perfectly substitute for human labor, increasing the number of AIs would have the same effect as increasing human population. At least if you exclude tasks that are intrinsically human, but we don’t expect these to be a large share of the economically relevant tasks. For example, human-preference driven tasks the AI can’t substitute for like ‘human babysitting’ should not preclude an AI and robot-only economy from growing in a closed loop (bounded only by bottlenecks that we expect to not bite strongly).

In fact, this undersells the likely effects because in reality, AIs won’t just be increasing in population, but also in qualitative ability leading to outputs that wouldn’t have been feasible to produce with humans. This is because, shortly after being able to substitute for human labor, AIs will become qualitatively superhuman. However, improvements to intelligence are harder to model quantitatively than increases in population, so we’ll settle for establishing a population-based lower bound by ignoring qualitative improvements.

So how fast will the “population” of AIs and robots be growing at the point of full automation? We need to do separate analyses here for physical and cognitive labor, because the underlying dynamics driving the growth rates are quite different.

Cognitive Labor: a doubling time of roughly 50 days. The total cognitive labor from AI depends on total inference compute and the compute efficiency of the AIs. The simplest way of making a baseline guess here is to look at historical rates for each of these.

Total AI inference compute: 3.3x/year, 7 month doubling time. Epoch estimates that the total compute in the world has been doubling every 7 months. In the future, we think there are reasons for this to slow down (it’s already requiring 2-3% of GDP investment in the US, so doubling a few more times seems hard), but also reasons for it to speed up at the point of full automation (e.g., future AIs automating chip R&D, and robots automating the AI chip supply chain).

Compute efficiency on achieved capabilities: 30x/year, 2.5 month doubling time. Epoch estimates that the price of a given level of AI capability decreases by an average of 40x/yr (which is equivalent to halving every 2.2 months). Assuming hardware price performance has been improving 1.4x/yr and margins have been flat, this gives a trend of 30x/year improvement in compute efficiency. When the cost of AI inference halves, this is at least as economically beneficial as the population of AIs doubling, because we can run twice as many AIs.

Putting these together, this means that the population of AIs today at a fixed capability level could increase at a rate of 100x/year, which is a 55 day doubling time.

Physical Labor: a doubling time of a few days to a year. For physical labor, we can reason directly about the number of robots in the world. At the moment, Epoch finds that the number of robots is dominated by wheeled robots, drones and robotic arms, and these are not scaling very quickly.

Right now, these robots are not capable of performing all tasks in the robot manufacturing process (including mining raw materials, transportation, and every step of the supply chain). However, once robots reach this capability threshold then there’s a clear reason to expect exponential growth in the number of robots: the rate of new robot construction will be approximately proportional to the number of robots in existence (barring raw material bottlenecks that we address below). But how fast of an exponential? We walk through our reasoning below, and also have a review of the doubling-times literature in Appendix A.

Why wouldn’t robots plateau like other products? Right now, robots and AI compute are both doubling faster than once per year. On its own this is not strong evidence of anything: many new products grow this fast at first, and then plateau once they saturate their addressable market. We expect robots to be different, because once AI and robots can perform every task in their own supply chain, the two things that normally end fast growth stop applying:

No demand ceiling. Robots and AIs are productive assets, not consumer goods. As long as an extra robot produces more value than it costs to build, there is an incentive to keep building them, past the point where the robot population exceeds the human population and far beyond it.

No human bottleneck on supply. Today’s production growth is partly borrowed from human labor (factory workers, miners, truck drivers, engineers). At full automation the robot economy doesn’t need humans to buy anything, build anything, or deliver ingredients to its factories, so the size of the human population stops being a constraint on how big it can get.

The ceiling that does eventually bind is physical resources: surface area for solar panels, minerals in the earth’s crust to mine. But by our estimates those bottlenecks bite very late, after many orders of magnitude of growth (see the bottlenecks section below).

That leaves the question of the growth rate in between. A reasonable worry is that today’s doubling rates are inflated by human help, and that growth slows once the robot economy has to do essentially everything itself. We don’t think this changes the bottom line: analyses of what a fully automated economy could achieve with current technology and no further improvement, e.g. Binder’s von Neumann growth rate calculation from US input-output tables, capital stocks, and depreciation data, land at around one doubling per year, conservatively. An intuition pump: a modern car factory produces roughly its own weight in cars every year. And a year is likely an underestimate of the long-run pace, because superhuman AI R&D should keep improving robot designs, and biology shows much faster replication is physically possible (e.g., animals like rabbits can double their population in 6 weeks, bacteria in hours). This is why we quote doubling times between a few days and a year, with the fast end becoming more plausible over time.

Overall, our argument can be summarized as:

AI and robots will be capable of fully automating all economically relevant tasks.

Therefore, the AI-robot economy will be capable of autonomously self-replicating (building more efficient AIs, building more robots, building more GPUs, etc.).

The replication rate will be fast: around one doubling per year even with current technology and no human help, and rising over time as AI R&D improves robot designs.

Therefore, the AI-robot economy will undergo rapid exponential growth, with a doubling time of a year at the slow end and plausibly months or days, until physical resource limits bite (very late, on our estimates).

Even if the true growth rate is much slower than this baseline predicts in the future, the effective AI population seems very likely to rapidly outgrow the total number of humans. Once AIs dominate the number of humans, if their population is (conservatively) increasing at 2x per year, this would involve ~100%/yr growth, whereas current growth is ~3%/yr.

Why we disagree with mainstream economists

Most mainstream economists are skeptical of explosive economic growth from AI. Even conditional on a “rapid AI progress scenario”, economists predicted an average of 3.5%/yr GDP growth between 2030 and 2050.

One core disagreement between us and mainstream economists tends to be about how capable AIs will be. We believe that AI's ability to do tasks in the economy will look something like the red curve below absent strong regulations. This reflects AI dominating humans at all tasks and achieving 100% automation around 2031 (top expert dominating milestone), which is close to the authors' median expectations. We find that economists tend to have much lower expectations for automation in the coming decades.

Share automatable
0%
25%
50%
75%
100%
2025
2026
2027
2028
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
2040
AI 2040 Default World
AI 2040 Plan A
Acemoglu: ~5% “cost-effectively automatable” (2024)
Goldman Sachs: ~25% “substitutable” (2023)

Note: Acemoglu and Goldman Sachs projections are not necessarily directly comparable, as their definitions for "cost-effectively automatable" and "substitutable" may diverge somewhat from our automatable definition.

Automatable tasks: AI 2040 scenarios vs prior forecasts - ai-2040.com

In Plan A, strong regulations (coordinated internationally) are sufficient to slow this down, but still lead to ~99% automation in the late 2030s, as regulation only preserves critical AI oversight jobs (where humans are still significantly uplifted by AI). We believe that AI's capabilities will be so high that lower automation levels (e.g., due to wanting to preserve more human jobs) will be extremely uncompetitive (and thus be quickly competed away), with preferences for human-to-human interactions being (1) supplemented by more leisure, and (2) insufficient to push human wages high enough relative to the citizen's dividend to attract much labor.

Acemoglu (2024): too few tasks automated by AI

Acemoglu (2024) (also critiqued here by Leopold Aschenbrenner) assumes only ~5% of tasks in the next 10 years will be cost-effectively automatable by AI. Acemoglu’s overall estimate was that AI would increase GDP by 0.9% over the next 10 years (which is approximately a 0.08% increase in GDP annually). We think Acemoglu’s view from 2024 is already close to falsified based on current AI investment and AI revenue numbers.

Early evidence against Acemoglu (2024)

AI investment contributed around 1% to GDP growth in the first half of 2025 alone (JP Morgan, EY), whereas Acemoglu predicted .9% growth over the course of 10 years.

Even at the scale of AI revenues, over the course of the last six months, Anthropic’s revenue run rate alone has increased by $38B from $9B to $47B. We think this will plausibly beat the rate of increased growth per year (0.08% of US GDP) of ~$30B that Acemoglu predicted for the entire AI industry. Note: Anthropic's contribution to GDP is difficult to disentangle, but should count employee compensation + operating surplus + depreciation costs, which we think is on track to be above $30B this year.

The only ways Acemoglu’s predictions will hold up are if (1) AI revenue and investment growth essentially stops, or (2) AI investment and revenues are not counterfactual (the spending and revenue would’ve happened elsewhere anyway). Both seem unlikely.

Jones & Tonetti (2026): slow AI automation of R&D

Jones & Tonetti (2026), Past Automation and Future A.I.: How Weak Links Tame the Growth Explosion features an elegant growth model combining capital and labor. They grant that capital may eventually automate every task, but their argument is that because tasks are strong complements (they assume an elasticity of substitution 
𝜎
=
0.2
σ=0.2), the shrinking set of tasks machines cannot yet do becomes a 'weak link' whose cost share rises (Baumol's cost disease) and strongly bottlenecks growth. Our biggest disagreement with this model is that we think the R&D automation loop is very conservative, with the model assuming:

Fixed R&D investment and research productivity. In the Jones model R&D works through "ideas accumulation" with capital productivity 
𝜓
𝑘
𝑖
ψ
ki
	​

 changing with a fixed "idea elasticity of capital" 
𝜃
𝑘
θ
k
	​

, a fixed "research productivity" 
𝑞
ˉ
q
ˉ
	​

, and a fixed share 
𝜄
ˉ
𝑅
ι
ˉ
R
	​

 of output 
𝑌
Y being invested in R&D (with diminishing returns per ideas getting harder to find).

𝜓
˙
𝑘
𝑖
𝜓
𝑘
𝑖
	
=
𝜃
𝑘
𝑞
ˉ
 
𝜄
ˉ
𝑅
 
𝑌
𝑄
 
1
−
𝜙
,
ψ
ki
	​

ψ
˙
	​

ki
	​

	​

	​

=θ
k
	​

Q
1−ϕ
q
ˉ
	​

ι
ˉ
R
	​

Y
	​

,
	​


We think this formulation systematically underestimates the effect that AI will have on R&D, because AI will be able to automate R&D labor (particularly AI R&D itself), so ideas and productivity growth should track some notion of total R&D effort accounting for this AI uplift. We think the AI field will have its own feedback loop of R&D automation, leading to higher research productivity and higher reinvestment into R&D, ultimately leading to much higher capital productivity for AI capital.

No unique treatment of AI capital. In the Jones model, there is no unique treatment of AI. AI enters as normal capital and accumulates through the classic investment less depreciation rule 
𝐾
˙
=
𝜄
ˉ
𝐾
 
𝑌
−
𝛿
𝐾
K
˙
=
ι
ˉ
K
	​

Y−δK with fixed investment share 
𝜄
ˉ
𝐾
ι
ˉ
K
	​

 and depreciation rate 
𝛿
δ. We think AI would be worth modelling on its own, because we think its task productivity and investment attractiveness will grow over time, and also have a different responsiveness to more investment and different responsiveness to R&D (e.g., algorithmic progress on the orders of 10x/year instead of Moore's law 1.35x/yr). In other words, we think the "idea elasticity of AI", "research productivity of AI" and "share of output being invested in AI R&D" will all behave very differently to how they behave for other capital, leading to AI's effects being drastically underestimated by being bundled with the capital factor of production.

Jones & Tonetti Model Explanation

Jones & Tonetti's "Moore's Law Everywhere" calibration has 
Φ
=
2.27
Φ=2.27 (see box above for what this means) leading output to go infinite around 2060. Our main disagreement is not with this calibration, but with the lack of R&D automation and lack of unique treatment of AI capital (e.g., different in returns to R&D in AI vs. normal capital).

AI Futures Model

The AI Futures Model features a tighter R&D automation loop, with combined AI-human research effort feeding into AI R&D (still with diminishing returns). We think some kind of similar treatment of AI, with modelling that is calibrated to how quickly AI has been improving and responding to increased inputs (human labor, compute, etc.) is needed for a growth model to model future growth in a way that more reasonably accounts for AI.

aifuturesmodel.com
Open ↗
Open the AI Futures Model ↗
AI Futures Model - ai-2040.com

We think it would be exciting future work to modify the Jones & Tonetti model to (A) feature a unique AI factor of production, and/or (B) make the R&D loop more dynamic (and allowing more direct AI uplift on R&D). For the modelling we have done in this scenario, we instead rely on the AI Futures Model, and what we have added is more of an economics explorer, since it takes the AI automation trajectories as exogenous inputs on paths consistent with our AI Futures Model runs for AI 2040 default and AI 2040 under Plan A. See the simple explorer and full model below.

Bottlenecks and other arguments

Beyond the two papers above, there is a more general class of arguments about economic growth not being explosive due to bottlenecks, or historical precedents. Overall we believe that many such bottlenecks will be either weak, routed around due to massive incentives, and/or will bite very late, and that AI will be disanalogous to historical precedents.

Objection: Previous technologies haven’t led to explosive growth, and AI won’t be any different.

We agree that previous technologies haven’t led to explosive growth (well at least the fast explosive growth we expect from AI, long run economic growth has actually been better fit by a power law than an exponential).

Long run economic growth on a log plot shows that it has been faster than an exponential trend

The core difference is that past technologies automated a narrow domain (e.g. washing machines automated the task of physically cleaning clothes, the internet automated many communication channels), while AI could dominate humans at all (non-human-specific) tasks. So AI could also create new tasks that don’t exist today (e.g., datacenter maintenance, robot manufacturing, AI research) like past technologies did, but the disanalogy is that AI will also be able to automate those new tasks because it will dominate humans both cognitively and then physically (through robotics R&D and production). The humans will only be maintaining the datacenters, making the robots, doing the AI research, up until the point where AI and robots can do it better than them, then they no longer will be (at least once the AIs and robots are numerous enough, and again, absent strong, successful regulation, more on that below). The only tasks left for humans will be driven by human-preference which we think will make for a drastically different economy than today.

Objection: There will be regulatory bottlenecks that prevent growth.

We think that it is conceivable for regulation to massively slow AI explosive growth; and in fact, the economy in the Plan A scenario grows much more slowly than it would have absent regulation. However, the type of regulation that we think is required to create this type of slowdown involves explicit international coordination to all agree to hold off on explosive AI driven growth.

This is for two reasons.

International competition: if it’s the case that any country in the world could decide to allow their robots to grow exponentially and soon eclipse the industrial capacity of the rest of the world combined, there would be a massive incentive to do so, and it is hard to believe that all countries would accept this massive handicapping absent coordination.

Internal reinvestment spirals: regulation on AI companies seems unlikely to bite on what they do on internal R&D in a pre-emptive way. So if a company reaches a base of AIs and robots that are capable of self-replicating, AI companies might be able to vertically integrate a supply chain and rapidly outcompete the government (e.g., quickly building billions of robots in a desert offshore). Additionally, even if some sectors are highly regulated, currently highly regulated sectors aren’t the ones that drive explosive growth, e.g., R&D is generally not highly regulated and there will be a massive incentive to cut red tape wherever these are blocking explosive growth. (Note that in AI, we’ve already seen examples of skirted regulations with copyright law violations and xAI datacenter construction).

The regulation that we think is sufficient involves (a) explicit international cooperation to limit the kinds of R&D leading to AI and robots that can replace the work of, or don’t answer to a wide range of humans, and (b) limit explosive growth of robots and the amount of compute in the world through, for example, a cap-and-trade regime.

Objection: There won’t be explosive growth because there will be long lags between AI being available and AI being actually adopted.

So far, AI has diffused unprecedentedly quickly, even at its current capability level. When AIs are superhuman and there are billions or trillions of dollars on the line, we expect firms to quickly adopt AI. Even if many firms lag dramatically, only some firms need to adopt AI. The firms that do will grow explosively and will quickly become the majority of the sector. There will be strong market pressure to adopt superhuman AI quickly, and we believe this will be enough to cause unprecedentedly fast growth.

Objection: There won’t be explosive growth due to the time it takes to build new physical infrastructure.

Infrastructure bottlenecks can and will be solved by building more infrastructure. There will be massive economic pressure at the point where it is constraining AI or robot populations (at and approaching the point of full automation) to make this happen quickly (and maybe with partial help from AI and robots). Once robots can perform the relevant physical tasks, the rate of infrastructure construction again becomes roughly proportional to the robot population.

There will of course be serial time bottlenecks (9 women can’t make a baby in one month), and so too, an arbitrary number of robots will not be able to speed up the time it takes to build a robot factory to be infinitesimal. But for technology very similar to what already exists (production lines in factories, with mining), we don’t think serial construction times prevent short doubling times; see Appendix A for our estimates.

Objection: Robot and semiconductor explosions will be bottlenecked by rare materials.

We appear to be very far from exhausting physical resources on earth. This will slow down growth (on earth) eventually, but only after robots have mined substantial fractions of the earth’s crust. There is room for 30-100s of years worth of current extraction rates depending on the mineral before we even exhaust its proven reserves, and it’s plausible that with robot-powered mining, something on the order of 1% of earth’s crust would be straightforwardly reachable. Once we become bottlenecked by materials on earth, the robots could expand to space. Of course, as the 'materials get harder to find' the growth rate will slow, but it might still be very fast.

55y
5.4My
107y
221My
308y
4.9My
43y
217ky
35y
3.0My
125y
15My
38y
17My
231y
103My
5.9By
10y
100y
1ky
10ky
100ky
1My
10My
100My
1By
10By
Iron
Aluminum
Phosphate
Copper
Nickel
Lithium
Cobalt
Rare earths
Silicon
Years of minerals left at 2024 extraction rates - ai-2040.com
Years until proven reserves run out
Years until 1% of continental crust runs out
Production & reserves: USGS MCS 2025. Crustal abundance: Wedepohl (1995); continental-crust mass 2×1022 kg (CRUST2.0, Pasyanos et al. 2007).
The simple explorer

We propose a simple toy model with two factors of production: humans and AI. A continuum of tasks combines in a constant-elasticity-of-substitution (CES) aggregate with elasticity σ. A growing fraction of tasks is automatable: AI and robots can only do those, while humans can do any task, and within a task humans and machines are perfect substitutes.

The full model below adds capital, multiple sectors, prices, land, energy, and endogenous investment, but the qualitative story is the same one this toy makes visible.

The full economic model
Open the Full Explorer
↗
Our full economic growth explorer, that models the Plan A scenario in a more hand crafted way, and features e.g., capital, robots, prices, land, and energy.

The full version of the explorer is a detailed economic growth model that we built to model the economy in AI scenarios like Plan A. We have two main disclaimers about this model:

The model makes some assumptions about the world that we don’t endorse, plausibly contains bugs, and has very high uncertainty (i.e., we don’t trust the outputs to be accurate). That being said, we think it behaves relatively reasonably in these scenarios and we think it is the best existing model for the economic effects of the intelligence and industrial explosions.

The model’s preset is conditional on Plan A, our scenario in which the government takes substantial and effective steps to regulate AI and drastically slow things down. The second model preset shows something closer to the growth we expect in reality absent the regulatory interventions. Under the default world inputs, the model predicts real output growing ~5000x during 2033, which corresponds to a sustained doubling time of around 1 month.

3.0% / yr
from 2024
10,000
1,000
100
10
1
Years till 2041
1B
10B
100B
1T
10T
100T
1,000T
10,000T
100,000T
1,000,000T
GWP ($)
Historical
Plan A
AI 2040
Plan D
Gross World Product - ai-2040.com
AI 2040 Plan A Scenario

Under the Plan A scenario, effective regulation limits growth in three ways.

It slows down R&D (particularly algorithmic research), leading to AIs that can fully substitute for all economically relevant work arrive around 2035 instead of 2031.

It stops AI and robots from becoming entirely self-sufficient (automating 100% of tasks) because of regulatory interventions to require human oversight and auditing.

The cap-and-trade regime limits the total number of robots and AI hardware to a controlled doubling time of around 6 months for most of the period.

Plan A assumptions

Task automation fraction in Plan A. We split labor into cognitive labor and physical labor to show that cognitive labor is automated first because it can happen entirely with AIs running on the cloud, while the automation of physical labor requires a massive buildup of robots. In the Plan A scenario, there is 99% automation reached around 2035, with humans maintaining oversight roles thanks to successful regulation, and retaining a small fraction of economic output (still large in absolute terms).

Humans
AI
Robots
dotted = Plan D (no deal)
10M
100M
1B
10B
100B
1T
10T
100T
Humans
AI
Robots
AI (Plan D)
Robots (Plan D)
2025
2030
2035
2040
count (log scale)

AI and robot populations in Plan A. Before 2029, these reflect unconstrained projections. After that, they reflect the Plan A regulations, where both R&D is restricted, and production is capped from 2032 onwards to a roughly 6 month doubling time (with AI hardware production slowed after 2035 to a ~3y doubling time).

Human, AI & Robot Population - ai-2040.com
Plan A economic outcomes

Overall, partially informed by our economic model, we expect the main economic effects of Plan A to include:

An average of roughly 90% yearly growth in real output from 2032 to 2037. Broadly speaking, throughout this period AI and robots are capable of doing the vast majority of economic tasks, and are allowed to roughly double every six months. Rather than doubling the economy every six months, output increases around 90% per year on average (because of the modelling choice to have capital and human labor partially bottleneck growth).

Most of the economic output becomes driven by AI and robots. Income shares in the economy shift greatly towards AI and robots as they become capable of doing more and more tasks, and also become more numerous.

Human cognitive
Human physical
AI
Robots
0%
25%
50%
75%
100%
2025
2026
2027
2028
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
2040
Share of US Labor Output - ai-2040.com

Enormous AI and robot permit revenues redistributed through a “Citizen's Dividend”. To a first approximation, the combined AI hardware and robot cap-and-trade permits are the central bottleneck to the economy doubling in size (on average) every year. Naively, that implies the total value of the permits (if well-priced by a competitive market) should be around the size of the current economy, because that is how much additional GDP they will add to the following year. This is reasonable if the AI and robot companies are relatively myopic about the value of the AI and robots (i.e., they mostly base their decision based on 1 expected year of output), which we think may be true under these levels of growth, given potentially fast progress driving obsolescence of tech that is even a few years old. Our cost modelling suggests that the actual manufacturing costs will be a small share of GDP which suggests the permit costs will dominate. So we think the permit revenues will roughly equal the annual GDP when the economy is close to doubling every year.

2030
Income tax
87%
Corporate tax
6%
Sales tax
7%
$10T
total revenue
2032
Compute permits
57%
Robot permits
23%
$65T
total revenue
2034
Compute permits
26%
Robot permits
74%
$180T
total revenue
US Tax Revenue Sources - ai-2040.com

In Plan A, most of the US permit revenue share (75% in 2035) is redistributed to the US population as a Citizen’s Dividend, resulting in roughly $1M/yr per person in 2035 and around $10M/yr in 2040.

Wages and capital income from stocks would still be unequal, but with the equally distributed Citizen’s Dividend overall income equality would improve drastically, and the poorest Americans would see a drastic elevation in income.

2030
2035
2040
$1K
$10K
$100K
$1M
$10M
$100M
$1B

Per-person income (2025 dollars).

US Income Distribution in Plan A - ai-2040.com

Relative prices in the economy shift, with goods and services generally falling in price, while land, positional goods and human-bottlenecked outputs rising. In Plan A, both cognitive and physical labor from AIs and robots becomes vastly more abundant. Specifically, cognitive labor is 100x more abundant by 2033, and the same is true for physical labor by 2039. So anything the AI and robots can do (which is essentially to make every single good and provide every single service that exists today) will, generally speaking, become a lot cheaper in real terms. Throughout the 2030s in Plan A, AIs are relatively more abundant compared to robots, which means that the price of renting a human-equivalent robot is much higher than a human-equivalent AI worker. In some years, the gap we model is around 100x.

Rental costs for a full-time human-equivalent in any automated cognitive or physical domain over the course of Plan A.

In 2035, the cost of 1 FTE of labor in the average cognitive domain is $3,000 and in the average physical domain around $200K. These prices would be lower if not for the regulations limiting the amount of AI chips and robots being produced and deployed. In many domains such as law and medicine, since demand is relatively inelastic, we expect the GDP contribution to go down dramatically. In 2035, about 10x as much health care is consumed relative to 2025, but since it's ~100-1000x cheaper, the dollar-wise GDP contribution is 1-10% of what it was.

For fixed things like land, positional goods (like New York apartments) and human-bottlenecked services (e.g., human day care), we expect the relative pricing to increase, because their supply hasn’t changed. A (very rough model) for the price of land is that there are three main factors: (i) a larger share of spending gets devoted to land (10% -> 50%), and (ii) average spending increases due to the AI boom (100x), (iii) through repurposing of land (e.g., agriculture to housing) and deregulation, available land increases 10x. So with 500x increase in spending and only 10x increase in supply the price should increase 50x. The economic model has a more complicated model for land with more assumptions (which we don’t necessarily endorse), and produces concrete rental prices for urban, rural, and agricultural land separately. On average, land prices increase around 10-100x between the types.

The model predicts land costs increasing around 100x, while building costs only increase 2x. This implies that the price of housing will become dominated by the price of the land (as opposed to the cost of building housing), so dense housing (e.g. skyscrapers) will become relatively much cheaper than sparse housing. For single family homes, (where the current land vs. build cost share is usually around 40/60), this means that their price is up around 40x on average, but 97% of the home’s value on paper is the land. For 100 floor skyscrapers, land is currently typically 5% of the cost, so the price only goes up 7x. So it’s now commonplace for 100-floor skyscrapers to be built rapidly near major cities almost entirely by robots to provide cheaper housing. In 2035, the Citizen’s Dividend is roughly $1M per person, and it should only take around 15% of it to afford a typical high rise apartment near the city. Also, in deregulated places robots should be able to build far improved transportation that allows for rural homes to also become attractive, where we think the land will be around 10x cheaper.

We have an explorer in the scenario exploration tab for what the median consumer might be able to afford. The default assumes 15% of their spending is on urban land, 15% on rural land, 35% is on AI labor and 35% is on robot labor. Since AI labor is relatively cheap, by 2034 it becomes the case that each American can afford the equivalent of a mid-sized corporation working for them personally. Robots are more expensive and slower to scale, so in 2034 the median American has an average of a single robot working for them. By 2039, everyone can afford a construction team of robots, four hectares of rural land and a small urban block.

There are high real interest rates around 100-200% and depending on monetary policy choices, either massive deflation or large money creation (to keep inflation around 2%). We believe interest rates will increase drastically in Plan A as companies are willing to bid up the robot and AI production permits up to levels close to all of the current year’s GDP and pay interest up to 100-200%: since the robot and AI permits can be converted (barring the comparatively negligible costs of actually producing the AI and robots) into quantities of AI and robots that increase economic output 100-200%. In our modelling, this happens because of explosive growth in cognitive and physical labor, combined with our modelling decision to have production combine labor and capital with limited substitutability (a CES aggregate with elasticity 1.1, close to cobb-douglas). Because capital cannot fully stand in for labor at that elasticity, the exploding effective labor supply makes each unit of capital much more productive, so the marginal product of capital (MPK; how much extra output you get from one extra unit of capital per year) increases greatly throughout Plan A. Since in equilibrium the real interest rate equals MPK minus depreciation, this implies real rates rise similarly throughout the takeoff. We model the savings rate being responsive (but inelastic) with respect to these rising interest rates, but are not confident in the particular parameter we chose.

We imagine two mainline monetary policy responses being possible in this situation:

(1) If the government chooses to keep the money supply relatively fixed, then there would be a fixed amount of dollars chasing an increasingly abundant number of goods and services, so each dollar would be spread over a growing number of goods and services, meaning the average price is lower (each dollar buys more goods and services), i.e., leading to massive deflation. The problem with this could be a deflationary debt spiral, where the AI and robot companies can’t pay back loans in dollars because the robots and AIs are worth nominally less than the loans written the year before. One way to solve this could be for the loans to be denominated in AI and robots, so the companies pay back the loans with some percentage of the AI and robots instead of dollars. (2) Another possibility could be that they attempt to maintain an ongoing annual 2% inflation rate. This would involve a lot of money creation to keep up with the explosive real growth, and there might be high measurement difficulty and time lags making it hard to create the money at the correct level.

Note this wouldn’t change the fact that the consumer perceived inflation rates would depend dramatically on the basket of goods chosen, as the relative price swings systematically bring down the typical 2025-basket-of-goods dominant goods and services, with the AI and robot automation disproportionately affecting these areas. People will be able to afford many more cognitive-labor-bottlenecked services (e.g. financial advisors, lawyers, travel agents), and manufacturing bottlenecked goods (e.g. computers, cars, clothes, nice food), but less land, and less positional goods or non-automatable things (e.g., human day care). Because of the relative price swings, even if average inflation is 2%, some sectors will have large price increases (inflation) and others will have large price decreases (deflation).

AI 2040 Default World

In the AI 2040 default world, R&D and production quantities are mostly unconstrained by regulation, so there is 100% automation reached by early 2031. With our model’s naive endogenous investment and cost modelling explained below, we get 5000x growth in 1 year during 2033.

We model the investment required for robot and AI production (cost per quality-adjusted unit) by stacking pure “learning by doing” or economies of scale modelling (using Wright's law, i.e., cost / unit) combining multiplicatively with design improvements (using Jones' model, i.e., quality / unit). The idea is to reflect the separate gains from chip production efficiency (more chips of a fixed design being produced per dollar by fabs, i.e., progress that TSMC makes) with chip design efficiency (producing more final hardware performance per dollar from a fixed fab, i.e., progress that Nvidia makes). More on this in the cost model section of the model explanation. The endogenous investment mode then allocates investment between AI hardware, robot hardware, and capital based on a naive myopic return (i.e., so that each earns the same real return at the margin once you net out depreciation). We don’t necessarily endorse this as a way to model endogenous investment, but we’ve chosen it for simplicity for this illustrative model, and (as previously mentioned) we think the outputs are plausible because of the core arguments made in sections 1 and 2, rather than because of this modelling.

A feedback loop happens where AI and robot investment leads to more cognitive and physical labor, which can then be reinvested in R&D and more production efficiency. AI and robot investment gives higher returns as AI and robots become more capable (according to the exogenous trajectory that assumes full automation in 2031). The explosion in R&D labor flows through to plummeting production costs for AIs and robots.

Appendix A: Robot doubling times

There is a nascent but growing literature on this topic. In particular this Forethought report, which splits its doubling time estimates into three phases:

Initial (One-time gain from AI-directed human labor): on the order of ~1 year.

Acceleration: historical experience curves suggest the number of robots will double 1-5 times before the robot growth rate doubles.

Peak / maximum (biological anchors): days to weeks as an upper bound (fruit flies double in days, rats in ~6 weeks; bacteria in hours but probably too cognitively basic to bootstrap).

Out of these we broadly agree, except we think the acceleration phase is unlikely to match historical experience curves: those curves are evidence from human industries, and our best guess is that at full-automation, AI-driven R&D will be able to drive a faster experience curve for robotics. Our best guess is that it could look like Moore’s law (0.2 doublings per halving of cost) or faster, meaning that within a few months, the doubling time might halve multiple times, quickly approaching the ‘peak’ phase. Especially in the regime where AI continues to improve qualitatively, we also think that for the ‘peak / maximum’ phase the actual ceiling might be minutes or hours, because of bacteria with ~10 minute doubling times providing an existence proof of something a superintelligent AI may be able to match with a nanotechnology design.

This blog post by Damon Binder assumes full automation but no other technological improvement, framing this result as a conservative assumption, and finds headline doubling time of ~1 year ignoring consumption (with a plausible range of roughly 8 months to 2 years depending on assumptions). He computes the Von Neumann growth rate (the maximum rate at which the economy's physical capital can reproduce itself if all output is reinvested) directly from US BEA input-output tables, capital stocks, and depreciation data. He first assumes labor is free (abundant AI and robots), and then adjusts for actual AI and robot costs, resource depletion, construction time lags, and consumption to get estimates ranging more in the 1-2 year range.

Another recent piece is this Epoch report, which summarizes current 2025 robotics trends (6 months for humanoids, albeit at very low volumes), acceleration under historical demand shocks (e.g., WW2 and Ukraine), and current factory-build latencies (6-9 months in China). This piece is explicitly about near-term scaling (i.e., excluding AI-directed scale-up), which we think establishes a strong baseline for an initial doubling time of around 1 year at full automation.

See also older work in the “Industrial Explosion” section of another Forethought report, this Open Philanthropy report and this Epoch blog post, as well as our own arguments in the AI 2027 robot economy doubling times box:

ai-2027.com/slowdown
open ↗
Robot economy doubling times
SLOWDOWN ENDING · MARCH 2028
quoted from AI 2027, the box as published in the Slowdown ending (March 2028)
Appendix B: Energy model

Global energy consumption in 2025 was around 19.0 terawatt-years (TW-yrs). In the Plan A scenario, there is roughly 200x cumulative GWP growth by 2040 (on our default model assumptions). If the energy intensity of the economy (ratio of GDP to energy consumption) stayed constant, then energy consumption would also increase by that same factor, but historically we have observed a decrease in energy intensity since 1920. The headline numbers below are computed directly from the model's Plan A output and our elasticity assumption, so they stay in sync with the economic model explorer defaults.

Energy ×44
GDP ×109
×1
×2
×5
×10
×20
×50
×100
×200
1820
1850
1880
1900
1920
1950
1980
2000
2024
Global Energy vs. GDP - ai-2040.com
Global primary energy and GDP, both indexed 1820 = 1. 1820–2016: Bercegol & Benisty (2020). 2020/2024: IEA Global Energy Review 2025.

We expect this energy decoupling to continue, because the drivers of growth (AI, robots and accompanying capital) should all become more energy efficient per unit of economic output (AI hardware in particular has a strong power efficiency trend). In our energy model, we assume the energy decoupling trend of the last few decades will continue to become more aggressive, and energy consumption will grow at roughly 40% the pace of economic growth (we call this energy growth / GDP growth the energy elasticity of GDP; ε = 0.4). We are highly uncertain about this value, and find values between 20% and 70% to be plausible (80% CI; conditional on this economic growth trajectory).

GDP ×203
Energy ×8
×1
×10
×100
×1000
2025
2030
2035
2040
Energy vs. GDP in Plan A - ai-2040.com
Global energy and GDP under Plan A, indexed to 2025 = 1. GDP is the scenario-growth-model Plan A Output Y; energy via E ∝ Yε, ε = 0.40 (energy grows at 40% of the GDP rate).
Energy model at a glance

computed from the Plan A GWP trajectory and the econ-explorer energy defaults (E ∝ Yε).

2025 primary energy	19 TW-yrs
Plan A GWP growth (2025 to 2040)	x203
Energy elasticity of GDP (ε)	0.40
Energy growth at ε = 0.40	x8.4
2040 primary energy (ε = 0.40)	159 TW-yrs
2040 range (ε = 0.20 to 0.70)	55 TW-yrs to 784 TW-yrs

Primary energy scales as GWPε off the 2025 baseline of 19 TW-yrs. The GWP multiple is the scenario-growth-model Plan A Output Y; ε and the baseline mirror the econ-explorer defaults, so this stays in sync.

An energy elasticity of GDP of 40% leads to energy consumption on earth growing only around 8x during Plan A even as GWP grows by roughly 200x. The resulting 2040 primary-energy total (central case, and the 20% to 70% elasticity range) is computed in the summary above, and updates automatically with the economic model's defaults.

Depending on the source used for this energy, there may be significant implications for the earth’s temperature. There are two separate things to consider (1) a net increase in waste heat on earth, and (2) emissions, particularly CO2 emissions, leading to temperature increases.

Waste heat. Solar panels convert energy that was arriving on earth anyway from the sun, so they only change earth’s net energy if they change the reflectiveness (albedo) of the earth’s surface in a major way. Using another energy source like nuclear or fossil fuels, on the other hand, creates a direct increase in waste heat by releasing new energy to the atmosphere that was locked up in the earth’s crust. That said, even at the higher end of the levels we may reach by 2040 in the Plan A scenario, waste heat on its own does not become a major consideration.

ε=0.20 (55 TW)
ε=0.40 (159 TW)
ε=0.70 (784 TW)
Plan A 2040 (80% CI)
today (~19 TW)
10× today
100×
1000×
1%
10%
solar surface:
Nuclear / Fusion
Solar on land
Solar on ocean (cooling)
+0°C
+2°C
+4°C
+6°C
+8°C
+10°C
+12°C
10 TW
100 TW
1 PW
10 PW
Surface temperature increase ΔT (°C)
Sustained energy production (TW, log scale)
Warming from Waste Heat - ai-2040.com
Stefan-Boltzmann no-feedback equilibrium. Heat factors (W added per W generated): nuclear/fusion 1.0; solar on land +0.56; solar on ocean −0.089. Solar assumes 50% panel efficiency, panel albedo 0.10, surface albedos 0.35 (land) / 0.06 (ocean).

Carbon emissions. If fossil fuels were used as the sole source for the energy scale up, carbon emissions would become a significant problem by 2040, unless there were significant mitigations taken (e.g., removing the CO2 through direct air capture), with the equilibrium surface temperature increasing to 
+
3.0
𝑜
𝐶
+3.0
o
C over pre-industrial levels, up from 
+
1.8
𝑜
𝐶
+1.8
o
C today.

Warming vs. Cumulative CO₂
pre-industrial (280 ppm, 0°C)
today (427 ppm, +1.8°C)
+2.4°C
55 TW
10th %ile
+2.8°C
159 TW
50th %ile
+4.3°C
784 TW
90th %ile
Plan A, 2040
assuming 100% fossil fuel
Equilibrium ΔT
+0°C
+1°C
+2°C
+3°C
+4°C
+5°C
+6°C
0
1k
2k
3k
4k
5k
6k
Equilibrium ΔT (°C)
Atmospheric CO₂ above pre-industrial (GtCO₂)
Equilibrium warming equations Myhre et al. (1998) find the climate converging to a given temperature for a given atmospheric CO₂ stock. Today's observed +1.3–1.4°C is below the derived +1.8°C equilibrium value, in line with (Geoffroy et al. 2013), where ~55% of equilibrium warming materialises within 10 yrs of CO₂ stabilisation, ~70% in 100 yrs, ~99% by 1000 yrs. Plan A markers assume 100% fossil-fuel generation at 2.5 GtCO₂/TW-yr, with the ~45% airborne fraction staying in the air ( Friedlingstein et al. 2025 / Global Carbon Budget).

Therefore, we think there should be CO2 emission mitigation policies agreed to globally. Thankfully we think proven direct air capture (DAC) would provide an affordable path to mitigating CO2 increase, especially with help from AI and robot labor during the 2030s. Two specific ideas we have for carbon capture policy include:

Private cap-and-trade market (no government subsidy necessary), where any fossil fuel emitters globally are required to offset 100% of their emissions with equivalent carbon capture credits (with DAC companies making revenue by capturing carbon and selling the credits to the carbon emitters).

Auctioned carbon removal subsidy (government subsidy for net carbon removal), where the government(s) set the goal of not just capping emissions, but actually net removing carbon from the atmosphere, with the goal of returning to pre-industrial levels. They can set a “willingness to pay” curve, based on the social cost of carbon. We imagine something like the following curve being sufficient for affordably returning the earth to pre-industrial CO2 levels by 2040 with around $85T global government spending in total from 2033-2040, or around 0.1% of annual GWP on average during that period.

pre-industrial
today
2025 expected DAC cost ($600B/Gt)
2030 expected DAC cost ($400B/Gt)
2035 expected DAC cost ($100B/Gt)
2040 expected DAC cost ($30B/Gt)
SCC
$-200B
$-100B
$0B
$100B
$200B
$300B
$400B
$500B
$600B
$700B
0
1k
2k
3k
4k
5k
6k
7k
Carbon Capture Cost ($B per Gt removed)
Total atmospheric CO₂ (GtCO₂)
Carbon Capture Subsidy - ai-2040.com
Subsidy curve (WTP per GtCO₂ removed)
Expected Direct Air Capture (DAC) cost by year
Plan A path
Total Plan A subsidy: ~$85T (price × Δstock, summed). Prices: DAC × (1+10%), path sits on SCC curve. Sources: EPA 2023, IEA DAC 2022, CDR.fyi 2025.

Under some naive energy cost modelling that AI and robot labor accelerate progress in energy costs, and assuming a CO2 cap-and-trade forcing net neutral carbon emissions is enacted in 2035, we find the following energy cost, associated investment, and resulting energy mix.

### Additional content revealed by tabs / alternate choices

- During World War II the United States and many other countries converted their civilian economies to total war economies. This meant converting factories that produced cars into factories that produced planes and tanks, redirecting raw materials from consumer products to military products, and rerouting transportation networks accordingly.
- We are imagining something similar, except faster because superintelligences are directing and managing the whole process. Roughly speaking, the plan is to convert existing factories to mass-produce a variety of robots (designed by superintelligences to be both better than existing robots and cheaper to produce) which then assist in the construction of newer, more efficient factories and laboratories, which produce larger quantities of more sophisticated robots, which produce even more advanced factories and laboratories, etc. until the combined robot economy spread across all the SEZs is as large as the human economy (and therefore needs to procure its own raw materials, energy, etc.) By that point, the new factories will have produced huge quantities of robotic mining equipment, solar panels, etc. in anticipation of needing to meet demand far greater than the legacy human economy can provide.
- How fast would this new robot economy grow? Some reference points:
- The modern human economy doubles every twenty years or so. Countries that have developed especially rapidly (e.g. China) sometimes manage to double their economies in less than a decade.
- A modern car factory produces roughly its own weight in cars in less than a year. Perhaps a fully robotic economy run by superintelligences would be able to reproduce itself in less than a year, so long as it didn’t start to run out of raw materials.
- Yet that seems like it could be a dramatic underestimate. Plants and insects often have “doubling times” of far less than a year—sometimes just weeks! Perhaps eventually the robots would be so sophisticated, so intricately manufactured and well-designed, that the robot economy could double in a few weeks (again assuming available raw materials).
- Yet even that could be an underestimate. Plants and insects are operating under many constraints that superintelligent designers don’t have. For example, they need to take the form of self-contained organisms that self-replicate, instead of an economy of diverse and more specialized vehicles and factories shipping materials and equipment back and forth. Besides, bacteria and other tiny organisms reproduce in hours. It’s possible that, eventually, the autonomous robot economy would look more like e.g. a new kind of indigestible algae that spreads across the Earth’s oceans, doubling twice a day so that it covers the entire ocean surface in two months, along with an accompanying ecosystem of predator-species that convert algae into more useful products, themselves fed into floating factories that produce macro-structures like rockets and more floating factories.
- Obviously, all of this is hard to predict. It’s like asking the inventors of the steam engine to guess how long it takes for a modern car factory to produce its own weight in cars, and also to guess how long it would take until such a factory first exists. But economic growth rates have accelerated by multiple orders of magnitude over the course of human history, and it seems plausible to us that after superintelligence they will accelerate by orders of magnitude more. Our story depicts economic growth accelerating by about 1.5 orders of magnitude over the course of a few years.
- Output is a CES aggregate over a continuum of tasks
- ∈
- [
- ]
- i∈[0,1] with elasticity of substitution
- σ=0.2:
- (
- ∫
- 𝑑
- )
- ℓ
- 𝐿
- Y=(∫
- i
- σ
- σ−1
- di)
- ,Y
- =ψ
- +ψ
- ℓi
- L
- where
- and
- are the capital and labor allocated to task
- i. Within a task the two are perfect substitutes (whichever is cheaper does it, more on this below). The task productivities of capital
- and labor
- are given by:
- 𝑓
- 𝜇
- .
- =Q
- f(i),ψ
- ,f(i)=
- 1+μ
- (1−i)
- μ
- f
- Q is the economy's stock of ideas (the technology level); and
- are the idea elasticities, governing how fast each factor's productivity rises as ideas accumulate, with
- >
- >θ
- as capital improves faster from ideas than labor. In their 'Moore's Law Everywhere' calibration
- ≈
- 11.2
- ≈11.2 and
- 0.5
- ≈0.5. The function
- f(i) is capital's comparative advantage at task
- i, declining in
- i (tasks are ordered so capital is relatively best at low
- i),
- μ and
- are shape parameters fit to historical automation, and the floor
- =f(1) controls the long-run end state: with
- ≥
- ≥0 automation runs essentially to completion, while
- <
- <0 leaves a positive set of tasks permanently un-automated (worked out below).
- Automation. Let
- 𝑟
- r be the rental rate of capital and
- 𝑤
- w the labor wage. A task is automated when capital is cheaper than labor per productivity-adjusted-unit, i.e., when
- r
- w
- . Because
- f(i) is decreasing there is a single crossing, so the automation fraction
- 𝛽
- β can be solved by finding this crossover point
- ℓβ
- kβ
- :
- (r/w) today
- (r/w) later
- β today
- β later
- more automation
- more R&D
- automated tasks
- tasks
- ψ_k/ψ_ℓ: capital vs. labor productivity ratio on task i, today
- ψ_k/ψ_ℓ after R&D
- r/w: capital vs. labor cost ratio
- Automation in Jones-Tonetti - ai-2040.com
- There are two ways to increase automation, either (1) R&D, which increases the ideas stock
- Q and grows
- faster than
- , since
- , or (2) capital becoming cheaper over time (by becoming more abundant through capital accumulation) relative to wages.
- Cost-minimization assigns each task to the cheaper factor, so capital does tasks
- [0,β] and labor does
- [β,1]. We can collapse output to an ordinary two-factor CES (because each task is done by just one factor, so we only need the totals
- K and
- L each weighted by their total productivity across the tasks they do,
- 𝐵
- B and
- 𝐴
- A):
- B
- A
- =[(BK)
- +(AL)
- [∫
- β
- f(i)
- di]
- (1−β)
- Capital accumulates and labor grows as
- 𝑡
- 𝑒
- 𝑛
- t
- Y−δK,
- =L
- e
- nt
- with investment share
- , depreciation rate
- δ, and population growth rate
- n.
- R&D in the model. New ideas are produced from a fixed share
- R of output being invested, given by:
- 𝜆
- λ
- ϕ
- Y.
- Where
- is the change in the idea stock,
- is a research-productivity constant,
- is the share of output spent on R&D, and
- λ=1 is the elasticity of new ideas to research input, and
- 2
- ϕ=−2 (
- <0) the returns to the existing stock, i.e., ideas getting harder to find.
- With defaults
- λ=1,
- ϕ=−2 the growth rate is:
- And the growth rate of capital productivity
- is given by:
- So R&D is modelled at a fixed productivity
- from a fixed share
- of output. The paper sets the combined term
- 0.0001
- =0.0001 to match idea growth
- /
- %
- /Q=1% in 2020.
- 100% automation. The model leads to 100% automation in finite time when
- >0, with labor fully displaced and its income share falling to zero. Output collapses to a single-factor form
- Y=BK (linear in capital) whose productivity
- ∝
- B∝Q
- keeps climbing as ideas accumulate.
- When does growth explode? To pin down the long run behaviour one can look for a steady state where output and ideas are both growing at a constant rate. This either has a finite solution (the loop R&D feedback settles to steady growth) or no solution (where it explodes). There are two sides we can find:
- Idea side. Constant idea growth
- /Q=
- ϕ−1
- needs the
- Y and
- Q powers to offset,
- 𝑔
- λg
- =(ϕ−1)g
- , so ideas growing at a fraction of output (a fraction because ideas get harder to find with
- ϕ<0):
- g
- Output side. Output grows at the income-share-weighted growth of its two effective inputs, each input's growth being its productivity (rising with ideas,
- ) plus its quantity (for capital
- =g
- because of fixed saving & depreciation rate, and for labor its just
- n):
- 𝑠
- ∗
- =s
- (θ
- +g
- )+(1−s
- )(θ
- +n).
- Substituting the idea side for
- and collecting the
- terms gives:
- with
- =Φg
- +n,withΦ=
- 1−s
- s
- ).
- So apart from population growth, the model's output growth happens through
- Φ which represents the R&D loop's contribution. Each unit of output growth feeds back scaled by
- Φ. Summing over timesteps we get a geometric series:
- ⋯
- =n(1+Φ+Φ
- +⋯)=
- 1−Φ
- n
- If
- Φ<1 each round shrinks and growth settles at a finite rate proportional to population growth.
- Φ≥1 it does not and no steady rate exists, so output runs to infinity in finite time. This is hyperbolic growth with output
- 𝑋
- X (normalized to 1 today) obeying
- X
- , with
- today's growth rate. So the growth rate
- /X=
- Φ−1
- itself rises with the level. Separating and integrating from today,
- −Φ
- dX=
- t, and solving for output gives
- X=(1−(Φ−1)
- t)
- −1/(Φ−1)
- . With negative exponent, as the inside goes
- →
- →0 (which happens at
- 1=(Φ−1)
- t) output
- X goes
- ∞
- →∞. So output going to infinity happens at
- (Φ−1)
- . For
- Φ=2 this is simply
- which for ~3% growth today is ~33 years from now.

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
- [https://ai-2040.com/supplements/economics-of-plan-a#core-arguments-for-explosive-growth](https://ai-2040.com/supplements/economics-of-plan-a#core-arguments-for-explosive-growth)
- [Core arguments for explosive growth](https://ai-2040.com/supplements/economics-of-plan-a#core-arguments-for-explosive-growth)
- [https://ai-2040.com/supplements/economics-of-plan-a#why-we-disagree-with-mainstream-economists](https://ai-2040.com/supplements/economics-of-plan-a#why-we-disagree-with-mainstream-economists)
- [Why we disagree with mainstream economists](https://ai-2040.com/supplements/economics-of-plan-a#why-we-disagree-with-mainstream-economists)
- [https://ai-2040.com/supplements/economics-of-plan-a#acemoglu-2024-too-few-tasks-automated-by-ai](https://ai-2040.com/supplements/economics-of-plan-a#acemoglu-2024-too-few-tasks-automated-by-ai)
- [Acemoglu](https://ai-2040.com/supplements/economics-of-plan-a#acemoglu-2024-too-few-tasks-automated-by-ai)
- [https://ai-2040.com/supplements/economics-of-plan-a#jones-and-tonetti-2026-slow-ai-automation-of-randd](https://ai-2040.com/supplements/economics-of-plan-a#jones-and-tonetti-2026-slow-ai-automation-of-randd)
- [Jones](https://ai-2040.com/supplements/economics-of-plan-a#jones-and-tonetti-2026-slow-ai-automation-of-randd)
- [https://ai-2040.com/supplements/economics-of-plan-a#bottlenecks-and-other-arguments](https://ai-2040.com/supplements/economics-of-plan-a#bottlenecks-and-other-arguments)
- [Bottlenecks and other arguments](https://ai-2040.com/supplements/economics-of-plan-a#bottlenecks-and-other-arguments)
- [https://ai-2040.com/supplements/economics-of-plan-a#the-simple-explorer](https://ai-2040.com/supplements/economics-of-plan-a#the-simple-explorer)
- [The simple explorer](https://ai-2040.com/supplements/economics-of-plan-a#the-simple-explorer)
- [https://ai-2040.com/supplements/economics-of-plan-a#the-full-economic-model](https://ai-2040.com/supplements/economics-of-plan-a#the-full-economic-model)
- [The full economic model](https://ai-2040.com/supplements/economics-of-plan-a#the-full-economic-model)
- [https://ai-2040.com/supplements/economics-of-plan-a#ai-2040-plan-a-scenario](https://ai-2040.com/supplements/economics-of-plan-a#ai-2040-plan-a-scenario)
- [AI 2040 Plan A Scenario](https://ai-2040.com/supplements/economics-of-plan-a#ai-2040-plan-a-scenario)
- [https://ai-2040.com/supplements/economics-of-plan-a#plan-a-assumptions](https://ai-2040.com/supplements/economics-of-plan-a#plan-a-assumptions)
- [Plan A assumptions](https://ai-2040.com/supplements/economics-of-plan-a#plan-a-assumptions)
- [https://ai-2040.com/supplements/economics-of-plan-a#plan-a-economic-outcomes](https://ai-2040.com/supplements/economics-of-plan-a#plan-a-economic-outcomes)
- [Plan A economic outcomes](https://ai-2040.com/supplements/economics-of-plan-a#plan-a-economic-outcomes)
- [https://ai-2040.com/supplements/economics-of-plan-a#ai-2040-default-world](https://ai-2040.com/supplements/economics-of-plan-a#ai-2040-default-world)
- [AI 2040 Default World](https://ai-2040.com/supplements/economics-of-plan-a#ai-2040-default-world)
- [https://ai-2040.com/supplements/economics-of-plan-a#appendix-a-robot-doubling-times](https://ai-2040.com/supplements/economics-of-plan-a#appendix-a-robot-doubling-times)
- [Appendix](https://ai-2040.com/supplements/economics-of-plan-a#appendix-a-robot-doubling-times)
- [https://ai-2040.com/supplements/economics-of-plan-a#appendix-b-energy-model](https://ai-2040.com/supplements/economics-of-plan-a#appendix-b-energy-model)
- [Appendix](https://ai-2040.com/supplements/economics-of-plan-a#appendix-b-energy-model)
- [link](https://ai-2040.com/supplements/economics-of-plan-a#core-arguments-for-explosive-growth)
- [link](https://ai-2040.com/supplements/economics-of-plan-a#why-we-disagree-with-mainstream-economists)
- [link](https://ai-2040.com/supplements/economics-of-plan-a#the-simple-explorer)
- [link](https://ai-2040.com/supplements/economics-of-plan-a#the-full-economic-model)
- [many arguments about AGI timelines elsewhere](https://www.aifuturesmodel.com/)
- [https://ai-2040.com/supplements/economics-of-plan-a#top-toc](https://ai-2040.com/supplements/economics-of-plan-a#top-toc)
- [bottlenecks that we expect to not bite strongly](https://ai-2040.com/supplements/economics-of-plan-a#why-we-disagree-with-mainstream-economists)
- [Epoch estimates](https://epoch.ai/data-insights/ai-chip-production)
- [2-3% of](https://finance.yahoo.com/news/big-techs-ai-spending-spree-142111465.html?guccounter=1)
- [GDP investment in the US](https://finance.yahoo.com/news/big-techs-ai-spending-spree-142111465.html?guccounter=1)
- [Epoch estimates](https://epoch.ai/data-insights/llm-inference-price-trends)
- [hardware price performance](https://epoch.ai/trends#hardware)
- [Epoch finds](https://epoch.ai/blog/how-fast-could-robot-production-scale-up)
- [Appendix A](https://ai-2040.com/supplements/economics-of-plan-a#appendix-a-robot-doubling-times)
- [bottlenecks section below](https://ai-2040.com/supplements/economics-of-plan-a#bottlenecks-and-other-arguments)
- [Binder’s von Neumann growth rate calculation](https://defensesindepth.bio/ai-industrial-takeoff-part-1-maximum-growth-rates-with-current-technology/)
- [its own weight in cars every year](https://ai-2040.com/supplements/economics-of-plan-a#appendix-a-robot-doubling-times)
- [current growth](https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG)
- [economists predicted](https://static1.squarespace.com/static/635693acf15a3e2a14a56a4a/t/69cbb9d509ada447b6d9013f/1774959061185/forecasting-the-economic-effects-of-ai.pdf)
- [(2024)](https://shapingwork.mit.edu/wp-content/uploads/2024/05/Acemoglu_Macroeconomics-of-AI_May-2024.pdf)
- [(2023)](https://www.gspublishing.com/content/research/en/reports/2023/03/27/d64e052b-0f6e-45d7-967b-d7be35fabd16.pdf)
- [Acemoglu (2024)](https://economics.mit.edu/sites/default/files/2024-04/The%20Simple%20Macroeconomics%20of%20AI.pdf)
- [critiqued here](https://x.com/AndreyFradkin/status/1840837475062988911)
- [JP Morgan](https://am.jpmorgan.com/us/en/asset-management/adv/insights/market-insights/market-updates/on-the-minds-of-investors/is-ai-already-driving-us-growth/)
- [EY](https://www.ey.com/en_us/insights/ai/ai-powered-growth)
- [increased by $38B](https://epoch.ai/data/ai-companies?view=graph&tab=revenue)
- [Jones & Tonetti (2026)](https://web.stanford.edu/~chadj/JonesTonetti_Automation.pdf)
- [Baumol's cost disease](https://en.wikipedia.org/wiki/Baumol_effect)
- [ideas getting harder to find](https://web.stanford.edu/~chadj/IdeaPF.pdf)
- [hyperbolic growth](https://en.wikipedia.org/wiki/Hyperbolic_growth)
- [AI Futures Model](https://www.aifuturesmodel.com/)
- [aifuturesmodel.comOpen ↗Open the AI Futures Model ↗](https://www.aifuturesmodel.com/)
- [AI 2040 default](https://ai-rates-calculator-git-fixed-training-compute-lesswrong.vercel.app/p?base=daniel-04-02-26&acth=6.089920916003435&arts=3.4833731503601166&bgm=true&gy=1.103409&mttm=5.281602094603481&tam=1.54170045294956)
- [AI 2040 under Plan A](https://plan-a.aifuturesmodel.com/)
- [simple explorer](https://ai-2040.com/supplements/economics-of-plan-a#the-simple-explorer)
- [full model](https://ai-2040.com/supplements/economics-of-plan-a#the-full-economic-model)
- [better fit by a power law than an exponential](https://coefficientgiving.org/research/modeling-the-human-trajectory/)
- [Long run economic growth on a log plot shows that it has been faster than an exponential trend](https://ourworldindata.org/grapher/global-gdp-over-the-long-run?yScale=log)
- [copyright law violations](https://www.bakerlaw.com/bartz-v-anthropic/)
- [xAI datacenter construction](https://newsletter.semianalysis.com/p/xais-colossus-2-first-gigawatt-datacenter)
- [USGS MCS 2025](https://pubs.usgs.gov/publication/mcs2025)
- [Wedepohl (1995)](http://apostilas.cena.usp.br/moodle/pessenda/projes/simposio/artigo7.pdf)
- [Pasyanos et al. 2007](https://ui.adsabs.harvard.edu/abs/2007AGUFM.V33A1161P/abstract)
- [Open the Full Explorer ↗Our full economic growth explorer, that models the Plan A scenario in a more hand crafted way, and features e.g., capital, robots, prices, land, and energy.](https://ai-2040.com/supplements/econ-explorer)
- [economic growth model](https://ai-2040.com/supplements/econ-explorer)
- [cost modelling](https://ai-2040.com/econ-explorer/cost-model)
- [scenario exploration tab](https://ai-2040.com/econ-explorer/scenario-exploration)
- [increase drastically](https://www.basilhalperin.com/papers/agi_emh.pdf)
- [deflationary debt spiral](https://en.wikipedia.org/wiki/Debt_deflation)
- [Wright's law](https://en.wikipedia.org/wiki/Learning_curve)
- [Jones' model](https://en.wikipedia.org/wiki/Jones_model)
- [model explanation](https://ai-2040.com/econ-explorer/model-explanation)
- [this Forethought report](https://www.forethought.org/research/the-industrial-explosion)
- [bacteria with ~10 minute doubling times](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3751608/)
- [This blog post](https://defensesindepth.bio/ai-industrial-takeoff-part-1-maximum-growth-rates-with-current-technology/)
- [this Epoch report](https://epoch.ai/blog/how-fast-could-robot-production-scale-up)
- [the “Industrial Explosion” section of another Forethought report](https://www.forethought.org/research/preparing-for-the-intelligence-explosion#the-industrial-explosion)
- [this Open Philanthropy report](https://www.openphilanthropy.org/research/could-advanced-ai-drive-explosive-economic-growth/)
- [this Epoch blog post](https://epoch.ai/blog/explosive-growth-from-ai-a-review-of-the-arguments)
- [AI 2027 robot economy doubling times box](https://ai-2027.com/slowdown#slowdown-2028-03-31)
- [ai-2027.com/slowdownopen ↗](https://ai-2027.com/slowdown#slowdown-2028-03-31)
- [China)](https://www.macrotrends.net/global-metrics/countries/CHN/china/gdp-gross-domestic-product)
- [twice a day](https://enviroliteracy.org/how-long-does-it-take-for-algae-to-multiply/)
- [multiple orders of magnitude](https://wiki.aiimpacts.org/featured_articles/precedents_for_economic_n-year_doubling_before_4n-year_doubling)
- [course of human history](https://www.openphilanthropy.org/research/modeling-the-human-trajectory/)
- [AI 2027](https://ai-2027.com/slowdown#slowdown-2028-03-31)
- [default model assumptions](https://ai-2040.com/econ-explorer/world)
- [economic model explorer](https://ai-2040.com/supplements/econ-explorer)
- [Bercegol & Benisty (2020)](https://arxiv.org/abs/2008.10967)
- [IEA Global Energy Review 2025](https://www.iea.org/reports/global-energy-review-2025)
- [strong power efficiency trend](https://epoch.ai/blog/trends-in-machine-learning-hardware#energy-efficiency)
- [energy model](https://ai-2040.com/econ-explorer/energy-model)
- [Myhre et al. (1998)](https://agupubs.onlinelibrary.wiley.com/doi/10.1029/98GL01908)
- [Geoffroy et al. 2013](https://journals.ametsoc.org/view/journals/clim/26/6/jcli-d-12-00195.1.xml)
- [Friedlingstein et al. 2025 / Global Carbon Budget](https://essd.copernicus.org/articles/17/965/2025/)
- [direct air capture (DAC)](https://www.iea.org/energy-system/carbon-capture-utilisation-and-storage/direct-air-capture)
- [EPA 2023](https://www.epa.gov/environmental-economics/scghg)
- [IEA DAC 2022](https://www.iea.org/reports/direct-air-capture-2022/executive-summary)
- [CDR.fyi 2025](https://www.cdr.fyi/blog/direct-air-capture-market-snapshot-2025)
- [timelines and takeoff model](https://www.aifuturesmodel.com/)
- [doubling every ~four months](https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/)
- [in other domains](https://metr.org/blog/2025-07-14-how-does-time-horizon-vary-across-domains/)
- [section 1](https://ai-2040.com/supplements/economics-of-plan-a#core-arguments-for-explosive-growth)
- [this one](https://www.aifuturesmodel.com/p?base=eli-12-29-25&acth=5.386766760341415&arts=3.372873086588689)
- [here in the model explanation](https://ai-2040.com/econ-explorer/model-explanation/automation-definitions)
- [Cobb-Douglas](https://en.wikipedia.org/wiki/Cobb%E2%80%93Douglas_production_function)
- [Chirinko, 2008](https://ideas.repec.org/a/eee/jmacro/v30y2008i2p671-686.html)
- [Knoblach et al., 2020](https://onlinelibrary.wiley.com/doi/10.1111/obes.12312)
- [Gechert et al., 2022](https://doi.org/10.1016/j.red.2021.05.003)
- [Empire State Building](https://en.wikipedia.org/wiki/Empire_State_Building)
- [area of 4.5m sq ft](https://en.wikipedia.org/wiki/List_of_Tesla_factories)
- [produces 750k](https://en.wikipedia.org/wiki/Gigafactory_Shanghai)
- [Energy Transition Institute 2024](https://www.energy-transition-institute.com/article/statistical-review-of-world-energy-2025)
- [IEA’s 1.3% 2025 growth estimate](https://www.iea.org/reports/global-energy-review-2025)
- [here](https://docs.google.com/spreadsheets/d/1yxCYv4lsoVGJqdwh2Oe28ngiAlO-ZyW4Ng5HmraaX3s/edit?gid=67630334#gid=67630334)

---
