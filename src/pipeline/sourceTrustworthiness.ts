/**
 * Source Trustworthiness Scoring
 *
 * Evaluates the trustworthiness of sources based on domain reputation.
 * Used to factor into note submission decisions.
 */

export interface TrustworthinessScore {
  url: string;
  domain: string;
  score: number; // 0-1
  tier: "high" | "medium" | "low" | "unknown";
  reasoning: string;
  factors: {
    domainType: "gov" | "edu" | "news" | "factcheck" | "academic" | "org" | "social" | "blog" | "other";
    isKnownOutlet: boolean;
    isHttps: boolean;
  };
}

// High-trust domains - major news outlets, government, academic institutions
const HIGH_TRUST_DOMAINS = new Set([
  // Government
  "gov",
  "gov.uk",
  "gov.au",
  "gc.ca",
  "europa.eu",
  // Academic
  "edu",
  "ac.uk",
  "edu.au",
  // Major news
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "nytimes.com",
  "washingtonpost.com",
  "theguardian.com",
  "wsj.com",
  "economist.com",
  "ft.com",
  "npr.org",
  "pbs.org",
  "cnn.com",
  "nbcnews.com",
  "cbsnews.com",
  "abcnews.go.com",
  "politico.com",
  "theatlantic.com",
  "newyorker.com",
  "time.com",
  "usatoday.com",
  "latimes.com",
  "chicagotribune.com",
  "bloomberg.com",
  // International news
  "aljazeera.com",
  "dw.com",
  "france24.com",
  "cbc.ca",
  "abc.net.au",
  "scmp.com",
  // Science/Academic publishers
  "nature.com",
  "science.org",
  "sciencedirect.com",
  "pubmed.ncbi.nlm.nih.gov",
  "ncbi.nlm.nih.gov",
  "nih.gov",
  "cdc.gov",
  "who.int",
  "arxiv.org",
  // Fact-checkers
  "snopes.com",
  "factcheck.org",
  "politifact.com",
  "fullfact.org",
  "apfactcheck.org",
  "checkyourfact.com",
]);

// Medium-trust domains - reputable but less authoritative
const MEDIUM_TRUST_DOMAINS = new Set([
  // Regional news
  "sfchronicle.com",
  "bostonglobe.com",
  "denverpost.com",
  "seattletimes.com",
  "miamiherald.com",
  "dallasnews.com",
  "houstonchronicle.com",
  "azcentral.com",
  // Tech news
  "techcrunch.com",
  "wired.com",
  "arstechnica.com",
  "theverge.com",
  "engadget.com",
  "zdnet.com",
  "cnet.com",
  // Business news
  "cnbc.com",
  "businessinsider.com",
  "forbes.com",
  "fortune.com",
  "marketwatch.com",
  // Specialty
  "espn.com",
  "si.com",
  "variety.com",
  "hollywoodreporter.com",
  "rollingstone.com",
  // Wire services
  "upi.com",
  "afp.com",
  // Reference
  "wikipedia.org",
  "britannica.com",
  // International
  "independent.co.uk",
  "telegraph.co.uk",
  "mirror.co.uk",
  "dailymail.co.uk",
  "thehill.com",
  "axios.com",
  "vox.com",
  "buzzfeednews.com",
  "vice.com",
]);

// Low-trust domains - user-generated content, blogs, social media
const LOW_TRUST_PATTERNS = [
  // Social media
  /^(www\.)?twitter\.com$/i,
  /^(www\.)?x\.com$/i,
  /^(www\.)?facebook\.com$/i,
  /^(www\.)?instagram\.com$/i,
  /^(www\.)?tiktok\.com$/i,
  /^(www\.)?reddit\.com$/i,
  /^(www\.)?threads\.net$/i,
  // Blogging platforms
  /^(www\.)?medium\.com$/i,
  /^(www\.)?substack\.com$/i,
  /^.*\.substack\.com$/i,
  /^(www\.)?blogspot\.com$/i,
  /^.*\.blogspot\.com$/i,
  /^(www\.)?wordpress\.com$/i,
  /^.*\.wordpress\.com$/i,
  /^(www\.)?tumblr\.com$/i,
  /^(www\.)?livejournal\.com$/i,
  // Video platforms
  /^(www\.)?youtube\.com$/i,
  /^(www\.)?youtu\.be$/i,
  /^(www\.)?vimeo\.com$/i,
  /^(www\.)?twitch\.tv$/i,
  // URL shorteners
  /^(www\.)?bit\.ly$/i,
  /^(www\.)?t\.co$/i,
  /^(www\.)?tinyurl\.com$/i,
  /^(www\.)?goo\.gl$/i,
];

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Check if URL uses HTTPS
 */
function isHttps(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Determine domain type category
 */
function getDomainType(domain: string): TrustworthinessScore["factors"]["domainType"] {
  if (domain.endsWith(".gov") || domain.includes(".gov.")) return "gov";
  if (domain.endsWith(".edu") || domain.includes(".ac.") || domain.includes(".edu.")) return "edu";
  if (domain.endsWith(".org")) return "org";

  // Check fact-checkers
  const factCheckers = ["snopes.com", "factcheck.org", "politifact.com", "fullfact.org"];
  if (factCheckers.some((fc) => domain.endsWith(fc))) return "factcheck";

  // Check academic publishers
  const academic = ["nature.com", "science.org", "arxiv.org", "pubmed", "ncbi"];
  if (academic.some((a) => domain.includes(a))) return "academic";

  // Check news
  if (HIGH_TRUST_DOMAINS.has(domain) || MEDIUM_TRUST_DOMAINS.has(domain)) return "news";

  // Check social/blog
  if (LOW_TRUST_PATTERNS.some((p) => p.test(domain))) return "social";
  if (domain.includes("blog") || domain.includes("wordpress") || domain.includes("substack")) {
    return "blog";
  }

  return "other";
}

/**
 * Score source trustworthiness based on domain reputation
 */
export function scoreSourceTrustworthiness(url: string): TrustworthinessScore {
  const domain = extractDomain(url);

  if (!domain) {
    return {
      url,
      domain: "",
      score: 0,
      tier: "unknown",
      reasoning: "Could not parse URL",
      factors: {
        domainType: "other",
        isKnownOutlet: false,
        isHttps: false,
      },
    };
  }

  const isSecure = isHttps(url);
  const domainType = getDomainType(domain);

  // Check high trust (exact match or suffix match for TLDs)
  const isHighTrust =
    HIGH_TRUST_DOMAINS.has(domain) ||
    domain.endsWith(".gov") ||
    domain.endsWith(".gov.uk") ||
    domain.endsWith(".gov.au") ||
    domain.endsWith(".edu") ||
    domain.endsWith(".ac.uk") ||
    HIGH_TRUST_DOMAINS.has(domain.split(".").slice(-2).join("."));

  // Check medium trust
  const isMediumTrust =
    MEDIUM_TRUST_DOMAINS.has(domain) || MEDIUM_TRUST_DOMAINS.has(domain.split(".").slice(-2).join("."));

  // Check low trust
  const isLowTrust = LOW_TRUST_PATTERNS.some((p) => p.test(domain));

  let score: number;
  let tier: TrustworthinessScore["tier"];
  let reasoning: string;

  if (isHighTrust) {
    score = 0.9;
    tier = "high";
    reasoning = `${domain} is a high-trust source (${domainType})`;
  } else if (isMediumTrust) {
    score = 0.6;
    tier = "medium";
    reasoning = `${domain} is a medium-trust source (${domainType})`;
  } else if (isLowTrust) {
    score = 0.2;
    tier = "low";
    reasoning = `${domain} is user-generated content or social media`;
  } else {
    // Unknown domain - moderate caution
    score = 0.4;
    tier = "unknown";
    reasoning = `${domain} is not in our trust database`;
  }

  // Slight penalty for HTTP
  if (!isSecure && score > 0.3) {
    score -= 0.1;
    reasoning += " (HTTP, not HTTPS)";
  }

  return {
    url,
    domain,
    score: Math.max(0, Math.min(1, score)),
    tier,
    reasoning,
    factors: {
      domainType,
      isKnownOutlet: isHighTrust || isMediumTrust,
      isHttps: isSecure,
    },
  };
}
