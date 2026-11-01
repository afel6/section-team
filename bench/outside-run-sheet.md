Freeze: tag mo-freeze

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
- A fresh or rebuilt set always gets a new folder name. Attempt records are kept per set name, in `bench/results/codex-logs/<case set>/` and `bench/results/ag-logs/<case set>/`, so these folders are never emptied or reused.

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
- To re-ask a case, first record the attempt in `bench/results/ag-logs/<case set>/<case>-a<n>.txt`, where n is that attempt's number. Move the text of its `verdict.json` into that file, or write the words "no verdict" in it when there is no `verdict.json`. Then open a new conversation on that case.
- After the last case, run `node bench/external-judge.mjs import --round=<r> --out=<ag set> --as=<name>`, for example `--round=mo --out=C:/Users/Asus/ag-judge-mo --as=moag`.
- The import lists every case that is not usable. Re-ask each one as above, then run the import again.
- A case still not usable after its second re-ask is left as it is. Antigravity is then reported as "not usable (k of 18)".
- k is the usable count the last import wrote to `bench/results/outside-usable-<name>.json`; that file stays.

## Values for the runner

The sandbox is set after the sandbox probe. Until then the runner refuses to start.

```json
{
  "codexBin": "C:/Users/Asus/AppData/Local/OpenAI/Codex/bin/22cfb1d302613eae/codex.exe",
  "model": "gpt-6.1-sol",
  "effort": "ultra",
  "sandbox": "<set in Task 27>"
}
```
