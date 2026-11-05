// Кнопка своей системы — главная; размер установщика — из ответа сервера.
const platform = navigator.userAgentData?.platform ?? navigator.platform ?? '';
const mine = /win/i.test(platform) ? 'win' : 'mac';
for (const link of document.querySelectorAll('.downloads .button')) {
  const os = link.dataset.os;
  link.classList.toggle('primary', os === mine);
  const meta = document.querySelector(`[data-meta="${os}"]`);
  if (os === mine) {
    link.parentElement.prepend(link);
    meta.parentElement.prepend(meta);
  }
  fetch(link.getAttribute('href'), { method: 'HEAD' })
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      const size = Number(res.headers.get('content-length'));
      if (size) meta.append(` · ${Math.round(size / 1048576)} МБ`);
    })
    .catch(() => {
      // Установщика ещё нет на сервере — кнопка не ведёт в пустоту.
      link.classList.add('missing');
      link.removeAttribute('href');
    });
}
