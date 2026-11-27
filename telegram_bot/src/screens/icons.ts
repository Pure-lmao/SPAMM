const SPORT_RULES: readonly { test: RegExp; icon: string }[] = [
   { test: /american football|\bnfl\b|\bcfl\b/i, icon: "🏈" },
   { test: /australian rules|\bafl\b/i, icon: "🏉" },
   { test: /soccer|football/i, icon: "⚽" },
   { test: /basketball|\bnba\b/i, icon: "🏀" },
   { test: /baseball|\bmlb\b/i, icon: "⚾" },
   { test: /ice hockey|hockey|\bnhl\b/i, icon: "🏒" },
   { test: /table tennis|ping pong/i, icon: "🏓" },
   { test: /tennis/i, icon: "🎾" },
   { test: /badminton/i, icon: "🏸" },
   { test: /volleyball/i, icon: "🏐" },
   { test: /handball/i, icon: "🤾" },
   { test: /cricket/i, icon: "🏏" },
   { test: /rugby/i, icon: "🏉" },
   { test: /\bmma\b|\bufc\b|boxing/i, icon: "🥊" },
   { test: /golf/i, icon: "⛳" },
   { test: /darts|snooker/i, icon: "🎯" },
   { test: /cycling/i, icon: "🚴" },
   { test: /formula|motorsport|\bf1\b|nascar|racing/i, icon: "🏎️" },
   { test: /\bcs2\b|\bcsgo\b|counter-strike|cs:go/i, icon: "🔫" },
   { test: /esport|dota|league of legends|valorant/i, icon: "🎮" },
];

const FLAGS: Record<string, string> = {
   "united states": "🇺🇸",
   "united kingdom": "🇬🇧",
   "northern ireland": "🇬🇧",
   "south korea": "🇰🇷",
   "north korea": "🇰🇵",
   "south africa": "🇿🇦",
   "new zealand": "🇳🇿",
   "saudi arabia": "🇸🇦",
   "costa rica": "🇨🇷",
   "czech republic": "🇨🇿",
   "hong kong": "🇭🇰",
   england: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
   english: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
   scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
   scottish: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
   wales: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
   welsh: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
   ireland: "🇮🇪",
   irish: "🇮🇪",
   spain: "🇪🇸",
   spanish: "🇪🇸",
   france: "🇫🇷",
   french: "🇫🇷",
   germany: "🇩🇪",
   german: "🇩🇪",
   italy: "🇮🇹",
   italian: "🇮🇹",
   netherlands: "🇳🇱",
   dutch: "🇳🇱",
   portugal: "🇵🇹",
   portuguese: "🇵🇹",
   brazil: "🇧🇷",
   brazilian: "🇧🇷",
   argentina: "🇦🇷",
   argentine: "🇦🇷",
   mexico: "🇲🇽",
   mexican: "🇲🇽",
   usa: "🇺🇸",
   us: "🇺🇸",
   canada: "🇨🇦",
   canadian: "🇨🇦",
   australia: "🇦🇺",
   australian: "🇦🇺",
   japan: "🇯🇵",
   japanese: "🇯🇵",
   korea: "🇰🇷",
   korean: "🇰🇷",
   china: "🇨🇳",
   chinese: "🇨🇳",
   turkey: "🇹🇷",
   turkish: "🇹🇷",
   greece: "🇬🇷",
   greek: "🇬🇷",
   belgium: "🇧🇪",
   belgian: "🇧🇪",
   sweden: "🇸🇪",
   swedish: "🇸🇪",
   norway: "🇳🇴",
   norwegian: "🇳🇴",
   denmark: "🇩🇰",
   danish: "🇩🇰",
   finland: "🇫🇮",
   finnish: "🇫🇮",
   poland: "🇵🇱",
   polish: "🇵🇱",
   austria: "🇦🇹",
   austrian: "🇦🇹",
   switzerland: "🇨🇭",
   swiss: "🇨🇭",
   croatia: "🇭🇷",
   croatian: "🇭🇷",
   serbia: "🇷🇸",
   serbian: "🇷🇸",
   romania: "🇷🇴",
   romanian: "🇷🇴",
   hungary: "🇭🇺",
   hungarian: "🇭🇺",
   czechia: "🇨🇿",
   czech: "🇨🇿",
   ukraine: "🇺🇦",
   ukrainian: "🇺🇦",
   russia: "🇷🇺",
   russian: "🇷🇺",
   israel: "🇮🇱",
   israeli: "🇮🇱",
   egypt: "🇪🇬",
   egyptian: "🇪🇬",
   morocco: "🇲🇦",
   moroccan: "🇲🇦",
   qatar: "🇶🇦",
   india: "🇮🇳",
   indian: "🇮🇳",
   chile: "🇨🇱",
   colombia: "🇨🇴",
   peru: "🇵🇪",
   uruguay: "🇺🇾",
   ecuador: "🇪🇨",
   nigeria: "🇳🇬",
   ghana: "🇬🇭",
   "uae": "🇦🇪",
   emirates: "🇦🇪",
};

const FLAG_KEYS = Object.keys(FLAGS).sort((a, b) => b.length - a.length);

export function sportIcon(name: string): string {
   for (const rule of SPORT_RULES) {
      if (rule.test.test(name)) {
         return rule.icon;
      }
   }
   return "";
}

export function leagueFlag(name: string): string {
   const lower = name.toLowerCase();
   for (const key of FLAG_KEYS) {
      if (lower === key || lower.startsWith(`${key} `)) {
         return FLAGS[key] ?? "";
      }
   }
   return "";
}

export function withIcon(icon: string, text: string): string {
   return icon === "" ? text : `${icon} ${text}`;
}
