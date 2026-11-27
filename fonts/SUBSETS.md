# Font subsets: manifest (translation layers, T8)

Generated for the `vilna-layout` multilingual round (T1 fonts). Covers the new faces added in `fonts/`
for Korean (`ko`), Yiddish (`yi`) and the Latin/Cyrillic translation sheets (`en`, `ru`, `fr`, `es`). Plan refs: `docs/TRANSLATION_SPLIT_PLAN.md` §3.6, §9, §11 T8.
Licence texts: `fonts/OFL-NotoSerifKR.txt`, `fonts/OFL-NotoSerif.txt`. Existing faces are unchanged (see the table at the end).

## New files

| file | size (bytes) | sha256 | source font, version | source sha256 (download) | licence |
|---|---|---|---|---|---|
| `fonts/NotoSerifKR-hangul.woff2` | 362036 | `815b4bac855e286ab250ee003f86c52ba4fcd0b053af9a167e38ed806643e07d` | Noto Serif KR (variable `wght` 200–900), Version 2.003-H1 | `11f8d5de6f1b79195efba3828aaa2ec95c1178f5ae976fb23c8d53250a9938f3` | SIL OFL 1.1 |
| `fonts/NotoSerif-extra.woff2` | 13292 | `760fae454b3c7e2767fbc1f021b7383767993f770f3da2321ca4ac6c229a1395` | Noto Serif (variable `wdth` pinned to 100, `wght` 100–900), Version 2.015 | `4d8e6761424656867019081a1a01336f3cb086982682698714054fc33f782713` | SIL OFL 1.1 |

## Sources (downloaded from official Google Fonts repository, branch `main`, on 2026-11-26)

- Noto Serif KR: `https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifkr/NotoSerifKR%5Bwght%5D.ttf` (licence `.../ofl/notoserifkr/OFL.txt`); name table: copyright "(c) 2017-2024 Adobe", OFL 1.1, https://openfontlicense.org. Upstream: Noto CJK project (Adobe/Google).
- Noto Serif: `https://raw.githubusercontent.com/google/fonts/main/ofl/notoserif/NotoSerif%5Bwdth%2Cwght%5D.ttf` (licence `.../ofl/notoserif/OFL.txt`); name table: "Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic)", OFL 1.1.
- The `main` branch is not a pin: re-verify the source sha256 above before any rebuild.

## Code points

### `NotoSerifKR-hangul.woff2` (ko): 1321 code points, all of the ko corpus except Hebrew (U+0590–05FF, covered by the bundled Frank Ruhl Libre Hebrew face) and U+1E25 (not in this font). Includes U+0020 (space). Hangul syllables are only the ones used in the corpus (1239 distinct); a syllable outside this list is NOT covered.

```
U+0020-0022, U+0027-002A, U+002C-003C, U+003E-003F, U+0041, U+0045, U+0049, U+004C-004D, U+0052-0054, U+0059, U+005B, U+005D, U+0061-0065, U+0067-0069, U+006B-0070, U+0072-0076, U+0079-007A, U+007E, U+00AB, U+00B7, U+00BB, U+2013-2014, U+2018-201A, U+201C-201E, U+2026, U+2039-203A, U+300C-300F, U+314E, U+6C34, U+7AE0, U+816B, U+8671, U+AC00-AC01, U+AC04, U+AC07-AC08, U+AC10-AC17, U+AC19-AC1A, U+AC1C-AC1D, U+AC2F, U+AC31, U+AC38, U+AC40, U+AC70-AC71, U+AC74, U+AC77-AC78, U+AC80-AC81, U+AC83, U+AC85, U+AC89-AC8A, U+AC8C, U+AC90, U+AC94, U+AC9C, U+AC9F-ACA0, U+ACA8-ACAA, U+ACAC, U+ACB0, U+ACB8-ACB9, U+ACBC-ACBD, U+ACC1, U+ACC4, U+ACE0-ACE1, U+ACE4, U+ACE7-ACE8, U+ACF0-ACF1, U+ACF3, U+ACF5, U+ACFC, U+AD00, U+AD11, U+AD1C, U+AD2D, U+AD34, U+AD50, U+AD6C-AD6D, U+AD70, U+AD73-AD76, U+AD7C-AD7D, U+AD81, U+AD8C, U+AD90, U+ADA4, U+ADC0, U+ADD0, U+ADD3, U+ADDC, U+ADF8-ADF9, U+ADFC, U+AE00-AE01, U+AE08-AE09, U+AE0B, U+AE0D, U+AE30, U+AE34, U+AE37-AE38, U+AE40-AE41, U+AE43, U+AE4A, U+AE4C-AE4E, U+AE50, U+AE54, U+AE5C-AE5D, U+AE65, U+AE68, U+AE6C, U+AE70, U+AEBC, U+AEBE, U+AECD, U+AECF-AED1, U+AED8, U+AEF4, U+AF08, U+AF2C-AF2D, U+AF3D, U+AF43, U+AF49, U+AF80, U+AFB8, U+AFBC, U+AFC0, U+AFC7-AFC8, U+AFF0, U+B00C, U+B010, U+B014, U+B044, U+B048, U+B04A, U+B04C, U+B053, U+B057, U+B05D, U+B07C, U+B084, U+B08D, U+B098-B09A, U+B09C, U+B0A0-B0A1, U+B0A8-B0A9, U+B0AB-B0AF, U+B0B1, U+B0B3-B0B4, U+B0B8, U+B0BC, U+B0C4-B0C5, U+B0C7-B0C9, U+B0D0, U+B0E5, U+B108-B109, U+B10C, U+B110, U+B113, U+B118, U+B11C, U+B123-B124, U+B128, U+B12C, U+B134, U+B137, U+B140-B141, U+B144, U+B150, U+B154-B155, U+B158, U+B178-B179, U+B17C, U+B180, U+B188-B189, U+B18B, U+B18D, U+B192-B193, U+B1CC, U+B204, U+B208, U+B20C, U+B215, U+B217, U+B220, U+B258, U+B25C, U+B260, U+B269, U+B274, U+B290-B291, U+B294, U+B298-B299, U+B2A5-B2A6, U+B2AA, U+B2AC, U+B2C8, U+B2CC, U+B2D0, U+B2D8-B2D9, U+B2DB, U+B2E4-B2E6, U+B2E8, U+B2EB-B2EE, U+B2F3-B2F5, U+B2F7, U+B2F9, U+B2FF-B300, U+B304, U+B311, U+B31C, U+B354-B355, U+B358, U+B35C, U+B35F, U+B364, U+B367, U+B369, U+B36B, U+B36E, U+B370-B371, U+B374, U+B378, U+B380, U+B383, U+B38C, U+B3C4-B3C5, U+B3C8, U+B3CB-B3CC, U+B3D4-B3D5, U+B3D7, U+B3D9, U+B3DB, U+B3FC, U+B418, U+B41C, U+B420, U+B428-B429, U+B450-B451, U+B454, U+B458, U+B460-B461, U+B465, U+B46C, U+B4A4, U+B4B7, U+B4B9, U+B4DC-B4DD, U+B4E0, U+B4E3-B4E4, U+B4EC-B4ED, U+B4EF, U+B4F1, U+B514, U+B518, U+B51B-B51C, U+B524-B525, U+B527, U+B529-B52A, U+B530-B531, U+B534, U+B538, U+B540, U+B545, U+B54B-B54C, U+B554, U+B5A0-B5A1, U+B5A4, U+B5A8, U+B5B4, U+B5BB-B5BC, U+B5C0, U+B5CF, U+B610-B611, U+B625, U+B69C-B69D, U+B6A4, U+B6AB, U+B6B1, U+B6F0, U+B6F4, U+B6F8, U+B728, U+B72C, U+B72F-B730, U+B738, U+B73B, U+B744, U+B760, U+B77C-B77D, U+B780, U+B784, U+B78C-B78D, U+B78F-B791, U+B798-B799, U+B79C, U+B7A0, U+B7AB-B7AC, U+B7B4-B7B5, U+B7C7, U+B7C9, U+B7EC, U+B7F0, U+B7F4, U+B7FC-B7FD, U+B7FF-B801, U+B807-B809, U+B80C, U+B810, U+B818-B819, U+B81B, U+B824-B825, U+B828, U+B82C, U+B835, U+B837-B839, U+B840, U+B85C-B85D, U+B860, U+B864, U+B86C-B86D, U+B86F, U+B871, U+B8B0, U+B8CC, U+B8D0, U+B8E8-B8E9, U+B8EC, U+B8F0, U+B8F8-B8F9, U+B8FB, U+B958, U+B95C, U+B96D, U+B974, U+B978, U+B97C, U+B984-B985, U+B987, U+B989, U+B98E, U+B9AC-B9AD, U+B9B0, U+B9B4, U+B9BC-B9BD, U+B9BF, U+B9C1, U+B9C8-B9C9, U+B9CC, U+B9CE-B9D1, U+B9D8-B9D9, U+B9DB, U+B9DD-B9DE, U+B9E1, U+B9E4-B9E5, U+B9E8, U+B9EC, U+B9F7, U+B9F9-B9FA, U+BA00, U+BA38-BA39, U+BA3C, U+BA40, U+BA48, U+BA4D, U+BA54-BA55, U+BA58, U+BA5C, U+BA64, U+BA67, U+BA70, U+BA74, U+BA78, U+BA84-BA85, U+BA87, U+BAA8-BAA9, U+BAAB-BAAC, U+BAAF-BAB0, U+BAB8-BAB9, U+BABB, U+BABD, U+BB18, U+BB34-BB36, U+BB38, U+BB3B-BB3D, U+BB44-BB45, U+BB47, U+BB49, U+BB4D, U+BBC0, U+BBC8, U+BBD3, U+BBF8-BBF9, U+BBFC, U+BBFF-BC00, U+BC08, U+BC0B, U+BC0F, U+BC11, U+BC14-BC16, U+BC18, U+BC1B-BC1D, U+BC1F, U+BC24-BC25, U+BC27, U+BC29, U+BC2D, U+BC30-BC31, U+BC40, U+BC43, U+BC45, U+BC49, U+BC4C, U+BC84-BC85, U+BC88, U+BC8C, U+BC94-BC95, U+BC97, U+BC99, U+BCA0, U+BCA4, U+BCA7-BCA8, U+BCB3, U+BCBC-BCBD, U+BCC0, U+BCC4, U+BCCD, U+BCD1, U+BCD5, U+BCF4-BCF6, U+BCF8, U+BCFC, U+BD04-BD05, U+BD07, U+BD09, U+BD10, U+BD48, U+BD59, U+BD80-BD81, U+BD84, U+BD88-BD89, U+BD90, U+BD93, U+BD95, U+BD99, U+BE0C, U+BE14, U+BE44-BE45, U+BE48, U+BE4C, U+BE54-BE55, U+BE57, U+BE59-BE5B, U+BE60-BE61, U+BE64, U+BE68, U+BE74-BE75, U+BE7B-BE7D, U+BE80, U+BEA8, U+BED0, U+BED4, U+BED7, U+BEE3, U+BF08-BF09, U+BF18, U+BF51, U+BF55, U+BFCC, U+BFD0, U+BFD4, U+BFDC, U+C058, U+C05C, U+C068-C069, U+C090, U+C0AC-C0AD, U+C0AF-C0B0, U+C0B4, U+C0B6, U+C0BC-C0BD, U+C0BF-C0C1, U+C0C5, U+C0C8-C0C9, U+C0CC, U+C0D8, U+C0DD, U+C0E4, U+C0E8, U+C0EC, U+C0F4, U+C0F7, U+C11C-C11E, U+C120, U+C124, U+C12C-C12D, U+C12F-C131, U+C136, U+C138-C139, U+C13C, U+C140, U+C148-C149, U+C14B, U+C154, U+C168, U+C170, U+C174, U+C178, U+C180, U+C18C-C18D, U+C190, U+C194, U+C19C, U+C19F, U+C1A1, U+C1A5, U+C1A8, U+C1C4, U+C1E0, U+C1FC, U+C200, U+C218-C219, U+C21C, U+C21F-C220, U+C228-C229, U+C22B, U+C22D, U+C22F, U+C232, U+C250, U+C258, U+C260, U+C26C-C26D, U+C270, U+C274, U+C27C-C27D, U+C288, U+C28C, U+C290, U+C298, U+C2A4, U+C2A8, U+C2AC, U+C2B4-C2B5, U+C2B7, U+C2B9, U+C2DC-C2DD, U+C2E0, U+C2E3-C2E4, U+C2EB-C2ED, U+C2EF, U+C2F1, U+C2F6, U+C2F8-C2F9, U+C2FC, U+C300, U+C309, U+C30C-C30D, U+C313, U+C368-C369, U+C36C, U+C370, U+C379, U+C37C, U+C3D8, U+C3DF, U+C410, U+C4F0, U+C4F4, U+C4F8, U+C500-C501, U+C50C, U+C528-C529, U+C52C, U+C539, U+C53B, U+C544-C545, U+C548-C54A, U+C54C, U+C554-C555, U+C557-C559, U+C55E, U+C560-C561, U+C564, U+C571, U+C57C-C57D, U+C580, U+C584, U+C587, U+C58C-C58D, U+C58F, U+C591, U+C597, U+C5B4-C5B5, U+C5B8-C5B9, U+C5BB-C5BD, U+C5C4-C5C9, U+C5CE, U+C5D0-C5D1, U+C5D4, U+C5D8, U+C5E0-C5E1, U+C5E3, U+C5EC-C5EE, U+C5F0, U+C5F4, U+C5FC-C5FD, U+C5FF-C601, U+C605-C606, U+C608, U+C610, U+C61B, U+C624-C625, U+C628, U+C62C, U+C62E, U+C633-C635, U+C637, U+C639, U+C640, U+C644, U+C653-C655, U+C65C, U+C678, U+C67C, U+C694-C695, U+C698, U+C6A4-C6A5, U+C6A7, U+C6A9, U+C6B0-C6B1, U+C6B4, U+C6B8, U+C6C0-C6C1, U+C6C3, U+C6C5, U+C6CC, U+C6D0, U+C6D4, U+C6E0, U+C6E8, U+C6EC, U+C704, U+C708, U+C70C, U+C714, U+C717, U+C720-C721, U+C724, U+C728, U+C733, U+C73C, U+C740, U+C744, U+C74A, U+C74C-C74D, U+C751, U+C758, U+C75C, U+C774-C775, U+C778, U+C77C-C77D, U+C783-C785, U+C787-C78A, U+C78E, U+C790-C791, U+C794, U+C798, U+C7A0-C7A1, U+C7A3-C7A6, U+C7AC, U+C7B4, U+C7BF-C7C1, U+C800-C801, U+C804, U+C808, U+C80A, U+C810-C811, U+C813, U+C815-C816, U+C81C, U+C824, U+C82F, U+C838, U+C84C, U+C870-C871, U+C874, U+C878, U+C880-C881, U+C885, U+C887, U+C88B-C88C, U+C8C4, U+C8FC-C8FD, U+C900, U+C904, U+C90C-C90D, U+C90F, U+C911, U+C950, U+C954, U+C988-C989, U+C990, U+C999, U+C99D, U+C9C0-C9C1, U+C9C4, U+C9C8, U+C9CA, U+C9D0-C9D1, U+C9D3, U+C9D5-C9D6, U+C9D9-C9DA, U+C9DC-C9DD, U+C9E0, U+C9E2, U+C9E4, U+C9E7, U+C9F0-C9F1, U+C9F8, U+CA0C, U+CA4C-CA4D, U+CA54, U+CA84, U+CABC-CABD, U+CAD3, U+CB10, U+CB48-CB49, U+CB50, U+CBD4, U+CBE4, U+CC0C-CC0D, U+CC10, U+CC14, U+CC22, U+CC27-CC29, U+CC2C, U+CC2E, U+CC30, U+CC38-CC39, U+CC3C-CC3E, U+CC44-CC45, U+CC59, U+CC60, U+CC98-CC99, U+CC9C, U+CCA0, U+CCA8-CCA9, U+CCAB, U+CCAD, U+CCB4, U+CCBC, U+CCC7, U+CCD0, U+CCE4, U+CD08-CD09, U+CD0C, U+CD1B, U+CD1D, U+CD5C, U+CD94-CD95, U+CD98, U+CD9C, U+CDA4-CDA5, U+CDA7, U+CDA9, U+CDB0, U+CDE8, U+CE20-CE21, U+CE35, U+CE58-CE59, U+CE5C, U+CE60, U+CE68-CE69, U+CE6B, U+CE6D, U+CE74, U+CE78, U+CE7C, U+CE84-CE85, U+CE87, U+CE98, U+CEAC, U+CEE4, U+CEE8, U+CEEB-CEEC, U+CEF7-CEF8, U+CF00, U+CF04, U+CF08, U+CF10, U+CF13, U+CF1C, U+CF20, U+CF24, U+CF30, U+CF54, U+CF58, U+CF5C, U+CF64, U+CF67, U+CF69, U+CF8C, U+CFE0-CFE1, U+CFE4, U+CFE8, U+CFF0, U+D034, U+D06C, U+D070, U+D074, U+D07C-D07D, U+D0A4, U+D0A8, U+D0AC, U+D0B4-D0B5, U+D0C0-D0C1, U+D0C4, U+D0C8-D0C9, U+D0D0-D0D1, U+D0D3-D0D5, U+D0DC-D0DD, U+D0EF, U+D0F1, U+D130-D131, U+D138, U+D145, U+D14C, U+D150, U+D154, U+D15C, U+D1A0, U+D1A4, U+D1A8, U+D1B0-D1B1, U+D1B3, U+D1B5, U+D22C, U+D230, U+D234, U+D23C-D23D, U+D241, U+D280, U+D29C, U+D2B8-D2B9, U+D2BC, U+D2BF-D2C0, U+D2C8, U+D2F0, U+D2F4, U+D2F8, U+D300, U+D30C, U+D30E, U+D310, U+D314, U+D320-D321, U+D325, U+D328, U+D32C, U+D33D, U+D37C, U+D390, U+D398-D399, U+D39C, U+D3A0-D3A1, U+D3AB, U+D3B4, U+D3B8, U+D3BC, U+D3C8-D3C9, U+D3D0, U+D3EC-D3ED, U+D3F0, U+D3F4, U+D45C, U+D478-D479, U+D47C, U+D480, U+D488, U+D48B, U+D48D, U+D504, U+D508, U+D50C, U+D514, U+D53C, U+D540, U+D544, U+D54C-D54D, U+D54F, U+D558-D559, U+D55C, U+D560, U+D565, U+D568-D569, U+D56B, U+D56D, U+D574-D575, U+D587-D589, U+D590, U+D5A5, U+D5C8, U+D5CC, U+D5D0, U+D5D8, U+D5DB, U+D5DD, U+D5E4, U+D5E8, U+D5EC, U+D5F4-D5F5, U+D5F7, U+D5F9, U+D600, U+D604, U+D608, U+D610-D611, U+D614-D615, U+D61C, U+D638-D639, U+D63C, U+D640, U+D649, U+D64B, U+D64D, U+D654-D655, U+D658, U+D65C, U+D669, U+D683, U+D68C-D68D, U+D69F, U+D6A1, U+D6A8, U+D6C4-D6C5, U+D6C8, U+D6CC, U+D6D1, U+D6D4-D6D5, U+D6D7, U+D6E8, U+D718, U+D729, U+D734, U+D73C, U+D749, U+D750-D751, U+D754, U+D758-D759, U+D760-D761, U+D765, U+D769, U+D76C, U+D770, U+D77D, U+D788, U+D78C, U+D790, U+D798-D799, U+D79B
```

### `NotoSerif-extra.woff2` (en, ru, fr, es, ko, yi): 38 code points

Every code point of the six translation corpora (`langs.*` and `apparatus.*`, all tractates) that no faces in
the language's stack cover, and that Noto Serif (wdth 100) has. Derived by `fonts/SUBSETS.md` "Coverage checks".
The file's `unicode-range` is exactly this set:

`unicode-range: U+00AD, U+0101, U+011B, U+0124-0125, U+014C-014D, U+015B, U+0161, U+0259, U+02BB-02BC, U+02BF, U+0301, U+0306, U+0323, U+0331, U+03A7, U+0463, U+0493, U+049B, U+04AF, U+04B2-04B3, U+04BA-04BB, U+04D9, U+04E3, U+1E24-1E25, U+1E35, U+1E92-1E93, U+2011, U+201F, U+2021, U+2116, U+2153`

| code point | name | where it is used (examples) |
|---|---|---|
| U+00AD | SOFT HYPHEN | en, ru (Bava Kamma 110b, Bava Metzia 102b) |
| U+0101, U+014C-014D | a/o with macron | en, ru (Beitzah 11a, Bava Kamma 9b, Zevachim 82b) |
| U+011B, U+0259, U+015B, U+0161 | e caron, schwa, s acute, s caron | ru |
| U+0124-0125 | H circumflex | en (Megillah 18a), ru |
| U+02BB-02BC, U+02BF | modifier letters (ʻ ʼ ʿ) | ru |
| U+0301, U+0306, U+0323, U+0331 | combining acute, breve, dot below, macron below | ru (Berachot 50a rashi "Тна́": U+0301 falls back to a system font without this point; Menachot 21b, 83 uses of U+0331) |
| U+03A7 | GREEK CAPITAL CHI | en (Keritot 5b, Menachot 106a) |
| U+0463, U+0493, U+049B, U+04AF, U+04B2-04B3, U+04BA-04BB, U+04D9, U+04E3 | Cyrillic extras (ѣ ғ қ ү Ҳ ҳ Һ һ ә ӣ) | ru; U+04BB (һ) has 1273 uses |
| U+1E24-1E25 | H with dot below (Ḥ ḥ) | en, ru, fr, es (Berachot, Arachin: 9176 and 22185 uses in en) |
| U+1E35 | k with line below | ru (Gittin 28b) |
| U+1E92-1E93 | Z with dot below | en (Bava Batra 14b), ru |
| U+2011 | NON-BREAKING HYPHEN | ru (Yevamot 46b) |
| U+2021 | DOUBLE DAGGER | fr (Bava Batra 16b apparatus, 10 uses) |
| U+2116 | NUMERO SIGN | ru (Bava Batra 3a, Bava Metzia 34a) |
| U+2153 | VULGAR FRACTION ONE THIRD | en (Bava Batra 27a), ru |
| U+201F | DOUBLE HIGH-REVERSED-9 QUOTATION MARK | yi (601 uses), ko |

Not in this file (Noto Serif lacks them; the translation builder still refuses those pages, see "Remaining uncovered"):
U+F020 (private use; Bava Kamma 5a, en; a data artifact), U+1D434, U+1D45F, U+1D70B (mathematical italic A, r, pi;
Bava Batra 27a, en), U+25B3, U+25BD, U+2612 (triangles, ballot box; Beitzah 28a, Bava Metzia 23b and 108b, ru),
U+FF1A (fullwidth colon; Gittin 87b, ru), U+0561 (Armenian ayb; Bava Batra 17a, ru), U+0645, U+064A (Arabic meem, yeh; Gittin 28b, ru).

Left to the fallback chain, not this file: Latin-1 fractions and the not sign (U+00AC, U+00BC-00BE) are covered by the
Frank Ruhl Latin face in the Gemara and fall back to it in the commentary stack; Hebrew accents (U+0591-05A8, Bava Kamma 11a, 15a)
are covered by `NotoRashiHebrew-hebrew` through the RashiScript fallback added to the en/ru/fr/es Gemara stack; U+200E (LRM) by
`NotoRashiHebrew-hebrew`.

### Combining marks (translation stacks only)

Blink draws a combining mark with the face that draws its base letter, and only if that face's `unicode-range` also
admits the mark. The shared Cyrillic faces (`NotoSans-cyrillic`, `NotoSerif-cyrillic`) admit only U+0400-052F, so
`Тна́` (ru Berachot 50a, Rashi) fell back to a system font even though those files contain U+0301. Two translation-only
`@font-face` names reuse the same two files with `unicode-range: U+0301, U+0400-04FF, U+0500-052F`:
`VilnaCyrRashi` (NotoSans-cyrillic) and `VilnaCyrFrank` (NotoSerif-cyrillic). They are placed before the shared faces in
the en/ru/fr/es stacks. Hebrew stacks do not reference them. No new file; glyphs are identical to the shared Cyrillic faces.

Verified in Chromium (`CSS.getPlatformFontsForNode`): `Тна́ ха` in the commentary stack is drawn only by Noto Sans and
Noto Rashi Hebrew (custom faces, no system font).

Still unresolved: combining marks on a Cyrillic base that no bundled face contains (the Cyrillic subsets hold only U+0301).
Checked over all tractates for en/ru/fr/es, 8 of 14 (base, mark) pairs fail in the gemara or commentary stack:
ru н + U+0331 (83 uses, Menachot 21b), с + U+0306, т + U+0323, Ё + U+0300. Fix needs a Cyrillic face with U+0300-036F
(Noto Serif or Noto Sans, OFL). Adding them to `NotoSerif-extra` would also move ordinary н/с/т/Ё in those stacks to
another face, so this was not done.

### Yiddish (yi): no new Hebrew face needed

The bundled `FrankRuhlLibre-hebrew.woff2` covers every Hebrew code point of the yi corpus, including U+05F0, U+05F1, U+05F2 and the points/marks used in `ײַ` (U+05B7, U+05BF rafe, etc.). The yi corpus (103 distinct code points) is covered by: bundled Frank Ruhl Libre (Hebrew + Latin) + `NotoSerif-extra.woff2` (U+201F). Remaining yi code points not in the bundled Hebrew/Latin faces: U+201F only.

Yi code points, for reference (103):

```
U+0020-0022, U+0027-002A, U+002C-003F, U+005B, U+005D, U+0061-0062, U+0065, U+0067, U+0069, U+006C-006F, U+0072-0074, U+007B, U+00AB, U+00BB, U+05B0-05B9, U+05BB-05BC, U+05BE-05BF, U+05C1-05C3, U+05D0-05EA, U+05F0-05F4, U+2013-2014, U+2018-201A, U+201C-201F, U+2026
```

## Coverage checks (run on the committed files)

Scan: every string under `langs.<L>` and `apparatus.<L>` in `data/offline/*/*.json` (5448 files; HTML tags stripped, entities
decoded, `ref`/`i` keys skipped), per language, against the stack the page's CSS uses (`css/daf.css`, `unicode-range` respected,
cmaps read from the woff2 files). A code point is covered when a face with a matching range and that glyph is in the stack.

| language | distinct code points | uncovered before this change | uncovered after | remaining (reason) |
|---|---|---|---|---|
| en | 180 | 25 | 4 | U+F020 (PUA, data artifact); U+1D434, U+1D45F, U+1D70B (math italic; not in Noto Serif) |
| ru | 246 | 37 | 7 | U+0561 (Armenian), U+0645, U+064A (Arabic), U+25B3, U+25BD, U+2612 (symbols), U+FF1A (fullwidth colon): not in Noto Serif |
| fr | 144 | 3 | 0 | |
| es | 129 | 2 | 0 | |
| yi | 95 | 0 | 0 | |
| ko | 1342 | 0 | 0 | |

The "before" column is the stacks as committed in the working tree before this change (no VilnaExtra in en/ru/fr/es).
Remaining items need a different source (proposals in the report that accompanies this change): Noto Sans Math or STIX Two Math
(math italic), Noto Sans Symbols 2 (triangles, ballot box), Noto Naskh Arabic, Noto Sans Armenian, Noto Sans KR or Noto Serif KR
(U+FF1A). U+F020 is a data error in `data/offline/Bava Kamma/5a.json`.

| check | result |
|---|---|
| subset cmap == intended set | `NotoSerif-extra`: 38/38, no extras, no missing |
| unicode-range of `VilnaExtra` in `css/daf.css` | = the 38 code points |
| bundled Frank Ruhl Libre Hebrew (`FrankRuhlLibre-hebrew.woff2`) has U+05F0–05F2, U+05B7, U+05BF | yes |
| U+201F, U+1E24/U+1E25, U+04BB in bundled faces | no (all in `NotoSerif-extra.woff2`) |
| Hebrew stacks (`:root --font-gemara/--font-rashi`) | unchanged |

## Command used (fontTools 4.53.0, Python 3.9; equivalent to the shown arguments)

Step 1 (variable `wdth` pinned, Noto Serif only): `fonttools varLib.instancer "NotoSerif[wdth,wght].ttf" wdth=100 -o inst.ttf`

Step 2 (subset; ko): `pyftsubset "NotoSerifKR[wght].ttf" --unicodes="<ranges above>" --flavor=woff2 --layout-features="*" --no-hinting --notdef-outline --name-IDs="*" --name-languages="*" --name-legacy --output-file=fonts/NotoSerifKR-hangul.woff2`

Step 2 (subset; extra): `pyftsubset inst.ttf --unicodes="<the 38 code points above>" --flavor=woff2 --layout-features="*" --no-hinting --notdef-outline --name-IDs="*" --name-languages="*" --name-legacy --output-file=fonts/NotoSerif-extra.woff2`

The files were produced with the fontTools Python API using the same options (the instancer result was saved and reloaded before subsetting to avoid a lazy-table error). Run with `python3 -I`.

## Existing faces (unchanged; sha256 before and after this round)

| file | sha256 |
|---|---|
| `fonts/FrankRuhlLibre-hebrew.woff2` | `acdf9ed0a3fc287df8401d796892c1f72118f291e510e38328396f48e200b08c` |
| `fonts/FrankRuhlLibre-latin.woff2` | `b8081e5e9acd530df59ef062f9274e201569b94c9bfa6881950f3eb259d7b375` |
| `fonts/LICENSE.txt` | `bb9b583c5e5369ae83e86f497d9f132685a1e186d08623aef7658967e90ac7a6` |
| `fonts/NotoRashiHebrew-hebrew.woff2` | `1e5e568b41c015c011d5e378bf9c617c74432ed3bbb1574c292a9eb2927cc0ed` |
| `fonts/NotoRashiHebrew-latin.woff2` | `4009fe7f5b062243d91672807a7dc451be2349fc6ff8675fc52471657ab4e497` |
| `fonts/NotoSans-cyrillic.woff2` | `6ab64433de6077ca5ad31b05420450ce986a616a4ea47b6ad16f3217055dafc3` |
| `fonts/NotoSerif-cyrillic.woff2` | `54e3bd0c4a002b0f76bf9c758507fe9bb170f9e364ea4ecc85fc8b22819bca7e` |

OFL texts: `fonts/OFL-NotoSerifKR.txt`, `fonts/OFL-NotoSerif.txt` (copies of the upstream `OFL.txt` files).
