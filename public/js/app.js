(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const csrf = ($('meta[name="csrf"]') || {}).content || '';
  const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

  // Mobile nav
  const toggle = $('.nav-toggle');
  if (toggle) toggle.addEventListener('click', () => $('.nav-links').classList.toggle('open'));

  // 3D tilt panel mengikuti mouse
  $$('.panel').forEach((el) => {
    el.addEventListener('animationend', () => { el.style.animation = 'none'; }, { once: true });
    if (reduce || !el.hasAttribute('data-tilt')) return;
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(800px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateZ(8px)`;
      el.style.boxShadow = `${7 - x * 8}px ${7 - y * 8}px 0 #111`;
    });
    el.addEventListener('mouseleave', () => { el.style.transform = ''; el.style.boxShadow = ''; });
  });

  // Hero parallax
  const stage = $('.hero-stage');
  if (stage && !reduce) {
    window.addEventListener('mousemove', (e) => {
      const x = e.clientX / window.innerWidth - 0.5;
      const y = e.clientY / window.innerHeight - 0.5;
      $$('[data-depth]', stage).forEach((n) => {
        const d = parseFloat(n.dataset.depth);
        n.style.translate = `${x * d * 40}px ${y * d * 40}px`;
      });
    });
  }

  // Konfirmasi
  document.addEventListener('submit', (e) => {
    const msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // Format input rupiah + tombol nominal cepat
  $$('input[data-rupiah]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const n = inp.value.replace(/\D/g, '');
      inp.value = n ? Number(n).toLocaleString('id-ID') : '';
      inp.dispatchEvent(new CustomEvent('rupiah-change'));
    });
  });
  $$('[data-amount]').forEach((b) =>
    b.addEventListener('click', () => {
      const inp = $(b.dataset.target);
      inp.value = Number(b.dataset.amount).toLocaleString('id-ID');
      inp.dispatchEvent(new Event('input'));
    })
  );

  // Ringkasan penarikan
  const wdAmount = $('#wd-amount');
  if (wdAmount) {
    const fee = Number(wdAmount.dataset.fee);
    const update = () => {
      const n = Number(wdAmount.value.replace(/\D/g, '')) || 0;
      $('#wd-total').textContent = rupiah(n ? n + fee : 0);
    };
    wdAmount.addEventListener('rupiah-change', update);
    update();
  }

  // Cek rekening
  const checkBtn = $('#check-account');
  if (checkBtn) {
    checkBtn.addEventListener('click', async () => {
      const out = $('#account-result');
      out.textContent = 'Mengecek...';
      out.className = 'hint';
      try {
        const res = await fetch('/withdraw/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Accept: 'application/json' },
          body: JSON.stringify({ bank_code: $('#bank_code').value, account_number: $('#account_number').value }),
        });
        const j = await res.json();
        if (j.status) {
          out.textContent = `✅ ${j.data.nama_pemilik || '-'} (${j.data.status || 'valid'})`;
          out.className = 'hint plus';
        } else {
          out.textContent = '❌ ' + (j.message || 'Rekening tidak ditemukan');
          out.className = 'hint minus';
        }
      } catch (e) {
        out.textContent = '❌ Gagal mengecek rekening';
      }
    });
  }

  // Copy
  $$('[data-copy]').forEach((b) =>
    b.addEventListener('click', async () => {
      const text = b.dataset.copy || ($(b.dataset.copyFrom) || {}).textContent || '';
      try {
        await navigator.clipboard.writeText(text.trim());
        const old = b.textContent;
        b.textContent = 'TERSALIN!';
        setTimeout(() => (b.textContent = old), 1500);
      } catch (e) { /* abaikan */ }
    })
  );

  // Tab kode di dokumentasi
  $$('.tabs').forEach((tabs) => {
    const group = tabs.dataset.group;
    $$('.tab', tabs).forEach((t) =>
      t.addEventListener('click', () => {
        const lang = t.dataset.lang;
        $$(`.tabs[data-group="${group}"] .tab`).forEach((x) => x.classList.toggle('active', x.dataset.lang === lang));
        $$(`.tab-body[data-group="${group}"]`).forEach((x) => x.classList.toggle('active', x.dataset.lang === lang));
      })
    );
  });

  // Halaman bayar QRIS: countdown + polling status
  const pay = $('#pay');
  if (pay) {
    const statusUrl = pay.dataset.statusUrl;
    const expires = pay.dataset.expires ? new Date(pay.dataset.expires.replace(' ', 'T') + '+07:00') : null;
    const cd = $('#countdown');
    let done = pay.dataset.status !== 'pending';
    const tick = () => {
      if (!expires || !cd || done) return;
      const s = Math.max(0, Math.floor((expires - Date.now()) / 1000));
      cd.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    tick();
    setInterval(tick, 1000);
    const poll = async () => {
      if (done) return;
      try {
        const j = await (await fetch(statusUrl, { headers: { Accept: 'application/json' } })).json();
        if (j.status && j.data.status !== 'pending') {
          done = true;
          const badge = $('#pay-status');
          badge.textContent = j.data.status.toUpperCase();
          badge.className = 'badge ' + j.data.status;
          if (j.data.status === 'success') {
            pay.classList.add('paid');
            $('#pay-msg').textContent = `Pembayaran diterima! Saldo masuk ${rupiah(j.data.amount_received)}`;
          } else {
            $('#pay-msg').textContent = 'Transaksi ' + j.data.status;
          }
          $$('.hide-when-done').forEach((n) => (n.style.display = 'none'));
        }
      } catch (e) { /* coba lagi */ }
      if (!done) setTimeout(poll, 5000);
    };
    setTimeout(poll, 4000);
  }
})();
