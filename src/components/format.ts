/** Подписи значений ползунков. */
export const percent = (v: number) => `${Math.round(v * 100)}%`;
export const signed = (v: number) => {
  const n = Math.round(v * 100);
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
};
