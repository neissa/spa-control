const test = require('node:test');
const assert = require('node:assert/strict');
const { compact, runtimes, toC } = require('./stats.js');

test("convertit en °C selon l'unité du boîtier", () => {
  assert.equal(toC('50.90', false), 10.5);
  assert.equal(toC('38.00', true), 38);
  assert.equal(toC('0.00', false), null);
});

const st = (ts, online, pump, heat) => compact({ online, components: [{ componentType: 'PUMP', value: pump }] }, { c8zHeaterState: heat }, ts);

test('répartit les temps avec/sans chauffe et ignore les trous', () => {
  const m = 60000;
  const r = runtimes([
    st(0, true, 'HIGH', 'OFF'),      // 1 min pompe sans chauffe
    st(m, true, 'HIGH', 'ON'),       // 1 min pompe + chauffe
    st(2 * m, false, 'OFF', 'OFF'),  // 1 min hors ligne
    st(3 * m, true, 'OFF', 'OFF'),   // trou de 1h -> ignoré
    st(3 * m + 3600000, true, 'OFF', 'OFF'),
  ], 5 * m);
  assert.deepEqual([r.runningS, r.heatingS, r.runningNoHeatS, r.offlineS, r.onlineS], [120, 60, 60, 60, 120]);
});
