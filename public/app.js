let isAdmin = false;
let items = [];

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  await loadItems();

  // If URL is /admin and not logged in, show login modal
  if (window.location.pathname.startsWith('/admin') && !isAdmin) {
    openLoginModal();
  }
});

// --- Auth ---
async function checkAuth() {
  const res = await fetch('/api/auth/check');
  const data = await res.json();
  isAdmin = data.isAdmin;
  updateUI();
}

function updateUI() {
  document.getElementById('admin-bar').classList.toggle('hidden', !isAdmin);
}

function openLoginModal() {
  document.getElementById('login-form').reset();
  document.getElementById('login-error').classList.add('hidden');
  openModal('login-modal');
}

function closeLoginAndGoHome() {
  closeModal('login-modal');
  if (!isAdmin) {
    history.replaceState(null, '', '/');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      errorEl.textContent = 'Неверное имя пользователя или пароль';
      errorEl.classList.remove('hidden');
      return;
    }

    isAdmin = true;
    updateUI();
    closeModal('login-modal');
    renderItems();
  } catch (err) {
    errorEl.textContent = 'Ошибка соединения';
    errorEl.classList.remove('hidden');
  }
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  isAdmin = false;
  updateUI();
  history.replaceState(null, '', '/');
  renderItems();
}

// --- Items ---
async function loadItems() {
  const res = await fetch('/api/items');
  items = await res.json();
  renderItems();
}

function renderItems() {
  const grid = document.getElementById('items-grid');
  const empty = document.getElementById('empty-state');
  const title = document.getElementById('gifts-title');

  if (items.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    title.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  title.classList.remove('hidden');

  grid.innerHTML = items.map(item => {
    const photoHTML = item.photo
      ? `<img class="card-photo" src="${item.photo}" alt="${escapeHtml(item.name)}">`
      : `<div class="card-photo-placeholder">&#127873;</div>`;

    const typeHTML = item.type
      ? `<span class="card-type">${escapeHtml(item.type)}</span>`
      : '';

    const descHTML = item.description
      ? `<div class="card-description">${escapeHtml(item.description)}</div>`
      : '';

    const priceHTML = item.price !== null && item.price !== undefined
      ? `<div class="card-price">${formatPrice(item.price)}</div>`
      : '';

    let progressHTML = '';
    if (item.price && item.funded > 0) {
      const pct = Math.min(item.funded / item.price * 100, 100);
      if (item.funded >= item.price) {
        progressHTML = `<span class="badge-funded">&#10003; Полностью профинансировано</span>`;
      } else {
        progressHTML = `
          <div class="card-progress"><div class="card-progress-bar" style="width:${pct}%"></div></div>
          <div class="card-progress-text">${formatPrice(item.funded)} / ${formatPrice(item.price)}</div>`;
      }
    }

    const linkHTML = item.link
      ? `<a class="card-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Где купить &rarr;</a>`
      : '';

    const reservedBadge = item.reserved
      ? `<span class="badge-reserved">&#10003; Зарезервировано</span>`
      : '';

    const adminBtns = isAdmin
      ? `<div class="card-admin-actions">
           <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); openEditModal('${item.id}')">Редактировать</button>
           <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); confirmDelete('${item.id}')">Удалить</button>
         </div>`
      : '';

    // User action buttons (not for admin)
    let userActionBtns = '';
    if (!isAdmin) {
      if (!item.reserved) {
        const hasPrice = item.price !== null && item.price !== undefined && item.price > 0;
        const contributeBtn = hasPrice && item.funded < item.price
          ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); openDetailModal('${item.id}')">Внести вклад</button>`
          : '';
        userActionBtns = `
          <div class="card-user-actions">
            <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); quickReserve('${item.id}')">Зарезервировать</button>
            ${contributeBtn}
          </div>`;
      } else {
        userActionBtns = `
          <div class="card-user-actions">
            <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); quickUnreserve('${item.id}')">Отменить резервацию</button>
          </div>`;
      }
    }

    return `
      <div class="card ${item.reserved ? 'reserved' : ''}" onclick="openDetailModal('${item.id}')">
        ${photoHTML}
        <div class="card-body">
          ${reservedBadge}
          <div class="card-name">${escapeHtml(item.name)}</div>
          ${typeHTML}
          ${descHTML}
          ${priceHTML}
          ${progressHTML}
          ${linkHTML}
          ${userActionBtns}
          ${adminBtns}
        </div>
      </div>`;
  }).join('');
}

// --- Add / Edit ---
function openAddModal() {
  document.getElementById('item-modal-title').textContent = 'Добавить подарок';
  document.getElementById('item-form').reset();
  document.getElementById('item-id').value = '';
  document.getElementById('current-photo').classList.add('hidden');
  openModal('item-modal');
}

function openEditModal(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;

  document.getElementById('item-modal-title').textContent = 'Редактировать подарок';
  document.getElementById('item-id').value = item.id;
  document.getElementById('item-name').value = item.name;
  document.getElementById('item-link').value = item.link || '';
  document.getElementById('item-price').value = item.price ?? '';
  document.getElementById('item-type').value = item.type || '';
  document.getElementById('item-description').value = item.description || '';
  document.getElementById('item-photo').value = '';

  const currentPhoto = document.getElementById('current-photo');
  if (item.photo) {
    document.getElementById('current-photo-img').src = item.photo;
    currentPhoto.classList.remove('hidden');
  } else {
    currentPhoto.classList.add('hidden');
  }

  openModal('item-modal');
}

async function handleItemSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('item-id').value;
  const formData = new FormData();
  formData.append('name', document.getElementById('item-name').value);
  formData.append('link', document.getElementById('item-link').value);
  formData.append('price', document.getElementById('item-price').value);
  formData.append('type', document.getElementById('item-type').value);
  formData.append('description', document.getElementById('item-description').value);

  const photoFile = document.getElementById('item-photo').files[0];
  if (photoFile) {
    formData.append('photo', photoFile);
  }

  const url = id ? `/api/items/${id}` : '/api/items';
  const method = id ? 'PUT' : 'POST';

  const res = await fetch(url, { method, body: formData });
  if (res.ok) {
    closeModal('item-modal');
    await loadItems();
  } else {
    const err = await res.json().catch(() => ({}));
    alert(err.error || 'Не удалось сохранить');
  }
}

// --- Detail Modal ---
function openDetailModal(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;

  // Photo
  const photoEl = document.getElementById('detail-photo');
  if (item.photo) {
    photoEl.src = item.photo;
    photoEl.classList.remove('hidden');
  } else {
    photoEl.classList.add('hidden');
  }

  // Badge
  const badgeEl = document.getElementById('detail-badge');
  badgeEl.classList.toggle('hidden', !item.reserved);

  // Admin: show who reserved
  const reservedByEl = document.getElementById('detail-admin-reserved-by');
  if (isAdmin && item.reserved && item.reservedBy) {
    reservedByEl.textContent = `Зарезервировано: ${item.reservedBy}`;
    reservedByEl.classList.remove('hidden');
  } else {
    reservedByEl.classList.add('hidden');
  }

  // Name, type, description, price, link
  document.getElementById('detail-name').textContent = item.name;

  const typeEl = document.getElementById('detail-type');
  if (item.type) {
    typeEl.textContent = item.type;
    typeEl.classList.remove('hidden');
  } else {
    typeEl.classList.add('hidden');
  }

  const descEl = document.getElementById('detail-description');
  if (item.description) {
    descEl.textContent = item.description;
    descEl.classList.remove('hidden');
  } else {
    descEl.classList.add('hidden');
  }

  const priceEl = document.getElementById('detail-price');
  if (item.price !== null && item.price !== undefined) {
    priceEl.textContent = formatPrice(item.price);
    priceEl.classList.remove('hidden');
  } else {
    priceEl.classList.add('hidden');
  }

  const linkEl = document.getElementById('detail-link');
  if (item.link) {
    linkEl.href = item.link;
    linkEl.textContent = 'Где купить \u2192';
    linkEl.classList.remove('hidden');
  } else {
    linkEl.classList.add('hidden');
  }

  // Reserve & donate section
  const section = document.getElementById('detail-reserve-section');
  const hasPrice = item.price !== null && item.price !== undefined && item.price > 0;

  let detailProgressHTML = '';
  if (hasPrice && item.funded > 0) {
    const pct = Math.min(item.funded / item.price * 100, 100);
    if (item.funded >= item.price) {
      detailProgressHTML = `<span class="badge-funded">&#10003; Полностью профинансировано</span>`;
    } else {
      detailProgressHTML = `
        <div class="detail-progress"><div class="detail-progress-bar" style="width:${pct}%"></div></div>
        <div class="detail-progress-text">${formatPrice(item.funded)} / ${formatPrice(item.price)}</div>`;
    }
  }

  if (!item.reserved) {
    const donateBtn = hasPrice
      ? `<button class="btn btn-outline btn-full" onclick="showDonateForm('${item.id}')" style="margin-top:8px">Внести вклад</button>`
      : '';

    const donateForm = hasPrice
      ? `<div id="donate-form" class="donate-form hidden">
          <div class="form-group">
            <label for="donate-phone">Ваш номер телефона</label>
            <input type="tel" id="donate-phone" placeholder="+7 (999) 123-45-67" required>
          </div>
          <div class="form-group">
            <label for="donate-name">Ваше имя (необязательно)</label>
            <input type="text" id="donate-name" placeholder="Ваше имя">
          </div>
          <div class="form-group">
            <label for="donate-amount">Сумма (&#8381;)</label>
            <input type="number" id="donate-amount" min="1" step="1" required>
          </div>
          <div id="donate-error" class="form-error hidden"></div>
          <button class="btn btn-primary btn-full" onclick="handleDonate('${item.id}')">Подтвердить вклад</button>
        </div>`
      : '';

    const cancelDonateBtn = hasPrice && item.funded > 0
      ? `<button class="btn btn-outline btn-full" onclick="showUndonateForm('${item.id}')" style="margin-top:8px">Отменить мой вклад</button>
         <div id="undonate-form" class="phone-form hidden">
           <div class="form-group">
             <label for="undonate-phone">Ваш номер телефона</label>
             <input type="tel" id="undonate-phone" placeholder="+7 (999) 123-45-67" required>
           </div>
           <div id="undonate-error" class="form-error hidden"></div>
           <button class="btn btn-outline btn-full" onclick="handleUndonate('${item.id}')">Подтвердить отмену</button>
         </div>`
      : '';

    section.innerHTML = `
      ${detailProgressHTML}
      <button class="btn btn-primary btn-full" onclick="showReservePhone('${item.id}')">Зарезервировать подарок</button>
      <div id="reserve-phone-form" class="phone-form hidden">
        <div class="form-group">
          <label for="reserve-phone">Ваш номер телефона</label>
          <input type="tel" id="reserve-phone" placeholder="+7 (999) 123-45-67" required>
        </div>
        <button class="btn btn-primary btn-full" onclick="handleReserve('${item.id}')">Подтвердить резервацию</button>
      </div>
      ${donateBtn}
      ${donateForm}
      ${cancelDonateBtn}
      <div id="detail-donors-container"></div>`;
  } else if (isAdmin) {
    section.innerHTML = `
      ${detailProgressHTML}
      <button class="btn btn-outline btn-full" onclick="handleAdminUnreserve('${item.id}')">Снять резервацию</button>
      <div id="detail-donors-container"></div>`;
  } else {
    section.innerHTML = `
      ${detailProgressHTML}
      <button class="btn btn-outline btn-full" onclick="showUnreservePhone('${item.id}')">Отменить резервацию</button>
      <div id="unreserve-phone-form" class="phone-form hidden">
        <div class="form-group">
          <label for="unreserve-phone">Ваш номер телефона</label>
          <input type="tel" id="unreserve-phone" placeholder="+7 (999) 123-45-67" required>
        </div>
        <div id="unreserve-error" class="form-error hidden"></div>
        <button class="btn btn-outline btn-full" onclick="handleUnreserve('${item.id}')">Подтвердить отмену</button>
      </div>
      <div id="detail-donors-container"></div>`;
  }

  // Load donor list if item has a price
  if (hasPrice) {
    loadDonors(item.id);
  }

  openModal('detail-modal');
}

function showReservePhone() {
  const form = document.getElementById('reserve-phone-form');
  form.classList.remove('hidden');
  document.getElementById('reserve-phone').focus();
}

function showUnreservePhone() {
  const form = document.getElementById('unreserve-phone-form');
  form.classList.remove('hidden');
  document.getElementById('unreserve-phone').focus();
}

async function handleReserve(id) {
  const phone = document.getElementById('reserve-phone').value.trim();
  if (!phone) return;

  const res = await fetch(`/api/items/${id}/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });

  if (res.ok) {
    closeModal('detail-modal');
    await loadItems();
  } else {
    const data = await res.json();
    alert(data.error || 'Не удалось зарезервировать');
  }
}

async function handleUnreserve(id) {
  const phone = document.getElementById('unreserve-phone').value.trim();
  if (!phone) return;

  const errorEl = document.getElementById('unreserve-error');
  const res = await fetch(`/api/items/${id}/unreserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });

  if (res.ok) {
    closeModal('detail-modal');
    await loadItems();
  } else {
    const data = await res.json();
    errorEl.textContent = data.error || 'Не удалось отменить резервацию';
    errorEl.classList.remove('hidden');
  }
}

async function handleAdminUnreserve(id) {
  const res = await fetch(`/api/items/${id}/unreserve`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if (res.ok) {
    closeModal('detail-modal');
    await loadItems();
  }
}

// Quick actions from card
function quickReserve(id) {
  openDetailModal(id);
  setTimeout(() => showReservePhone(), 100);
}

function quickUnreserve(id) {
  openDetailModal(id);
  setTimeout(() => showUnreservePhone(), 100);
}

// --- Donations ---
function showDonateForm() {
  const form = document.getElementById('donate-form');
  form.classList.remove('hidden');
  document.getElementById('donate-phone').focus();
}

function showUndonateForm() {
  const form = document.getElementById('undonate-form');
  form.classList.remove('hidden');
  document.getElementById('undonate-phone').focus();
}

async function handleDonate(id) {
  const phone = document.getElementById('donate-phone').value.trim();
  const name = document.getElementById('donate-name').value.trim();
  const amount = parseInt(document.getElementById('donate-amount').value, 10);
  const errorEl = document.getElementById('donate-error');

  if (!phone) { errorEl.textContent = 'Требуется номер телефона'; errorEl.classList.remove('hidden'); return; }
  if (!amount || amount <= 0) { errorEl.textContent = 'Сумма должна быть больше 0'; errorEl.classList.remove('hidden'); return; }

  const res = await fetch(`/api/items/${id}/donate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, name, amount })
  });

  if (res.ok) {
    closeModal('detail-modal');
    await loadItems();
  } else {
    const data = await res.json();
    errorEl.textContent = data.error || 'Не удалось внести вклад';
    errorEl.classList.remove('hidden');
  }
}

async function handleUndonate(id) {
  const phone = document.getElementById('undonate-phone').value.trim();
  if (!phone) return;

  const errorEl = document.getElementById('undonate-error');
  const res = await fetch(`/api/items/${id}/undonate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });

  if (res.ok) {
    closeModal('detail-modal');
    await loadItems();
  } else {
    const data = await res.json();
    errorEl.textContent = data.error || 'Вклады для этого телефона не найдены';
    errorEl.classList.remove('hidden');
  }
}

async function loadDonors(itemId) {
  const container = document.getElementById('detail-donors-container');
  if (!container) return;

  // Admin (birthday person) should not see donors
  if (isAdmin) { container.innerHTML = ''; return; }

  const res = await fetch(`/api/items/${itemId}/donations`);
  const donors = await res.json();

  if (donors.length === 0) {
    container.innerHTML = '';
    return;
  }

  const donorRows = donors.map(d => {
    const nameDisplay = d.name || 'Аноним';
    return `
      <div class="donor-item">
        <div class="donor-info">
          <span class="donor-name">${escapeHtml(nameDisplay)}</span>
        </div>
        <span class="donor-amount">${formatPrice(d.amount)}</span>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="detail-donors">
      <div class="detail-donors-title">Вкладчики</div>
      ${donorRows}
    </div>`;
}

// --- Delete ---
function confirmDelete(id) {
  const item = items.find(i => i.id === id);
  document.getElementById('confirm-title').textContent = 'Удалить подарок';
  document.getElementById('confirm-text').textContent = `Удалить "${item?.name}"?`;

  const okBtn = document.getElementById('confirm-ok');
  okBtn.onclick = async () => {
    await fetch(`/api/items/${id}`, { method: 'DELETE' });
    closeModal('confirm-modal');
    await loadItems();
  };

  openModal('confirm-modal');
}

// --- Modal helpers ---
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  document.body.style.overflow = '';
}

// Close modal only if both mousedown and mouseup were on the overlay
let mouseDownTarget = null;
document.addEventListener('mousedown', (e) => { mouseDownTarget = e.target; });
document.addEventListener('mouseup', (e) => {
  if (mouseDownTarget === e.target && e.target.classList.contains('modal-overlay')) {
    e.target.classList.add('hidden');
    document.body.style.overflow = '';
    if (!isAdmin) history.replaceState(null, '', '/');
  }
  mouseDownTarget = null;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => {
      m.classList.add('hidden');
    });
    document.body.style.overflow = '';
    if (!isAdmin) history.replaceState(null, '', '/');
  }
});

// --- Utils ---
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatPrice(price) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0
  }).format(price);
}
