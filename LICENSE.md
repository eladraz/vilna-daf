# License

## Code

MIT License

Copyright (c) 2026 Elad Raz <e@eladraz.com>

Vilna Daf is written and maintained by Elad Raz, as a way to give anyone the
ability to add Torah on the Gemara — in the classic Vilna daf form that
everyone loves to read, on screen and in print.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Talmud Text — Powered by Sefaria

**This software is built on [Sefaria](https://www.sefaria.org).** All Talmud text,
commentary, vocalization, cross-references, and chapter structure are served from
Sefaria's free, open API; the project depends on it entirely. Sefaria's attribution
must be preserved in any use or deployment — it is shown in the application footer and
is a condition of the text license. See Sefaria's terms at
<https://www.sefaria.org/terms>.

The Talmud text and commentaries displayed by this software are sourced from
[Sefaria](https://www.sefaria.org) via their public API. The primary text version
used is the **William Davidson digital edition of the Koren Noé Talmud**, with
commentary by **Rabbi Adin Even-Israel Steinsaltz**.

This content is licensed under a **Creative Commons Attribution-NonCommercial
4.0 International License (CC-BY-NC 4.0)**.

> The William Davidson Talmud is a fully digital edition of the Babylonian Talmud
> with the complete traditional commentaries. It is made available through the
> generous support of the William Davidson Foundation.
>
> Hebrew text: Koren Publishers Jerusalem Ltd.  www.korenpub.com
> English translation: Sefaria, CC-BY-NC.
> Commentary: Rabbi Adin Even-Israel Steinsaltz, CC-BY-NC.
> Nikud (vocalization): Dicta - the Israel Center for Text Analysis.

**Users of this software must comply with the CC-BY-NC license terms**, which
prohibit commercial use of the text without separate permission from the rights
holders (Koren Publishers Jerusalem).

Full license text: https://creativecommons.org/licenses/by-nc/4.0/

The Rashi and Tosafot commentary texts are from the **Vilna Edition** (Public
Domain).

---

## Fonts

### Frank Ruhl Libre
Copyright the Frank Ruhl Libre Project Authors. Licensed under the SIL Open
Font License 1.1. https://fonts.google.com/specimen/Frank+Ruhl+Libre

### Noto Rashi Hebrew
Copyright the Noto Project Authors. Licensed under the SIL Open Font
License 1.1. https://fonts.google.com/specimen/Noto+Rashi+Hebrew

---

## Attribution (required)

Anyone who uses, modifies, or deploys this software **must keep the Sefaria
attribution visible** (the application shows it in the page footer) and must
link back to Sefaria. The required credit:

> Talmud text, vocalization, and commentary courtesy of
> [Sefaria](https://www.sefaria.org) — the William Davidson Talmud, used under
> CC-BY-NC 4.0. Commentary by Rabbi Adin Even-Israel Steinsaltz. Hebrew
> vocalization by Dicta.

Removing or obscuring the Sefaria attribution is not permitted.


## Additional text attributions (Sefaria sources, per-version licences)

Texts under `data/offline/` come from [Sefaria](https://www.sefaria.org) and keep the licence of the
Sefaria version they were taken from. Each block records it in `sources` (`title`, `license`,
`pd`, and `special: true` for anything that is not Public Domain / CC0, so it can be found and
removed: `grep -l '"special":true' data/offline/*/*.json`).

- **Public Domain / CC0:** "Vilna Edition" Hebrew (Rashi, Tosafot, Gilyon HaShas, Rav Nissim
  Gaon, Rabbeinu Chananel, most pages); Sefaria Community Translation (CC0).
- **CC-BY-SA:** part of the Hebrew Rashi/Tosafot and other versions as listed per page.
  Attribution to Sefaria and the version's contributors is required, and adaptations stay CC-BY-SA.
- **CC-BY:** Tosafot translation by Jan Buckler (English).
- **CC-BY-NC:** William Davidson Edition (Hebrew/Aramaic and English) of the Talmud — non-commercial use only.
- **Russian, Yiddish, French, Spanish, Korean:** machine translations derived from the Hebrew
  and, where used, the English above. They inherit the most restrictive source licence
  (`derivedFrom`, `special`).
- Blocks whose version licence is unknown are not displayed.
