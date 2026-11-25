# Apricot Admin Toolkit

Do admin work in Apricot that the Apricot screens can't do, or can only do one record at a time.
The toolkit runs on your own computer and opens in your web browser.

**What it can do today**

- **Attach files to records in bulk.** Drop in a folder of documents, and the toolkit matches each one to the
  right Apricot record (by record ID, by any field such as Client ID, or from a spreadsheet), shows you
  what will happen, uploads them, and checks every file actually landed.

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

## Good to know

- Files can be up to **10 MB** each. That's the Apricot API's limit.
- Each Apricot organization decides which file types it accepts. If Apricot rejects a type, the toolkit tells you.
- The Apricot API can't delete attachments or bring back a file once it's replaced, so the toolkit skips
  records that already have a file unless you choose otherwise.
- Your data goes directly from your computer to Apricot. Nothing passes through any other server.

---

## For developers

Built with [Bun](https://bun.com), React and Tailwind. The local server (`src/server`) talks to the
Bonterra v1 Apricot API; the web page (`src/web`) talks only to the local server.

```sh
bun install
bun run dev        # http://localhost:4317 with hot reload
bun check          # type-check
bun run build      # single-file programs for Windows and Mac in dist/
```

Push a tag like `v0.1.1` to publish a release. GitHub Actions builds the programs and the install
scripts pick up the newest release automatically.
