// Group handlers. A handler gets { state, params, query, body } and returns { status, body } plus, when it
// changes the store, the new store as `state`. Handlers never change the state they are given.
import { balances, settleUp } from './ledger.mjs'
import { parseGroupId, parseGroupName, parseMembers } from './validate.mjs'

export const NOT_FOUND = { status: 404, body: { error: 'not found' } }

export const findGroup = (state, id) => state.groups.find(g => g.id === id)

export function createGroup({ state, body }) {
  const group = { id: parseGroupId(body.id), name: parseGroupName(body.name), members: parseMembers(body.members) }
  if (findGroup(state, group.id)) return { status: 409, body: { error: 'group already exists' } }
  return { status: 201, body: group, state: { ...state, groups: [...state.groups, group] } }
}

export function getGroup({ state, params }) {
  const group = findGroup(state, params[0])
  return group ? { status: 200, body: group } : NOT_FOUND
}

export function getBalances({ state, params }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  return { status: 200, body: { balances: balances(state, group) } }
}

export function getSettleUp({ state, params }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  return { status: 200, body: { payments: settleUp(state, group) } }
}
