/**
 * suggestedQuestions.js — generates 4-6 daf-specific study questions (§6).
 * One background call on first open per daf; cached in the session.
 */
(function (global) {
  'use strict';
  const NS = global.VilnaChavruta = global.VilnaChavruta || {};

  function prompt(dafRef, avoid) {
    let p = `Based on the current daf (${dafRef}), generate 4-6 suggested study questions
that a learner would naturally want to ask. Return ONLY a JSON array of strings, no other
text.

Categories to draw from (pick the most relevant for THIS specific daf):
1. KEY INDIVIDUALS: "Who is [Tanna/Amora name] and what is their position here?"
   — only for scholars who play a central role in THIS sugya
2. ARAMAIC TERMS: "What does '[difficult term]' mean?"
   — only genuinely uncommon terms, not basic vocabulary
3. SUGYA FLOW: "What is the argument between [A] and [B] about?"
   — when there's a real machloket (dispute) on the daf
4. RASHI vs TOSAFOT: "How do Rashi and Tosafot differ on [topic]?"
   — only when they actually disagree on this daf
5. HALACHIC CONNECTION: "What is the practical halacha from this sugya?"
   — when Ein Mishpat references are present
6. FAMOUS STORIES: "What is the story of [narrative] about?"
   — only when an aggadic passage appears on this daf
7. MISHNAH CONNECTION: "How does the Gemara's discussion relate to the Mishnah's ruling?"
   — when the sugya is directly interpreting the Mishnah

Rules:
- Be SPECIFIC to this daf's content. Never generate generic questions.
- Use the actual names, terms, and topics from the text.
- Questions should be in the same language as the daf header (Hebrew).
- Short (under 60 chars each) — they're pill buttons.
- Order by likely interest (most compelling first).`;
    if (avoid && avoid.length) {
      p += `\n\nDo NOT repeat any of these already-shown questions:\n${avoid.map(q => `- ${q}`).join('\n')}`;
    }
    return p;
  }

  /** Tolerant parse: find the first JSON array in the response. */
  function parseQuestions(text) {
    const m = /\[[\s\S]*\]/.exec(text || '');
    if (!m) return null;
    try {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr)) {
        const qs = arr.filter(q => typeof q === 'string' && q.trim()).map(q => q.trim());
        return qs.length ? qs.slice(0, 6) : null;
      }
    } catch (e) { /* malformed */ }
    return null;
  }

  async function generate(systemPrompt, dafRef, avoid) {
    const { text } = await NS.provider.send({
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt(dafRef, avoid) }],
      maxTokens: 1000,
    });
    const qs = parseQuestions(text);
    if (!qs) throw new Error('no questions parsed');
    return qs;
  }

  NS.suggestions = { generate, _parse: parseQuestions };
})(typeof window !== 'undefined' ? window : globalThis);
