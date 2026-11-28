# Writing style: ASD-STE100 (Simplified Technical English)

All text that people see (screens, buttons, field labels, messages, errors, the console banner)
follows ASD-STE100. This file lists the rules we apply and the fixed terms we use.

The approved-word list comes from the STE dictionary. Where we are not sure that a word is approved,
we use a word from the substitution table below. For a formal check, use an STE checker.

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
7. **Simple tenses only**: present, past, simple future. No "-ing" verb forms, except in technical
   names. Progress text uses a noun: "Upload in progress", not "Uploading…".
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
| Do again after a failure | do again | retry, try again |
| A small test before all | test | try, trial |
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
| Uploading… 76 of 11,560 | Upload in progress: 76 of 11,560 |
| Pick the folder that contains them. | Select the folder that has the files. |
| You can't undo this. | You cannot undo this. |
| This keeps going without you | The upload continues when you close this page |
