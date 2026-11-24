const test = require('node:test');
const assert = require('node:assert/strict');
const { compact, runtimes, toC } = require('./stats.js');

test('toC: toujours °F -> °C, valeurs absurdes ou absentes => null', () => {
  assert.equal(toC('50.90'), 10.5);
  assert.equal(toC('50.90', true), 10.5); // le drapeau celsius est ignoré
  assert.deepEqual([50, 51, 52, 53, 55, 99].map(toC), [10, 10.5, 11, 11.5, 13, 37]); // °F entier puis °C au 0,5
  assert.equal(toC(99), 37);
  assert.equal(toC(104), 40);
  assert.equal(toC('0.00'), null);
  assert.equal(toC('262.00'), null);
  assert.equal(toC(31.4), null);
  assert.equal(toC(140.6), null);
  assert.equal(toC(140), 60);
  for (const v of [null, undefined, '', 'abc', NaN]) assert.equal(toC(v), null);
});

test('compact: temp et set en °C même si celsius=true', () => {
  const x = compact({ online: true, celsius: true, currentTemp: '262.00', desiredTemp: '50.90', components: [] }, null, 1);
  assert.equal(x.temp, null); assert.equal(x.set, 10.5);
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
