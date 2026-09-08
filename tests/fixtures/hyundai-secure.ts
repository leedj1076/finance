// Synthetic statement only. Ciphertext generated independently with OpenSSL
// SEED-CBC (not the application's JS decryptor). No real card/customer data.
export const HYUNDAI_TEST_PASSWORD = 'fixture-only-pass'
export const HYUNDAI_TEST_PARTS = [
  'BwcHBwcHBwcHBwcHBwcHB4nSlXmy0N9uKQ8xmp3xh2Xm1vrXVYZikWU8jpH16vFG3WFkxHhTcjJR5R4wkvDHOpM4OIu468fcjLvAI3Krbn4oUqsLq/OmBqxs6ikQROY4Y/ejDEkPp0+HsmWwS/DBp6Z8b5cLm4Uv/slfS3hVyzefC/55OHfvlJb9EWZhf5CZvM/HWahN2BU4B/AqKx7SJ4tt0Fek/9rm1j14ltkG9083xRPNAI4v7BTo7U4rkjIw/bPG7M1/W9qIRTEtklbqQ1MIYO4xL06UCN1IdHxR0cY=',
  'BwcHBwcHBwcHBwcHBwcHB4nSlXmy0N9uKQ8xmp3xh2VHcJGrs1s+5zrgmOtRtRkoCcuuQWMnxKd8xAsl8P8B2ePHG0fuJMtPMAiuv6Q6o26VaUWF1ZUvhnrc3n4obGkEisO3zwVr0c20gu3C/3ErnB2esBdaFbCN44i4pxsCH06g/iuZ/9qv7jKliH1J1yoL/eOFqmuFEgSyAqgsZ6IW/0xHhfXLVd7fEWMxaO34GeZ57jCnbVjotOeHxZhBqc9CMGICD3IXk7OThk7XkdF2jYA8YW+X37lsyAR+gaEOUKqAPuLfFcVcGY3UhRW3qIBXvQH7tTEOsPIH7PLLXm/3wSIq2yWIuxjIOtrKs2Rvj9sjqWB47wOXt7nb3MZqTJeFHnwhwx4nXIqNtiVqyVpoTrvaPyrTmwLqlEiO3lYfeVs=',
]

export function secureHyundaiFixture(parts = HYUNDAI_TEST_PARTS) {
  return `<html><script>/* VestMail */ var s = new Array();
${parts.map((part, index) => `s[${index}] = "${part}";`).join('\n')}
throw new Error('Embedded scripts must never execute');
</script></html>`
}
