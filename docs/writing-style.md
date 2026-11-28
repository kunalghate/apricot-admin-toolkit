# Writing style: plain product voice, based on ASD-STE100

All text that people see (screens, buttons, field labels, messages, errors, the console banner)
is short, clear and consistent. We take the useful parts of ASD-STE100 (Simplified Technical
English): short sentences, active voice, one instruction per sentence, one term for one thing,
no idioms. We do NOT apply it so literally that the text sounds robotic.

**Product-voice rules that take priority over literal STE:**

- Headings and labels are short phrases, not sentences: "Match files to records", "File locations",
  "Find records by". Never a riddle like "What tells the toolkit which record each file goes to?".
- Talk to the person ("you", or an imperative), not about the program. Use "the toolkit" only when
  it really matters who does something. Prefer "Every file is verified" to "The toolkit verifies each file".
- Use the familiar word people expect in software: Review, Match, Try again, Loading…, Connecting….
  Short "-ing…" progress labels are fine.
- Read every string aloud. If nobody would say it that way, rewrite it.

## Rules

1. **One word, one meaning, one part of speech.** Use a word only with its approved meaning.
   Use a noun as a noun and a verb as a verb (for example, do not use "run" as a noun).
2. **One term for one thing.** Use the terms in the glossary. Do not use synonyms.
3. **Short sentences.** Instructions: 20 words maximum. Descriptions: 25 words maximum.
   A paragraph has 6 sentences maximum.
4. **One instruction in each sentence.** Exception: two actions that you do at the same time.
5. **Instructions use the imperative.** "Select the folder." Not "You should select the folder."
6. **Active voice.** "The toolkit replaces the file." Not "The file is replaced."
   Passive voice is permitted in descriptions only when the agent is not known or not important.
7. **Simple tenses**: present, past, simple future. Short progress labels may use "-ing…"
   ("Loading…", "Checking the paths…").
8. **No contractions.** "Do not", "cannot", "is not".
9. **No idioms, jokes, or emotion.** No "Oops", "Looks good", "Hold on", no exclamation marks.
10. **Articles.** Use "a", "an", "the" where English needs them. Do not shorten text by removing them.
11. **Noun clusters**: 3 words maximum. Use "the date of the upload", not "upload date time value".
12. **Warnings and cautions** start with the instruction, then the reason:
    "Do not close this window. The upload stops if you close it."
13. **Buttons** are a verb (+ object): "Select folder", "Find records", "Upload 3 files as a test".

## Glossary (use these terms only)

| Thing | Term | Do not use |
|---|---|---|
| The program | the toolkit | the app, the tool |
| The black console window | the toolkit window | terminal, console, server |
| An Apricot entry | record | entry, item, row (for records) |
| An Apricot form | form | |
| A place on a form for a file | file field | attachment field, file slot |
| A file field for pictures only | image field | photo field |
| A computer file | file | document, attachment (as the thing on disk) |
| A list in Excel/CSV | spreadsheet | sheet, mapping file, list, CSV file (in text) |
| A line in the spreadsheet | row | line, entry |
| A spreadsheet column | column | |
| Where files are | location | place, source |
| A folder | folder | directory |
| SFTP/FTP computer | file server | server, host (in text) |
| One upload job | upload | run, job, batch, task |
| The list of upload jobs | Uploads | Runs, History |
| Apricot record number | record ID | ID number |
| Make a file part of a record | attach | add, put |
| Send a file to Apricot | upload | send, push |
| Read a record again after upload | verify | check, confirm (for this meaning) |
| Make a choice | select | choose, pick |
| Start again after a stop | continue | resume |
| Stop for some time | stop | pause, hold |
| Do again after a failure | try again | retry, do again |
| A small test before all | test | trial |
| Look for a record | find | look up, search for (as a verb phrase) |
| Look for files in a location | find | scan, list, browse |
| Remove from a list | remove | delete (use "delete" only for data that goes away) |
| A problem with a row | problem | issue, error (except real errors) |

## Examples

| Before | After (STE) |
|---|---|
| Try 3 first | Upload 3 files as a test |
| Looks good. Upload the remaining 391 | Upload the other 391 files |
| Resume (391 to go) | Continue (391 files remain) |
| What tells the toolkit which record each file goes to? | Match files to records |
| The toolkit does not upload rows that have a problem. | Rows that need attention are skipped. |
| Apricot did not reply in the usual time. Wait some minutes, then do the step again. | Apricot is taking too long to respond. Wait a few minutes and try again. |
