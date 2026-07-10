# Compute in Plan A

**Path:** `/supplements/compute-supplement`

Compute in Plan A
Romeo Dean

This supplement explains our estimates and forecasts on compute-related numbers. It is divided into two major parts, the first pre-2029 and the second post-2029 (where it becomes conditional on Plan A). In the pre-2029 section, the main goal is to forecast the total amount of compute in the world year by year, and to break this compute down into informative categories, including AI-relevant and non-AI-relevant compute, single-devices vs. clusters, regional ownership, and datacenter sizes (for AI-relevant clusters). Post-2029 it justifies how much compute we think could be produced with AI acceleration of hardware R&D and production, as well as our forecasts for the concentration of compute in companies, the allocation of frontier AI compute between uses and our guesses about how AI copies-speed numbers will look in the Plan A scenario.

Compute Definitions

Part 1. Pre-deal compute (pre-2029)

1.1. AI-relevant compute

1.2. All compute

1.3. Regional ownership

1.4. Datacenter sizes

Part 2. Post-deal compute (post-2029)

2.1. The no-deal counterfactual

2.2. AI-relevant compute after the deal

2.3. Company concentration

2.4. Compute allocation

2.5. AI copies and speed

Appendix. The effective-H100e model

Summary in figures
	AI-relevant	non-AI-relevant
Cluster	
AI Clusters
AI servers and pods.	
Non-AI Clusters
CPU servers.
Single-device	
Specialty Consumer
High-end workstations and gaming cards.	
Consumer Compute
Phones, PCs, gaming GPUs.

Two cutoffs define the split: a chip is AI-relevant if it clears the AI-compute performance floor, and a cluster if it is linked ≥ 5 GB/s to at least one other chip.

H100e added
H100e installed
level
Y/Y
raw
effective
EUV buildout (§1.1)
+ China domestic (§1.3)
0×
1×
2×
3×
(no prior)
2024
2.5×
2025
2.4×
2026
2.4×
2027
2.1×
2028
AI compute: flow & stock - ai-2040.com

H100e added is annual capex × cost-efficiency (anchored to the 2024/25 actuals 5.09M, 13.6M, then forecast); installed stock is shown at the end of each year. The black bars are the EUV-constrained §1.1 buildout (~155M added in 2028, ~280M installed by end-2028); the red caps add China's off-EUV domestic manufacturing (§1.3), for a ~289M world total. Toggle ‘effective’ to rescale by the §1.2 usefulness factor.

AI-relevant
non-AI
raw
effective
level
% AI
0%
25%
50%
75%
100%
26%
2024
48%
2025
67%
2026
projected →
82%
2027
90%
2028
94%
2029
All compute global stock - ai-2040.com

Our forecast of all compute in the world, including AI-relevant and non-AI-relevant compute, measured in both raw H100e, and our effective H100e metric which makes an adjustment for memory and networking factors. World installed compute stock is measured at Jan 1st.

stock
flow
level
% share
US
China
RoW
0%
25%
50%
75%
100%
71%
16%
13%
2024
75%
12%
13%
2025
77%
10%
14%
2026
78%
8%
14%
2027
78%
8%
14%
2028
Who owns the AI compute - ai-2040.com

Owner = the nation of the company that owns or leases the compute. World compute is from §1.1; China is the §1.3.1 bottom-up forecast; the non-China remainder is split 85/15 US/RoW.

10M+
1 DCs·10M·3.5%
1M-10M
74 DCs·149M·51.4%
100K-1M
257 DCs·76M·26.4%
10K-100K
497 DCs·15M·5.3%
1K-10K
823 DCs·2.6M·0.9%
<1K
1.2K DCs·397K·0.1%
In-transit
35M·12.0%
AI consumer
255K units·938K·0.32%
US · 224M · 77%
China · 26M · 9%
RoW · 39M · 14%
Compute locations by datacenter size (Jan 1 2029) - ai-2040.com
no deal
deal (Plan A)
2029 capex
debt-sourced takes the hit
$3.5T
$2.4T
-31%
H100e added (2029)
capex × efficiency, net of EUV surcharge
247M
199M
-19%
Installed H100e (end of 2029)
cushioned by the existing base
537M
489M
-9%
Plan A counterfactual - ai-2040.com

No deal vs Plan A, one year past the deal (through end-2029). Plan A collapses the debt-financed slice of capex (~31% off 2029 spending) while cash-flow-funded capex holds.

Plan A
no cap & trade
H100e
$ invested
$ / H100e
$67
$8
2029
2030
2032
2034
2036
2038
2040
$1
$10
$100
$1K
$10K
manufacturing $ / H100e, log scale
Plan A compute, with and without the cap - ai-2040.com

Plan A compute with different constraints lifted. The two constraints are the cap & trade policy in 2032, which restricts the quantity produced, and the hardware R&D deployment limits, which stop an exploding hardware R&D workforce from driving compute costs too low and chips too easy to manufacture.

US
China
RoW
fuller fill = frontier, lighter = rest
Year
2029
highlighted = frontier (top 3)
Anthropic
OpenAI
GDM
SpaceX
Meta
other US
other China
other RoW
US
China
RoW
Compute end-users by company - ai-2040.com
Frontier AI compute allocation under Plan A
public deployment
internal inference
training
experiments
safety
offline / transition
0%
25%
50%
75%
100%
2029 deal
publicdeployment
experiments
training
safety
2026
2028
2030
2032
2034
2036
2038
2040
Compute Definitions
Measuring compute: Raw vs effective H100e

The primary metric used in this supplement is H100-equivalents (H100e) multiples of one Nvidia H100 GPU measured in Total Processing Performance (TPP).

But compute isn't the only relevant hardware performance metric. The usefulness of compute for AI workloads also depends on many other factors, including memory bandwidth, memory capacity (stores and feeds data to the compute), and interconnect (to send data in between chips). Compute (H100e) is the headline metric we focus on but we also want to account for overall AI usefulness, so we also look at four other hardware resources, and combine them into an overall effective H100e metric:

Resource	What it does	H100 (per H100e)
Compute (TPP)	the math throughput itself (defines the unit)	15,800 TPP
Memory bandwidth	feeds data to the compute (HBM)	3,350 GB/s
Memory capacity	stores data near the compute (HBM)	80 GB
Scale-up	links chips within a server (NVLink)	900 GB/s
Scale-out	links servers across the cluster (Ethernet)	50 GB/s

Effective H100e adjusts raw H100e (which counts compute alone) by a single usefulness factor 
𝑈
U.

effective H100e
  
=
  
raw H100e
×
𝑈
effective H100e=raw H100e×U

𝑈
U is built from the four other resources in the table above. It adjusts for a chip's ability to actually be served by memory and communicate with other chips for representative AI workloads of its era, all relative to a 2024 100K H100 SXM cluster, which scores exactly 
𝑈
=
1
U=1.

Hardware that is memory-rich and well-networked for its FLOP/s can score above 1 (non-AI CPU servers, which carry lots of memory and networking around relatively little compute, score ~1.4), and e.g., compute with poor networking abilities (like gaming GPUs and phones) scores below one.

The usefulness factor is explained in full in the appendix.

Four categories of compute

The supplement attempts to model all the compute in the world and then partitions it in two independent ways giving four categories.

Partition 1: AI-relevant vs non-AI-relevant. A chip is considered AI-relevant if it clears all four floors of our AI-relevant cutoff thresholds set just below an A100 GPU.

metric	cutoff	A100	H100	RTX 4090
compute	4,000 TPP	4,992	15,800	5,285
memory bandwidth	1.0 TB/s	2.0	3.35	1.01
memory capacity	32 GB	80	80	24
networking (NIC)	100 Gb/s	200	400	64

Partition 2: cluster vs single-device.

Cluster = is actively used in a multi-device setting with at least 2 devices connected at least at 5 GB/s bidirectional speed.

Single-device = actively used as a single device (e.g., a phone, a PC, a gaming card) or otherwise does not meet the cluster definition.

These definitions give us four categories of compute.

	AI-relevant	non-AI-relevant
Cluster	
AI Clusters
AI servers and pods.	
Non-AI Clusters
CPU servers.
Single-device	
Specialty Consumer
High-end workstations and gaming cards.	
Consumer Compute
Phones, PCs, gaming GPUs.

Two cutoffs define the split: a chip is AI-relevant if it clears the AI-compute performance floor, and a cluster if it is linked ≥ 5 GB/s to at least one other chip.

Part 1. Pre-deal compute (pre-2029)
1.1 AI-relevant compute

In this section we forecast AI-relevant compute production with a demand-side method:

capex spent ($) 
×
× cost-efficiency (H100e / $) = compute added (H100e)

The AI capital expenditure trend has been ~1.72x/yr through Q3 2023 to Q4 2025, while cost-efficiency (H100e per dollar) has been improving around 1.4x/yr.

AI capex (~1.72×/yr)
Cost-efficiency (~1.4×/yr)

Source: Epoch AI — ML hardware price-performance

Extrapolating these trends naively would lead to the following compute forecast:

H100e added
Installed H100e
0
100M
200M
300M
8.5M
2024
22M
×2.6
2025
55M
×2.5
2026
projected →
134M
×2.4
2027
323M
×2.4
2028
Naive baseline forecast - ai-2040.com

The method is H100e added = capex × cost-efficiency, both extrapolated naively from the trends above (capex ~1.72×/yr; H100e per $ ~1.4×/yr). 2024/25 are actual Epoch data (AI Chip Sales: 5.09M H100e added on $260B spending in 2024, 13.6M from $448B in 2025).

The rest of this section will attempt to improve the forecast from this naive baseline.

Improving the capex forecast

Through 2025 the buildout was paid for almost entirely out of big-tech's operating cashflow. However, if this trend continues capital expenditures are on track to overtake operating cash flow of hyperscalers around Q3 2026.

Source: Epoch AI

To make a forecast that takes this into account, we split capex projections into three sources: existing-trend hyperscaler cash flow, AI cash flow (additional compute spend from AI company revenues, approximated as 80% of frontier AI company revenue forecasts), and debt & equity raises (which we are already starting to see grow in 2025/2026).

Our projections are as follows:

Existing-trend hyperscaler cash flow to continue growing at ~20%/yr (Epoch's ~$478B → $603B, with frontier AI company revenue stripped out) and deploy a rising share of it into the buildout, an invested fraction climbing ~75 → 85% as capex consumes more of cash flow.

AI cash flow to follow a total ARR (across frontier AI companies) of $30B (start-2026) → $180B → $500B → $1T (start-2029), with 80% of the recognized revenue counted as additional compute spend.

Debt & equity raises are hand forecasted (low effort) as a declining multiple of AI revenue: 3x (2025), 2.8x (2026), 1.8x (2027), 1.6x (2028). This is highly uncertain: on the one hand AI revenue growth motivates leverage, but as the total debt raise grows the interest rate will likely get higher. Note also that leverage at these levels implicitly conditions on the scenario's fast AI progress continuing (lenders keep believing in the revenue growth); like the revenue path itself, it is an input consistent with this scenario rather than an unconditional forecast.

With 2024-25 pinned to Epoch's Broad CapEx ($260B / $448B), this carries total AI capex to ~$2.4T in 2028, with debt reaching ~$900B (38% of the 2028 buildout). (We use hyperscaler Broad CapEx as the proxy for total AI capex: hyperscalers are ~60-90% of global AI spend, and ~60-90% of their capex is AI, and we assume the two gaps roughly cancel.) This is 7% higher than the naive baseline's (extrapolating the ~1.72x/yr trend) 2028 capex of $2.28T! This is because our bullish AI revenue forecast (and the debt raises we think its fast growth will motivate) actually pulls the trend slightly upwards.

$ / yr
% Y/Y
0%
30%
60%
90%
(no prior)
2024
+72%
2025
+78%
2026
projected →
+77%
2027
+72%
2028
Funding the AI buildout - ai-2040.com

Total AI capex = Epoch's hyperscaler Broad CapEx directly ($260B / $448B for 2024/25). We think hyperscalers are ~60–90% of global spend and ~60–90% of their capex is AI, so we assume the two roughly cancel as a simplifying assumption. Hyperscaler cash flow (existing trend) excludes frontier-AI revenue (to avoid double-counting) and we project it to grow ~20%/yr, with a rising fraction invested (~75→85%). AI cash flow is the additional compute spend from AI company revenues, approximated as 80% of frontier AI company revenue forecasts. Debt & equity raises we hand-pick as a declining multiple of AI revenue (3× / 2.8× / 1.8× / 1.6× for 2025–28), reaching ~$923B by 2028. This leads to ~$2.4T capex in 2028.

AI revenue and debt forecasts
Improving the cost efficiency forecast (supply-side)

The capex forecast is a demand-side forecast, while for cost-efficiency it makes sense to look at supply side. In particular, this section will focus on lithography (primarily EUV) capacity as the primary expected bottleneck on how many H100e can be produced.

EUV is needed for leading-edge logic, and the leading HBM DRAM nodes now use it too (DRAM was manufactured entirely without EUV until recently, e.g., Micron only adopted it in 2025, so this is a cost-optimality choice rather than a strict requirement; avoiding EUV just shifts the same demand onto the shared DUV pool). EUV is extremely hard to scale on short notice given the complexity of the machines and extensive supply chain dependencies, so we expect it to be the most important and informative bottleneck. Because of the time-inelasticity (how hard it is to quickly scale production in response to price signal), the EUV fleet is also relatively easy to forecast.

Year	EUV fleet (start of year)	EUV added / yr	fleet passes / yr	AI logic wafers / yr	AI HBM wafers / yr	AI EUV passes / yr	AI share of fleet
2024	220	+44	87M	0.2M	1.1M	7M	7%
2025	264	+48	104M	0.4M	2.5M	15M	15%
2026	312	+65	124M	0.7M	4.6M	34M	27%
2027	377	+80	150M	1.0M	8.0M	68M	45%
2028	457	+100	183M	1.6M	13M	118M	65%
2029 (no Plan A)	557	+125	223M	2.1M	17M	172M	77%

EUV fleet over time and AI's usage share. The fleet starts at 220 operating tools in 2024 (we estimate ASML had ~127 EUV tools in use at end-2021, then shipped 54/42 in 2022/23, per ASML's annual reports; the full build-up with sources is in the details box below) and grows with its accelerating shipments. The EUV added column is ASML's shipments during the year (ASML guides "60+" for 2026 and ~80 for 2027). Fleet passes/yr is the during-year average fleet x ~360k passes/tool. AI's draw sums its logic wafers (x ~12-24 EUV layers per logic wafer, N4→N2) and its HBM-DRAM wafers (x ~4-7 EUV layers per HBM wafer, accounting for stacking and packaging yields). AI's share climbs ~15% (2025) to ~77% (2029, no Plan A).

How EUV scanners make a H100e

AI's share of the EUV fleet grows from ~7% in 2024 toward ~64% by 2028 (and ~77% by 2029, near saturation). We expect this to translate to higher prices as it requires outbidding other uses of the fleet (e.g., phones, PCs, etc.). To model this, we implement a hand-chosen cost surcharge curve that depends on the fleet usage (highly uncertain ad-hoc choice).

% EUV used
Surcharge curve
0%
20%
40%
60%
0%
25%
50%
75%
100%
EUV capacity used →
2024: 0%
2025: 1%
2026: 4%
2027: 14%
2028: 33%
surcharge = 1.00 · u^2.5
EUV capacity and pricing surcharge - ai-2040.com
steepness K
2.5
ceiling A
100%

Our forecast for % of global EUV time (passes) used by AI, including both logic and memory wafers (and accounting for yields). It runs ~7% in 2024 toward ~65% by 2028 (~77% by 2029), so AI hits the EUV wall around 2029-30. The cost surcharge (curve tab), surcharge = A·u^K (default A = 100%, K = 2.5), is keyed to this derived path and feeds back into the compute forecast (more draw → higher surcharge → fewer H100e), solved to a fixed point so it climbs to ~33% by 2028 and throttles the late buildout. The K and A sliders tune how hard it bites for users to play with. The parameters are hand chosen and extremely uncertain.

Applying this surcharge to the naive price-performance trend gives an updated compute cost-efficiency trend that averages ~1.25x/yr from 2025-2028 (and slows to just ~1.1x/yr by 2028 as the surcharge bites) instead of the historical ~1.4x/yr.

$ / H100e
H100e / wafer
wafers / $B
level
Y/Y
0×
1×
2×
(no prior)
2024
1.2×
2025
1.0×
2026
projected →
0.9×
2027
0.9×
2028
The cost of compute, decomposed - ai-2040.com

Cost per H100e decomposes as $ per wafer ÷ H100e per wafer.

Where the wafer numbers come from

Multiplying this cost-efficiency baseline (incl. the scarcity surcharge) by the capex topline gives the annual H100e added (~155M in 2028), and an installed stock of ~280M by end-2028. We also adjust very slightly downwards for chip survival rates. China's domestically manufactured compute (§1.3) does not draw on this EUV supply chain, so we forecast it separately and add it onto this total, bringing the world AI stock to ~287M.

H100e added
H100e installed
level
Y/Y
raw
effective
EUV buildout (§1.1)
+ China domestic (§1.3)
0×
1×
2×
3×
(no prior)
2024
2.5×
2025
2.4×
2026
2.4×
2027
2.1×
2028
AI compute: flow & stock - ai-2040.com

H100e added is annual capex × cost-efficiency (anchored to the 2024/25 actuals 5.09M, 13.6M, then forecast); installed stock is shown at the end of each year. The black bars are the EUV-constrained §1.1 buildout (~155M added in 2028, ~280M installed by end-2028); the red caps add China's off-EUV domestic manufacturing (§1.3), for a ~289M world total. Toggle ‘effective’ to rescale by the §1.2 usefulness factor.

Resource intensity: from raw H100e to effective compute
1.2 All compute

§1.1 forecast AI-relevant compute. Now we extend to all compute in the world. We split all compute into six device categories:

Category	Examples	AI-relevant
AI	datacenter AI accelerators (H100, B200, MI300)	yes
Non-AI servers	datacenter CPUs and non-AI accelerators	no
PCs	laptops and desktops	no
Phones	smartphones	no
Gaming	gaming GPUs	no
Other	microcontrollers, automotive, edge	no

Our method works by looking at two quantities. The device side is the compute we get from counting the units shipped and the average compute carried on each device. The lithography side is the compute the world can make, from counting the wafers the fabs can produce and the compute each wafer turns into.

device side 
→
→ H100e = units 
×
× H100e per unit

lithography side 
→
→ H100e = wafers 
×
× H100e per wafer

The compute per wafer is the quantity we are least sure of, so it is what we attempt to pin down from history (where we can get good estimates of all the other values).

1.2.1 Calibration (2015 to 2024)

Across 2015 to 2024 we look at device demand (units shipped and compute per unit) and lithography supply (wafers shipped), and use this to back out an estimate of compute per wafer that we can then use to forecast future compute by category based on wafer allocation and wafer supply forecasts (which are easier to do than device demand forecasts, because the supply side can be forecasted with the relatively predictable lithography ceiling).

Device side
Shipments (M units/yr)	2015	2018	2020	2022	2024
phones	1K	1K	1K	1K	1K
pcs	276	259	304	292	263
gaming	44	50	40	38	36
ai	0.1	0.3	0.6	2.0	7.5
non-AI servers	8.0	11	13	14	13
other	12K	20K	24K	28K	30K
Shipment sources
TPP per unit	2015	2018	2020	2022	2024
phones	0.5	5.0	25	60	100
pcs	8.0	20	38	62	100
gaming	15	250	550	1K	2K
ai	350	1K	2K	5K	10K
non-AI servers	30	75	150	320	500
other	0.1	0.3	0.5	0.7	0.9
TPP-per-unit sources
Lithography side
wafers (M/yr)	2015	2018	2020	2022	2024
phones	1.8	1.9	1.9	1.9	2.1
pcs	0.7	0.7	0.9	0.9	0.9
gaming	0.2	0.3	0.2	0.3	0.3
ai	0.0	0.0	0.0	0.0	0.3
non-AI servers	0.1	0.2	0.3	0.3	0.3
other	5.5	9.7	12	15	17
device demand (total)	8.3	13	15	18	20
Wafer shipment sources

The lithography utilization by category is shown below. We treat every category as a package with its logic and associated memory (HBM, DRAM, NAND).

Lithography allocation, 2015-2024
EUV passes
% of EUV
all passes
% of passes

Share of total exposure-passes (≈ fab area, every node counts). AI is a sliver; most passes are trailing-node.

0%
25%
50%
75%
100%
'15
'16
'17
'18
'19
'20
'21
'22
'23
'24
ai
non-AI servers
phones
pcs
gaming
other
Sanity check with independent compute per wafer estimates

The resulting H100e added each year by category is shown below in both raw and effective H100e:

World H100e by category, 2015-2024
flow (added/yr)
stock (installed)
raw
effective
level
% share

Installed effective H100e stock by category (Jan 1). AI is a sliver until the early 2020s.

0%
25%
50%
75%
100%
'15
'16
'17
'18
'19
'20
'21
'22
'23
'24
ai
non-AI servers
phones
pcs
gaming
other
1.2.2 Forecast (2025 to 2028)

We take AI's compute forecast from §1.1 and ration the leftover lithography capacity to the other compute categories. AI first claims its lithography usage and then each non-AI category keeps its frozen-2024 share of the wafers that remain. That gives the projection:

Flow (H100e/yr)	2025	2026	2027	2028
phones	12.0M (33%)	16.6M (25%)	21.5M (18%)	31.0M (14%)
pcs	2.8M (7.7%)	4.1M (6.2%)	5.5M (4.5%)	8.8M (4.0%)
gaming	5.2M (14%)	7.2M (11%)	9.4M (7.8%)	14.2M (6.5%)
ai	14.2M (39%)	35.7M (54%)	80.6M (67%)	159.7M (73%)
non-AI servers	558K (1.5%)	725K (1.1%)	901K (0.7%)	1.2M (0.5%)
other	2.0M (5.4%)	2.3M (3.4%)	2.6M (2.2%)	3.2M (1.5%)
total	36.7M	66.6M	120.5M	218.1M

AI is from §1.1; non-AI gets the leftover logic wafers × rising TPP-per-wafer. Counting logic + HBM, AI reaches ~15% → 65% of EUV fleet capacity by 2028 (with the fleet ~100% utilized overall), but only ~40% of all logic wafers.

AI’s wafer claim, leftover pool, and bill of materials

The rest of this section is the supply-side justification behind that table, i.e., what share of the lithography ceiling each category uses.

Lithography allocation, 2024-2028
EUV passes
% of EUV
all passes
% of passes

Share of total exposure-passes (≈ fab area, every node counts). AI stays a minority even as it takes the leading edge.

0%
25%
50%
75%
100%
2024
2025
2026
2027
2028
ai
non-AI servers
phones
pcs
gaming
other
Logic vs. Memory
EUV
DUV (193i)

Share of EUV and DUV passes that go to logic vs. memory

0%
25%
50%
75%
100%
'15
'16
'17
'18
'19
'20
'21
'22
'23
'24
'25
'26
'27
'28
logic
memory

EUV utilization reaches ~100% by 2028 in our naive model, up from only 52% in 2024, as we expect it to become the binding constraint by then. That figure already separately accounts for uptime and realized throughput, both held at 2024 proportions. We don't expect utilization to literally hit 100%, but we're comfortable with the approximation: uptime and realized throughput (as a share of peak theoretical throughput) should improve a bit by 2028, roughly offsetting the gap.

EUV pass pool (M/yr)	2024	2028
passes demanded	45.3M	182.5M
pass capacity	87.1M	182.5M
EUV utilization	52%	100%
immersion (DUV) utilization	20%	25%

Utilization = passes demanded ÷ pass capacity. EUV and immersion are both on the effective (uptime- and throughput-adjusted) basis, so the two utilizations compare directly.

Node structure: passes per wafer and node mix
Per-device memory and wafer cost
Litho supply sources: EUV layers/node, fleet, throughput, node mix
1.2.3 Results

Accumulating production net of retirement gives the installed stock by category. Rescaling raw H100e to effective H100e (raw x 
𝑈
U, the resource-adjusted AI workload usefulness model derived in the appendix).

Effective H100e rescales each category's raw compute by a usefulness factor U, derived in the appendix.

usefulness U	2024	2026	2028	2029
phones	0.21	0.11	0.07	0.05
pcs	0.35	0.08	0.04	0.03
gaming	0.04	0.05	0.06	0.04
ai	1.16	1.06	1.04	1.02
non-AI servers	1.38	1.40	1.41	1.40
other	0.53	0.43	0.34	0.30
Per-chip inputs and the unclamped model output
World compute by quadrant
Stock
Flow
Raw
Effective
level
% share

Installed H100e by deployment quadrant; toggle raw↔effective and level↔share.

0%
25%
50%
75%
100%
2024
2025
2026
2027
2028
AI × cluster (the AI fleet)
AI × single-device (PCIe AI cards)
non-AI × cluster (CPU / NIC pools)
non-AI × single-device (consumer)

Cluster vs. single-device split. We also categorize compute into clusters and single-devices. Non-AI servers are treated as non-AI relevant clusters; phones, PCs, gaming GPUs and embedded chips are non-AI single-device; and AI relevant compute is almost entirely in accelerators run in datacenters (AI-relevant clusters), but there is a small rising amount of AI-relevant single-device chips that is negligible today and grows later as datacenter-class GPUs reach desktop form factors (e.g., NVIDIA's DGX Station).

effective H100e stock (Jan 1)	2020	2024	2026	2028	2029
AI-relevant · cluster (AI datacenters)	101K (4.1%)	3.6M (26%)	23.7M (67%)	140.8M (90%)	295.2M (94%)
AI-relevant · single-device (specialty consumer)	0	0	0	218K (0.1%)	938K (0.3%)
non-AI · cluster (non-AI servers)	294K (12%)	1.4M (10%)	2.6M (7.5%)	4.7M (3.0%)	6.1M (1.9%)
non-AI · single-device (consumer)	2.1M (84%)	8.7M (63%)	9.1M (26%)	11.5M (7.3%)	12.6M (4.0%)
How we forecast AI-relevant single-device compute (specialty consumer)
1.3 Regional ownership

This section forecasts world compute ownership by region, for the AI-relevant compute from §1.1. We split ownership three ways: US, China, and the Rest of the World. We think it is most informative to focus on a separate Chinese compute forecast, because China is cut off from the main global supply chain by export controls, making it the hardest region to pin down with a crude percent-of-spending estimate.

What follows is therefore an independent Chinese compute forecast, broken down by the different sources of compute reaching China. We then make a crude estimate of the US versus Rest-of-World split of the global total. China's domestic manufacturing is treated as separate from the world compute total forecast in §1.1, because it does not come from the same (EUV-based) supply chain, so the §1.1 totals add it back on.

1.3.1 Chinese compute forecast

We categorize China's AI compute into four sources: Three come from the global supply chain (already in the §1.1 world total): legal imports (export-compliant chips: e.g., H20s historically, H200 under the current licensing policy), smuggled chips, and loopholes (chip dies smuggled in before packaging, or offshore datacenters Chinese firms own or lease from abroad). The fourth is domestically manufactured chips (SMIC 7nm logic / CXMT HBM / Ascend). China's compute grows ~9x over 2026-2029, but its world share still falls toward ~9% because the global buildout outpaces it.

H100e / year
H100e installed
level
Y/Y
% of world
0%
5%
10%
15%
installed base at end of year
14.7%
2025
13.1%
2026
11.1%
2027
projected →
9.7%
2028
9.0%
2029
China's AI compute - ai-2040.com
The 2024-2025 anchors, pinned to observed data:
Forecasting 2026-2028

The four channels combined (M raw H100e):

H100e (per year unless noted)	2024	2025	2026	2027	2028
Domestic	0.25M	0.6M	1.1M	2.3M	5.0M
Legal western	0.2M	0.15M	0.35M	0.8M	1.6M
Loopholes (offshore DCs / rental)	0.25M	0.45M	0.7M	1.6M	3.15M
Smuggled	0.16M	0.48M	1.26M	2.12M	2.99M
Total added /yr	0.9M	1.7M	3.4M	6.8M	12.7M
→ China stock (end of year)	1.3M	2.9M	6.3M	13.2M	25.9M
→ China % of world	14.7%	13.1%	11.1%	9.7%	9.0%
1.3.2 Results

Combining the world total (§1.1), the China forecast (§1.3.1), and an 85/15 US/RoW split of the remainder gives ownership by region: the US holds the great majority throughout, China ~15% → ~9%.

stock
flow
level
% share
US
China
RoW
0%
25%
50%
75%
100%
71%
16%
13%
2024
75%
12%
13%
2025
77%
10%
14%
2026
78%
8%
14%
2027
78%
8%
14%
2028
Who owns the AI compute - ai-2040.com

Owner = the nation of the company that owns or leases the compute. World compute is from §1.1; China is the §1.3.1 bottom-up forecast; the non-China remainder is split 85/15 US/RoW.

1.4 Datacenter sizes

In this section we forecast how the AI compute from §1.1 will be distributed across datacenter sizes, from gigawatt-scale training campuses down to the long tail of small regional sites. The method is relatively naive (and uncertain). We take the total AI compute forecast (from §1.1), and spread it across a total datacenter count, fit a curve of datacenter sizes with three concentration anchors, and then split the result across the US, China, and the Rest of the World ownerships (from §1.3).

10M+
1 DCs·10M·3.5%
1M-10M
74 DCs·149M·51.4%
100K-1M
257 DCs·76M·26.4%
10K-100K
497 DCs·15M·5.3%
1K-10K
823 DCs·2.6M·0.9%
<1K
1.2K DCs·397K·0.1%
In-transit
35M·12.0%
AI consumer
255K units·938K·0.32%
US · 224M · 77%
China · 26M · 9%
RoW · 39M · 14%
Compute locations by datacenter size (Jan 1 2029) - ai-2040.com
Datacenter sizes model
Part 2. Post-deal compute (post-2029)

In this section we forecast what happens after Plan A is implemented, as well as the 1-year default counterfactual without Plan A.

2.1 The no-deal counterfactual

To predict one more year of the default (no-deal) path, we extend the §1.1 method (and §1.3 for China's domestic additions) to the installed stock at the end of 2029. Under Plan A we expect the temporary R&D pause and general uncertainty during the deal's implementation to make capital spending temporarily lower. We approximate this by having the debt-financed slice of the buildout collapse to zero under Plan A, while cash capex stays on trend. With the fast implementation of inference-only verification and increased inference-compute allocation, we expect the AI revenue forecast to stay on par with the default counterfactual.

Overall, we think a good implementation of the deal can provide confidence to companies that R&D will be allowed to resume, and that given the level of realized capabilities and continued improvements once R&D resumes (which will be at a slowed down but still fast pace), we expect AI investment to still be extremely economically attractive. We expect this to hold despite increased transparency, because without algorithmic moats the economic value will accrue to the owners of compute (who can therefore still be the ones to train the best models first and serve them to the widest user base).

no deal
deal (Plan A)
2029 capex
debt-sourced takes the hit
$3.5T
$2.4T
-31%
H100e added (2029)
capex × efficiency, net of EUV surcharge
247M
199M
-19%
Installed H100e (end of 2029)
cushioned by the existing base
537M
489M
-9%
Plan A counterfactual - ai-2040.com

No deal vs Plan A, one year past the deal (through end-2029). Plan A collapses the debt-financed slice of capex (~31% off 2029 spending) while cash-flow-funded capex holds.

2.2 AI-relevant compute after the deal

Further into Plan A, we have increased uncertainty over compute growth, especially as AI and robots become capable of automating hardware R&D and production, and drastically increasing the previously human-constrained workforce. Given the uncertainty, we think it is reasonable to use a relatively simple model (Jones and Wright's-law learning) that takes the §1.1 compute path as its starting point and runs it to 2040. Given the hardware explosion we expect by default with unconstrained AI and robot deployment on hardware R&D and production, and the fact that this would be destabilizing (among other things, increasing the ease of defecting on the deal and verification burden within the deal) Plan A features a cap-and-trade regime to slow down the hardware explosion to controllable (but still drastically increased) hardware levels.

Why we expect hardware to grow fast. We can think of two separate forces lowering the cost per unit of compute:

Design improvements (modelled with Jones). Design improvements can lead to more compute per fixed unit of AI chip production, with better chip layouts, memory designs, transistor density, packaging etc. This is R&D, so we can model it with the labor spent on it, but with diminishing returns as the easy ideas get used up (Jones 1995, calibrated by Bloom et al. 2020) and with diminishing returns to more parallel labor at a given time. Think of this as the historical improvements in 'compute per wafer' (including node shrinks, which we bucket under design R&D since they come from chip and equipment research rather than from production scale). Roughly 2 million people work in semiconductors today; by the early 2030s our forecast is that combined human, AI, and robot effort on chip and equipment R&D is on the order of 100x that. Under our model's parameters this only speeds up the 'Moore's law' progress by around 1.1x.

Production scaling (Wright). Pure manufacturing scale of units of compute can lead to 'learning by doing' efficiency improvements, e.g., with yield, throughput, uptime effects, and economies of scale. Think of this as the improvements in 'wafers per dollar' historically. We model unit cost falling about 15% per doubling of cumulative production (similar to long-run semiconductor and solar rate). We don't know if AI and robots automating fab construction and operation will speed up this trend, but at least think it's a reasonable baseline that these gains from scale will continue separately to design improvements.

We treat the cost per unit of compute ($ / H100e) as the product of the two factors (compute / unit produced) and (units produced / $), where historically the unit has been 'wafers' but may change with future paradigms. Each factor is normalized to 1 in 2025 and falling thereafter. We take the §1.1 endpoint as the starting point and run these two models forwards to 2040.

The Jones & Wright's-law cost model

The hardware explosion has two throttles in Plan A. Without them there is too much progress for the deal's stability (ease of defection and verification burden). There is a feedback loop where more compute leads to more hardware R&D and production, leading to more compute and cheaper hardware. Plan A has two constraints that act on different parts of that loop: capping production levels (cap-and-trade policy from 2032 onwards) and limiting R&D deployment (to avoid compute becoming too easy and cheap to manufacture despite the quantity caps).

Plan A (cap + hardware R&D controls)
no cap, hardware R&D controlled
no cap + hardware R&D unconstrained
H100e
$ invested
$ / H100e
$67
$8
$0.05
2029
2030
2032
2034
2036
2038
2040
$0.01
$0.10
$1
$10
$100
$1K
$10K
manufacturing $ / H100e, log scale
Capped Plan A compute vs. default - ai-2040.com

Plan A compute with different constraints lifted. The two constraints are the cap & trade policy in 2032, which restricts the quantity produced, and the hardware R&D deployment limits, which stop an exploding hardware R&D workforce from driving compute costs too low and chips too easy to manufacture.

Assumptions for each scenario
Supply-side implications and sanity check.

We can also express Plan A's buildout in dollars, as a check on the investment it implies. Each year's implied investment is the compute added that year times an all-in cost per H100e, which is the production cost from the model above times a markup covering everything else a dollar of AI capex buys (chip-maker margin, datacenters, power, networking). We calibrate the markup so that 2025 to 2028 reproduce Part 1's capex forecast exactly (~$2.4T in 2028) and 2029 the §2.1 deal year: this gives roughly 7x to 8x. Our best guess is that the markup then declines to ~1.2x by 2040, since robot-built fabs and datacenters should sell hardware near production cost, and the power and datacenter share of each H100e shrinks with the efficiency gains below.

Investment $ / yr
$ / H100e
$10
$100
$1.0K
$10K
$100K
deal →
2026
2029
2032
2035
2038
2040
Implied AI compute investment - ai-2040.com

We are very uncertain about the uncapped paths, but we think the unconstrained default is likely to be orders of magnitude higher than our capped path. The effective labor available for hardware R&D and chip production scales enormously once AI and robots are capable of that work. We think the stacked Jones and Wright's-law learning-curve dynamics are a reasonable naive approximation of what this might look like.

Historically, chip design improvements have been closely tied to power-efficiency improvements, so we model compute power efficiency on the same Jones design trend as the cost model above, using the same parameters (25%/yr base rate, stepping-on-toes 
𝜆
=
0.05
λ=0.05) at Plan A's constrained R&D pace, which leads to the following trajectory (notably not breaking past the CMOS transistor theoretical limit that Epoch estimates).

1000
500
200
100
50
20
10
5
CMOS limit
~200× H100 (Epoch)
2025
2027
2029
2031
2033
2035
2037
2039
2040
27 W
Compute power efficiency - ai-2040.com

Total facility power per H100e (in Epoch's terms: chip TDP plus the server's other components plus cluster-level overhead like cooling, i.e. the full power draw at the grid), fleet stock-average, from the econ model's Plan A energy trajectory (same constrained Jones design trend as the cost model). It reaches ~37× the 2025 chip by 2040, still several× above the CMOS practical limit Epoch estimates (~200× a current H100e).

2.3 Company concentration

In this section we show our projections for how compute is distributed among companies over time. We track AI company end-users (the company that actually uses the compute) as opposed to owners (who may use or rent their compute to others). Early on most compute is owned by hyperscalers in a concentrated way (Google owns ~25% of compute) but the AI company end-users are less concentrated, with the largest using around 10% of global compute in 2026 (GDM and OpenAI are similar).

top company
top 3
top 10
0%
20%
40%
60%
80%
2026
2028
2030
2032
2034
2036
2038
2040
~8%
~20%
~5%
~13%
~31%
Company compute concentration - ai-2040.com

The share used by AI companies has been growing over time, and we project this trend forwards until Plan A is implemented. After 2030 the Plan A transparency regime lowers barriers to entry: investment in AI grows and spreads more evenly, and compute becomes distributed across more companies. By 2040 the largest holds only about 5% of world compute and there are around 20 frontier companies (defined as anyone within 4x of the largest).

US
China
RoW
fuller fill = frontier, lighter = rest
Year
2029
highlighted = frontier (top 3)
Anthropic
OpenAI
GDM
SpaceX
Meta
other US
other China
other RoW
US
China
RoW
Compute end-users by company - ai-2040.com
Method for company compute concentrations
2.4 Compute allocation

In this section we forecast allocation of frontier AI compute in Plan A. In 2025 OpenAI spent around half of its compute on inference and more like one third on inference in 2024 and the rest on training and experiments (of which only around 10% on final frontier training runs). We project this current split forwards naively until the 2029 deal, and then forecast each share conditional on Plan A.

Frontier AI compute allocation under Plan A
public deployment
internal inference
training
experiments
safety
offline / transition
0%
25%
50%
75%
100%
2029 deal
publicdeployment
experiments
training
safety
2026
2028
2030
2032
2034
2036
2038
2040
2.5 AI copies and speed

In this section we forecast how many copies of the frontier model can be run at once and at what token/second speed. These are both imperfect metrics, because it may be difficult to know how to count a 'copy' under different scaffolds / architectures in the future, but we assume each parallel instance of the model weights being served, so copies = replicas x batch. Speed is also imperfect, because we probably care more about the speed of task completion, but we just focus on decode tokens per second, even though the speed comparison in tokens might break down with future paradigm changes, e.g., neuralese instead of chain of thought.

Up front: these forecasts are concrete best guesses, and we think the honest uncertainty is multiple orders of magnitude. Both the AI paradigm (architectures, sparsity, agent scaffolds, whether 'copies' is even the right frame) and the hardware paradigm (the memory and bandwidth tradeoffs of chips, how much silicon gets specialized for inference) could change several times before 2040. The method itself is simple, and we prefer to state it plainly: we guess the frontier model's size, we guess what share of the world's compute runs inference, and then we get copies by dividing the inference fleet's total memory by the bytes each copy takes, and we get speed from how quickly memory bandwidth can read the bytes each token needs. The rest of this section explains how we make each of these guesses.

Model size. We combine the global compute growth from the previous sections with the leading company's concentration (§2.3) and training allocation (§2.4) to get frontier training compute over time (roughly 32x today's by 2029 and 160,000x by 2040). We then map these compute numbers as well as a sparsity forecast to model size (total parameters) with a simple model:

𝑃
 
=
 
𝑃
2026
(
𝐶
𝐶
2026
)
𝛼
(
𝜎
𝜎
2026
)
𝛽
P=P
2026
	​

(
C
2026
	​

C
	​

)
α
(
σ
2026
	​

σ
	​

)
β

Where 
𝑃
P is total parameters (
𝑃
2026
≈
10
P
2026
	​

≈10T, today's level), 
𝐶
C is frontier training compute, and 
𝜎
σ is sparsity. The compute exponent 
𝛼
α is the sensitivity of model-size scale up to compute scale up. Simple Chinchilla-optimality implies ~0.5, but we have wide uncertainty; there are reasons it might increase, e.g., due to data availability (fitting our formula to Nesov's own compute and sparsity numbers gives 
𝛼
≈
0.8
α≈0.8), or for example, intentional undertraining due to e.g., making it harder to steal the weights. There are also reasons it might decrease, e.g., more overtraining for serving (Sardana and Frankle), reinforcement learning, and other unknown unknowns about paradigm changes. We just assume 
𝛼
=
0.5
α=0.5 and draw 
𝛼
∈
[
0.2
,
0.8
]
α∈[0.2,0.8] as a range on the figure to show what we think is a plausible range. The sparsity exponent 
𝛽
=
0.74
β=0.74 is tentatively better pinned (though the sparsity MoE paradigm might change).

We think it's valuable to include the sparsity assumption because it might affect the speed and copies significantly.

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
Our model size forecast for plan A

total = 10T × (compute growth)α × (sparsity growth)β, with α = 0.5 and β = 0.74.

Year	10T × computeα	× sparsityβ	= ours (total)	α ∈ [0.2, 0.8]	Nesov
2026	10T	x1.0 (8x)	10T	10T to 10T	10T
2027	20T	x1.7 (16x)	33T	22T to 49T	30T
2028	35T	x2.8 (32x)	97T	46T to 205T	240T
2029	57T	x2.8 (32x)	158T	56T to 449T	650T
2030	83T	x3.1 (37x)	255T	72T to 904T	—
2032	229T	x3.8 (48x)	862T	132T to 5,638T	—
2035	1,411T	x4.7 (64x)	6,576T	337T to 128,155T	—
2040	3,992T	x7.8 (128x)	31,063T	854T to 1,129,715T	—
Differences with Nesov's numbers

Inference-compute fleet. We take the §2.4 inference share of world compute (public + internal), and hold its memory and bandwidth per H100e ratios (§1.1) flat after 2029. We split this compute into ordinary general-purpose chips and inference-specialized chips, a hand-set scenario we describe below.

Inference compute by chip type
general-purpose
inference-specialized
MemoryBandwidthCompute

Serving compute by chip type (millions of H100e, log); inference-specialized is ~12% of all compute but ~half of the serving pool by 2040.

0.01
1
100
10k
1B
2026
2028
2030
2032
2034
2036
2038
2040
2029 deal
128B
122B
Copies of the frontier model
all copies

Concurrent frontier copies served (replicas times batch), 2026 to 2040 (log).

10M
100M
1B
2026
2028
2030
2032
2034
2036
2038
2040
2029 deal
30.3M
29.0M
186M

Copies. We get copies by dividing the inference fleet's total memory by the bytes each copy takes. Each copy needs its share of the model weights (a full set of weights is ~5 TB today at 4-bit, and ~15 PB by 2040 at our central model size, shared across the copies served in the same batch) plus its own context. Rather than modelling batch sizes and KV caches in the main text, we just state their combined effect: we assume context takes up about half of general-purpose inference memory today, falling to ~5% by 2040 because the weights grow much faster than each copy's context does (the details are in the method box, and the batch assumption just trades off with context length assumptions and is arbitrary). This gives about 30 million copies today. The count dips slightly at first, because the jump in sparsity grows the model faster than the inference fleet, and ends up at very roughly 200 million by 2040, with most copies on general-purpose hardware and the rest being the much faster copies on inference-specialized chips described below.

Weights vs. context assumptions
Year	Avg context	KV / copy	Context / replica	Weights / replica	Context share
2026	200k	20 GB	5.1 TB	5.0 TB	51%
2029	341k	68 GB	17.4 TB	79.2 TB	18%
2032	580k	220 GB	56.3 TB	430.9 TB	12%
2035	988k	896 GB	229.3 TB	3.3 PB	7%
2040	2.4M	3.3 TB	856.1 TB	15.5 PB	5%
Copies & speed model summary

Model size, copies, and speed at milestone years (Plan A).

Year	Model (total/active)	Copies (gen/inf)	All copies	Speed (gen/inf)	Avg speed	Total tok/s (gen/inf)
2026	10T / 1.3T	30.3M / 8k	30.3M	~57 / ~1.0k	~57	1.7B / 7.9M
2028	97T / 3.0T	23.4M / 60k	23.5M	~65 / ~1.3k	~68	1.5B / 78.6M
2029	158T / 4.9T	28.9M / 123k	29.0M	~67 / ~1.5k	~73	1.9B / 185M
2032	862T / 18T	63.1M / 1.6M	64.6M	~89 / ~3.0k	~161	5.6B / 4.7B
2035	6,576T / 103T	154M / 21.7M	176M	~119 / ~6.0k	~844	18B / 130B
2040	31,063T / 243T	150M / 36.2M	186M	~192 / ~25.0k	~5.0k	29B / 904B
Speed of a frontier copy
inference-specialized
general-purpose
average

Per-copy decode speed by chip type (tokens/sec, log).

10
100
1k
10k
2026
2028
2030
2032
2034
2036
2038
2040
human working pace (~10 tok/s)
~25.0k
avg ~5.0k
~192

Speed. For speed we look at memory bandwidth. On general-purpose hardware, each decode step has to read the weights plus the context of every copy in the batch, so the number of tokens each copy gets per second is just how many times per second the hardware can read through its own memory. Memory bandwidth on the inference fleet is about 31x its memory capacity, giving ~31 full read-throughs per second, or ~57 tok/s per copy after a ~2x speculative-decoding gain and ~90% utilization. Conveniently, this guess does not depend on batch, context, model size, or sparsity, because a bigger memory footprint comes with proportionally more memory bandwidth. Speed then grows only as fast as bandwidth per H100e outpaces memory capacity per H100e, which we assume happens at ~10%/yr after 2029, reaching ~190 tok/s by 2040.

Inference-specialized chips. The biggest wildcard is chips specialized for serving specific models, with weights held in on-chip SRAM (à la Cerebras, Groq) or baked directly into the die (à la Etched, Taalas). Here we are guessing at every step: we hand-set the share of new compute production these chips take (0.2% in 2026, 1% at the deal, 14% by 2040, adding up to about half of the inference fleet's compute by then), and we hand-set how fast they serve each copy (~1,000 tok/s today, anchored to Cerebras' measured 969 tok/s on Llama-405B, rising to ~25,000 tok/s by 2040 once the 2035 pause freezes frontier models and makes it worth engineering chips close to the latency floor). Running each copy faster directly costs copies (copies = total token throughput / speed of each copy), so these chips add relatively few copies, but under these assumptions they end up producing almost all tokens by 2040 and pull the average speed from ~100 tok/s today to very roughly 5,000 tok/s, which is most of the speed growth in the figure above. If these chips don't take off, average speeds instead stay near the general-purpose ~190 tok/s path. The table below shows how much of its compute and bandwidth each part of the inference fleet actually uses.

Decode utilization of each resource, by chip type

Share of each chip type’s bandwidth and compute that decode uses; the binding (lower-ceiling) resource sets throughput.

Year	Gen: bandwidth	Gen: compute	Inf-spec: bandwidth	Inf-spec: compute
2026	90% (binds)	9.4%	90% (binds)	18%
2029	90% (binds)	3.3%	90% (binds)	21%
2032	90% (binds)	3.2%	90% (binds)	40%
2035	90% (binds)	3.3%	73%	90% (binds)
2040	90% (binds)	2.7%	23%	90% (binds)
Method for AI copies and speed
Appendix: the effective-H100e model
A.1 Goal

We want a way of estimating how useful a given cluster is for AI workloads relative to a typical H100 GPU cluster.

Comparing the raw H100-equivalents is a poor proxy, because they only measure peak compute, and for real AI workloads a cluster can be drastically more or less useful depending on other hardware factors, particularly memory bandwidth, memory capacity, scale-up networking, scale-out networking, and how many physical chips a typical workload must span. The output is

effective H100e
  
=
  
raw H100e
×
usefulness adjustment
,
effective H100e=raw H100e×usefulness adjustment,

where the usefulness adjustment is above 1 if the cluster is more useful per raw H100e than the H100 cluster anchor we consider, and below 1 if it's worse. The key design goals for the usefulness adjustment are:

Our H100 anchor cluster should have effective H100e equal to raw H100e.

Holding everything else constant, more memory bandwidth, memory capacity, scale-up networking, scale-out networking, or scale-up world size should help. This means an Nx improvement in any individual metric (all else equal) should be a 
≥
≥1x usefulness adjustment.

A cluster with equivalent total hardware performance, but spread over smaller devices can be worse, because at a fixed workload size it needs to spread over more chips, raising communication overhead. This means an Nx reduction in all per-chip metrics with an Nx increase in quantity (so cluster totals are the same) should be a 
≤
≤1x usefulness adjustment.

Bottlenecks should be soft, not hard: resources should trade off with each other, because it tends to be possible in AI workloads to readjust e.g., parallelism or other software-level choices to trade off different resources.

A.2 Inputs

The inputs are the chip and cluster properties, which we notate as:

𝐶
C: per-chip compute (H100e).

𝐵
B: per-chip memory bandwidth.

𝑀
M: per-chip memory capacity.

𝑆
𝑈
SU: per-chip scale-up bandwidth inside a given world-size (e.g., NVLink inside a rack).

𝑆
𝑂
SO: per-chip scale-out bandwidth outside the scale-up world but inside the full cluster.

𝑊
W: scale-up world size, in chips (the scale up domain GPU count, e.g. NVL72 
=
72
=72).

𝑁
N: number of chips in the cluster.

Our model is workload-dependent, meaning that it takes into account a workload size (in compute footprint). Rather than considering a single average workload, we use a spread of job sizes, each a fraction 
𝐿
𝑗
L
j
	​

 of the frontier scale 
𝐹
F, which is supposed to represent a frontier company's total compute, with job-count weights 
𝜔
𝑗
ω
j
	​

 (
∑
𝑗
𝜔
𝑗
=
1
∑
j
	​

ω
j
	​

=1) as follows, expressed as fractions 
𝐿
𝑗
L
j
	​

 of the frontier scale:

job	fraction 
𝐿
𝑗
L
j
	​

 of 
𝐹
F	weight 
𝜔
𝑗
ω
j
	​


small (inference, experiments)	
1
/
10,000
1/10,000	0.50
medium (large experiments, test runs)	
1
/
100
1/100	0.30
large (near-frontier training)	
1
/
5
1/5	0.20

Importantly, 
𝐿
𝑗
L
j
	​

 is a fraction of raw H100e compute, not physical chip count.

A.3 Anchor scenario

We use a 2024-style H100-SXM cluster as the anchor for raw=effective:

anchor (where raw=effective)	value
raw H100e per chip 
𝐶
0
C
0
	​

	1
memory bandwidth 
𝐵
0
B
0
	​

	3.35 TB/s
memory capacity 
𝑀
0
M
0
	​

	80 GB
scale-up bandwidth 
𝑆
𝑈
0
SU
0
	​

	0.9 TB/s
scale-out bandwidth 
𝑆
𝑂
0
SO
0
	​

	0.05 TB/s
scale-up world 
𝑊
0
W
0
	​

	8 chips (HGX-8)
cluster size 
𝑁
0
N
0
	​

	100K chips

Separately, the frontier scale we consider 
𝐹
F is time dependent. We model it as a growing share of total world compute (reflecting how frontier AI companies have a rising share of global compute), rising from ~6% (2025.0) to 9 / 13 / 16 / 18% (2026.0-2029.0), so absolute workload sizes climb each year and scale-out pressure rises alongside the world-size roadmap. By construction the anchor must output effective H100e 
=
𝐶
c
l
u
s
t
e
r
=C
cluster
	​

, i.e. usefulness adjustment 
=
1
=1 (verified in §A.9).

A.4 Workload footprint

For each bucket 
𝑗
j, the raw workload size (in compute needed) is

𝐶
j
o
b
,
𝑗
=
𝐿
𝑗
 
𝐹
.
C
job,j
	​

=L
j
	​

F.

The number of physical chips that workload needs assumes we spread it as thinly as the hardware allows. Dividing the job's compute by the per-chip compute 
𝐶
C gives the count we'd need if memory were free, which we then inflate by 
(
𝑀
0
/
𝑀
)
𝛿
(M
0
	​

/M)
δ
 to account for a memory-poorer chip holding a smaller slice of the job's weights and activations. We don't treat memory as a hard wall, though: the exponent 
𝛿
<
1
δ<1 reflects that you can partly trade capacity back (recomputing activations, offloading, finer sharding), so halving a chip's memory spreads the workload over somewhat more chips, not necessarily twice as many.

𝑛
r
e
q
,
𝑗
=
𝐶
j
o
b
,
𝑗
𝐶
(
𝑀
0
𝑀
)
𝛿
,
n
req,j
	​

=
C
C
job,j
	​

	​

(
M
M
0
	​

	​

)
δ
,

where 
𝛿
∈
[
0
,
1
]
δ∈[0,1] is the memory-footprint elasticity explained above (
𝛿
=
0
δ=0: capacity does not change the chip count; 
𝛿
=
1
δ=1: footprint scales inversely with capacity; we assume 
𝛿
=
0.5
δ=0.5 by default).

We call this the communication footprint 
𝑛
𝑗
=
𝑛
r
e
q
,
𝑗
n
j
	​

=n
req,j
	​

, because it's what drives the cross-chip traffic in the penalties below: the more chips a job is smeared across, the more it has to talk between them (§A.5). In the edge case where the workload fits on a single chip we floor it at one. Either weakness compounds into a bigger footprint: a chip with less compute needs more copies of itself to run the job, and a chip with less memory needs more copies to hold its state, so a weaker chip on either axis spreads the same workload over more chips and pays more communication cost.

We measure all of this against the anchor cluster running the same job: the reference footprint is 
𝑛
0
,
𝑗
=
𝐶
j
o
b
,
𝑗
/
𝐶
0
n
0,j
	​

=C
job,j
	​

/C
0
	​

, with no memory term because the anchor is 
𝑀
=
𝑀
0
M=M
0
	​

.

A.5 Scale-up versus scale-out traffic

Now we estimate what fraction of a workload's communication (
𝑝
S
U
p
SU
	​

) can stay inside the fast scale-up world. Comparing the workload's chip footprint 
𝑛
𝑗
n
j
	​

 (from §A.4) to the world size 
𝑊
W, let

𝑝
S
U
(
𝑛
,
𝑊
)
=
{
1
,
	
𝑛
≤
1


min
⁡
!
(
1
,
  
𝑊
−
1
𝑛
−
1
)
,
	
𝑛
>
1
,
𝑝
S
O
=
1
−
𝑝
S
U
.
p
SU
	​

(n,W)=
⎩
⎨
⎧
	​

1,
min!(1,
n−1
W−1
	​

),
	​

n≤1
n>1,
	​

p
SO
	​

=1−p
SU
	​

.

If the footprint fits inside the scale-up world (
𝑛
𝑗
≤
𝑊
n
j
	​

≤W), then 
𝑝
S
U
=
1
p
SU
	​

=1; if it is bigger, only a fraction of all-to-all-style communication is in-world. With chips that don't have a scale-up world (
𝑊
=
1
W=1), any workload larger than one chip is pure scale-out. This is a crude approximation for the traffic of AI workloads.

A.6 Resource penalties

The model computes resource penalties, each normalized so the anchor equals 1.

6.1 Memory-bandwidth penalty.

𝜏
𝐵
=
𝐶
/
𝐶
0
𝐵
/
𝐵
0
.
τ
B
	​

=
B/B
0
	​

C/C
0
	​

	​

.

If compute per chip outruns memory bandwidth per chip (both relative to the anchor), the chip is more bandwidth-bottlenecked (
𝜏
𝐵
>
1
τ
B
	​

>1). If bandwidth rises faster than compute, less so (
𝜏
𝐵
<
1
τ
B
	​

<1).

6.2 Networking penalty. This measures how communication-bound the cluster is versus the anchor on the same job. The communication bottleneck is higher when a chip has more compute (more work done per second needs more data exchanged to stay fed) and when its job spans more chips; we weight these against how fast the networking is.

We start with each cluster's effective inverse bandwidth 
𝑅
R (communication time per unit of data moved, so higher is worse). From §A.5, 
𝑝
S
U
p
SU
	​

 is the fraction of traffic inside the scale-up world, and 
1
−
𝑝
S
U
1−p
SU
	​

 is on scale-out, so 
𝑅
R blends the two fabrics by where the traffic goes. For the anchor:

𝑝
0
,
𝑗
=
𝑝
S
U
(
𝑛
0
,
𝑗
,
𝑊
0
)
,
𝑅
0
,
𝑗
=
𝑝
0
,
𝑗
𝑆
𝑈
0
+
1
−
𝑝
0
,
𝑗
𝑆
𝑂
0
,
p
0,j
	​

=p
SU
	​

(n
0,j
	​

,W
0
	​

),R
0,j
	​

=
SU
0
	​

p
0,j
	​

	​

+
SO
0
	​

1−p
0,j
	​

	​

,

and the same for the candidate cluster with its own footprint, world, and bandwidths:

𝑅
𝑗
=
𝑝
S
U
(
𝑛
𝑗
,
𝑊
)
𝑆
𝑈
+
1
−
𝑝
S
U
(
𝑛
𝑗
,
𝑊
)
𝑆
𝑂
.
R
j
	​

=
SU
p
SU
	​

(n
j
	​

,W)
	​

+
SO
1−p
SU
	​

(n
j
	​

,W)
	​

.

We model the communication penalty as the product of three things, each measured against the anchor: how many chips the job must span (
𝑛
𝑗
n
j
	​

), how fast each chip finishes its work (
𝐶
C), and how costly communication is on the cluster (
𝑅
𝑗
R
j
	​

). They multiply because communication time is the amount of data moved times the cost of moving it, so being worse on several axes at once compounds. With elasticity 
𝛾
=
0.15
γ=0.15 on the span:

𝜏
𝑁
,
𝑗
=
(
𝑛
𝑗
𝑛
0
,
𝑗
)
𝛾
(
𝐶
𝐶
0
)
𝑅
𝑗
𝑅
0
,
𝑗
.
τ
N,j
	​

=(
n
0,j
	​

n
j
	​

	​

)
γ
(
C
0
	​

C
	​

)
R
0,j
	​

R
j
	​

	​

.

Compute speed (
𝐶
/
𝐶
0
C/C
0
	​

) and communication cost (
𝑅
𝑗
/
𝑅
0
,
𝑗
R
j
	​

/R
0,j
	​

) enter linearly: a chip finishing its work 2x faster produces data to exchange 2x faster, and a link 2x costlier per byte takes 2x longer, so we model each as putting linear pressure on communication time. The span enters sublinearly (
𝛾
<
1
γ<1) because with 2x more chips any one chip does not move 2x more data: e.g., in a ring all-reduce the data each chip moves is constant (about twice the model size) whether the job runs on 100 chips or 100,000, since the per-chip chunks shrink as fast as the step count grows. However, the number of coordination steps (e.g., sync rounds, tree hops) does grow with chip count but only weakly. So overall we choose to model this with a 
0.15
0.15 exponent.

A.7 Combining bottlenecks

We combine the two penalties above with the compute bottleneck, weighted by importance shares 
𝛼
𝐶
+
𝛼
𝐵
+
𝛼
𝑁
=
1
α
C
	​

+α
B
	​

+α
N
	​

=1. Compute carries no penalty (it's 1 by definition because the penalties are compute-over-resource ratios, and for compute itself that ratio is just 
𝐶
/
𝐶
=
1
C/C=1), so 
𝛼
𝐶
α
C
	​

 is just the share of work we model as compute-bound, with 
𝛼
𝐵
α
B
	​

 and 
𝛼
𝑁
α
N
	​

 the shares set by the memory-bandwidth and networking penalties. We use a power mean rather than a hard bottleneck so the resources can partly trade off, with a default 
𝑞
=
1.5
q=1.5:

𝐷
𝑗
=
(
𝛼
𝐶
+
𝛼
𝐵
 
𝜏
𝐵
 
𝑞
+
𝛼
𝑁
 
𝜏
𝑁
,
𝑗
 
𝑞
)
1
/
𝑞
,
D
j
	​

=(α
C
	​

+α
B
	​

τ
B
q
	​

+α
N
	​

τ
N,j
q
	​

)
1/q
,

where 
𝐷
𝑗
D
j
	​

 is the slowdown relative to the H100 anchor. (
𝑞
=
1
q=1 is a simple Amdahl-style weighted average; 
𝑞
=
1.5
q=1.5, the default, makes large bottlenecks bite harder. In CES terms 
1.5
1.5 corresponds to an elasticity of substitution 
𝜎
=
1
/
(
1
+
𝑞
)
=
0.4
σ=1/(1+q)=0.4 between the resources). The usefulness adjustment is the weighted average of the penalty across workloads:

𝑈
=
∑
𝑗
𝜔
𝑗
1
𝐷
𝑗
,
effective H100e
=
𝐶
c
l
u
s
t
e
r
 
𝑈
.
U=
j
∑
	​

ω
j
	​

D
j
	​

1
	​

,effective H100e=C
cluster
	​

U.
A.8 Full equation
effective H100e
=
𝐶
c
l
u
s
t
e
r
 
𝑈
effective H100e=C
cluster
	​

U

where the usefulness adjustment 
𝑈
U is

  
𝑈
=
∑
𝑗
𝜔
𝑗
(
𝛼
𝐶
+
𝛼
𝐵
[
𝐶
/
𝐶
0
𝐵
/
𝐵
0
]
𝑞
+
𝛼
𝑁
[
(
𝑛
𝑗
𝑛
0
,
𝑗
)
𝛾
𝐶
𝐶
0
𝑅
𝑗
𝑅
0
,
𝑗
]
𝑞
)
−
1
/
𝑞
  
U=
j
∑
	​

ω
j
	​

(α
C
	​

+α
B
	​

[
B/B
0
	​

C/C
0
	​

	​

]
q
+α
N
	​

[(
n
0,j
	​

n
j
	​

	​

)
γ
C
0
	​

C
	​

R
0,j
	​

R
j
	​

	​

]
q
)
−1/q
	​

A.9 Why this satisfies the desired properties

Property 1: anchor raw equals effective. In the anchor 
𝐶
=
𝐶
0
,
 
𝐵
=
𝐵
0
,
 
𝑀
=
𝑀
0
,
 
𝑆
𝑈
=
𝑆
𝑈
0
,
 
𝑆
𝑂
=
𝑆
𝑂
0
,
 
𝑊
=
𝑊
0
C=C
0
	​

, B=B
0
	​

, M=M
0
	​

, SU=SU
0
	​

, SO=SO
0
	​

, W=W
0
	​

 and 
𝑛
𝑗
=
𝑛
0
,
𝑗
n
j
	​

=n
0,j
	​

, so 
𝜏
𝐵
=
1
τ
B
	​

=1 and 
𝜏
𝑁
,
𝑗
=
1
τ
N,j
	​

=1. Hence 
𝐷
𝑗
=
(
𝛼
𝐶
+
𝛼
𝐵
+
𝛼
𝑁
)
1
/
𝑞
=
1
D
j
	​

=(α
C
	​

+α
B
	​

+α
N
	​

)
1/q
=1 and effective H100e 
=
𝐶
c
l
u
s
t
e
r
=C
cluster
	​

 exactly.

Property 2: more resources help. Increasing 
𝐵
B lowers 
𝜏
𝐵
τ
B
	​

. Increasing 
𝑀
M lowers the footprint 
𝑛
𝑗
n
j
	​

, hence 
𝜏
𝑁
,
𝑗
τ
N,j
	​

. Increasing 
𝑆
𝑈
SU or 
𝑆
𝑂
SO lowers 
𝑅
𝑗
R
j
	​

. Increasing 
𝑊
W raises 
𝑝
S
U
p
SU
	​

, shifting traffic from slow scale-out to fast scale-up (which helps when 
𝑆
𝑈
>
𝑆
𝑂
SU>SO); the effect saturates once 
𝑊
≥
𝐶
j
o
b
W≥C
job
	​

, i.e. once the workload already fits inside the scale-up world. Each raises effective H100e.

Property 3: same total compute, smaller chips. Rebuild the anchor cluster from chips that are 
𝑘
×
k× weaker on every per-chip metric but 
𝑘
×
k× more numerous, so the cluster totals are unchanged: 
𝐶
′
=
𝐶
0
/
𝑘
,
 
𝐵
′
=
𝐵
0
/
𝑘
,
 
𝑀
′
=
𝑀
0
/
𝑘
,
 
𝑆
𝑈
′
=
𝑆
𝑈
0
/
𝑘
,
 
𝑆
𝑂
′
=
𝑆
𝑂
0
/
𝑘
C
′
=C
0
	​

/k, B
′
=B
0
	​

/k, M
′
=M
0
	​

/k, SU
′
=SU
0
	​

/k, SO
′
=SO
0
	​

/k with 
𝑘
×
k× the chip count and the same workloads 
𝐶
j
o
b
,
𝑗
C
job,j
	​

.

Total raw H100e is identical, yet usefulness falls below 1, because each job must now span more chips. The footprint grows superlinearly because the two per-chip cuts compound: weaker compute means each chip holds only 
1
/
𝑘
1/k of the job, needing 
𝑘
×
k× more chips, and smaller memory inflates that by a further 
𝑘
𝛿
k
δ
 (by the memory elasticity 
𝛿
δ), so the chip count rises by 
𝑘
1
+
𝛿
k
1+δ
, more than 
𝑘
k since 
𝛿
>
0
δ>0:

𝑛
𝑗
′
𝑛
0
,
𝑗
=
𝐶
0
𝐶
′
(
𝑀
0
𝑀
′
)
𝛿
=
𝑘
⋅
𝑘
𝛿
=
𝑘
1
+
𝛿
n
0,j
	​

n
j
′
	​

	​

=
C
′
C
0
	​

	​

(
M
′
M
0
	​

	​

)
δ
=k⋅k
δ
=k
1+δ

Bandwidth balance is unchanged, and in 
𝜏
𝑁
,
𝑗
τ
N,j
	​

 the per-chip compute and the inverse-network cancel (smaller per-chip compute is offset by a correspondingly slower network), leaving only the footprint term:

\tau'_B = \frac{C'/C_0}{B'/B_0} = \frac{1/k}{1/k} = 1, \qquad \tau'_{N,j} = \left(\frac{n_'j}{n_{0,j}}\right)^{\gamma}\frac{C'}{C_0}\frac{R'_j}{R_{0,j}} \;\gtrsim\; \big(k^{1+\delta}\big)^{\gamma}\cdot\underbrace{\frac{1}{k}\cdot k}_{=\,1} \;=\; k^{(1+\delta)\gamma} > 1.

Hence

𝐷
𝑗
′
≳
(
𝛼
𝐶
+
𝛼
𝐵
+
𝛼
𝑁
 
𝑘
(
1
+
𝛿
)
𝛾
𝑞
)
1
/
𝑞
>
1
,
𝑈
=
∑
𝑗
𝜔
𝑗
𝐷
𝑗
′
<
1.
D
j
′
	​

≳(α
C
	​

+α
B
	​

+α
N
	​

k
(1+δ)γq
)
1/q
>1,U=
j
∑
	​

D
j
′
	​

ω
j
	​

	​

<1.
  
same total compute, 
𝑘
×
 more chips each 
𝑘
×
 weaker
  
⇒
  
usefulness
<
1
  
same total compute, k× more chips each k× weaker⇒usefulness<1
	​


With the default parameters the usefulness adjustment is:

𝑈
=
1
𝐷
(
𝑘
)
≈
(
𝛼
𝐶
+
𝛼
𝐵
+
𝛼
𝑁
 
𝑘
(
1
+
𝛿
)
𝛾
𝑞
)
−
1
/
𝑞
=
(
0.75
+
0.25
 
𝑘
0.3375
)
−
2
/
3
,
U=
D(k)
1
	​

≈(α
C
	​

+α
B
	​

+α
N
	​

k
(1+δ)γq
)
−1/q
=(0.75+0.25k
0.3375
)
−2/3
,

which gives the following values for these values of 
𝑘
k:

𝑘
k	usefulness adjustment 
𝑈
U	
𝐷
(
𝑘
)
=
1
/
𝑈
D(k)=1/U
0.1	1.10x	0.91x
0.5	1.04x	0.96x
2	0.96x	1.04x
10	0.84x	1.19x
100	0.64x	1.55x
1000	0.45x	2.23x

For weaker chips (
𝑘
>
1
k>1) the penalty is real but moderate; it strengthens with larger 
𝛾
γ, 
𝛼
𝑁
α
N
	​

, 
𝑞
q, or 
𝛿
δ, or when larger jobs spill from scale-up to scale-out. For 
𝑘
<
1
k<1 (fewer but stronger chips, e.g. the 
𝑘
=
0.1
k=0.1 row) the opposite holds and 
𝑈
>
1
U>1.

A.10 Default parameters and results

Default parameters (uncertain, hand-picked):

parameter	value	role

𝛼
𝐶
α
C
	​

	0.55	irreducible compute-bound share

𝛼
𝐵
α
B
	​

	0.20	memory-bandwidth-sensitive share

𝛼
𝑁
α
N
	​

	0.25	networking-sensitive share

𝑞
q	1.5	bottleneck sharpness (1 = Amdahl, →∞ = max)

𝛿
δ	0.5	how much low capacity inflates the footprint

𝛾
γ	0.15	how much footprint size raises comms pressure

On our projection of the frontier workload size and the average resource properties of the different compute categories from §1.2, we get the following usefulness adjustment to the raw compute:

effective per raw (
𝑈
U)	2024	2026	2028	2029
AI	1.16	1.06	1.04	1.02
non-AI servers	1.38	1.40	1.41	1.40
PCs	0.35	0.08	0.04	0.03
phones	0.21	0.11	0.07	0.05
gaming GPUs	0.04	0.05	0.06	0.04
other	0.53	0.43	0.34	0.30

Note that 
𝑈
U is measured per unit of raw compute, which is why non-AI servers score highest: a CPU server carries very little compute per chip but wraps it in generous memory, bandwidth, and datacenter networking, so each of its (few) H100e is unusually well fed. The AI fleet starts slightly above 1 (memory-rich H100s versus the anchor) and drifts toward 1 as the memory wall bites, while single-devices score far below 1 because they fail on networking, not compute.

You can also run the model yourself: enter any chip/cluster spec below (or start from a preset) and read off its usefulness adjustment and effective H100e.

datacenter:
H100 SXM (anchor)
A100 SXM
B200 NVL72
Rubin Ultra NVL576 (est.)
CPU server
consumer:
budget Android
iPhone (A18 Pro)
MacBook (M4 Pro)
PS5
RTX 4060
RTX 4090
PER-CHIP SPEC
compute
H100e
memory bandwidth
TB/s
memory capacity
GB
scale-up bandwidth
TB/s
scale-out bandwidth
TB/s
scale-up world
chips
workload year
2026
RESULT
usefulness U
0.023×
effective H100e per chip
0.008
= 0.33 raw × 0.023 usefulness
BY WORKLOAD SIZE
U = 1 (anchor)
0.022×
small jobs (1/10,000)
weight 50%
0.023×
medium jobs (1/100)
weight 30%
0.023×
large jobs (1/5)
weight 20%
Usefulness calculator - ai-2040.com

Runs the exact appendix model (A.8) with the published parameters against the chosen year's frontier scale. Headline U is the job-mix weighted average; the bars show each job size alone, so you can see where a spec pays its penalty: hatched ink above the U = 1 anchor line, red below. Compute in H100e (= TPP / 15,800); a chip with no real scale-up fabric is W = 1. Datacenter presets follow the supplement's definition tables; the consumer devices and Rubin Ultra are rough public-spec estimates, with networking set to deployment-realistic sustained links (shared WiFi, home ethernet) rather than port peaks, which is what pulls consumer U down to the appendix table's ~0.05-0.2 range. It also produces the model's signature inversion: a budget phone outscores a flagship GPU per unit of compute, because more compute behind the same thin link is more stranded.

### Additional content revealed by tabs / alternate choices

- 50M
- 150M
- 5.3M
- 14M
- 36M
- 81M
- 160M
- 400M
- 20M
- 35M
- 74M
- 157M
- 314M
- 75M
- 225M
- 17M
- 43M
- 104M
- 18M
- 224M
- 26M
- 39M
- 5Q
- 1T
- 10B
- 100B
- 10T
- 100T
- 1Q
- 10Q
- 100Q
- installed H100-equivalents, log scale
- Source: Epoch AI — hyperscaler capex
- 5.1M
- ×2.7
- 33M
- 79M
- 190M
- $1T
- $2T
- $260B
- $448B
- $797B
- $1.4T
- Hyperscaler cash flow (existing trend)
- AI cash flow
- Debt & equity raises
- saturation
- 7%
- 27%
- 45%
- 65%
- $20K
- $40K
- $60K
- $51K
- $33K
- $23K
- $18K
- $16K
- EUV exposure-passes drawn per year (the absolute view the share hides). Volume EUV begins ~2019; it's ~all phones/PCs early, AI invisible until ~2022.
- 0M
- 12M
- 23M
- 46M
- Raw H100e added per year by category.
- 5M
- 15M
- EUV exposure-passes drawn per year. AI's draw explodes, taking the fleet toward saturation by 2028.
- 47M
- 93M
- 140M
- 4M
- 8M
- 0.9M
- 1.7M
- 3.4M
- 6.8M
- 13M
- Domestic
- Legal imports
- Loopholes (offshore DCs / rental)
- Smuggled
- $100B
- $1.0T
- $10T
- $100T
- $2.43T
- $47T
- Frontier model size, 2022 to 2040
- reported
- ours (α=0.5)
- α ∈ [0.2, 0.8]
- Nesov
- 100k
- 1M
- Trillion parameters
- GPT-4 ~1.8T
- α=0.8
- α=0.2
- ~650T (Nesov)
- 31,000T
- ~158T
- Inference memory by chip type
- Serving memory by chip type (exabytes, log). Specialized memory is derived from demand (replica weights + KV per copy): ~2.3 ZB by 2040 vs ~10 ZB general-purpose.
- 10 ZB
- 2 ZB
- 0.93×
- 0.93
- = 1.00 raw × 0.93 usefulness
- Our AI revenue forecast follows a total frontier AI company ARR (annualized revenue run-rate) path of $30B → $180B → $500B → $1T (year-boundaries 2026.0 through 2029.0). Note that AI revenue is the flow recognized over the year, not the ARR run-rate, so this converts to annual recognized revenue of 2025: $15B / 2026: $84B / 2027: $313B / 2028: $721B. We count 80% of this as additional compute spend (the "AI cash flow" stream above) giving: $12 / $67 / $251 / $577B. Our total frontier AI company ARR projection is done manually and is highly uncertain. Broadly speaking we expect Anthropic's recent ~10x/yr ARR trend to slow down as they become the leading AI company in terms of revenue, and for the overall total AI company revenue trend to return to roughly 3x/yr, and slightly lower as companies manage to maintain roughly flat revenue / inference-compute ($/FLOP) while their inference-compute grows around 2x/yr in the later years. This is somewhat circular with the compute numbers, but is our current (highly uncertain) expectation.
- What's a reasonable debt-raising rate given this revenue trend? For starters, the five hyperscalers issued ~$121B of bonds in 2025 (vs a ~$28B/yr 2020-24 norm), with BofA/JPMorgan projecting ~$175-300B in 2026; debt-funded neoclouds like CoreWeave carry ~4x revenue in debt ($21B on ~$5B revenue); and this Morgan Stanley podcast sees ~$1.15T of the ~$2.9T 2025-28 buildout as debt-financed. Total US investment-grade issuance is ~$1.5T/yr. The SpaceX IPO also shows the potential for large equity raises that might be followed with similar/larger ones by OpenAI and Anthropic. We use these anchors to manually set debt as an ad-hoc multiple of total AI revenue, 3x (2025) → 2.8x (2026) → 1.8x (2027) → 1.6x (2028), giving debt-financed AI capex of ~$36B / $188B / $452B / $923B over 2025-2028. That sums to ~$1.6T of debt-financed spending out of the ~$5.1T total buildout (2025-2028; ~31% debt-financed), roughly 39% above Morgan Stanley's ~$1.15T of debt, and ~75% above their ~$2.9T total, respectively, though notably Morgan Stanley's numbers ignore equity-raises.
- AI's claim on the fleet comes from both logic and memory, so we add the two in a single unit: an EUV pass = one EUV exposure of one wafer (a tool images ~360k/yr regardless of what it's printing). Here is the 2025 build-up.
- 1. Fleet → passes. Each scanner runs only ~40-50 wph-equivalent in practice, versus a ~160 wafers-per-hour nameplate: real patterns need longer exposures than the spec assumes (higher dose, limited by the light source's power), tools are only up ~75-82% of the time, and time is lost stepping between exposure fields (reticle overhead). Netting these out gives ~360,000 effective passes/tool/yr (the naive 160 wph x 8,760 h ≈ 1.1-1.4M is 3-4x too high). Two back-calculations agree: Frederick Chen (<50 wph effective) and SemiAnalysis (~1,500 wafers/mo x ~20 exposures). Starting from ~220 operating tools at the start of 2024 (ASML had ~127 EUV in use at end-2021, then shipped ~54 and ~42 in 2022-23; TSMC alone runs ~56% of capacity) the fleet does ~100M passes/yr in 2025, growing to ~220M by 2029 as ASML's EUV shipments accelerate (~48 in 2025 toward ~120/yr by 2029).
- 2. AI's logic draw. AI accelerators take ~0.4M leading-edge wafers in 2025, roughly ~12% of TSMC's ~3M ≤5nm wafers (Epoch's direct estimate; Blackwell on N4, Nvidia only now ramping into N3). At N4's ~14 EUV layers that is ~5M passes. (An ~800mm² die yields ~42 good dies/wafer at ~70% yield, per Cerebras; at ~28-36 H100e/wafer today → ~120 by 2029 as FP4 + the N4→N3→N2 shrink + Rubin's high H100e/chip compound, the all-logic ceiling is ~200M → ~1.2B H100e/yr. The shrink is not free EUV-wise: the model charges a growing pass count per logic wafer, ~12 in 2024 rising to ~24 by 2029, as more layers move onto EUV.)
- 3. AI's memory draw (the larger half). Essentially all HBM goes to AI, and HBM uses a lot of wafers per GB. Reported 2025 HBM TSV/back-end capacity is ~400k wafers/month (SK Hynix ~170k + Samsung ~165k + Micron ~60k, TrendForce), but that's a capacity ceiling, not utilized starts. Netting yields, AI's actual draw is ~2.5M HBM core-wafers/yr: a 24Gb-die DRAM wafer holds ~1,400 GB gross, and after ~57% core+stacking (KGSD/TSV) yield and ~88% CoWoS-assembly yield only ~700 net GB ship per started wafer, while the 2025 fleet needs ~1.8B GB of HBM (bottom-up: ~11.7M accelerators x ~150 GB, cross-checking the ~$35B / ~2B-GB industry total). The leading HBM nodes use real EUV (SK Hynix 1b ~4 layers, 1c ~6), so at ~4 layers that is ~10M passes, roughly two thirds of AI's EUV draw. (Per GB, HBM burns ~3x a DDR5 wafer.)
- 4. AI's fleet share. Logic (~5M) + HBM (~10M) = ~15M passes / ~104M fleet ≈ 15% in 2025. Rising HBM volume and EUV-layer count, plus AI's migration onto EUV-heavy N3/N2 logic, carry it to ~64% by 2028 and ~77% by 2029, with AI approaching saturation of the EUV fleet around 2029-30. This draw feeds back into the cost surcharge (more EUV use means a higher surcharge and fewer H100e per dollar), so it is solved self-consistently, and it is what trims the late buildout (2028 additions ~155M vs a naive ~190M).
- 5. Why passes and not wafer counts. AI's wafers are a mix: an HBM wafer takes only ~4 EUV passes while a leading-edge logic wafer takes ~14-22, so counting wafers treats very different claims on the fleet as equal. Since AI's wafer mix is HBM-heavy, a wafer count overstates its early share (it would put 2025 well above the ~15% the pass count gives). The two measures converge by 2029 for a simple reason: by then AI is the majority user of both the logic and the HBM wafer pools, so the mix difference stops mattering and either way of counting lands around ~80%.
- The cost figure is an identity, $/H100e = (all-in $/wafer) / (H100e per wafer), and we have decent estimates of two of the three quantities, so we back out wafers per $B (the inverse of all-in $/wafer) as the residual and then check whether the wafer cost it implies is sensible.
- $/H100e (known). 2024/25 are observed (annual capex / H100e added: ~$51K, ~$33K). For 2026-28 we take the ~1.4x/yr price-performance trend and penalize it by the EUV surcharge, giving ~$23K / ~$18K / ~$16K.
- H100e per wafer (known, ~28 → ~98). An ~800mm² reticle-limit die yields ~64-72 gross dies per 300mm wafer, ~42 good at ~70% yield; netting downstream losses (packaging yield) leaves ~28 sellable H100e per wafer in 2024. This climbs ~1.4x/yr to ~98 by 2028 (~120 by 2029) from FP4/precision (EUV-free), the N4→N3→N2 shrink (paid in extra EUV layers), and Rubin's high H100e/chip, all reasonably well grounded in die-size, node, and precision estimates. (2025 check: ~13.6M H100e on ~0.38M AI leading-edge wafers ≈ ~36 H100e/wafer.)
- Wafers per $B (the residual). Multiplying the two backs out the implied all-in $/wafer: ~$1.43M (2024) → ~$1.18M (2025) → ~$1.20M → ~$1.36M → ~$1.56M (2028), i.e. wafers/$B ~700 → ~845 → ~640. The 2025 dip comes directly from the observed data: 2024 was early and supply-constrained, and 2025 hit Blackwell volume, so all-in cost per leading-edge wafer fell. From 2026 the implied $/wafer rises, which is what we'd expect: TSMC ASP +5-10%/yr (N2 ~$30K, +10-20% over N3), CoWoS +15-20%/yr, datacenter $/MW rising, plus the EUV surcharge. The level also checks against a bottom-up build-up (foundry ~$25-30K + HBM ~$50-70K + CoWoS ~$10-15K, with a ~4-5x chip-designer markup giving a ~$400-500K accelerator, and the remaining ~$0.7-1.1M being the non-chip buildout: datacenters, power, land, networking). So the residual looks reasonable: wafer costs are a mild headwind after 2025, and the whole ~$51K to ~$16K decline in $/H100e comes from compute density improvements.
- Even for the AI fleet, effective and raw H100e drift apart. The memory wall drags effectiveness below 1 (TPP, boosted by FP4, outgrows HBM bandwidth and capacity), while the growing coherent NVLink world (HGX-8 → NVL72 → NVL144 → NVL576) pushes it back up. The two roughly cancel: there is a mild premium in 2024 (~1.16, when the fleet is memory-rich) that fades toward ~1 by 2029 as the memory wall and larger training runs start to matter more. It is the same usefulness model as §1.2.3 (full derivation in the appendix); the deployment-weighted fleet inputs that drive it (scale-up world in H100e = coherent chips x H100e/chip):
- AI fleet (deployment-weighted)	2024	2026	2028
- HBM bandwidth per H100e (GB/s)	4,080	3,330	3,610
- HBM capacity per H100e (GB)	110	91	85
- scale-up world (H100e)	184	436	929
- H100e per chip	1.15	2.58	5.34
- effective H100e per raw	1.16	1.06	1.04
- Compute per wafer is just (good dies per wafer) x (TPP per die) / 15,800, both estimated from device specs independently of how full the fabs run:
- Good dies per 300mm wafer (yield-net, from die areas; sources in the wafer box above): AI ~42 (an ~800 mm² reticle-limit die at ~70% yield), gaming ~130 (~400 mm²), PCs ~300 (~200 mm²), phones ~600 (~100 to 120 mm²), commodity 'other' ~1,800 (~30 mm²).
- TPP per die = each category's TPP per unit (device side above) / its dies per device. In 2024 AI is ~9,500 / ~1.5 ≈ 6,300 TPP/die, gaming ~1,500, phones and PCs ~100, 'other' ~1.5.
- So AI's big, high-TPP dies make it densest per wafer and commodity 'other' (tiny, near-zero-TPP dies) the lowest, which is exactly what dividing each category's compute by its wafers gives:
- implied H100e / wafer	2015	2018	2020	2022	2024
- phones	0.03	0.23	1.1	2.4	3.8
- pcs	0.20	0.46	0.83	1.3	1.9
- gaming	0.19	2.8	5.6	9.2	12.3
- ai	1.4	5.0	7.2	14.2	16.8
- non-AI servers	0.11	0.25	0.46	0.90	1.3
- other	0.01	0.04	0.06	0.09	0.10
- As a further check, the wafer demand these rates imply, set against our estimated lithography pool (broad global logic-wafer output, ~30M wafers in 2024, a scale consistent with SEMI's 300mm capacity), is ~62% to ~69% of the pool across the decade: a plausible, stable share that never runs past the pool. The pool level is itself calibrated to land in that range, so this says the die-size, compute, and capacity estimates are mutually consistent rather than independently validating any one of them.
- Channel	2024	2025	Basis
- Domestic	0.25M	0.6M	Ascend on SMIC ≤7nm + Cambricon, drawing a one-time foreign-HBM stockpile (~13M stacks, mostly Samsung ~11.4M ≈ 1.6M 910C) and a ~2.9M-die TSMC "die bank" (SemiAnalysis); ~0.8 raw H100e/910C
- Legal	0.2M	0.15M	~1M throttled H20s in 2024 (~0.2 H100e each); 2025 nets only ~0.15M: Q1 shipments before the April ban, a partial re-licensing from July, and Beijing discouraging purchases
- Loopholes	0.25M	0.45M	offshore DCs Chinese firms own or rent abroad; the cumulative 2024+2025 total here (~0.7M by end-2025) sits just above the ≥~670K confirmed-rental floor (ByteDance ~520K)
- Smuggled	0.16M	0.48M	grey-market banned parts, anchored to Epoch
- The three global channels are projected as a share of §1.1 world production:
- Global channel	Rule (share of §1.1 world)	2026	2027	2028
- Smuggled	~3.5% → 2% with more enforcement	1.26M	2.12M	2.99M
- Loopholes	~2% (~1.5% confirmed-rental floor + other sources)	0.7M	1.6M	3.15M
- Legal	~1%	0.35M	0.8M	1.6M
- The legal channel could plausibly run 2-3x higher than this ~1% rule: the current licensing policy already covers volumes above it, though Beijing-side import restrictions push realized shipments back down.
- Domestic is HBM-bound; see the recent SemiAnalysis CXMT piece:
- Domestic build-up	2026	2027	2028
- CXMT HBM capacity (kwspm starts)	30	55	100
- 8-hi stack yield (maturing)	25%	31%	37%
- good 8-hi stacks per wafer (~88 gross x yield)	22	27	33
- → good 910C-equiv/yr (kwspm x 12k x stacks / 8)	1.0M	2.2M	4.9M
- raw H100e per 910C-equiv (logic + HBM3E gains)	0.80	0.82	0.85
- → raw H100e on CXMT memory	0.8M	1.8M	4.2M
- uplift: smuggled HBM + other firms	+30%	+25%	+20%
- = Domestic	1.1M	2.3M	5.0M
- This is optimistic: we take CXMT's HBM ramp at face value (the SemiAnalysis CXMT piece projects it to ~12% of global HBM wafer supply by 2028), though that ramp is back-loaded (the 2026 column could plausibly be near zero) and competes with higher-margin commodity DRAM for the same fab.
- DUV capacity is abundant. Ascend logic and CXMT memory both print on China's ArF-immersion (DUV) fleet; these AI chip projections only use a small fraction of it:
- DUV immersion fleet	2026	2028	Basis
- Fleet (tools)	~290	~400	~200 base + ~90 ArFi bought in 2024 (mostly NXT:1980Fi-class, 275-330 wph; 70% of ASML's 129, $5-7B); imports since slowed by Dutch controls (AEI)
- Realized capacity (passes/yr)	~520M	~720M	fleet x ~1.8M realized passes/tool/yr (~5-6k wafers/day in production vs the ~2.4M nameplate; cf. §1.1's ~360k EUV)
- Ascend logic	~5M (~1%)	~17M (~2%)	~8 → 28 kwspm SMIC ≤7nm starts x ~40-60 passes/wafer (SAQP quad-patterning)
- CXMT HBM	~4M (~1%)	~12M (~2%)	~30 → 100 kwspm CXMT HBM starts x ~10 passes/wafer
- The AI draw is ~2% of fleet capacity in 2026, ~4% by 2028; the binding constraint is HBM. This is also why we don't expect China to simply flood its DUV fleet with AI chips: more Ascend logic without matching HBM doesn't add usable AI compute, SMIC's ≤7nm starts are capped by multi-patterning yield and cost rather than scanner availability, and most of the fleet profitably serves the mature-node economy (autos, industrial, appliances) that China is also trying to dominate.
- Setup. We take the total AI compute C (§1.1) and a datacenter count N (~1,000 sites in 2025, growing at a default 30%/yr to reach ~2,850 sites by 2029). We then allocate the datacenter sizes based on a size distribution.
- Anchors. We pin the shape of the size distribution with three concentration anchors, the share of all compute held by the largest 1, 10, and 100 clusters,
- ,S
- , which we forecast to be roughly 4%, 20%, and 70% (hand-set, adjusted up from Epoch's datacenter dataset), held flat over time:
- 𝑐
- ⋯
- =c
- =(c
- +⋯+c
- )/C
- Fit. We then model log-size as a cubic in log-rank, with four coefficients
- 𝑎
- 𝑏
- 𝑑
- a,b,c,d:
- log
- 𝑖
- log(c
- i
- )=a+blog(i)+clog(i)
- +dlog(i)
- Those four coefficients are pinned exactly by four equations, the three anchors plus the total (a cubic in log-rank has four degrees of freedom, matching the four constraints, so the curve is fully pinned with no free parameters left over):
- (c
- =S
- The first is immediate, since
- log1=0 gives
- a=logc
- =log(S
- C); the other three are solved numerically. This recovers every datacenter size
- from just N, C, and the three anchors.
- Regions. To split the curve across the US, China, and the Rest of the World, we forecast each region's ownership share
- 𝑟
- of total compute (giving it a target
- 𝑇
- T
- C) and assign each datacenter to a region in proportion to that share. An optional skew
- 𝜃
- θ
- can tilt a region toward smaller or larger sites (to match a region whose biggest clusters are known to differ, e.g. China) while keeping its total fixed, but it is off by default (
- 𝐻
- 𝑜
- CH
- =θ
- =0), so each region is just a same-shape slice of the global curve.
- Default parameters.
- parameter	default	what it controls
- (sites in 2025)	1,000	datacenter count in 2025
- growth
- 𝑔
- g	30% / yr	datacenter-count growth (→ ~2,850 sites by 2029)
- 4%	compute share of the single largest cluster
- 20%	compute share of the largest 10
- 70%	compute share of the largest 100
- skew
- ,θ
- 0 (off)	optional regional size tilt; 0 = proportional
- These concentration shares are hand-picked and uncertain, adjusted up from Epoch's observed current dataset on the assumption that it does not have full coverage of frontier clusters (its largest tracked sites cover ~15% of global AI compute as of late 2025).
- The cost per unit of AI compute is one 2025 anchor times two indices that both start at 1 and fall over time, a manufacturing index
- 𝑡
- W(t) and a design index
- D(t):
- MC(t)=MC
- ×W(t)×D(t)
- Wright's law (manufacturing). Cost falls with cumulative production, the classic learning curve:
- 𝑄
- m
- W(t)=(Q
- cum
- (t)/Q
- (2025))
- −b
- so each doubling of cumulative output cuts manufacturing cost by
- 1−2
- . We use
- b=0.25, about 16% per doubling, similar to the long-run semiconductor learning rate (close to Swanson's law for solar).
- Jones design R&D. The annual design-cost decline scales with more labor doing R&D, with diminishing returns:
- rate
- a
- g
- rate(t)=r
- base
- (L
- cog
- (t)/L
- λ
- ,D(t+1)=D(t)(1−rate(t))
- is combined human and AI cognitive labor (which scales with deployed compute) which is taken from the 'effective labor' quantity from our economic model that combines AI / robot labor quantities with its capability (% of tasks it is able to automate).
- is the base pace, and
- λ is the "stepping on toes" adjustment (Bloom et al. 2020): a 100x research force buys far less than 100x the progress.
- Parameter	AI chips
- Wright learning
- b	0.25 (~16% / doubling)
- Jones base rate
- 25% / yr
- Jones stepping-on-toes
- λ	0.05
- 2025 cost to make	$5,000 / H100e
- Cumulative output, 2025	20M H100e
- The base rate (25%/yr) tracks the ~1.35x/yr compute-efficiency trend, and
- λ=0.05 keeps stepping-on-toes strong: a 100x AI research force buys only ~1.3x the design-progress rate, so even the swelling AI workforce only modestly accelerates chip design. The anchor above is the cost to make a chip (marginal production cost, ~$5K in 2025), which is what the cost figure tracks; markups plus datacenter and power bring the all-in cost to ~$33K, which is what the $-invested figure counts. Both fall along the same
- W×D curve. Below we run this loop with and without Plan A's two constraints, the compute cap and the R&D controls.
- All three scenarios follow Plan A's compute path until the cap starts to bind (~2034), then differ on two levers:
- Compute cap (cap-and-trade, 2032 on). On: installed compute is pinned to the Plan A policy path, ~1T H100e by 2040. Off: an unconstrained reinvestment loop sets the quantity and it runs away.
- Hardware R&D. Controlled: chip-design progress is held to its historical Moore's-law pace. Unconstrained: the hardware-R&D effective labor is the economic model's effective AI labor (capability x quantity), so the design-cost decline accelerates with it (base rate 25%/yr, stepping-on-toes
- λ=0.05, capped at 60%/yr).
- Scenario	Compute cap	Hardware R&D	What happens
- Plan A	on, ~1T by 2040	controlled	the bounded path the rest of the document uses
- no cap, hardware R&D controlled	off	controlled	quantity explodes to thousands of times the cap
- no cap + hardware R&D unconstrained	off	unconstrained	quantity and cost both run away, off the chart
- Effective labor is the same series in every scenario (the econ model's A_eff, capability x quantity, scaled by that scenario's compute); the R&D control acts on how much of it becomes design progress, not on the labor total:
- Hardware R&D	effective AI labor, 2040 (HE = human-equivalents)	design-cost decline
- controlled (Plan A)	~400B HE	~10%/yr, held at the historical Moore's-law pace
- controlled (no cap)	~2x10^15 HE	~10%/yr, still held despite the vastly larger workforce
- unconstrained (both)	~2x10^21 HE	25%/yr, scaling to a 60%/yr cap
- The unconstrained rate is exactly the economic model's Jones formula (25%/yr x (A_eff growth)^0.05,
- λ=0.05); the controlled cap is Plan A's R&D-control policy layered on top, which the base economic model does not impose.
- What share of effective labor does R&D? A fixed, constant share of the effective labor; only its growth matters, so the share cancels and we do not commit to a specific percentage. That effective labor is the economic model's effective AI labor (A_eff, capability x quantity), scaled by each scenario's compute relative to Plan A, so R&D progress responds to both rising capability and rising quantity. Robots are held on their fixed Plan A cap-and-trade path and are not varied across these scenarios.
- The compute production possible by default in Plan A is modelled relatively naively, and the cap-and-trade trajectory is set considerably lower due to other constraints (verification and deal stability). In this box we motivate the cap-and-trade trajectory being possible with an illustration of what it implies on the supply side. In particular we look at the lithography it would require compared to historical growth.
- Method. We take Plan A's annual production (new H100e per year, rising to roughly 570 billion H100e/yr by 2040) and convert it to silicon wafers (assuming this remains the paradigm), convert the wafers to lithography exposure-passes needed and then divide by one lithography machine's throughput (realized passes per machine-year) to get the machine-years needed.
- machines needed
- new H100e
- litho passes per H100e
- passes per machine-year
- machines needed(t)=
- passes per machine-year(t)
- new H100e(t)×litho passes per H100e(t)
- Default lithography fleet. We anchor at 2029 (about 0.7 EUV passes per H100e, from §1.1) and compare against the lithography fleet on its historical path (about 620 operating machines in 2029, growing roughly 20%/yr; ASML ships about 125/yr today). We also let machine throughput rise about 10%/yr, matching the historical climb in wafers-per-hour (roughly 125 to 220 over 2019 to 2024).
- Default compute density. Over time H100e/wafer has been increasing around 35%/year; we look at three different possibilities for the lithography buildout it would imply vs. the default trend.
- compute-per-wafer growth	0%/yr (frozen 2029 tech)	35%/yr (continued tech trend)	50%/yr (faster tech trend)
- lithography machines needed by 2040	~1,100,000	~14,000	~4,400
- vs the fleet's historical trend (~4,300 by 2040)	~255x	~3x	~1x
- implied annual production vs today (~125/yr)	~4,400x	~29x	~6x
- We expect something like the middle column to be what happens in Plan A.
- The method is relatively naive, where we set one worldwide rank-size law for the shape of the distribution, hand set to match forecasts, and then companies are assigned to ownership regions to match the §1.3 split. Across a universe of
- N end-users worldwide, the share of the rank-
- i company is
- 𝑠
- ∝
- exp
- Φ
- …
- ∝exp(σΦ
- −1
- N−i+0.5
- )+
- ),i=1,…,N,
- normalized so the shares sum to one (
- is the standard-normal quantile of rank
- i). It has two shape parameters:
- σ sets the overall spread (concentration, which drives the top three), and
- τ is a head tilt that decays as
- rank
- 1/rank, moving the single leader relative to the next two with less effect on the tail.
- We choose the world's top-1 and top-3 end-user shares directly each year and solve
- (σ,τ) so the distribution reproduces both. The leader is a minority early (frontier AI companies don't yet use most AI compute), rises into the 2029 deal to about a fifth of world compute with the top three at nearly half, then both decline as Plan A spreads compute (top-1 about 10% by 2035 and 5% by 2040; top-3 about 25% then 13%). A better justification of this forecast is currently future work. We wanted to create a model of "AI market power" / "willingness to pay" for AI compute that was a combination of algorithmic IP (which becomes uniformly distributed after the deal), non-algorithmic IP/capital (datasets, users, brand loyalty, talent loyalty, etc.) and finally capital more broadly, and build a model of compute allocation over time tracking this quantity. This was complicated though and we ran out of time.
- Each company is then assigned to an ownership region (US, China, rest-of-world) by a hard-capped greedy fill, so regional totals match the §1.3 ownership split exactly every year through 2029 and then matching the Plan A ownership splits which converge towards the cap-and-trade deal allocations. A per-region size bias shifts only which companies a region holds, never its total: the US is neutral and holds the biggest developers; China is flat and dispersed through 2030, then a state-backed core consolidates at 2031 (its top developer jumps to about half of China's compute and lands a frontier developer) before gradually flattening again by 2040; the rest-of-world is flatter and flattens further toward the end, so the single largest developer worldwide stays in the US even once the rest-of-world's ownership share overtakes it.
- Through 2030 (the deal era) the frontier set is the three largest end-users worldwide (the leading US developers are named, in a hand-set per-year order). From 2031 we drop names and call an end-user frontier if it is within 4x of the largest end-user worldwide.
- worldwide end-user universe (
- N)	200	the rank-size law's company count
- top-1 end-user share (2026 / 2029 / 2035 / 2040)	8% / 20% / 10% / 5%	hand-set;
- (σ,τ) solved to match
- top-3 end-user share (2026 / 2029 / 2035 / 2040)	23% / 45% / 25% / 13%	hand-set independently of top-1
- §1.3 ownership split at 2040 (US / CH / RoW)	35% / 20% / 45%	regional totals matched exactly each year
- China size bias	flat, then +5 at 2031, easing to +2 by 2039	dispersed early; consolidates at 2031; flattens by 2040
- rest-of-world size bias	−0.6, to −2.5 by 2039	flattens toward the end so the US keeps the largest developer
- frontier rule	top-3 (≤2030) / within 4x (≥2031)	deal era names the top three; later, within 4x of the largest
- How Nesov gets 650T: Both Nesov's forecast and ours start from training compute; the difference is mainly that Nesov's 2029 frontier run is 2x larger at 8e28 FLOP assuming 30x sparsity. At 30x sparsity compute-optimal ratio is 240 tokens per active parameter (from a sparse-MoE scaling paper) so 8e28 FLOP would want 7.4T active parameters on ~1,800T tokens. But he assumes only ~200T tokens of unique data exist, an 8.5x shortfall, which he splits with this data-constrained scaling result to get roughly
- 8.5
- ≈ 2.9x more active parameters (7.4T → 22T) and 2.9 epochs of repetition. We don't make the same low-data-regime adjustment as Nesov, because we think multiple factors such as more reinforcement learning, changes to the training paradigm, synthetic data generation, etc. could pull the other way. Given the uncertainty on these factors that could pull in both directions we prefer to use a naive simpler baseline.
- Nesov’s model-size forecast
- From “Model size scaling in 2023–2031”.
- Year	Pretraining
- compute (FLOP)	Sparsity	Active params	Total params	Data shortfall	Epochs
- 2026	1.3e27	8x	1.3T	10T	—	1
- 2027	6e27	8x	2.9T	30T	1.75x	1.3
- 2028	2e28	30x	7.9T	240T	4.5x	2.1
- 2029	8e28	30x	22T	650T	8.5x	2.9
- 2030	1e29	30x	26T	790T	10x	3.1
- 2031	2.2e29	30x	48T	1,400T	15x	3.9
- A frontier model has
- P total and
- =P/σ active parameters at sparsity
- σ, served 4-bit (
- b=0.5 bytes/param), so one replica holds
- W=bP bytes of weights and each token costs
- 2P
- FLOPs (reading
- bP
- bytes).
- Model size.
- (C/C
- (σ/σ
- with
- =10T,
- α=0.5[0.2,0.8],
- β=0.74, and
- world
- C=s
- τ the leader's training compute (top-1 share §2.3 x world stock x training allocation §2.4). Central: ~158T at 2029, ~31,000T at 2040.
- Copies. The inference fleet is the §2.4 inference share
- δ of the world stock (per-H100e memory and bandwidth from §1.1, flat after 2029), with an inference-specialized fraction
- 𝑓
- f built up from a hand-set flow of new compute (specialized chips only serve, so their whole stock serves). The general-purpose part serves copies out of its memory: a replica occupies the weights
- W plus a KV cache
- c for each of its
- B concurrent copies. The specialized chips instead serve as many copies as their token throughput supports at their chosen speed
- 𝑣
- spec
- v
- , where throughput is utilization
- 𝑢
- u times the smaller of their compute limit (
- F
- ) and their weight-read bandwidth limit (
- Λ
- ); their memory is sized to match and never binds. So,
- copies
- copies=
- W+Bc
- δM(1−f)
- B+
- umin!(F
- /2,Λ
- /b)
- Speed. With
- 𝜌
- ρ(t) the inference fleet's bandwidth:capacity ratio (how many times per second its memory can be read in full),
- speed
- gp
- 𝜅
- =uρ(t)κ,speed
- =v
- (t).
- On general-purpose hardware a batched decode step reads the same footprint (
- W+Bc) whose bandwidth the replica owns (
- ρ(W+Bc)), so batch and context cancel and only the decode gain
- κ times the utilization
- u remains; this presumes serving stays at the large-batch, throughput-optimal operating point. Sparsity does not move realized speed (it cuts bytes and FLOPs per token, not layer count); it enters through model size and the specialized chips' per-token compute. The headline average speed is copy-weighted.
- Every input, ordered by the guess it belongs to (model size, then the inference fleet, then copies, then speed):
- parameter	value	note
- 2026 anchor	10T total params, 8x sparse	today's frontier
- compute exponent (
- α)	0.5, band [0.2, 0.8]	data walls push up (Nesov's numbers fit
- α≈0.8); overtraining, RL, distillation push down
- sparsity exponent (
- β)	0.74	optimal tokens per active param rise ~
- 0.53
- sparsity (
- σ)	8x → 32x@2028 → 128x@2040	hand-set
- inference share (
- δ)	~50% pre-deal, 77%@2030, 25%@2040	from §2.4 (public + internal)
- specialized share of new compute (
- f)	0.2% (2026) → 1% (2029) → 14% (2040)	hand-set; ~half the inference fleet's compute by 2040
- bandwidth per H100e	+10%/yr after 2029, capacity flat	gives the read rate
- ρ: ~31/s (2026) → ~107/s (2040)
- spec bandwidth (
- )	60x HBM (2026) → ~500x (2040)	measured Groq/Cerebras ~60-80x; bandwidth binds until ~2034, then compute
- serving precision and FLOP/s	4-bit (0.5 B/param), 4e15 FLOP/s per H100e	weights are ~5 TB per replica in 2026
- batch (
- B)	256 concurrent copies per replica	held flat; trades off with context assumptions
- KV per copy (
- c)	~20 GB (2026) → ~3.3 TB (2040)	~200k → ~2.4M tokens of context; leaves context ~5% of memory by 2040
- decode gain (
- κ)	~2	speculative / multi-token decoding
- utilization (
- u)	0.9	of each chip category's binding limit
- spec speed (
- )	1,000 / 1,500 / 3,000 / 6,000 / 15,000 / 25,000 tok/s at 2026/29/32/35/38/40	hand-set, toward the on-chip wire-latency floor

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
- [Compute Definitions](https://ai-2040.com/supplements/compute-supplement#compute-definitions)
- [Part 1. Pre-deal compute (pre-2029)](https://ai-2040.com/supplements/compute-supplement#part-1-pre-deal-compute-pre-2029)
- [1.1. AI-relevant compute](https://ai-2040.com/supplements/compute-supplement#11-ai-relevant-compute)
- [1.2. All compute](https://ai-2040.com/supplements/compute-supplement#12-all-compute)
- [1.3. Regional ownership](https://ai-2040.com/supplements/compute-supplement#13-regional-ownership)
- [1.4. Datacenter sizes](https://ai-2040.com/supplements/compute-supplement#14-datacenter-sizes)
- [Part 2. Post-deal compute (post-2029)](https://ai-2040.com/supplements/compute-supplement#part-2-post-deal-compute-post-2029)
- [2.1. The no-deal counterfactual](https://ai-2040.com/supplements/compute-supplement#21-the-no-deal-counterfactual)
- [2.2. AI-relevant compute after the deal](https://ai-2040.com/supplements/compute-supplement#22-ai-relevant-compute-after-the-deal)
- [2.3. Company concentration](https://ai-2040.com/supplements/compute-supplement#23-company-concentration)
- [2.4. Compute allocation](https://ai-2040.com/supplements/compute-supplement#24-compute-allocation)
- [2.5. AI copies and speed](https://ai-2040.com/supplements/compute-supplement#25-ai-copies-and-speed)
- [Appendix. The effective-H100e model](https://ai-2040.com/supplements/compute-supplement#appendix-the-effective-h100e-model)
- [https://ai-2040.com/supplements/compute-supplement#top-toc](https://ai-2040.com/supplements/compute-supplement#top-toc)
- [H100 SXM](https://www.nvidia.com/en-us/data-center/h100/)
- [appendix](https://ai-2040.com/supplements/compute-supplement#appendix-the-effective-h100e-model)
- [Epoch AI — hyperscaler capex](https://epoch.ai/data-insights/hyperscaler-capex-trend)
- [AI Chip Sales](https://epoch.ai/data/ai-chip-sales?view=graph&tab=h100_equivalents&timePeriod=annual&cumulative=false)
- [Source: Epoch AI](https://epoch.ai/data-insights/hyperscaler-capex-vs-cash-flow)
- [hyperscalers are ~60-90% of global AI spend](https://epoch.ai/data-insights/hyperscalers-control-most-compute)
- [hyperscaler Broad CapEx](https://epoch.ai/data-insights/hyperscaler-capex-trend)
- [~60–90% of global spend](https://epoch.ai/data-insights/hyperscalers-control-most-compute)
- [Morgan Stanley podcast](https://www.morganstanley.com/insights/podcasts/thoughts-on-the-market/credit-markets-ai-financing-gap-vishy-tirupattur-vishwas-patkar)
- [ASML's annual reports](https://www.asml.com/en/investors/annual-report)
- [Frederick Chen](https://frederickchen.substack.com/p/estimating-euv-production-wafer-throughput)
- [SemiAnalysis](https://newsletter.semianalysis.com/p/asmls-euv-tools-have-a-throughput)
- [TSMC alone runs ~56% of capacity](https://www.digitimes.com/news/a20241112PD204/euv-tsmc-adoption-2023-technology.html)
- [Epoch's direct estimate](https://epoch.ai/data-insights/ai-chip-supply-chain-constraints)
- [Cerebras](https://www.cerebras.ai/blog/100x-defect-tolerance-how-cerebras-solved-the-yield-problem)
- [TrendForce](https://www.trendforce.com/news/2025/12/30/news-samsung-reportedly-plans-50-hbm-capacity-surge-in-2026-spotlight-on-hbm4/)
- [1c ~6](https://www.tweaktown.com/news/106957/sk-hynix-ramps-1c-dram-to-6-euv-layers-preps-for-high-na-designs-destroy-samsung-in-hbm/index.html)
- [~3x a DDR5 wafer](https://www.tomshardware.com/pc-components/ram/hbm-is-eating-your-ram)
- [IDC Worldwide Quarterly Mobile Phone Tracker](https://www.idc.com/promo/smartphone-market-share)
- [Gartner](https://www.gartner.com/en/newsroom/press-releases/2024-01-10-gartner-says-worldwide-pc-shipments-grew)
- [IDC PCD Tracker](https://www.idc.com/promo/pcdforecast)
- [Jon Peddie Research AIB Report](https://www.jonpeddie.com/reports/add-in-board-report/)
- [TechInsights via DCD](https://www.datacenterdynamics.com/en/news/nvidia-gpu-shipments-totaled-376m-in-2023-equating-to-a-98-market-share-report/)
- [Epoch AI](https://epoch.ai/data-insights/nvidia-chip-production)
- [~25 to 35B MCUs/yr alone](https://www.statista.com/statistics/935382/worldwide-microcontroller-unit-shipments)
- [Federal Register 88 FR 73458](https://www.govinfo.gov/content/pkg/FR-2023-10-25/pdf/2023-23055.pdf)
- [CSET explainer](https://cset.georgetown.edu/article/bis-2023-update-explainer/)
- [Princeton ISCA 2025](https://parallel.princeton.edu/papers/sanctions-isca-2025.pdf)
- [Apple Neural Engine TOPS table](https://github.com/hollance/neural-engine/blob/master/docs/supported-devices.md)
- [Canalys AI-PC share](https://canalys.com/newsroom/ai-capable-pc-shipment-q4-2024)
- [Steam Hardware Survey](https://store.steampowered.com/hwsurvey/videocard/)
- [TrendForce mix](https://www.trendforce.com/presscenter/news/20240903-12283.html)
- [AnySilicon](https://anysilicon.com/die-per-wafer-formula-free-calculators/)
- [SemiAnalysis](https://www.semianalysis.com/)
- [TrendForce](https://www.trendforce.com/presscenter/news/20240903-12283.html)
- [NVIDIA DGX/HGX H100 specs](https://www.nvidia.com/en-us/data-center/dgx-h100/)
- [SEMI](https://www.semi.org/en/products-services/market-data)
- [SemiAnalysis](https://www.semianalysis.com/p/the-memory-wall)
- [ASML](https://www.asml.com/en/investors)
- [TSMC](https://investor.tsmc.com/english/quarterly-results)
- [NVIDIA's DGX Station](https://www.nvidia.com/en-us/products/workstations/dgx-station/)
- [chip dies smuggled in](https://www.reuters.com/technology/us-ordered-tsmc-halt-shipments-china-chips-used-ai-applications-source-says-2024-11-10/)
- [lease from abroad](https://www.the-substrate.net/p/how-much-us-compute-is-china-renting)
- [SemiAnalysis](https://newsletter.semianalysis.com/p/huawei-ascend-production-ramp)
- [rent abroad](https://www.the-substrate.net/p/how-much-us-compute-is-china-renting)
- [Epoch](https://epoch.ai/publications/chip-smuggling)
- [enforcement](https://www.ft.com/content/57fcd3ce-464f-4dc2-8ea2-5712d4972c69)
- [confirmed-rental floor](https://www.the-substrate.net/p/how-much-us-compute-is-china-renting)
- [SemiAnalysis CXMT piece](https://newsletter.semianalysis.com/p/chinas-cxmt-is-set-to-challenge-dram)
- [NXT:1980Fi-class](https://www.asml.com/en/products/duv-lithography-systems/twinscan-nxt1980fi)
- [AEI](https://www.aei.org/research-products/report/the-lithography-loophole-how-china-is-printing-its-way-to-chip-self-sufficiency/)
- [~2.4M nameplate](https://www.aei.org/research-products/report/the-lithography-loophole-how-china-is-printing-its-way-to-chip-self-sufficiency/)
- [SMIC ≤7nm starts](https://newsletter.semianalysis.com/p/huawei-ascend-production-ramp)
- [SAQP quad-patterning](https://www.techpowerup.com/344000/chinese-smic-achieves-5-nm-production-on-n-3-node-without-euv-tools)
- [CXMT HBM starts](https://newsletter.semianalysis.com/p/chinas-cxmt-is-set-to-challenge-dram)
- [Epoch's datacenter dataset](https://epoch.ai/data/data-centers)
- [Epoch's observed current dataset](https://epoch.ai/data/data-centers)
- [Jones 1995](https://web.stanford.edu/~chadj/JonesJPE95.pdf)
- [Bloom et al. 2020](https://web.stanford.edu/~chadj/IdeaPF.pdf)
- [around 35%/year](https://epoch.ai/data/machine-learning-hardware?view=graph)
- [Epoch estimates](https://epoch.ai/blog/limits-to-the-energy-efficiency-of-cmos-microprocessors)
- [Epoch's terms](https://epoch.ai/data-insights/gpus-power-usage-in-ai-data-centers)
- [CMOS practical limit](https://epoch.ai/blog/limits-to-the-energy-efficiency-of-cmos-microprocessors)
- [owned by hyperscalers](https://epoch.ai/data/ai-chip-owners?view=graph&tab=h100_equivalents)
- [AI company end-users are less concentrated](https://epochai.substack.com/p/frontier-labs-dont-use-most-ai-compute)
- [around half of its compute on inference](https://www.theinformation.com/articles/openai-boost-revenue-forecasts-predicts-112-billion-cash-burn-2030?rc=9mzoog)
- [one third on inference in 2024](https://epoch.ai/data-insights/openai-compute-spend)
- [Nesov's](https://www.lesswrong.com/posts/yLHiQGCPdvzL9fBn3/model-size-scaling-in-2023-2031)
- [Sardana and Frankle](https://arxiv.org/abs/2401.00448)
- [forecast](https://www.lesswrong.com/posts/yLHiQGCPdvzL9fBn3/model-size-scaling-in-2023-2031)
- [sparse-MoE scaling paper](https://arxiv.org/abs/2501.12370)
- [data-constrained scaling result](https://arxiv.org/abs/2605.01640)
- [“Model size scaling in 2023–2031”](https://www.lesswrong.com/posts/yLHiQGCPdvzL9fBn3/model-size-scaling-in-2023-2031)
- [Cerebras](https://www.cerebras.ai/blog/llama-405b-inference)
- [Groq](https://groq.com/blog/inside-the-lpu-deconstructing-groq-speed)
- [Etched](https://www.etched.com/)
- [Taalas](https://www.taalas.com/)
- [Compute Definitions](https://ai-2040.com/supplements/compute-supplement#four-categories-of-compute)
- [CNBC](https://www.cnbc.com/2026/02/09/alphabet-highlights-new-ai-related-risks-in-tapping-debt-market.html)
- [Fortune](https://fortune.com/2026/03/07/big-tech-trillion-dollar-borrowing-ai-century-bonds/)
- [CNBC](https://www.cnbc.com/2026/06/11/spacex-raises-75-billion-in-record-setting-ipo-ahead-of-nasdaq-debut.html)
- [TechCrunch](https://techcrunch.com/2026/05/20/anthropic-will-pay-xai-1-25-billion-per-month-for-compute/)
- [sparse-MoE ratio](https://arxiv.org/abs/2501.12370)
- [NVIDIA, Massively Scale Your Deep Learning Training with NCCL 2.4](https://developer.nvidia.com/blog/massively-scale-deep-learning-training-nccl-2-4/)

---
