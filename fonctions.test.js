// Tests des fonctions ajoutées : cycles de filtration, C8Zone, programmes, heure automatique, verrouillage de la consigne.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('./spa.js');
const C = require('./commands.js');

const ID = 'spa-test-1';
const B = (path, extra) => ({ path, body: Object.assign({ spaId: ID, via: 'WEB' }, extra) });
const ok = () => ({ online: true, hour: 12, minute: 0, military: true, timeNotSet: false });

test('filterCycles: état, début HH:MM, durée; DISABLED sans heure', () => {
  const s = { components: [
    { componentType: 'FILTER', port: 0, value: 'OFF', hour: 23, minute: 15, durationMinutes: 60 },
    { componentType: 'FILTER', port: 1, value: 'DISABLED', hour: 8, minute: 0, durationMinutes: 120 },
    { componentType: 'PUMP', port: 0, value: 'OFF' }, null
  ] };
  const c = V.filterCycles(s);
  assert.equal(c.length, 2);
  assert.deepEqual([c[0].label, c[0].value, c[0].start, c[0].duration, c[0].on, c[0].disabled], ['Cycle 1', 'OFF', '23:15', '1 h', false, false]);
  assert.deepEqual([c[1].value, c[1].start, c[1].duration, c[1].disabled], ['DISABLED', null, null, true]);
  assert.equal(V.filterCycles({ components: [{ componentType: 'FILTER', value: 'ON', hour: 7, minute: 5, durationMinutes: 90 }] })[0].duration, '1 h 30');
  assert.equal(V.filterCycles({}).length, 0);
  assert.equal(V.durationText(45), '45 min'); assert.equal(V.durationText(null), null);
});

test('c8zText et tempLock', () => {
  assert.equal(V.c8zText('C8Z_STATUS_CONNECTED'), 'connecté');
  assert.equal(V.c8zText('C8Z_STATUS_NOT_PRESENT'), 'non présent');
  assert.equal(V.c8zText('AUTRE'), 'AUTRE'); assert.equal(V.c8zText(null), null); assert.equal(V.c8zText('__proto__'), '__proto__');
  assert.equal(V.tempLock({}), null); assert.equal(V.tempLock({ tempLock: null }), null);
  assert.equal(V.tempLock({ tempLock: false }), false); assert.equal(V.tempLock({ tempLock: true }), true);
  assert.equal(V.tempLock({ tempLock: 'LOCK_TEMP_SETTING' }), true); assert.equal(V.tempLock({ tempLock: 'UNLOCK_TEMP_SETTING' }), false);
});

test('schedules: expose heure, minute et jours numériques pour l\'édition', () => {
  const l = V.schedules([{ _id: 'x', name: 'A', settings: { days: [0, 3], hour: 7, minute: 9 }, values: {} }])[0];
  assert.deepEqual([l.hour, l.minute, l.dayNums], [7, 9, [0, 3]]);
});

test('schedules / findSched: données partielles ignorées sans exception', () => {
  assert.deepEqual(V.schedules(null), []); assert.deepEqual(V.schedules({}), []); assert.deepEqual(V.schedules('x'), []);
  const l = V.schedules([null, 5, { _id: 'a' }, { _id: 'b', settings: { days: 'lun', hour: 7 }, values: null }, { _id: 'c', settings: { days: [null, 1, 'mar'] } }, { _id: 'd', settings: null }]);
  assert.equal(l.length, 4);
  assert.deepEqual(l.map(x => x.id).sort(), ['a', 'b', 'c', 'd']);
  const c = l.find(x => x.id === 'c'); assert.deepEqual([c.dayNums, c.days], [[1], ['lun', 'mar']]);
  assert.deepEqual(l.find(x => x.id === 'b').days, []);
});

test('autoTimeDecision: nominal, écart faible, hors ligne, état périmé, essai récent, échecs, réglage, format, signal', () => {
  const t = new Date(2026, 0, 15, 12, 0).getTime();
  const base = () => ({ state: Object.assign(ok(), { minute: 20, updatedAt: new Date(t - 60000).toISOString() }), stateTs: t - 10000, now: t, enabled: true, lastAttempt: null, failures: 0 });
  assert.deepEqual(V.autoTimeDecision(base()), { time: '12:00', military: true, driftMin: 20 });
  const m = base(); m.state.military = false; assert.equal(V.autoTimeDecision(m).military, false);
  for (const bad of [undefined, null, 'true', 1]) { const x = base(); x.state.military = bad; assert.equal(V.autoTimeDecision(x), null, String(bad)); }
  const nm = base(); delete nm.state.military; assert.equal(V.autoTimeDecision(nm), null);
  const small = base(); small.state.minute = 4; assert.equal(V.autoTimeDecision(small), null);
  const edge = base(); edge.state.minute = 5; assert.equal(V.autoTimeDecision(edge), null);
  const six = base(); six.state.minute = 6; assert.notEqual(V.autoTimeDecision(six), null);
  const off = base(); off.state.online = false; assert.equal(V.autoTimeDecision(off), null);
  const old = base(); old.stateTs = t - 91000; assert.equal(V.autoTimeDecision(old), null);
  const ping10 = base(); ping10.state.updatedAt = new Date(t - 10 * 60000).toISOString(); assert.equal(V.autoTimeDecision(ping10), null);
  const noping = base(); delete noping.state.updatedAt; assert.equal(V.autoTimeDecision(noping), null);
  const rec = base(); rec.lastAttempt = t - 29 * 60000; assert.equal(V.autoTimeDecision(rec), null);
  const old2 = base(); old2.lastAttempt = t - 31 * 60000; assert.notEqual(V.autoTimeDecision(old2), null);
  const f = base(); f.failures = 2; assert.equal(V.autoTimeDecision(f), null);
  const dis = base(); dis.enabled = false; assert.equal(V.autoTimeDecision(dis), null);
  assert.equal(V.autoTimeDecision(null), null);
  const ns = base(); ns.state.timeNotSet = true; ns.state.minute = 0; assert.notEqual(V.autoTimeDecision(ns), null);
  const nul = base(); nul.state.hour = null; nul.state.timeNotSet = true; assert.equal(V.autoTimeDecision(nul), null); // écart inconnu : rien
  const tz = base(); tz.state.timeZone = 'Asia/Tokyo'; tz.timeZone = 'Asia/Tokyo'; assert.equal(V.autoTimeDecision(tz).time, '12:00'); // fuseau ignoré : heure de l'appareil
});

test('time: HH:MM et booléen', () => {
  assert.deepEqual(C.time(ID, '18:16', false), Object.assign(B('/time', { time: '18:16', isMilitaryFormat: false }), { unverified: true }));
  assert.throws(() => C.time(ID, '8:16', false), /HH:MM/);
  assert.throws(() => C.time(ID, '18:16', 'non'), /booléen/);
});

test('tempLock: panel/state LOCK/UNLOCK_TEMP_SETTING', () => {
  assert.deepEqual(C.tempLock(ID, true), Object.assign(B('/panel/state', { state: 'LOCK_TEMP_SETTING' }), { unverified: true }));
  assert.deepEqual(C.tempLock(ID, false), Object.assign(B('/panel/state', { state: 'UNLOCK_TEMP_SETTING' }), { unverified: true }));
  assert.throws(() => C.tempLock(ID, 'oui'), /booléen/);
});

const SID = 'a1b2c3d4e5f60718293a4b5c';
const P = (o) => Object.assign({ name: 'Soir', days: [0, 6], hour: 18, minute: 18, mode: 'REST', tempC: 10 }, o);

test('scheduleCreate: corps exact, jours triés, °C -> °F entier', () => {
  assert.deepEqual(C.scheduleCreate(ID, P({ name: '  Soir  ', days: [6, 0, 6], tempC: 10.5 })), { method: 'POST', path: '/spa-schedules',
    body: { spaId: ID, name: 'Soir', values: { heaterTemp: 51, heaterMode: 'REST' }, settings: { days: [0, 6], hour: 18, minute: 18 }, enabled: true } });
  assert.equal(C.scheduleCreate(ID, P({ tempC: 40 })).body.values.heaterTemp, 104);
  assert.equal(C.scheduleCreate(ID, P({ tempC: 10 })).body.values.heaterTemp, 50);
  for (let f = 50; f <= 104; f++) assert.equal(C.scheduleCreate(ID, P({ tempC: V.toC(f) })).body.values.heaterTemp, f); // aller-retour de l'affichage 0,5 °C
});

test('scheduleCreate: validations', () => {
  for (const bad of [{ name: '' }, { name: '   ' }, { name: 'x'.repeat(41) }, { days: [] }, { days: [7] }, { days: [1.5] }, { days: undefined }, { hour: 24 }, { hour: -1 }, { hour: 1.5 }, { minute: 60 }, { mode: 'READY_REST' }, { tempC: 9.9 }, { tempC: 40.1 }, { tempC: NaN }, { tempC: '20' }])
    assert.throws(() => C.scheduleCreate(ID, P(bad)), Error, JSON.stringify(bad));
  assert.equal(C.scheduleCreate(ID, P({ name: 'x'.repeat(40) })).body.name.length, 40);
  assert.throws(() => C.scheduleCreate('', P()), /spa/);
  assert.throws(() => C.scheduleCreate(ID, null), /Programme/);
});

test('scheduleUpdate / Trigger / Delete: méthode, chemin, corps; id hexadécimal de 24 car.', () => {
  assert.deepEqual(C.scheduleUpdate(SID, P({ tempC: 10.5, mode: 'READY' })), { method: 'PATCH', path: '/spa-schedules/' + SID,
    body: { name: 'Soir', values: { heaterTemp: 51, heaterMode: 'READY' }, settings: { days: [0, 6], hour: 18, minute: 18 } } });
  assert.deepEqual(C.scheduleTrigger(SID), { method: 'POST', path: '/spa-schedules/' + SID + '/trigger', body: {} });
  assert.deepEqual(C.scheduleDelete(SID), { method: 'DELETE', path: '/spa-schedules/' + SID, body: null });
  for (const bad of ['', 'abc', SID + '0', '../../spa-commands/x', SID.slice(0, 23) + 'g', null, 5, SID.slice(0, 20) + '/..']) {
    assert.throws(() => C.scheduleUpdate(bad, P()), /Identifiant/);
    assert.throws(() => C.scheduleTrigger(bad), /Identifiant/);
    assert.throws(() => C.scheduleDelete(bad), /Identifiant/);
  }
});
