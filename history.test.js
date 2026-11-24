const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./history.js');

const st = comps => ({ heaterMode: 'REST', tempRange: 'LOW', components: comps });
const P = (type, port, value) => ({ componentType: type, port, value });

test('snapshot: clés type:port (ou index), types suivis, éléments invalides ignorés', () => {
  const s = H.snapshot(st([P('PUMP', '1', 'OFF'), P('PUMP', '2', 'HIGH'), { componentType: 'LIGHT', value: 'ON' }, P('LIGHT', 3, 'OFF'),
    P('GATEWAY', null, 'ON'), P('CONTROLLER', null, 'ON'), P('HEATER', null, 'ON'), null, 'x', P('OZONE', null, null), P('FILTER', null, 'OFF'), P('FILTER', null, 'DISABLED'), P('MICROSILK', 1, 'ON')]));
  assert.equal(s.mode, 'REST'); assert.equal(s.range, 'LOW');
  assert.deepEqual(s.comps, { 'PUMP:1': 'OFF', 'PUMP:2': 'HIGH', 'LIGHT:0': 'ON', 'LIGHT:3': 'OFF', 'FILTER:0': 'OFF', 'FILTER:1': 'DISABLED' });
  assert.deepEqual(H.snapshot(null), { mode: null, range: null, comps: {} });
  assert.deepEqual(H.snapshot({ components: 'x', heaterMode: 5 }), { mode: null, range: null, comps: {} });
});

test('snapshot: clé en double ignorée, entrée non modifiée', () => {
  const input = st([P('PUMP', 1, 'ON'), P('PUMP', 1, 'OFF')]), copy = JSON.stringify(input);
  assert.deepEqual(H.snapshot(input).comps, {});
  assert.equal(JSON.stringify(input), copy);
});

test('diff: premier relevé sans changement, puis mode, plage, pompe, lumière', () => {
  const a = H.snapshot(st([P('PUMP', 2, 'OFF'), P('LIGHT', 1, 'OFF')]));
  assert.deepEqual(H.diff(null, a, 5, 's'), []);
  assert.deepEqual(H.diff(a, a, 5, 's'), []);
  const b = { mode: 'READY', range: 'HIGH', comps: { 'PUMP:2': 'HIGH', 'LIGHT:1': 'ON' } };
  assert.deepEqual(H.diff(a, b, 9, 's'), [
    { ts: 9, spa: 's', k: 'mode', f: 'REST', t: 'READY' }, { ts: 9, spa: 's', k: 'range', f: 'LOW', t: 'HIGH' },
    { ts: 9, spa: 's', k: 'comp:PUMP:2', f: 'OFF', t: 'HIGH' }, { ts: 9, spa: 's', k: 'comp:LIGHT:1', f: 'OFF', t: 'ON' }]);
});

test('diff: composant ou valeur absents ignorés (réponse partielle)', () => {
  const a = H.snapshot(st([P('PUMP', 1, 'OFF'), P('PUMP', 2, 'ON')]));
  const part = { mode: null, range: null, comps: { 'PUMP:1': 'OFF' } };
  assert.deepEqual(H.diff(a, part, 1, 's'), []);
  assert.deepEqual(H.diff(part, { mode: 'REST', range: 'LOW', comps: { 'PUMP:1': 'OFF', 'PUMP:9': 'ON' } }, 1, 's'), []);
  // merge garde la dernière valeur connue : un composant qui revient changé est un vrai changement
  const m = H.merge(a, part);
  assert.deepEqual(m.comps, { 'PUMP:1': 'OFF', 'PUMP:2': 'ON' }); assert.equal(m.mode, 'REST');
  assert.equal(H.diff(m, { mode: 'REST', range: 'LOW', comps: { 'PUMP:2': 'OFF' } }, 1, 's').length, 1);
  assert.deepEqual(H.diff({ comps: 'x' }, { comps: { a: 'b' } }, 1, 's'), []);
});

test('point: °C au 0,5; sonde 262 ou 0 => null; les deux null => null', () => {
  assert.deepEqual(H.point({ currentTemp: '50.90', desiredTemp: '104' }, 7), [7, 10.5, 40]);
  assert.deepEqual(H.point({ currentTemp: '262.00', desiredTemp: '50.90' }, 7), [7, null, 10.5]);
  assert.deepEqual(H.point({ currentTemp: '0.00', desiredTemp: 'abc' }, 7), null);
  assert.equal(H.point({}, 7), null);
});

test('shouldRecord: premier point, 5 min, changement', () => {
  const last = [0, 10, 11], M = 60000;
  assert.equal(H.shouldRecord(null, [1, 10, 11]), true);
  assert.equal(H.shouldRecord(last, [4 * M, 10, 11]), false);
  assert.equal(H.shouldRecord(last, [5 * M, 10, 11]), true);
  assert.equal(H.shouldRecord(last, [M, 10.5, 11]), true);
  assert.equal(H.shouldRecord(last, [M, 10, 12]), true);
  assert.equal(H.shouldRecord(last, [M, null, 11]), true);
  assert.equal(H.shouldRecord(['x'], [M, 10, 11]), true);
});

test('prune: âge, longueur, éléments mal formés', () => {
  const now = 1000, arr = [[0, 1, 1], [500, 1, 1], [600, 1, 1], [700, 1, 1], 'x', null, [NaN], { ts: 900 }];
  assert.deepEqual(H.prune(arr, now, 600, 100), [[500, 1, 1], [600, 1, 1], [700, 1, 1], { ts: 900 }]);
  assert.deepEqual(H.prune(arr, now, 600, 2), [[700, 1, 1], { ts: 900 }]);
  assert.deepEqual(H.prune('x', now, 600, 2), []);
  assert.equal(H.isChange({ ts: 1, k: 'mode', spa: 'a' }), true); assert.equal(H.isChange({ ts: 1 }), false);
});

test('series: coupure au-delà de 15 min, nulls ignorés, fenêtre', () => {
  const M = 60000, pts = [[0, 10, 11], [5 * M, 10.5, 11], [10 * M, null, 11], [40 * M, 12, 12], [45 * M, 12, 12], [999 * M, 1, 1], 'x'];
  const s = H.series(pts, 0, 100 * M);
  assert.deepEqual(s.temp, [[[0, 10], [5 * M, 10.5]], [[40 * M, 12], [45 * M, 12]]]);
  assert.deepEqual(s.set, [[[0, 11], [5 * M, 11], [10 * M, 11]], [[40 * M, 12], [45 * M, 12]]]);
  assert.equal(H.series(pts, 0, 100 * M, 60 * M).temp.length, 1);
  assert.deepEqual(H.series(null, 0, 1), { temp: [], set: [] });
});

test('extent: marge, demi-degré, amplitude >= 2, vide', () => {
  assert.equal(H.extent([]), null); assert.equal(H.extent([null, 'a']), null);
  assert.deepEqual(H.extent([10, 20]), { min: 9, max: 21 });
  const e = H.extent([10.5, 10.5]); assert.equal(e.max - e.min, 2); assert.ok(e.min <= 10.5 && e.max >= 10.5);
  const f = H.extent([10.5, 11]); assert.ok(f.max - f.min >= 2 && f.min <= 10.5 && f.max >= 11);
  assert.equal(H.extent([10.3, 12.2]).min * 2 % 1, 0);
});

test('bands: ON/OFF alternés, état au début connu par changement, snapshot ou inconnu', () => {
  const ch = (ts, f, t) => ({ ts, spa: 's', k: 'comp:PUMP:1', f, t });
  const c = [ch(20, 'OFF', 'HIGH'), ch(40, 'HIGH', 'OFF'), ch(60, 'OFF', 'LOW'), ch(80, 'LOW', 'HIGH'), { ts: 30, spa: 's', k: 'comp:LIGHT:1', f: 'OFF', t: 'ON' }];
  assert.deepEqual(H.bands(c, null, 0, 100, 'comp:PUMP:1'), [[20, 40], [60, 100]]);
  assert.deepEqual(H.bands(c, null, 0, 100, 'PUMP:1'), [[20, 40], [60, 100]]);
  // fenêtre qui commence pendant une période active (dernier changement avant = ON)
  assert.deepEqual(H.bands(c, null, 25, 100, 'PUMP:1'), [[25, 40], [60, 100]]);
  // premier changement dans la fenêtre : son ancien état est connu (ON => actif dès le début)
  assert.deepEqual(H.bands([ch(50, 'HIGH', 'OFF')], null, 0, 100, 'PUMP:1'), [[0, 50]]);
  // aucun changement : snapshot courant, sinon inconnu => rien d'inventé
  assert.deepEqual(H.bands([], { comps: { 'PUMP:1': 'LOW' } }, 10, 100, 'PUMP:1'), [[10, 100]]);
  assert.deepEqual(H.bands([], { comps: { 'PUMP:1': 'OFF' } }, 10, 100, 'PUMP:1'), []);
  assert.deepEqual(H.bands([], null, 10, 100, 'PUMP:1'), []);
  assert.deepEqual(H.bands(null, null, 10, 100, 'PUMP:1'), []);
  assert.deepEqual(H.bands([ch(20, 'DISABLED', 'OFF')], null, 0, 100, 'PUMP:1'), []);
});

test('describe et kind', () => {
  const d = H.describe;
  assert.equal(d({ k: 'mode', f: 'REST', t: 'READY' }), 'Mode de chauffe : Repos → Prêt');
  assert.equal(d({ k: 'mode', f: 'READY', t: 'READY_REST' }), 'Mode de chauffe : Prêt → Prêt en repos');
  assert.equal(d({ k: 'range', f: 'LOW', t: 'HIGH' }), 'Plage : Basse → Haute');
  assert.equal(d({ k: 'comp:PUMP:2', f: 'OFF', t: 'HIGH' }), 'Pompe 2 : Éteint → Fort');
  assert.equal(d({ k: 'comp:LIGHT:1', f: 'OFF', t: 'ON' }), 'Lumière : Éteint → Allumé');
  assert.equal(d({ k: 'comp:PUMP:2', f: 'OFF', t: 'LOW' }, k => k === 'PUMP:2' ? 'Jets du dos' : null), 'Jets du dos : Éteint → Doux');
  assert.equal(d({ k: 'comp:FOO:1', f: 'A', t: 'B' }), 'FOO:1 : A → B');
  assert.deepEqual(['mode', 'range', 'comp:PUMP:1', 'comp:CIRCULATION_PUMP:0', 'comp:LIGHT:1', 'comp:OZONE:0', 'zzz'].map(k => H.kind({ k })), ['mode', 'range', 'pump', 'pump', 'light', 'other', 'other']);
});
