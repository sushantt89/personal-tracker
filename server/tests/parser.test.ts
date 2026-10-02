import { describe, it, expect } from 'vitest';
import { parseMessage, parseAddress, findDate, parseHeader } from '../src/services/parser/index.js';

const SAMPLE = `Hi SUSHANT
Your schedule for Friday 2 OCT.
Meet at Goodwood Road McDonald's at 8:45am.
Sonia 8:45am ($25)
25 Angus Street
Goodwood, SA, Australia
Andrew Dana - 10am ($30)
2 Chessington Avenue
Frewville, SA, Australia
Bron B - 11:30am ($30)
25 Clifton St Hawthorn 5062
Kitchen, 2 bathrooms, 3 rooms.
Dusting and wipedown surfaces, vacuum and mop floor.
Change the bed in master bedroom.`;

describe('parseMessage – sample schedule', () => {
  const r = parseMessage(SAMPLE, { today: '2026-10-01' });

  it('detects 3 jobs and summary', () => {
    expect(r.kind).toBe('schedule');
    expect(r.jobs).toHaveLength(3);
    expect(r.summary.totalAmount).toBe(85);
    expect(r.summary.addressCount).toBe(3);
    expect(r.summary.dates).toEqual(['2026-10-02']);
    expect(r.recipientName).toBe('Sushant');
    expect(r.meetingPoint).toBe("Goodwood Road McDonald's");
    expect(r.meetingTime).toBe('08:45');
  });

  it('extracts job 1', () => {
    const j = r.jobs[0];
    expect(j.clientName).toBe('Sonia');
    expect(j.date).toBe('2026-10-02');
    expect(j.startTime).toBe('08:45');
    expect(j.amount).toBe(25);
    expect(j.address).toMatchObject({ line1: '25 Angus Street', suburb: 'Goodwood', state: 'SA', country: 'Australia' });
    expect(j.address.formatted).toBe('25 Angus Street, Goodwood SA');
    expect(j.meetingPoint).toBe("Goodwood Road McDonald's");
  });

  it('extracts job 2', () => {
    const j = r.jobs[1];
    expect(j.clientName).toBe('Andrew Dana');
    expect(j.startTime).toBe('10:00');
    expect(j.amount).toBe(30);
    expect(j.address.formatted).toBe('2 Chessington Avenue, Frewville SA');
  });

  it('extracts job 3 with description and tasks', () => {
    const j = r.jobs[2];
    expect(j.clientName).toBe('Bron B');
    expect(j.startTime).toBe('11:30');
    expect(j.amount).toBe(30);
    expect(j.address).toMatchObject({ line1: '25 Clifton St', suburb: 'Hawthorn', state: 'SA', postcode: '5062' });
    expect(j.address.formatted).toBe('25 Clifton St, Hawthorn SA 5062');
    expect(j.description).toBe('Kitchen, 2 bathrooms, 3 rooms.');
    expect(j.rooms).toBe(3);
    expect(j.bathrooms).toBe(2);
    expect(j.tasks).toEqual(['Dusting', 'Wiping surfaces', 'Vacuuming', 'Mopping', 'Change master bedroom bed']);
    expect(j.confidence).toBe(1);
  });
});

describe('parseMessage – variations', () => {
  it('handles multi-day schedules, time ranges and missing amounts', () => {
    const r = parseMessage(
      `Schedule this week
Saturday 3 Oct
9am-11am Jane Smith $60
12 Main Rd, Norwood SA 5067
Sunday 4 October
Mark T 1:30pm
4/18 King William Street Adelaide`,
      { today: '2026-10-01' },
    );
    expect(r.jobs).toHaveLength(2);
    expect(r.jobs[0]).toMatchObject({ clientName: 'Jane Smith', date: '2026-10-03', startTime: '09:00', endTime: '11:00', amount: 60 });
    expect(r.jobs[0].address.postcode).toBe('5067');
    expect(r.jobs[1]).toMatchObject({ clientName: 'Mark T', date: '2026-10-04', startTime: '13:30' });
    expect(r.jobs[1].amount).toBeUndefined();
    expect(r.jobs[1].warnings).toContain('No payment amount found');
    expect(r.jobs[1].address.line1).toBe('4/18 King William Street');
    expect(r.jobs[1].address.suburb).toBe('Adelaide');
  });

  it('does not treat instructions with times as jobs', () => {
    expect(parseHeader('Arrive by 9am please')).toBeNull();
    expect(parseHeader('25 Angus Street')).toBeNull();
  });

  it('parses payment messages', () => {
    const r = parseMessage('You received $120.50 from Andrew Dana on 28/09 ref INV-2026-0004', { today: '2026-10-01' });
    expect(r.kind).toBe('payment');
    expect(r.payments[0]).toMatchObject({ amount: 120.5, payer: 'Andrew Dana', date: '2026-09-28', reference: 'INV-2026-0004' });
  });

  it('returns unknown for unrelated text', () => {
    const r = parseMessage('hello how are you', { today: '2026-10-01' });
    expect(r.kind).toBe('unknown');
  });
});

describe('helpers', () => {
  it('infers year across new year', () => {
    expect(findDate('Friday 2 Jan', '2026-12-20')?.date).toBe('2027-01-02');
    expect(findDate('tomorrow', '2026-10-01')?.date).toBe('2026-10-02');
    expect(findDate('2/10/2026', '2026-10-01')?.date).toBe('2026-10-02');
  });
  it('infers state from postcode', () => {
    expect(parseAddress(['10 Smith St Richmond 3121']).state).toBe('VIC');
  });
});
