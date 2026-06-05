function normalizeTweetText(html: string): string {
   const doc = new DOMParser().parseFromString(html, 'text/html');
   return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export async function verifyTweetMatchesExpected(
   tweetUrl: string,
   expectedText: string,
): Promise<{ ok: boolean; actual?: string; error?: string }> {
   try {
      const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl.trim())}`;
      const res = await fetch(oembedUrl);
      if (!res.ok) {
         return { ok: false, error: `oEmbed ${res.status}` };
      }
      const body = (await res.json()) as { html?: string };
      if (!body.html) {
         return { ok: false, error: 'No html in oEmbed response' };
      }
      const actual = normalizeTweetText(body.html);
      const expected = expectedText.replace(/\s+/g, ' ').trim();
      const ok = actual.includes(expected) || expected.includes(actual);
      return { ok, actual: ok ? undefined : actual };
   } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
   }
}
