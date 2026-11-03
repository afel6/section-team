// Prints the deepest nested-array chain JSON.stringify(v, null, 2) handles at this stack size.
let ok = 0;
for (let d = 250; d <= 8000; d += 250) {
  let v = [];
  for (let i = 0; i < d; i++) v = [v];
  try {
    JSON.stringify(v, null, 2);
    ok = d;
  } catch {
    break;
  }
}
process.stdout.write(`${process.execArgv.join(' ')} max ok ${ok}\n`);
