Freeze: tag mo-freeze-cloud

# Outside-judge run sheet

This sheet is frozen with the round. It says how the two outside judges, Codex and Antigravity, judge a case set.
Follow it as written. Each judge has its own copy of the case set (`codex-judge-*` and `ag-judge-*`).

## Both judges

- Judge each case in its own new session.
- Give that session only the case's folder as its workspace, for example `C:/Users/Asus/codex-judge-mo/case-01`.
- Turn off any memory that carries over between sessions.
- The judge reads `JUDGE.md` in the case folder and follows it.
- The judge never opens anything outside its own case folder.
- When a verdict is not usable, re-ask: start a new session on the same case. A case gets at most two re-asks.
- Never judge a case in a session that has seen another case.
- A fresh or rebuilt set always gets a new folder name. Attempt records are kept per set name, in `bench/results/codex-logs/<case set>/` and `bench/results/ag-logs/<case set>/`, so a log folder is never emptied or given to another set.
- The held-out set is judged, imported and checked (`node bench/external-judge.mjs check --as=<held-out name>`) before any mode-round set is imported; the importer refuses otherwise.

## Codex

- Codex is run by the runner, never by hand: `node bench/codex-judge.mjs --set=<case set folder>`.
- The runner starts one new headless session per case, with only that case's folder as the workspace and memories off.
- It does the re-asks itself and logs every attempt in `bench/results/codex-logs/<case set>/`.
- It reads the values in the json block below. `--ignore-user-config` drops the model and effort set in Codex, so they are set here.
- If the runner stops on a Codex error, read the `.err` file it names and fix the cause. Then run the same command again. It goes on where it stopped, and the stopped try does not count as an attempt.
- If the same case stops the runner twice for the same reason, stop and report it to the coordinator. Do not hand-write attempt files.
## Antigravity

- Antigravity is run by hand.
- For each case, open a new conversation with only that case's folder as the workspace.
- Send this message, word for word:

  ```text
  You are a blind code reviewer. The current folder is one case. Read JUDGE.md here and follow it exactly, without asking questions. Work only inside this folder, and put probes only in scratch/. Never edit, create or delete anything in the solution folders or in SEED. Do not use the network. End your answer with your verdict as one fenced json block.
  ```

- If it ends without writing `verdict.json`, save its final json block (without the fence) as `verdict.json` in the case folder.
- To re-ask a case, first record the attempt in `bench/results/ag-logs/<case set>/<case>-a<n>.txt`, where n is that attempt's number. Move the text of its `verdict.json` into that file and delete `verdict.json` from the case folder, or write the words "no verdict" in it when there is no `verdict.json`. Empty the case's `scratch/` folder. Then open a new conversation on that case.
- If any case was judged in a conversation that had seen another case, stop and tell the coordinator: Antigravity is reported as not used.
- After the last case, run `node bench/external-judge.mjs import --round=<r> --out=<ag set> --as=<name>`, for example `--round=mo --out=C:/Users/Asus/ag-judge-mo --as=moag`.
- The import lists every case that is not usable. Re-ask each one as above, then run the import again.
- A case still not usable after its second re-ask is left as it is. Antigravity is then reported as "not usable (k of 18)".
- k is the usable count the last import wrote to `bench/results/outside-usable-<name>.json`; that file stays.

## Cloud round (amendment of 2026-11-02)

The mode round's builds and Opus judges run on a cloud Linux machine; Codex and Antigravity stay on the user's Windows PC. Case sets reach the PC, and verdicts come back, only through the pushed branches named here. Everything above still holds, except that the imports run on the cloud machine. The results branch `bench/mode-round-cloud-results` holds the blind keys: never fetch it on the PC.

On the cloud machine, after the leak scan:

- `node bench/external-judge.mjs prepare --round=mo --out=/root/codex-judge-mo`, then at once `node bench/external-judge.mjs copy --from=/root/codex-judge-mo --to=/root/ag-judge-mo`.
- `node bench/cloud-sync.mjs publish --branch=bench/mode-round-cloud-cases /root/codex-judge-mo /root/ag-judge-mo`. It refuses a set that holds a `verdict.json`, a file in a `scratch/` folder or a key.
- `node bench/cloud-sync.mjs push --branch=bench/mode-round-cloud-results --redact-email`, so the case key `results/external-key-mo.json` is pushed too.

On the PC, from a worktree of the cloud freeze, never from a plain `git fetch` of every branch:

- `git fetch origin bench/mode-round-cloud-cases bench/mode-round-cloud-verdicts tag mo-freeze-cloud`, then `git worktree add C:/Users/Asus/claude-team-cloud mo-freeze-cloud`. Run every command below from `C:/Users/Asus/claude-team-cloud`.
- `node bench/cloud-sync.mjs fetch --branch=bench/mode-round-cloud-cases --path=codex-judge-mo --out=C:/Users/Asus/codex-judge-mo`, and the same with `ag-judge-mo`. The sets land outside any repository, with no git folder.
- Judge them as the sections above say. Codex: `node bench/codex-judge.mjs --set=C:/Users/Asus/codex-judge-mo`.
- Send the verdicts and logs back. In that shell set `CLAUDE_CODE_USER_EMAIL` to the Claude account's email first; the push scan needs it and never prints it. Then:
  - `node bench/cloud-sync.mjs publish --branch=bench/mode-round-cloud-verdicts --only=verdict.json C:/Users/Asus/codex-judge-mo C:/Users/Asus/ag-judge-mo`
  - `node bench/cloud-sync.mjs publish --branch=bench/mode-round-cloud-verdicts bench/results/codex-logs bench/results/ag-logs`
- Once, before any mode-round import: Codex's held-out check stays valid as recorded (`hocx`: gap +0.50, same winner 8 of 9) and is never run again. Send its record from the checkout that made it: `node bench/cloud-sync.mjs publish --branch=bench/mode-round-cloud-verdicts C:/Users/Asus/claude-team-moderound/bench/results/judge-hocx.json C:/Users/Asus/claude-team-moderound/bench/results/blind-key-hocx.json C:/Users/Asus/claude-team-moderound/bench/results/outside-check-ho-hocx.json C:/Users/Asus/claude-team-moderound/bench/results/outside-usable-hocx.json`, and the same four files for `hoag2` once Antigravity's held-out check is recorded.

Back on the cloud machine:

- The held-out records first, each into `bench/results` under its own name: `node bench/cloud-sync.mjs fetch --branch=bench/mode-round-cloud-verdicts --path=outside-check-ho-hocx.json --out=bench/results/outside-check-ho-hocx.json`, and the same for the other three files.
- Then the verdicts: `node bench/cloud-sync.mjs fetch --branch=bench/mode-round-cloud-verdicts --path=codex-judge-mo --out=/root/codex-judge-mo-verdicts`, then `node bench/external-judge.mjs import --round=mo --out=/root/codex-judge-mo-verdicts --as=mocx`. The same for `ag-judge-mo` as `moag`.
- The logs: `node bench/cloud-sync.mjs fetch --branch=bench/mode-round-cloud-verdicts --path=codex-logs --out=bench/results/codex-logs`, and the same for `ag-logs`.
- A case that is not usable is re-asked on the PC as above, in the PC's copy of the set; send the verdicts again and fetch them into a new folder before the next import.

## Values for the runner

The sandbox comes from the sandbox probe of 2026-11-02 (codex-cli 0.166.0-alpha.5.1, held-out case-01, never imported). Without `windows.sandbox="unelevated"`, `read-only` and `workspace-write` rejected every command, even reading JUDGE.md. With it, `read-only` ran `node --version`, read the case and changed no file; it cannot write or start child processes, so Codex cannot run a solution's own test suite. The events showed no MCP or plugin call and no memory; the user's skills list was offered to the model without descriptions. The runner starts `codexBin` from the block below with this command line, where `<case folder>` is the case and `<log>` is each attempt's log stem, `bench/results/codex-logs/<set>/<case>-a<n>`:

`codex.exe exec --ephemeral --ignore-user-config -m gpt-6.1-sol -c model_reasoning_effort="ultra" --disable memories -c windows.sandbox="unelevated" --skip-git-repo-check -C <case folder> -s read-only --json -o <log>.last.txt "<CODEX_PROMPT>"`

```json
{
  "codexBin": "C:/Users/Asus/AppData/Local/OpenAI/Codex/bin/22cfb1d302613eae/codex.exe",
  "model": "gpt-6.1-sol",
  "effort": "ultra",
  "sandbox": "read-only"
}
```
