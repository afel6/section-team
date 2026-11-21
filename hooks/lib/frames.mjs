// Hand-backs, task notifications and messages from other sessions reach the prompt hooks as prompts too, and are not the user's words.
export const HARNESS_FRAMES = Object.freeze(['task-notification', 'agent-message', 'teammate-message', 'side-sessions-event', 'ci-monitor-event', 'cross-session-message'])
const FRAME = new RegExp(String.raw`^\s*<(${HARNESS_FRAMES.join('|')})[>\s]`)

// True only for a string whose first non-space characters open one of the frames above.
export const isHarnessFrame = text => typeof text === 'string' && FRAME.test(text)
