// Tests for the offline drop audit (#332).
//
// The two terms are tested separately because they fail differently: d is exact
// and says only how many, S localises and has a known blind spot.

const { adjacencySites, auditConversation } = require('../tools/chatgpt/audit-drops.js');

const msg = (role) => ({ role });
const convo = (roles) => roles.map(msg);

const build = ({ roles, loaded, exported }) => ({
  metadata: {
    messageCount: exported === undefined ? roles.length : exported,
    scrollInfo: { messagesLoaded: loaded },
  },
  messages: convo(roles),
});

describe('adjacencySites', () => {
  test('a perfectly alternating conversation has no candidates', () => {
    expect(adjacencySites(convo(['user', 'assistant', 'user', 'assistant']))).toEqual([]);
  });

  test('finds the index of a same-role pair', () => {
    expect(adjacencySites(convo(['user', 'assistant', 'assistant', 'user']))).toEqual([2]);
  });

  test('a run of three same-role turns yields two adjacent sites', () => {
    expect(adjacencySites(convo(['user', 'assistant', 'assistant', 'assistant']))).toEqual([2, 3]);
  });

  test('empty and single-message conversations have no candidates', () => {
    expect(adjacencySites([])).toEqual([]);
    expect(adjacencySites(convo(['user']))).toEqual([]);
  });

  test('messages without a role are never counted as a match', () => {
    expect(adjacencySites([{ role: undefined }, { role: undefined }])).toEqual([]);
  });
});

describe('auditConversation', () => {
  test('nothing dropped: d is 0 and precision is not asserted', () => {
    const a = auditConversation('abc', build({
      roles: ['user', 'assistant', 'user', 'assistant'], loaded: 4,
    }));
    expect(a.d).toBe(0);
    expect(a.precision).toBeNull();
  });

  test('an adjacency with d = 0 is legitimate, not a drop', () => {
    // Consecutive assistant turns do occur. Without d this would look suspicious;
    // with d it is settled.
    const a = auditConversation('abc', build({
      roles: ['user', 'assistant', 'assistant'], loaded: 3,
    }));
    expect(a.d).toBe(0);
    expect(a.sites).toEqual([2]);
    expect(a.precision).toBeNull();
  });

  test('d equal to the candidate count means the drops are fully localised', () => {
    const a = auditConversation('abc', build({
      roles: ['user', 'assistant', 'assistant', 'user'], loaded: 5,
    }));
    expect(a.d).toBe(1);
    expect(a.sites).toEqual([2]);
    expect(a.precision).toBe(1);
  });

  test('more candidates than losses gives a bounded search with real precision', () => {
    // The #330 case: one message lost, six candidate sites, precision 1/6.
    const roles = ['user', 'user', 'assistant', 'assistant', 'user', 'user',
      'assistant', 'assistant', 'user', 'user', 'assistant', 'assistant'];
    const a = auditConversation('abc', build({ roles, loaded: roles.length + 1 }));
    expect(a.d).toBe(1);
    expect(a.sites).toHaveLength(6);
    expect(a.precision).toBeCloseTo(1 / 6, 10);
  });

  test('the known blind spot: a drop inside a same-role run leaves no new candidate', () => {
    // True sequence user, A, A, A; the middle assistant turn is lost. What
    // survives is user, A, A -- an adjacency that was already there. S cannot
    // distinguish the two, so d is the only witness.
    const a = auditConversation('abc', build({ roles: ['user', 'assistant', 'assistant'], loaded: 4 }));
    expect(a.d).toBe(1);
    expect(a.sites).toEqual([2]); // the pre-existing adjacency, not evidence of the loss
  });

  test('a drop with no adjacency at all is reported, and is not a contradiction', () => {
    const a = auditConversation('abc', build({
      roles: ['user', 'assistant', 'user', 'assistant'], loaded: 6,
    }));
    expect(a.d).toBe(2);
    expect(a.sites).toEqual([]);
    expect(a.precision).toBeNull();
  });

  test('exported count comes from metadata, not the array length', () => {
    // The manifest's messageCount is the authority; a truncated messages array
    // must not silently change d.
    const a = auditConversation('abc', build({
      roles: ['user', 'assistant'], loaded: 10, exported: 8,
    }));
    expect(a.d).toBe(2);
    expect(a.exported).toBe(8);
  });

  test('a conversation with no scrollInfo cannot be audited', () => {
    expect(auditConversation('abc', { metadata: { messageCount: 3 }, messages: [] })).toBeNull();
  });

  test('a missing export is not treated as a zero-drop conversation', () => {
    expect(auditConversation('abc', null)).toBeNull();
  });
});
