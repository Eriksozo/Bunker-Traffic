// Limites de tempo dos testes de desempenho. Na máquina de desenvolvimento valem como estão; no build
// automático do Cloudflare (WORKERS_CI) ou em outro CI, a máquina é mais lenta e compartilhada, então o
// limite é multiplicado. BUNKER_TEST_CPU_SCALE força um fator.
const forced = Number(process.env.BUNKER_TEST_CPU_SCALE);
export const cpuScale = forced > 0 ? forced : (process.env.WORKERS_CI || process.env.CI ? 8 : 1);
export const budget = (ms) => ms * cpuScale;
