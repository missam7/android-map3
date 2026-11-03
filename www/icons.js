/* مجموعه‌ی آیکون‌های خطی (۲۴×۲۴) — یک سبک واحد برای کل برنامه */
(function (root) {
'use strict';
const FM = root.FM || (root.FM = {});
const P = {
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.2"/><path d="M12 7.6h.01" stroke-width="2.6"/>',
  traffic: '<rect x="7.5" y="2.5" width="9" height="19" rx="3.2"/><circle cx="12" cy="7.3" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="16.7" r="1.3" fill="currentColor"/>',
  locate: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.6"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-10Z"/>',
  pen: '<path d="M4 20h4L19.5 8.5l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  route: '<circle cx="6" cy="18" r="2.3"/><circle cx="18" cy="6" r="2.3"/><path d="M8.3 18H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h5.7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>', down: '<path d="m6 9 6 6 6-6"/>', left: '<path d="m15 6-6 6 6 6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13 7 4 4"/>',
  target: '<circle cx="12" cy="12" r="6"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
  flag: '<path d="M5.5 21V4"/><path d="M5.5 5h12l-2.6 4 2.6 4h-12"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>', upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 20h14"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21Z"/><circle cx="12" cy="10" r="2.4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>', car: '<path d="M5 16V11l2-5h10l2 5v5M5 16h14M5 16v2.5M19 16v2.5"/><circle cx="8" cy="13.5" r=".9" fill="currentColor"/><circle cx="16" cy="13.5" r=".9" fill="currentColor"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6L12 3Z"/>', file: '<path d="M7 3h7l4 4v14H7V3Z"/><path d="M14 3v4h4"/>',
  map: '<path d="m9 4-5.5 2v14L9 18l6 2 5.5-2V4L15 6 9 4Z"/><path d="M9 4v14M15 6v14"/>', navigate: '<path d="m12 3 7 17-7-4-7 4 7-17Z"/>',
  more: '<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>'
};
function icon(name, size) {
  const n = size || 22;
  return `<svg class="ic" viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
function applyIcons(scope) {
  (scope || document).querySelectorAll('[data-icon]').forEach((e) => {
    if (e.dataset.iconDone) return; e.dataset.iconDone = '1';
    e.insertAdjacentHTML('afterbegin', icon(e.dataset.icon, +e.dataset.iconSize || 22));
  });
}
FM.icon = icon; FM.applyIcons = applyIcons;
})(window);
