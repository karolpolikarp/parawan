// Czas redactPII na długim piśmie (10, 50 i 200 KB). Z --jitless widać, jak silnik działa na
// komputerze, na którym polityka firmy wyłącza JIT w przeglądarce (np. Edge w trybie
// zwiększonego bezpieczeństwa).
// Użycie (po npm run build -w anonimizator): node [--jitless] scripts/e2e/manual/perf.mjs
const { redactPII } = await import(
  new URL('../../../packages/core/dist/index.js', import.meta.url).href
);

const para =
  'Na wniosek Pani Anny Kowalskiej, PESEL 44051401359, zamieszkałej przy ul. Polnej 12/3, ' +
  '00-950 Warszawa, tel. 600 700 800, e-mail anna.kowalska@example.com, orzekam o zwrocie ' +
  'opłaty na rachunek PL61 1090 1014 0000 0712 1981 2874. Sprawę prowadzi Jan Bąkiewicz, ' +
  'inspektor. Zgodnie z art. 104 § 1 Kodeksu postępowania administracyjnego organ rozstrzyga ' +
  'sprawę w drodze decyzji, a strona może wnieść odwołanie w terminie 14 dni od dnia doręczenia. ';

for (const kb of [10, 50, 200]) {
  let t = '';
  while (t.length < kb * 1024) t += `${para}\n`;
  redactPII(t.slice(0, 2000)); // rozgrzewka, żeby pomiar nie liczył kompilacji wyrażeń
  const s = performance.now();
  redactPII(t);
  const ms = performance.now() - s;
  console.log(`${kb} KB: ${ms.toFixed(0)} ms`);
}
