# Five Unresolved Issues in OpenAI’s Deal With the Department of Defense

Jake Laperruque / Mar 9, 2026*Jake Laperruque is a Tech Policy Press Fellow and the Deputy Director of Security & Surveillance at the Center for Democracy & Technology. This piece is written in his personal capacity for the fellowship and does not necessarily reflect the views or positions of his employer.*

The end of February brought a pair of striking developments regarding military use of AI. The Department of Defense announced it would designate Anthropic as a “supply chain risk” (a threat it [just followed through on](https://www.bloomberg.com/news/articles/2026-03-05/pentagon-says-it-s-told-anthropic-the-firm-is-supply-chain-risk)) after the company held firm on a [set of conditions](https://www.anthropic.com/news/statement-department-of-war) for use of its technology: no use for “mass domestic surveillance” or “fully autonomous weapons.”

In parallel, OpenAI announced an agreement with the Defense Department for the use of its own AI systems. In an effort to assuage concerns (one that at least initially [seemed to fail](https://www.theverge.com/ai-artificial-intelligence/887309/openai-anthropic-dod-military-pentagon-contract-sam-altman-hegseth)), the company released a [statement](https://openai.com/index/our-agreement-with-the-department-of-war/) outlining three “red lines” it had instituted for use of its systems: 1) No use for mass domestic surveillance; 2) No use to direct autonomous weapons systems; 3) No use for high-stakes automated decisions.

Seeing these limits trumpeted as key parts of a successful OpenAI deal was perplexing, as the first two appear to be exactly the same demands that caused the planned Anthropic agreement not only to fail, but to explode in shocking fashion. OpenAI has acknowledged this, stating, “our contract provides better guarantees and more responsible safeguards than earlier agreements, including Anthropic’s original contract. We think our red lines are more enforceable here …. We don’t know why Anthropic could not reach this deal, and we hope that they and more labs will consider it.”

That may explain why OpenAI chose to move forward. But it does little to explain why the Department of Defense (DOD) was willing to accept the same restrictions it had just rejected. When Anthropic insisted on limits to mass surveillance, the administration [viewed it](https://x.com/SecWar/status/2027507717469049070) as an effort “to seize veto power over the operational decisions of the United States military” and the [attempt](https://truthsocial.com/@realDonaldTrump/posts/116144552969293195) of “A RADICAL LEFT, WOKE COMPANY TO DICTATE HOW OUR GREAT MILITARY FIGHTS AND WINS WARS.”

How could those same restrictions, reinforced by even *stronger tools* for enforcement, have suddenly become acceptable for the Trump administration?

If OpenAI wants the public to have faith that its agreement with the Defense Department includes meaningful safeguards, more information is needed. To its credit, the company took a step in that direction by releasing additional contract terms in [an addendum](https://x.com/sama/status/2028640354912923739) on March 2. It should follow up with continued engagement, transparency, and efforts to address concerns.

But the new details also leave several important questions unresolved — especially around surveillance and privacy. In particular, it would be beneficial to provide further clarity on the following five issues:

#### What constitutes “mass domestic surveillance” as prohibited by the contract, and what (if any) forms of mass domestic surveillance does OpenAI believe the law currently permits?

For all its [bellicosity](https://x.com/SecWar/status/2027507717469049070?utm_source=chatgpt.com), Defense Secretary Hegseth’s statement offered a clear picture of the gap between Anthropic’s stance and the government’s: While the company wanted to bar use of its AI for domestic mass surveillance, the Pentagon wanted the military to be able to use AI systems for “any lawful purpose.” The implication is straightforward – in the government’s view, domestic mass surveillance is sometimes legal, and therefore permissible, even if technology companies might prefer to prohibit it.

OpenAI’s response indicates the company believes legal compliance provides a sufficient safeguard, highlighting from its contract terms:

“Any handling of private information will comply with the Fourth Amendment, the National Security Act of 1947 and the Foreign Intelligence and Surveillance Act of 1978, Executive Order 12333, and applicable DoD directives requiring a defined foreign intelligence purpose. The AI System shall not be used for unconstrained monitoring of U.S. persons’ private information as consistent with these authorities.”

But those authorities have rarely prevented large-scale surveillance programs.

[Executive Order 12333](https://www.pogo.org/analyses/executive-order-12333-the-spy-power-too-big-for-any-legal-limits) (“EO 12333”), for example, has served as the basis for dragnets (such as the [CO-TRAVELER](https://www.washingtonpost.com/world/national-security/nsa-tracking-cellphone-locations-worldwide-snowden-documents-show/2013/12/04/5492873a-5cf2-11e3-bc56-c6ca94801fac_story.html), [Dishfire](https://www.theguardian.com/world/2014/jan/16/nsa-collects-millions-text-messages-daily-untargeted-global-sweep), and [SOMALGET](https://theintercept.com/2014/05/19/data-pirates-caribbean-nsa-recording-every-cell-phone-call-bahamas/) programs) that collected data on millions of people. Nationwide bulk collection of Americans’ phone records occurred for a decade pursuant to Section 215, the notorious “business records” provision of the Foreign Intelligence and Surveillance Act (“FISA”). Another provision of FISA — Section 702 — [allows the government](https://documents.pclob.gov/prod/Documents/OversightReport/054417e4-9d20-427a-9850-862a6f29ac42/2023%20PCLOB%20702%20Report%20(002).pdf) to collect communications of thousands (potentially even millions) of Americans without a warrant.

These programs are managed by the NSA, which OpenAI has excluded from the scope of this contract (more discussion on that below), but they still illustrate that the law itself is no shield against mass surveillance systems.

Perhaps most important to this discussion is the military and intelligence agencies' growing practice of [purchasing large datasets](https://www.pogo.org/public-comments/federal-acquisition-of-commercially-available-information) from commercial brokers under the authority of EO 12333. The treatment of these stockpiles of data on the public writ large appears to be [at the heart](https://www.nytimes.com/2026/03/01/technology/anthropic-defense-dept-openai-talks.html) of the Pentagon’s dispute with Anthropic. If we are to properly understand the impact of OpenAI’s agreement with the Defense Department, we need to know how its technology could be used in conjunction with records obtained through these data purchases, as well as other forms of surveillance the government views as lawful.

#### How do prohibitions on “deliberate” and "intentional" surveillance on Americans impact incidental collection within large datasets?

The March 2 addendum included a provision addressing data purchases but also raised new questions. The new contract terms state:

“Consistent with applicable laws, including the Fourth Amendment to the United States Constitution, National Security Act of 1947, FISA Act of 1978, the AI system shall not beintentionallyused for domestic surveillance of U.S. persons and nationals. For the avoidance of doubt, the Department understands this limitation to prohibitdeliberatetracking, surveillance, or monitoring of U.S. persons or nationals, including through the procurement or use of commercially acquired personal or identifiable information."

I’ve added emphasis on “intentionally” and “deliberate” because those two words could dramatically undercut any value this clause was meant to provide. Surveillance of Americans pursuant to EO 12333 is generally premised on the notion that when surveillance of Americans does occur, it is *incidental* rather than *intentional*. This is certainly true of data purchases conducted pursuant to EO 12333, where even as the government is not *deliberately* collecting on Americans’ data, it assumes such data will incidentally be swept in.

Still, even a small portion of data collected on Americans can be consequential. For example, the US Special Operations Command purchased [bulk location data](https://www.vice.com/en/article/us-military-location-data-xmode-locate-x/) generated by a Muslim prayer and Quran app with 98 million users. If just 1% of those users were Americans, it would mean the military was collecting sensitive location information on nearly a million Americans. And it arguably would have done so without engaging in the type of “intentional” or “deliberate” tracking that OpenAI’s new terms prohibit.

The public needs clarity on how OpenAI intends to address such scenarios, in which the large-scale collection of Americans’ data is inevitable and expected, even if it is not the *deliberate* goal.

#### Does “tracking, surveillance, and monitoring” just refer to collection, or also apply to querying, sorting, and analytics?

Another ambiguity involves the contract’s restriction on “tracking, surveillance, or monitoring” of US persons, including through “procurement ** or use** of commercially acquired personal or identifiable information.”

On the one hand, this appears encouraging. It acknowledges that surveillance risks can arise not only from the collection of data (including incidental collection), but how that data is used.

However, the government has long maintained that “surveillance” refers only to the collection of data and communications, and not the use of that data once it's in the government's hands. For over a decade, this distinction has underpinned the government’s defense of warrantless FISA surveillance. According to the government, even when the FBI, NSA, or CIA deliberately queries Americans whose communications were swept up into its databases, that doesn’t count as “surveillance,” only the initial targeting and collection does.

The terms “tracking” and “monitoring” are not generally defined in the laws called out in the contract, and OpenAI has not suggested that they are defined in the contract itself.

So, how does this issue apply to bulk purchases of commercial data? It’s easy to imagine scenarios where the military wants to use OpenAI tools to sort through troves of data to track movements and travel patterns across vast swaths of the border that have been designated as “[National Defense Areas](https://www.aclu.org/news/immigrants-rights/border-communities-face-new-risks-under-trumps-national-defense-areas),” build profiles of individuals who had visited certain websites and message boards, or run threat assessments in conjunction with [deployment to US cities](https://time.com/7321064/danger-trumps-crackdown-blue-cities/).

Would such activities be prohibited under this agreement because they involve deliberate “use of commercially acquired personal or identifiable information” to keep tabs on Americans? Or would it be permissible, since in the government’s view, accessing data it's already collected does not constitute “tracking, surveillance, or monitoring”? Or is the distinction even more nuanced, so that, for example, analyzing location data to determine where a person has been amounts to “tracking” but analyzing data to create a social score does not? These and other ambiguities remain unresolved.

#### How will OpenAI treat surveillance where the executive’s legal rationales have not been subject to public or court review?

These concerns are compounded by the legal ambiguity and secrecy that frequently surround national security and surveillance law.

Despite [years of inquiries](https://www.wyden.senate.gov/imo/media/doc/032119%20Ltr%20to%20DOJ%20Metadata%20post-Carpenter.pdf) from [Members of Congress](https://democrats-judiciary.house.gov/sites/evo-subsites/democrats-judiciary.house.gov/files/migrated/UploadedFiles/2022-08-16_Ltr_to_DOJ_DHS_FBI_CBP_ICE_DEA_ATF_-_Digital_Data.pdf), the executive branch has never publicly disclosed its legal rationale for how commercial data purchases comply with the Fourth Amendment, especially in light of the Supreme Court’s [2018 ruling](https://www.supremecourt.gov/opinions/17pdf/16-402_h315.pdf) that electronic location tracking required a warrant. Nor has the legality of data purchases ever been reviewed and adjudicated by an independent court.

Unfortunately, for surveillance tied to national security actions, this is often the norm. Such secrecy and the lack of independent adjudication also lead executive agencies to craft weak and self-serving legal justifications.

Among the most infamous examples is the 2001 Office of Legal Counsel memos that relied on indefensibly shoddy legal reasoning to claim that the government could legally engage in [dragnet surveillance of Americans](https://www.pogo.org/analyses/secrets-surveillance-and-scandals-the-war-on-terrors-unending-impact-on-americans-private-lives) and [torture](https://www.intelligence.senate.gov/wp-content/uploads/2024/08/sites-default-files-documents-crpt-113srpt288.pdf). These memos were later revoked as [unsound and lacking professional candor](https://graphics8.nytimes.com/packages/pdf/politics/20100220JUSTICE/20100220JUSTICE-DAGMargolisMemo.pdf), but for years, as far as the executive and its personnel were concerned, they *were the law*.

With those stakes and risks in mind, it’s important to know how OpenAI will ensure not only that the law is being complied with but also that it’s not being interpreted in ways that serve merely to offer a pretext for unchecked surveillance.

#### How will OpenAI’s added prohibition on intelligence agency use apply in practice? And will this be a continued commitment?

One notable feature of the additional terms OpenAI announced on March 2 was the exclusion of military intelligence agencies (such as the NSA and Defense Intelligence Agency) from the contract. Given the intelligence community’s significant use of data purchases, its access to vast FISA surveillance powers, and the NSA’s problematic history of legally dubious dragnet surveillance of Americans during the “War on Terror,” this restriction is a meaningful one.

But more details are necessary to assess its effectiveness. How accessible will systems be in any joint task force that includes intelligence agency personnel? Will any measures restrict intelligence agencies from requesting that other Department of Defense entities run tasks through AI systems on their behalf? If such measures do exist, how will they be enforced?

And most importantly, is this an ongoing policy OpenAI is committed to, or simply a temporary division of access that the company is willing to amend in the future?

#### Final thoughts

I’ve focused primarily on the domestic surveillance “red line” because privacy and surveillance law are my areas of expertise. But there is a second red line raised by Anthropic and OpenAI, autonomous weapons, that is just as consequential and warrants further discussion.

We need to account for the risks of systems that are “human in loop in name only,” technically retaining human review and approval but not in any meaningful manner. We’ve already seen the deadly results of this from Israel’s “Lavender” system, where personnel would spend less than a minute reviewing AI-generated targets and described their role as “[zero added-value as a human, apart from being a stamp of approval](https://www.theguardian.com/world/2024/apr/03/israel-gaza-ai-database-hamas-airstrikes).” And the boat strikes in the Caribbean— being conducted with seeming indifference to the [copious analysis](https://www.justsecurity.org/120753/collection-u-s-lethal-strikes-on-suspected-drug-traffickers/) that they are unlawful — illustrates the dangers of letting the executive [be the sole arbiter of the law](https://www.justsecurity.org/123172/caribbean-strikes-legal-oversight-us-military/).

As [many have already noted](https://www.eff.org/deeplinks/2026/03/anthropic-dod-conflict-privacy-protections-shouldnt-depend-decisions-few-powerful), issues of this magnitude should be resolved through rigorous public discourse and thoughtful policy debate, not through opaque contract provisions negotiated between powerful tech companies and the government.

Understanding the details of how OpenAI’s agreement with the Department of Defense will operate in practice will not resolve these concerns. But it is an essential starting point.
