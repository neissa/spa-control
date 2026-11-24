import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimes } from './stats.js';

const st = (online, pump, heat) => ({ ts: 0, state: { online, components: [{ componentType: 'PUMP', value: pump }] }, c8z: { c8zHeaterState: heat } });
const at = (s, ms) => ({ ...s, ts: ms });

test('répartit les temps avec/sans chauffe et ignore les trous', () => {
  const m = 60000;
  const r = runtimes([
    at(st(true, 'HIGH', 'OFF'), 0),      // 1 min pompe sans chauffe
    at(st(true, 'HIGH', 'ON'), m),       // 1 min pompe + chauffe
    at(st(false, 'OFF', 'OFF'), 2 * m),  // 1 min hors ligne
    at(st(true, 'OFF', 'OFF'), 3 * m),   // trou de 1h -> ignoré
    at(st(true, 'OFF', 'OFF'), 3 * m + 3600000),
  ], 5 * m);
  assert.equal(r.runningS, 120);
  assert.equal(r.heatingS, 60);
  assert.equal(r.runningNoHeatS, 60);
  assert.equal(r.offlineS, 60);
  assert.equal(r.onlineS, 120);
});
