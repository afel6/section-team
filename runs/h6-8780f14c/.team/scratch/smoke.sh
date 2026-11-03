cd "$(dirname "$0")"
CLI=../../jsonpatch-cli.mjs
echo '[{"op":"add","path":"/1","value":5},{"op":"copy","from":"","path":"/c"}]' > p.json
printf '\xef\xbb\xbf{"b":-0}' > d.json
node $CLI p.json d.json; echo "exit $?"
node $CLI p.json < d.json; echo "exit $?"
node $CLI - ; echo "exit $?"
node $CLI nope.json; echo "exit $?"
node $CLI p.json/x; echo "exit $?"
node $CLI . ; echo "exit $?"
echo '[{"op":"x"}]' | node $CLI - d.json; echo "exit $?"
head -c 2000000 /dev/zero | node $CLI p.json; echo "exit $?"
node $CLI /dev/zero; echo "exit $?"
printf '\xff' > bad.json; node $CLI bad.json; echo "exit $?"
: > empty.json; node $CLI empty.json; echo "exit $?"
node -e "let s='['.repeat(1001)+']'.repeat(1001);require('fs').writeFileSync('deep.json',s)"
node $CLI deep.json; echo "exit $?"
node -e "let s='['.repeat(1000)+']'.repeat(1000);require('fs').writeFileSync('deep2.json',s)"
echo '[{"op":"copy","from":"","path":"/0"}]' > cp.json
for i in 1 2 3 4 5 6; do node $CLI cp.json deep2.json > out.json; cp out.json deep2.json 2>/dev/null; done; echo "deep out exit $? $(wc -c < out.json)"
