# Apricot Admin Toolkit

Do admin work in Apricot that the Apricot screens can't do, or can only do one record at a time.
The toolkit runs on your own computer and opens in your web browser.

**What it can do today**

- **Attach files to records in bulk, thousands at a time.** The toolkit matches each document to the right
  Apricot record, shows you what will happen, uploads them, and checks every file actually landed.
  - Match by record ID or by any fields (e.g. last name + date of birth), using the file names or a
    customer's mapping spreadsheet as it is, including one with several file columns.
  - Files can be on this computer, a network drive, a synced SharePoint/OneDrive folder, in a zip, on an
    SFTP/FTP server, or behind web links in the spreadsheet.

More tools are on the way.

---

## Install

You don't need administrator rights, and nothing else needs to be installed first.

### Windows

1. Press the **Windows key**, type **PowerShell**, and open it.
2. Copy this line, paste it into the PowerShell window (right-click pastes), and press **Enter**:

   ```powershell
   irm https://raw.githubusercontent.com/kunalghate/apricot-admin-toolkit/main/install/install.ps1 | iex
   ```

3. The toolkit opens in your browser when it's done.

### Mac

1. Open **Terminal** (press ⌘ Space, type **Terminal**, press Enter).
2. Paste this line and press **Enter**:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/kunalghate/apricot-admin-toolkit/main/install/install.sh | sh
   ```

3. The toolkit opens in your browser when it's done.

## Using it

1. **Start it:** click **Apricot Admin Toolkit** on your desktop or in the Start menu (Windows), or in the
   Applications folder in your home folder (Mac).
2. Your browser opens at **http://localhost:4317**. You can bookmark it.
3. A small window stays open while the toolkit runs. **Close that window when you're done.**

The first time, you'll be asked for your Apricot **Client ID** and **Client Secret**. Ask your Apricot
administrator if you don't have them. They're stored in your computer's secure credential store
(Windows Credential Manager or Mac Keychain).

## Updating

Run the same install line again. Your saved connections are kept.

## Big jobs

Uploads run inside the toolkit, not the browser page, so you can close the page while thousands of files go
up. Keep the small toolkit window open (you can minimize it). While a run is going:

- your computer won't go to sleep;
- every finished file is saved straight away, so if the toolkit or computer restarts, open **Runs** and
  press **Resume**: it carries on where it stopped and never uploads the same file twice;
- if Apricot or the file server stops responding, the run pauses itself and tries again automatically.

Each run has a downloadable report. For spreadsheets, the Review step can also give back the customer's own
spreadsheet with a status for every row, so problems can be fixed in Excel.

## Good to know

- Files can be up to **10 MB** each. That's the Apricot API's limit.
- Each Apricot organization decides which file types it accepts. If Apricot rejects a type, the toolkit tells you.
- The Apricot API can't delete attachments or bring back a file once it's replaced, so the toolkit skips
  records that already have a file unless you choose otherwise.
- Your data goes directly from your computer to Apricot. Nothing passes through any other server.
- SFTP/FTP passwords are kept in your computer's secure credential store, like the Apricot secret.
- To use files in SharePoint, open the library in your browser and click **Sync**. It then appears as a
  folder the toolkit can read.

---

## For developers

Built with [Bun](https://bun.com), React and Tailwind. The local server (`src/server`) talks to the
Bonterra v1 Apricot API; the web page (`src/web`) talks only to the local server.

```sh
bun install
bun run dev        # http://localhost:4317 with hot reload
bun check          # type-check
bun run build      # single-file programs for Windows and Mac in dist/
bun test           # unit tests
```

Testing big runs without a real organization:

```sh
bun tests/mock-apricot.ts                                   # a stand-in Apricot API on :4999
bun scripts/make-test-data.ts --mock --count 5000 --out ~/Desktop/toolkit-test
APRICOT_API_BASE=http://127.0.0.1:4999 APRICOT_TOOLKIT_DATA=/tmp/tk APRICOT_TOOLKIT_PORT=4321 bun src/server/main.ts
```

`scripts/make-test-data.ts --form <id>` creates test records on a real test form (credentials from
`.env.local`) and matching files and spreadsheets.

Push a tag like `v0.1.1` to publish a release. GitHub Actions builds the programs and the install
scripts pick up the newest release automatically.
