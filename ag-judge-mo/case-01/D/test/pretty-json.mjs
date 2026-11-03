// Reference serializer for the tests: the same text as JSON.stringify(value, null, 2), built with an
// explicit frame stack so it works for values far too deep for JSON.stringify. Not a test file itself.

// One open container: its entries are written one by one as `next` advances.
function openFrame(value) {
  const keys = Array.isArray(value) ? null : Object.keys(value);
  return { value, keys, count: keys ? keys.length : value.length, next: 0 };
}

// Writes a scalar, an empty container or the opening bracket; returns a frame to descend into, or null.
function writeValue(value, pieces) {
  if (value === null || typeof value !== 'object') {
    pieces.push(JSON.stringify(value));
    return null;
  }
  const frame = openFrame(value);
  const [open, close] = frame.keys ? ['{', '}'] : ['[', ']'];
  pieces.push(frame.count === 0 ? open + close : open);
  return frame.count === 0 ? null : frame;
}

export function prettyJson(root) {
  const pieces = [];
  const frames = [];
  const first = writeValue(root, pieces);
  if (first) frames.push(first);
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.next === frame.count) {
      frames.pop();
      pieces.push(`\n${'  '.repeat(frames.length)}${frame.keys ? '}' : ']'}`);
      continue;
    }
    const pad = '  '.repeat(frames.length);
    const i = frame.next++;
    const key = frame.keys ? frame.keys[i] : i;
    pieces.push(`${i > 0 ? ',' : ''}\n${pad}${frame.keys ? `${JSON.stringify(key)}: ` : ''}`);
    const child = writeValue(frame.value[key], pieces);
    if (child) frames.push(child);
  }
  return pieces.join('');
}
