// Shared bits for the browser-script (page-*) tests.
export const NO_REPLY = 'Could not reach the server.';
export const FAILED = 'Request failed.';

export const methodOf = (call) => call.options?.method ?? 'GET';

export async function flush(turns = 8) {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setImmediate(r));
}

// Replaces textContent on this one element with a getter/setter that keeps the
// value and calls onSet(newValue) before storing it. Returns the element.
export function spyOnText(element, onSet) {
  let stored = element.textContent;
  Object.defineProperty(element, 'textContent', {
    configurable: true,
    get() { return stored; },
    set(value) { onSet(value); stored = value; },
  });
  return element;
}
