export interface MediumPost {
  id: string;
  title: string;
  summary: string;
  url: string;
  coverImage: string;
  author: string;
  publishedDate: string;
  tags: string[];
  readTime: string;
}

export interface TwitterThread {
  id: string;
  tweetId: string;
  url: string;
  title: string;
  summary: string;
  tags: string[];
  date: string;
  /** Optional preview image shown in the fallback card. Grab the og:image URL from the tweet page. */
  previewImageUrl?: string;
}

export const MEDIUM_POSTS: MediumPost[] = [
  {
    id: "pq-day-ethereum-p1",
    title: "What Breaks When Q-Day Hits Ethereum: Part 1, Signatures",
    summary:
      "ECDSA has worked well for decades but it was never designed with quantum computers in mind. I go through exactly what breaks first and why signatures are the most exposed part of the stack.",
    url: "https://medium.com/@pranshurastogi/what-breaks-when-the-q-day-arrives-on-ethereum-p1-signatures-007602db9ea2",
    coverImage:
      "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=900&q=80",
    author: "Pranshu Rastogi",
    publishedDate: "Mar 2026",
    tags: ["Post-Quantum", "Ethereum", "Cryptography"],
    readTime: "8 min read",
  },
  {
    id: "pq-day-ethereum-p2",
    title: "What Breaks When Q-Day Arrives on Ethereum — P2: ZK Proofs",
    summary:
      "ZK proofs are celebrated as the future of Ethereum scaling and privacy. But most of them rely on the same elliptic curve assumptions that quantum computers will shatter. A deep dive into which proof systems survive Q-Day and which don't.",
    url: "https://pranshurastogi.medium.com/what-breaks-when-the-q-day-arrives-on-ethereum-p2-zk-proofs-0505ebbce2d6",
    coverImage:
      "https://images.unsplash.com/photo-1518770660439-4636190af475?w=900&q=80",
    author: "Pranshu Rastogi",
    publishedDate: "Mar 2026",
    tags: ["Post-Quantum", "ZK Proofs", "Ethereum"],
    readTime: "9 min read",
  },
];

export const TWITTER_THREADS: TwitterThread[] = [
  {
    id: "thread-pq-overview",
    tweetId: "2033612728443801939",
    url: "https://twitter.com/pranshurastogii/status/2033612728443801939",
    title: "Post-Quantum Cryptography on Ethereum",
    summary:
      "Wrote a thread on what post-quantum crypto actually means for Ethereum. Not the hype version, just the real protocol-level picture.",
    tags: ["Post-Quantum", "Ethereum"],
    date: "Mar 2026",
  },
  {
    id: "thread-stealth-addresses",
    tweetId: "2033143698771578936",
    url: "https://twitter.com/pranshurastogii/status/2033143698771578936",
    title: "Stealth Addresses and Why Privacy Is Hard",
    summary:
      "Most people think stealth addresses are simple. They are not. Thread on how they work, where they fall apart, and what SPECTER does differently.",
    tags: ["Stealth Addresses", "Privacy"],
    date: "Mar 2026",
  },
];
