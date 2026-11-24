const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('./spa.js');

const now = new Date(2026, 0, 15, 12, 0);
const ok = () => ({
  online: true, currentTemp: '38.00', desiredTemp: '39.00', celsius: true, tempRange: 'HIGH', heaterMode: 'READY', ecoMode: false,
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
  assert.deepEqual(c.map(x => x.kind), ['pump', 'pump', 'light', 'other', 'other']);
});

test('temps: °F -> °C, 0 -> null, plages', () => {
  const s = ok(); s.celsius = false; s.currentTemp = '0.00'; s.desiredTemp = '104.00';
  const t = V.temps(s);
  assert.equal(t.current, null);
  assert.equal(t.set, 40);
  assert.equal(t.range.lowMin, 10);
  assert.equal(t.range.highMax, 40);
  assert.equal(t.rangeMode, 'HIGH');
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

test('control: interrupteur, niveaux, ou rien', () => {
  assert.deepEqual(V.control({ componentType: 'LIGHT', value: 'OFF', availableValues: ['OFF', 'ON'] }), { kind: 'switch', onValue: 'ON' });
  assert.deepEqual(V.control({ componentType: 'PUMP', value: 'OFF', availableValues: ['OFF', 'HIGH', 'DISABLED'] }), { kind: 'switch', onValue: 'HIGH' });
  assert.deepEqual(V.control({ componentType: 'PUMP', value: 'LOW', availableValues: ['OFF', 'LOW', 'HIGH'] }), { kind: 'cycle' });
  assert.equal(V.control({ componentType: 'OZONE', value: 'ON', availableValues: ['OFF', 'ON'] }), null);
  assert.equal(V.control({ componentType: 'CIRCULATION_PUMP', value: 'ON', availableValues: ['OFF', 'ON'] }), null);
  assert.equal(V.control({ componentType: 'PUMP', value: 'DISABLED', availableValues: ['OFF', 'ON'] }), null);
  assert.equal(V.control({ componentType: 'PUMP', value: 'ON', availableValues: ['ON'] }), null);
  assert.equal(V.control({ componentType: 'PUMP', value: 'ON' }), null);
  assert.equal(V.control(null), null);
});
