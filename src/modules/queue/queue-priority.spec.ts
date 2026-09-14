import {
  QUEUE_PRIORITIES,
  QUEUE_PRIORITY_RANK,
  queuePriorityRank,
} from './dto/create-queue.dto';

describe('queue priority ladder', () => {
  it('accepts the p1–p5 codes the app and the triage screens speak', () => {
    // Every add-to-queue from the phone was a 400 before these were allowed.
    for (const code of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      expect(QUEUE_PRIORITIES).toContain(code);
    }
  });

  it('keeps the older word vocabulary working', () => {
    for (const word of ['urgent', 'normal', 'low', 'routine']) {
      expect(QUEUE_PRIORITIES).toContain(word);
    }
  });

  it('orders the whole ladder by urgency, not alphabetically', () => {
    // The board used to ORDER BY the priority *string*. Descending alphabetical
    // put "routine" above "normal", and with the p-codes added it scrambled
    // entirely — which, with server-side pagination, can put a P1 on page two.
    const byUrgency = [...QUEUE_PRIORITIES].sort(
      (a, b) => queuePriorityRank(a) - queuePriorityRank(b),
    );

    expect(byUrgency.indexOf('p1')).toBeLessThan(byUrgency.indexOf('p3'));
    expect(byUrgency.indexOf('p3')).toBeLessThan(byUrgency.indexOf('p5'));
    expect(byUrgency.indexOf('urgent')).toBeLessThan(byUrgency.indexOf('low'));
    expect(byUrgency.indexOf('p5')).toBeLessThan(byUrgency.indexOf('routine'));
  });

  it('interleaves the two vocabularies onto one ladder', () => {
    // A board mixing both must still read top-to-bottom by how sick somebody
    // is, so the equivalences have to hold across the sets.
    expect(queuePriorityRank('p1')).toBe(queuePriorityRank('emergency'));
    expect(queuePriorityRank('p4')).toBe(queuePriorityRank('normal'));
    expect(queuePriorityRank('low')).toBe(queuePriorityRank('routine'));
    expect(queuePriorityRank('p2')).toBeLessThan(queuePriorityRank('urgent'));
  });

  it('sorts an unknown value last, never first', () => {
    // A typo must not promote somebody to the top of a triage queue.
    const unknown = queuePriorityRank('definitely-not-a-priority');
    for (const known of Object.keys(QUEUE_PRIORITY_RANK)) {
      expect(unknown).toBeGreaterThan(queuePriorityRank(known));
    }
    expect(queuePriorityRank(null)).toBe(unknown);
    expect(queuePriorityRank(undefined)).toBe(unknown);
  });

  it('is case-insensitive, because stored values are not normalised', () => {
    expect(queuePriorityRank('P1')).toBe(queuePriorityRank('p1'));
    expect(queuePriorityRank('URGENT')).toBe(queuePriorityRank('urgent'));
  });

  it('ranks every accepted priority — no value falls through to unknown', () => {
    for (const p of QUEUE_PRIORITIES) {
      expect(queuePriorityRank(p)).toBeLessThan(99);
    }
  });
});
