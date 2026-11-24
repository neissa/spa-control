const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('./spa.js');

const now = new Date(2026, 0, 15, 12, 0);
const ok = () => ({
  online: true, currentTemp: '100.40', desiredTemp: '102.20', celsius: true, tempRange: 'HIGH', heaterMode: 'READY', ecoMode: false,
  hour: 12, minute: 0, day: 15, month: 1, year: 2026, military: true, timeNotSet: false,
  uplinkTimestamp: new Date(2026, 0, 15, 11, 50).toISOString(), updatedAt: new Date(2026, 0, 15, 11, 45).toISOString(),
  errorCode: 0, statusMessages: [], controllerType: 'NGSC',
  setupParams: { lowRangeLow: 50, lowRangeHigh: 99, highRangeLow: 80, highRangeHigh: 104 },
  systemInfo: { controllerSoftwareVersion: 'M100_235 V52.0' }, spaSerialNumber: '00000***0000000000', components: []
});

test('components: filtre, numérote, clés stables, label perso prioritaire', () => {
  const s = ok();
  s.components = [
    { componentType: 'PUMP', port: 0, value: 'OFF' }, { componentType: 'PUMP', port: 1, value: 'HIGH' },
    { componentType: 'LIGHT', port: null, value: 'ON' }, { componentType: 'OZONE', value: 'DISABLED' },
    { componentType: 'GATEWAY', value: null }, { componentType: 'HEATER', value: 'ON' }, { componentType: 'FILTER', port: null, value: null }
  ];
  const c = V.components(s, { 'PUMP:1': 'Jets dos' });
  assert.deepEqual(c.map(x => x.key), ['PUMP:0', 'PUMP:1', 'LIGHT:0', 'OZONE:0', 'FILTER:0']);
  assert.deepEqual(c.map(x => x.label), ['Pompe 1', 'Jets dos', 'Lumière', 'Ozone', 'Filtre']);
  assert.deepEqual(c.map(x => x.on), [false, true, true, false, false]);
  assert.deepEqual(c.map(x => x.ambiguous), [false, false, true, false, false]); // LIGHT sans port
  assert.deepEqual(c.map(x => x.kind), ['pump', 'pump', 'light', 'other', 'other']);
});

test('temps: toujours °F -> °C (celsius true ou false), 0 et 262 -> null, plages', () => {
  for (const celsius of [true, false]) {
    const s = ok(); s.celsius = celsius; s.currentTemp = '0.00'; s.desiredTemp = '50.90';
    const t = V.temps(s);
    assert.equal(t.current, null);
    assert.equal(t.set, 10.5);
    assert.equal(t.range.lowMin, 10); assert.equal(t.range.lowMax, 37);
    assert.equal(t.range.highMin, 26.5); assert.equal(t.range.highMax, 40);
    assert.equal(t.setF, 51); assert.deepEqual(t.rangeF, { lowMin: 50, lowMax: 99, highMin: 80, highMax: 104 });
    assert.equal(t.rangeMode, 'HIGH');
  }
  assert.equal(V.temps(Object.assign(ok(), { currentTemp: '262.00' })).current, null);
  assert.equal(V.temps(ok()).current, 38);
});

test('ping: 59 min, 61 min, date absente, max des deux dates', () => {
  const at = min => new Date(now.getTime() - min * 60000).toISOString();
  assert.equal(V.ping({ uplinkTimestamp: at(59) }, now).stale, false);
  assert.equal(V.ping({ uplinkTimestamp: at(61) }, now).stale, true);
  const p = V.ping({ uplinkTimestamp: at(100), updatedAt: at(10) }, now);
  assert.equal(p.ageMin, 10);
  assert.deepEqual(V.ping({}, now), { lastSeen: null, ageMin: null, stale: true });
});

test('clock: 24 h / 12 h, dérive 3 vs 10 min, timeNotSet', () => {
  const s = ok(); s.hour = 15; s.minute = 5;
  assert.equal(V.clock(s, now).text, '15:05');
  s.military = false;
  assert.equal(V.clock(s, now).text, '3:05 PM');
  s.hour = 0; assert.equal(V.clock(s, now).text, '12:05 AM');
  s.hour = 12; s.minute = 3;
  let c = V.clock(s, now); assert.equal(c.driftMin, 3); assert.equal(c.drifted, false);
  s.hour = 11; s.minute = 50;
  c = V.clock(s, now); assert.equal(c.driftMin, -10); assert.equal(c.drifted, true);
  s.timeNotSet = true; s.hour = 12; s.minute = 0;
  c = V.clock(s, now); assert.equal(c.notSet, true); assert.equal(c.drifted, true);
});

test('heating: actif seulement si c8z != OFF', () => {
  const s = ok();
  assert.equal(V.heating(s, null).active, false);
  assert.equal(V.heating(s, null).c8zState, null);
  assert.equal(V.heating(s, { c8zHeaterState: 'OFF', c8zStatus: 'x' }).active, false);
  const h = V.heating(s, { c8zHeaterState: 'HEATING', c8zStatus: 'y' });
  assert.equal(h.active, true); assert.equal(h.mode, 'READY'); assert.equal(h.c8zStatus, 'y');
});

test('tech: valeurs manquantes -> null', () => {
  const t = V.tech(ok(), { buildNumber: '1133/129', modelType: 'M' });
  assert.equal(t.gateway, '1133/129'); assert.equal(t.firmware, 'M100_235 V52.0'); assert.equal(t.model, 'M');
  assert.equal(t.dealer, null); assert.equal(t.salesDate, null);
  assert.equal(V.tech({}, null).serial, null);
});

test('schedules: jours numériques ou texte, zéro padding, tri par heure', () => {
  const l = V.schedules([
    { _id: 'b', name: 'Soir', enabled: true, settings: { days: [0, 6], hour: 18, minute: 30, timeZone: 'Europe/Paris' }, values: { heaterTemp: 100, heaterMode: 'READY', tempRange: 'HIGH' } },
    { _id: 'a', name: 'Matin', enabled: false, settings: { days: ['MON'], hour: 6, minute: 5 }, values: { heaterTemp: 90 } }
  ]);
  assert.deepEqual(l.map(x => x.time), ['06:05', '18:30']);
  assert.deepEqual(l[1].days, ['dim', 'sam']);
  assert.deepEqual(l[0].days, ['MON']);
  assert.equal(l[1].setTemp, 100); assert.equal(l[0].timeZone, null);
});

test('alerts: aucune quand tout va bien, sinon une par problème', () => {
  assert.deepEqual(V.alerts(ok(), {}, now), []);
  const s = ok();
  s.online = false; s.errorCode = 5; s.timeNotSet = true;
  s.uplinkTimestamp = new Date(2026, 0, 15, 9, 0).toISOString(); s.updatedAt = s.uplinkTimestamp;
  s.statusMessages = [{ code: 1, message: 'ok', severity: 'INFO' }, { code: 2, message: 'Filtre', severity: 'WARNING' }];
  const a = V.alerts(s, {}, now);
  assert.deepEqual(a.map(x => x.code), ['ping', 'offline', 'error', 'clock', 'msg:2']);
  assert.equal(a[1].level, 'critical');
  assert.equal(a[4].level, 'warning');
});

test('alerts: code 38 = information « pas de filtration », autre code = critique', () => {
  const s = ok(); s.errorCode = 38; s.currentTemp = 262;
  s.statusMessages = [{ code: 'TURN_ON_JET_1', message: 'Turn on jet 1', severity: 'INFO' }];
  const a = V.alerts(s, {}, now);
  assert.deepEqual(a.map(x => [x.level, x.code]), [['info', 'nofilter']]);
  assert.equal(a[0].text, "Pas de filtration en cours : la température n'est pas mesurée tant qu'une pompe n'a pas tourné.");
  assert.equal(V.temps(s).current, null);
  s.errorCode = 39; assert.deepEqual(V.alerts(s, {}, now).map(x => [x.level, x.code]), [['critical', 'error']]);
});

test('clock: heure ou minute manquante -> « — »; écart lisible', () => {
  const s = ok(); delete s.hour;
  assert.equal(V.clock(s, now).text, '—');
  s.hour = 12; delete s.minute; s.military = false;
  assert.equal(V.clock(s, now).text, '—');
  assert.equal(V.driftText(-748), 'en retard de 12 h 28 min');
  assert.equal(V.driftText(7), 'en avance de 7 min');
  const t = ok(); t.hour = 0; t.minute = 12;
  assert.equal(V.alerts(t, {}, now).find(a => a.code === 'clock').text, "L'horloge du spa est en retard de 11 h 48 min : à corriger.");
});

test('clock: écart sur hh:mm seulement (date API = 0), cercle de 24 h', () => {
  const n = new Date(2026, 10, 24, 16, 3, 54);
  const mk = (h, m, o) => Object.assign({ hour: h, minute: m, year: 0, month: 0, day: 0, military: true, timeNotSet: false }, o);
  let c = V.clock(mk(16, 2), n); assert.equal(c.driftMin, -1); assert.equal(c.drifted, false);
  c = V.clock(mk(16, 13), n); assert.equal(c.driftMin, 10); assert.equal(c.drifted, true);
  assert.equal(V.clock(mk(23, 59), new Date(2026, 10, 24, 0, 1)).driftMin, -2);
  assert.equal(V.clock(mk(0, 1), new Date(2026, 10, 24, 23, 59)).driftMin, 2);
  c = V.clock(mk(16, 2, { year: 2020, month: 3, day: 9 }), n); assert.equal(c.driftMin, -1); assert.equal(c.drifted, false);
  c = V.clock({ military: true }, n); assert.equal(c.driftMin, null); assert.equal(c.drifted, false);
  c = V.clock(mk(null, 'x'), n); assert.equal(c.driftMin, null); assert.equal(c.drifted, false);
  c = V.clock(mk(16, 3, { timeNotSet: true }), n); assert.equal(c.drifted, true);
});

test('données partielles: éléments null et types de prototype ignorés', () => {
  const s = ok();
  s.components = [null, 'x', { componentType: 'constructor' }, { componentType: 'PUMP', port: 0, value: 'ON' }];
  s.statusMessages = [null, 3, { code: 2, message: 'Filtre', severity: 'WARNING' }];
  assert.deepEqual(V.components(s).map(c => c.key), ['PUMP:0']);
  assert.deepEqual(V.alerts(s, {}, now).map(a => a.code), ['msg:2']);
  assert.equal(V.tech(s, null).messages.length, 1);
  s.components = null; s.statusMessages = null;
  assert.deepEqual(V.components(s), []);
  assert.deepEqual(V.alerts(s, {}, now), []);
});

test('components: sans port ou clé en double => aucun contrôle', () => {
  const sw = (type, port, extra) => Object.assign({ componentType: type, port, value: 'OFF', availableValues: ['OFF', 'HIGH'] }, extra);
  const ctl = comps => { const s = ok(); s.components = comps; return V.components(s).map(k => !!k.control); };
  assert.deepEqual(ctl([sw('PUMP', 1), sw('PUMP', null)]), [false, false]); // même clé PUMP:1
  assert.deepEqual(ctl([sw('PUMP', 0), sw('PUMP', 1)]), [true, true]);
  assert.deepEqual(ctl([sw('PUMP', 1), sw('PUMP', '1')]), [false, false]);
  for (const bad of [null, undefined, '', 'x']) assert.deepEqual(ctl([sw('LIGHT', bad)]), [false]);
  assert.deepEqual(ctl([sw('MICROSILK', null)]), [true]); // pas de port requis
  assert.deepEqual(ctl([{ componentType: 'PUMP', port: 0, value: 'LOW', availableValues: ['LOW', 'HIGH'] }]), [true]); // sans OFF : pompe quand même pilotable (essai réel)
  assert.deepEqual(ctl([{ componentType: 'LIGHT', port: 0, value: 'OFF', availableValues: ['HIGH'] }]), [false]); // lumière sans OFF : strict
  assert.deepEqual(ctl([{ componentType: 'PUMP', port: null, value: 'LOW', availableValues: ['LOW', 'HIGH'] }]), [false]); // sans port
  const s = ok(); s.components = [sw('PUMP', 0)];
  assert.equal(V.components(s, { toString: 'x', constructor: 'y' })[0].label, 'Pompe'); // libellés lus par hasOwn
});

test('components: circulation pilotable sans port, libellé perso', () => {
  const s = ok(); s.components = [{ componentType: 'CIRCULATION_PUMP', port: null, value: 'OFF', availableValues: ['OFF', 'LOW', 'HIGH'] }];
  const [k] = V.components(s, { 'CIRCULATION_PUMP:0': 'Circ' });
  assert.deepEqual([k.label, k.ambiguous, k.control], ['Circ', false, { kind: 'cycle' }]);
  assert.equal(V.components(s)[0].label, 'Pompe de circulation');
});

test('control: interrupteur, niveaux, ou rien', () => {
  assert.deepEqual(V.control({ componentType: 'LIGHT', value: 'OFF', availableValues: ['OFF', 'ON'] }), { kind: 'switch', onValue: 'ON' });
  assert.deepEqual(V.control({ componentType: 'PUMP', value: 'OFF', availableValues: ['OFF', 'HIGH', 'DISABLED'] }), { kind: 'switch', onValue: 'HIGH' });
  assert.deepEqual(V.control({ componentType: 'PUMP', value: 'LOW', availableValues: ['OFF', 'LOW', 'HIGH'] }), { kind: 'cycle' });
  assert.equal(V.control({ componentType: 'OZONE', value: 'ON', availableValues: ['OFF', 'ON'] }), null);
  assert.deepEqual(V.control({ componentType: 'CIRCULATION_PUMP', value: 'OFF', availableValues: ['OFF', 'HIGH'] }), { kind: 'switch', onValue: 'HIGH' });
  assert.deepEqual(V.control({ componentType: 'CIRCULATION_PUMP', value: 'LOW', availableValues: ['OFF', 'LOW', 'HIGH'] }), { kind: 'cycle' });
  assert.deepEqual(V.control({ componentType: 'CIRCULATION_PUMP', value: 'LOW', availableValues: ['LOW', 'HIGH'] }), { kind: 'cycle' }); // OFF implicite
  assert.equal(V.control({ componentType: 'CIRCULATION_PUMP', value: 'DISABLED', availableValues: ['OFF', 'HIGH'] }), null);
  assert.equal(V.control({ componentType: 'PUMP', value: 'DISABLED', availableValues: ['OFF', 'ON'] }), null);
  assert.deepEqual(V.control({ componentType: 'PUMP', value: 'LOW', availableValues: ['LOW', 'HIGH'] }), { kind: 'cycle' }); // OFF implicite
  assert.equal(V.control({ componentType: 'LIGHT', value: 'ON', availableValues: ['ON'] }), null);
  assert.equal(V.control({ componentType: 'PUMP', value: 'OFF', availableValues: ['OFF'] }), null);
  assert.equal(V.control({ componentType: 'PUMP', value: 'ON' }), null);
  assert.equal(V.control(null), null);
});

test('outcome: confirmé, autre niveau, inchangé', () => {
  assert.deepEqual(V.outcome('OFF', 'HIGH', 'LOW'), { status: 'changed', actual: 'HIGH' }); // pompe : LOW demandé, HIGH obtenu
  assert.deepEqual(V.outcome('LOW', 'HIGH', 'MED'), { status: 'changed', actual: 'HIGH' });
  assert.deepEqual(V.outcome('HIGH', 'OFF', 'OFF'), { status: 'confirmed', actual: 'OFF' });
  assert.deepEqual(V.outcome('OFF', 'HIGH', 'HIGH'), { status: 'confirmed', actual: 'HIGH' });
  assert.equal(V.outcome('OFF', 'OFF', 'HIGH').status, 'unchanged'); // lumière : pas encore relue
  assert.equal(V.outcome('OFF', 'OFF', 'LOW').status, 'unchanged');
  assert.equal(V.outcome('HIGH', 'HIGH', 'OFF').status, 'unchanged');
  for (const bad of [null, undefined, '']) { assert.equal(V.outcome('OFF', bad, 'HIGH').status, 'unchanged'); assert.equal(V.outcome(bad, 'HIGH', 'LOW').status, 'changed'); }
  assert.equal(V.outcome(null, null, null).status, 'unchanged');
});

test('errorChange: 0<->38 silencieux, autres changements journalisés', () => {
  for (const [a, b] of [[0, 0], [38, 38], [12, 12], [null, 0], [undefined, null], ['38', 38], [0, 38], [38, 0], [null, 38], [38, undefined], ['0', '38']]) assert.equal(V.errorChange(a, b), null, `${a}->${b}`);
  assert.equal(V.errorChange(0, 12), 'code erreur 0 -> 12');
  assert.equal(V.errorChange(12, 0), 'code erreur 12 -> 0');
  assert.equal(V.errorChange(12, 38), 'code erreur 12 -> 38');
  assert.equal(V.errorChange(38, 12), 'code erreur 38 -> 12');
  assert.equal(V.errorChange(null, 12), 'code erreur 0 -> 12');
});
