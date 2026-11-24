// Temps de fonctionnement à partir des relevés. Chaque intervalle est attribué au relevé qui le précède.
// shortcut: seuil "pompe active" = un composant PUMP/CIRCULATION_PUMP/FILTER à ON/HIGH; "chauffe" = c8zHeaterState != OFF. À vérifier sur données réelles.
const ACTIVE = ['PUMP', 'CIRCULATION_PUMP', 'FILTER'];

export function flags(state, c8z) {
  const running = (state?.components ?? []).some(c => ACTIVE.includes(c.componentType) && ['ON', 'HIGH', 'LOW', 'MEDIUM'].includes(c.value));
  const heating = !!c8z?.c8zHeaterState && c8z.c8zHeaterState !== 'OFF';
  return { online: !!state?.online, running, heating };
}

// samples: [{ts, state, c8z}] triés par ts; maxGapMs: au-delà, l'intervalle est ignoré (serveur arrêté)
export function runtimes(samples, maxGapMs) {
  const r = { onlineS: 0, offlineS: 0, runningS: 0, heatingS: 0, runningNoHeatS: 0 };
  for (let i = 0; i < samples.length - 1; i++) {
    const dt = samples[i + 1].ts - samples[i].ts;
    if (dt > maxGapMs) continue;
    const s = dt / 1000, f = flags(samples[i].state, samples[i].c8z);
    if (f.online) r.onlineS += s; else r.offlineS += s;
    if (f.running) r.runningS += s;
    if (f.heating) r.heatingS += s;
    if (f.running && !f.heating) r.runningNoHeatS += s;
  }
  return r;
}
