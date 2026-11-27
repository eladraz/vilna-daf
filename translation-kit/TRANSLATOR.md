# Translator instructions (any tractate; ru, yi, fr, es, ko)

You are given: `translate batch <ID> of tractate <TRACTATE> for lang <LANG>, read translation-kit/TRANSLATOR.md`.
Example: batch `batch-0007`, tractate `Shabbat`, lang `fr`. Work from the repository root (the folder that
contains `translation-kit/` and `data/`). Do not search the filesystem; every path you need is below.
`<WORK>` means `data/offline-work/i18n/<TRACTATE>` with spaces replaced by `_` (e.g. `data/offline-work/i18n/Moed_Katan`),
unless the person who gave you the task named another work directory (then pass it with `--work`).
Do not touch anything outside `<WORK>/<LANG>/out/`.

## 1. What to do

1. Read the input: `<WORK>/<LANG>/in/<ID>.json` (read all of it, in pieces if needed).
2. Translate every Hebrew/Aramaic string into the target language (section 5 gives the style per language).
3. Write the result to `<WORK>/<LANG>/out/<ID>.json` (section 3 gives the format).
4. Validate: `python3 translation-kit/i18n_check.py --tractate "<TRACTATE>" --lang <LANG> --batch <ID>`
5. If it prints `PROBLEM` lines, fix exactly those strings in the output file (Edit tool or a small
   python patch script that edits the JSON) and run the validator again. Repeat until the last line says `OK`.
   Never "fix" a problem by deleting or shortening text, and never edit the input file or any file in `data/offline/`.
6. Reply with one line: `<LANG> <ID> OK` (plus the number of pages), or the problems you could not fix.

Do the translating yourself, string by string. Do not write a program that translates, and do not call
a translation service or API. Python is allowed only for patching the JSON and running the validator.

## 2. Input format

```
{"lang":"fr","batch":"batch-0007","pages":[
  {"page":"<TRACTATE>/12a","blocks":{
     "gemara": {"he":[ "...", "..." ], "en":[ "...", "..." ]},
     "rashi":  {"he":[ ["...","..."], [], ["..."] ]},
     "tosafot":{"he":[ [], ["..."] ]},
     "gilyonHaShas":{"he":["<b>...</b> ..."]},
     "ravNissimGaon":{"he":["..."]} }},
  ...]}
```

- `he` is the text to translate. It is a list of strings (gemara, gilyonHaShas, ravNissimGaon) or a list of
  lists of strings (rashi, tosafot: the outer list is one entry per gemara segment, each inner list holds that
  segment's comments; inner lists are often empty).
- `en` (only for some blocks) is an English translation. It is an AID only: use it to resolve unclear Hebrew/Aramaic
  (who says what, what a pronoun refers to, what a verse is). Translate from the Hebrew. Do NOT carry over
  English explanations that are not in the Hebrew (the English adds many clarifying sentences), do not copy the
  English markup, and if the English and the Hebrew disagree, follow the Hebrew.
- Blocks present in a page are all to be translated: gemara, rashi, tosafot, gilyonHaShas, ravNissimGaon
  (whichever appear). Do not skip a block because it looks short or minor.

## 3. Output format (must mirror the input)

```
{"pages":[
  {"page":"<TRACTATE>/12a","blocks":{
     "gemara":[ "...", "..." ],
     "rashi":[ ["...","..."], [], ["..."] ],
     "tosafot":[ [], ["..."] ],
     "gilyonHaShas":[ "..." ],
     "ravNissimGaon":[ "..." ] }},
  ...]}
```

Rules that the validator enforces (a batch is rejected otherwise):

- Same pages (`page` strings copied exactly) and same block names as the input. For each block just the
  translated value, with NO `he`/`en` wrapper.
- The nesting and every list length must equal the Hebrew's: if `he` has 15 strings, you write 15 strings; if
  `rashi` has 14 inner lists with 0,4,1,... items, you write 14 inner lists with 0,4,1,... items. An empty list
  stays an empty list `[]`. One Hebrew string gives exactly one output string: never merge, split, reorder or drop
  segments, even if two neighbouring segments look like a single sentence.
- No empty output string for a non-empty Hebrew string. (A Hebrew string that is blank stays `""`.)
- Inline tags are copied from the Hebrew: every `<b>`, `</b>`, `<br>`, `<big>`, `<strong>`, `<small>` ... that is in the
  Hebrew string must be in your string, the same number of times, wrapped around the translation of the same words
  (e.g. Hebrew `<b>גמ' כל שחבירו נענש.</b> עי' ב"ב כב` becomes `<b>Guemara : ... .</b> Voir ...`). Do not add tags
  that are not in the Hebrew (in particular none of the English's `<i>`, `<sup>`, `<span>`).
- A string is a single line: no newline, tab, markdown (`**`, backticks). Drop trailing whitespace/newlines
  that some Hebrew strings carry.
- Valid JSON, UTF-8, written once as a whole file. Never use the plain ASCII double quote `"` inside a string
  (it needs escaping): quotation marks are `« »` (ru, fr, es, ko) or `„ ”` (yi), see below. A literal backslash is
  not needed anywhere.
- Script: ru = Cyrillic, yi = Hebrew letters (no Latin), ko = Hangul, fr/es = Latin letters (no Cyrillic, no Hangul; a few
  Hebrew words/refs are tolerated). Do not output English, and do not copy the Hebrew source unchanged.

Large batches: write the file in one go if you can. If it is too large for one write, split it by pages into
`out/<ID>.part1.json`, `out/<ID>.part2.json`, ... each of the form `{"pages":[...]}` (never split a page).
The validator reads `<ID>.json` and all `<ID>.partK.json`. Do not leave other stray files in `out/`.

## 4. Content rules (all languages)

- Translate faithfully and completely; do not summarise, explain, soften or censor, and do not add notes.
  Keep the register of the source (halakhic, legal-dialectical). The reader is a modern layperson/student.
- The Hebrew is unpunctuated Talmud text: supply normal punctuation and sentence breaks within each string.
  Questions: "מאי טעמא" = "what is the reason?" The Gemara's give-and-take (question, answer, objection, "yes, indeed")
  should read naturally, as a dialogue.
- Parentheses in the Hebrew like `(בית הלל)` mark a printed correction: translate the corrected reading
  and do not reproduce the parentheses. `[...]` brackets, `כו'`, `וגו'`, `וכו'` = "etc."/"and so on" (translate as
  such). Quoted verses: translate the verse as a verse, inside quotation marks.
- Rashi/Tosafot items look like `lemma - comment` (the lemma is the quoted Gemara phrase, a "dibbur hamatchil").
  Render as: opening quote + translated lemma + closing quote + space + em dash + space + comment, e.g. fr
  `« Le disciple qui ... » — le commentaire`. Tosafot items often start with the lemma then `-`; same treatment.
  Cross-references like `ד"ה`, `בפרק ...`, `(דף כה.)` become the language's equivalent ("s.v.", "chapitre", page ref
  with a/b side: `דף כה.` = 25a, `דף כה:` = 25b, in yi keep Hebrew numerals).
- gilyonHaShas (marginal notes) and ravNissimGaon: bold heading + a short note, usually "see ...". Keep the bold part
  as bold, translate "עי'/עיין" as "see".
- Names of rabbis, places, tractates and technical terms: transliterate consistently with the table for your
  language (section 5), and keep that spelling throughout the batch. Do not translate names (Rav, Abaye, Rava ...).
- Tractate and book names in references are translated/transliterated (Shabbat, Eruvin, Sanhedrin, Psalms).
  Page names in `page` keys (e.g. `Shabbat/12a`, `Moed Katan/3b`) are copied exactly, never translated.
- Numbers in refs stay as they are (Arabic digits for fr/es/ko; yi keeps Hebrew numerals as in the source).
- If a fragment is truly unintelligible, give your best literal rendering; never leave it empty or in Hebrew.

## 5. Language style

### ru - Russian
- Modern literary Russian, as in the finished Berachot pages. Quotation marks `« ... »`; the dash in
  `lemma — comment` is an em dash with spaces.
- Words the Hebrew leaves implicit may be supplied in square brackets `[...]`, as Berachot does
  (`Пусть же [запрет] будет выведен ...`), sparingly and only where the sentence needs them.
- Names and terms: рабби Йехуда, рабби Йоханан, рабби Элиэзер, рабби Меир, рабби Акива, рабби Йеошуа бен Леви,
  рабби Шимон, рабби Йоси, Раббан Гамлиэль, рав Хуна, рав Хисда, рав Нахман, рав Аши, рав Папа, рав Шешет, Абайе,
  Рава, Рав, Шмуэль, Реш Лакиш, Бейт Шаммай / Бейт Гилель, суббота (the day; «Шаббат» only as the tractate name), Мишна, Гемара, барайта, танна, амора, Тора,
  Тосафот, Раши, Всевышний (for ה'), Святой, благословен Он. Bible books by their Hebrew names in Russian
  transliteration as in Berachot: Берешит, Шмот, Ваикра, Бемидбар, Дварим, Шофтим, Теилим, Мишлей ...
- "Taught" = «Учили мудрецы в барайте» / «учили», "said" = «сказал», "see" = «см.». Page refs: `трактат Кидушин (лист 80б)`,
  `Шаббат 25а` (Cyrillic а/б for the amud side).
- No Latin letters, no Hangul.

### yi - Yiddish, Hebrew script
- Standard (YIVO-style) Yiddish orthography with the usual diacritics: אַ (pasekh alef) אָ (komets alef) ײַ (tsvey yudn
  with pasekh) פּ פֿ בֿ כּ תּ, e.g. וואָס, זײַן, פֿון, פֿאַר, גאַנץ, נישט, האָט געזאָגט. Native words are Yiddish
  (not German, not modern Hebrew).
- Letter forms (as in the finished Berachot pages): write "vov vov" as two letters וו (never the ligature װ), vov-yud as וי (never ױ),
  and tsvey-yudn WITH pasekh ײַ (never bare ײ). Typical fix after writing: in python `s.replace('װ','וו').replace('ױ','וי')`
  and `re.sub('ײ(?!\u05b7)','ײַ',s)`.
- The Hebrew and Aramaic words of the source that are normally embedded in Yiddish stay in Hebrew letters
  as in the source: rabbis' names (רב יהודה, אביי, רבא, ר׳ יוחנן, ר׳ מאיר), the Mishnah/Gemara markers (`מתני׳`, `גמ׳`),
  tractate names (שבת, עירובין), terms (תנא, ברייתא, הקדוש ברוך הוא, שבת, מלאכה, רשות הרבים), and short quoted Hebrew
  verse phrases or lemmas, which you may keep in Hebrew inside `„ ”`. The running syntax is Yiddish.
- Source references stay Hebrew as in the source, and "see" is `זעה`: `זעה יומא ע״א ע״א`, `ד״ה`, `תוס׳`, `ב״ב`, `ר״ה`.
  Use the Hebrew punctuation marks geresh `׳` and gershayim `״` (not ASCII ' and ") in abbreviations
  (ר״ה, תוס׳, כו׳).
- Quotation marks `„ ”`. God: ה׳ is rendered `השם` or `דער אויבערשטער`; `הקדוש ברוך הוא` stays as is.
- "he said" = `האָט געזאָגט`, "the Sages taught" = `די חכמים האָבן געלערנט` (`תנו רבנן` may also stay),
  "what is the reason" = `וואָס איז דער טעם`, "Mishnah" = `משנה`, "Gemara" = `גמרא`.
- No Latin letters at all (the validator rejects more than 10 Latin letters in a string).

### fr - French
- Modern, clear French. Quotation marks `« ... »` with a normal space inside; apostrophe is the straight `'`.
  Sentence-final `:` `;` `?` `!` are preceded by a space (« Pourquoi ? »).
- Transliteration in the Francophone Jewish style: Rav Yehouda, Rabbi Yohanan, Rabbi Éléazar, Rabbi Méir, Rabbi Akiva,
  Rabbi Yehochoua, Rabbi Chimon, Rabbi Yossi, Rabban Gamliel, Rav Houna, Rav Hisda, Rav Nahman, Rav Ashi, Rav Pappa, Rav Chechet,
  Abaye, Rava, Rav, Chmouel (Shmuel), Resh Lakish, Beit Chammaï / Beit Hillel, Chabbat, Michna, Guemara, baraïta,
  tanna, amora, Torah, Tossafot, Rachi, Éternel (for ה'), le Saint, béni soit-Il, Nabuchodonosor, Sédécias.
- "Said" = « dit », "taught" = « enseigné » / « Les Sages enseignent », "see" = « Voir ». Page refs: `Chabbat 25a`.
- Talmudic terms may be transliterated in italics-free plain text with a short gloss on first use only when the
  Hebrew itself does (otherwise keep the term plain).

### es - Spanish
- Neutral, clear Spanish. Quotation marks `« ... »` with no space inside; questions with `¿ ?`, exclamations `¡ !`.
- Transliteration in the Hispanic Jewish style: Rav Yehudá, Rabí Yojanán, Rabí Elazar, Rabí Meir, Rabí Akiva, Rabí
  Yehoshúa, Rabí Shimón, Rabí Yosei, Rabán Gamliel, Rav Huná, Rav Jisdá, Rav Najmán, Rav Ashi, Rav Papa, Rav Sheshet,
  Abaye, Rava, Rav, Shmuel, Resh Lakish, Beit Shamai / Beit Hilel, Shabat, Mishná, Guemará, baraita, tanna, amora, Torá,
  Tosafot, Rashi, el Señor (for ה'), el Santo, bendito sea, Nabucodonosor, Sedequías.
- "dijo", "enseñaron los Sabios", "Véase". Page refs: `Shabat 25a`.

### ko - Korean, Hangul
- Plain written declarative style (-다, -이다, -하였다, -한다), the same level throughout; questions end with -가? / -는가? /
  -인가?; the interlocutors' lines are also in plain style. Not the polite -습니다 style.
- All names and terms are written in Hangul (no Latin letters at all): 라브 예후다, 라비 요하난, 라비 엘아자르,
  라비 메이르, 라비 아키바, 라비 예호슈아, 라비 시몬, 라비 요세이, 라반 가믈리엘, 라브 후나, 라브 히스다, 라브 나흐만,
  라브 아시, 라브 파파, 라브 셰셰트, 아바예, 라바, 라브, 슈무엘, 레시 라키시, 베이트 샤마이, 베이트 힐렐, 안식일(샤바트),
  미슈나, 게마라, 바라이타(바라이트), 탄나, 아모라, 토라, 토사포트, 라시, 주(for ה'), 거룩하신 분, 찬양받으실 분.
  Tractates: 샤바트, 에루빈, 베라호트, 페사힘, 요마, 상헤드린, 바바 바트라 ...; "see" = `...을/를 보라`.
- Quotation marks: `« ... »` for quoted verses and lemmas; inner quotes `“ ... ”`. Biblical book names in
  Korean (열왕기상, 이사야 ...), page refs `샤바트 25a`-style with a/b kept.

## 6. Quick self-check before you validate

- Same number of pages and blocks; same lengths at every level; `[]` where the Hebrew has `[]`.
- Every tag of the Hebrew string is in yours. No `"` ASCII quote inside strings. No newline inside strings.
- Nothing left in Hebrew (except yi, and except short quoted lemmas/refs in ru/fr/es/ko) and nothing in English.
- Then run: `python3 translation-kit/i18n_check.py --tractate "<TRACTATE>" --lang <LANG> --batch <ID>` and fix until `OK`.
