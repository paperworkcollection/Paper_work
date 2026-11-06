(() => {
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const state = {
  token: localStorage.getItem('pw_token') || '',
  user: null,
  stores: [],
  docs: [],
  selectedStore: null
};

const isAdmin = () => state.user?.role === 'SUPER_ADMIN';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;',
  '<':'&lt;',
  '>':'&gt;',
  '"':'&quot;',
  "'":'&#39;'
}[c]));

const idOf = x => x?.id ?? x?._id ?? x?.storeId ?? null;

const fmt = v => v ? new Date(v).toLocaleDateString('en-US', {
  month:'short',
  day:'2-digit',
  year:'numeric'
}) : '—';

function toast(message, bad = false) {
  const el = $('#toast');
  if (!el) return;

  el.textContent = message;
  el.className = `toast show${bad ? ' toast-error' : ''}`;

  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    el.className = 'toast';
  }, 4000);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    logout(false);
    throw new Error('Your session expired. Please sign in again.');
  }

  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json')
    ? await response.json()
    : null;

  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }

  return data ?? response;
}

function showLogin() {
  $('#loginView')?.classList.remove('hidden');
  $('#appView')?.classList.add('hidden');
}

function showApp() {
  $('#loginView')?.classList.add('hidden');
  $('#appView')?.classList.remove('hidden');
}

function logout(showMessage = true) {
  state.token = '';
  state.user = null;
  state.stores = [];
  state.docs = [];
  state.selectedStore = null;

  localStorage.removeItem('pw_token');
  showLogin();

  if (showMessage) toast('Signed out.');
}

function closeMobileMenu() {
  $('#sidebar')?.classList.remove('open');
  $('#sidebarBackdrop')?.classList.remove('show');
  $('#sidebarToggle')?.setAttribute('aria-expanded', 'false');
}

function toggleMobileMenu() {
  const open = $('#sidebar')?.classList.toggle('open') || false;

  $('#sidebarBackdrop')?.classList.toggle('show', open);
  $('#sidebarToggle')?.setAttribute('aria-expanded', String(open));
}

function nav(page) {
  if (!isAdmin() && ['stores','store-detail'].includes(page)) {
    page = 'home';
  }

  $$('.page').forEach(el =>
    el.classList.toggle('active', el.id === `page-${page}`)
  );

  $$('.nav-item,.mobile-nav-item').forEach(el => {
    el.classList.toggle(
      'active',
      el.dataset.page === (page === 'store-detail' ? 'stores' : page)
    );
  });

  closeMobileMenu();

  const crumb = $('#crumb');

  if (crumb) {
    crumb.textContent = page === 'store-detail'
      ? 'Store details'
      : page[0].toUpperCase() + page.slice(1);
  }

  if (page === 'home') loadHome();
  if (page === 'stores') loadStores();
  if (page === 'uploads') loadUploads();

  if (page === 'store-detail') {
    loadStoreDetail().catch(e => toast(e.message, true));
  }
}

async function enter(user) {
  if (!user) throw new Error('Login response did not include a user.');

  state.user = user;

  $('#userName').textContent = user.name || 'User';
  $('#userRole').textContent = isAdmin() ? 'Super Admin' : 'Store Manager';
  $('#userAvatar').textContent = (user.name || 'U').charAt(0).toUpperCase();

  $$('[data-admin],.admin-only').forEach(el =>
    el.classList.toggle('hidden', !isAdmin())
  );

  $('#managerPanel').classList.toggle('hidden', isAdmin());
  $('#adminHome').classList.toggle('hidden', !isAdmin());

  $('#recentHeading').textContent = isAdmin()
    ? 'Recent store uploads'
    : 'My uploaded images and files';

  $('#welcomeTitle').textContent =
    `Welcome, ${(user.name || 'User').split(' ')[0]}`;

  const stores = await api('/api/stores');

  state.stores = Array.isArray(stores) ? stores : [];

  showApp();
  nav('home');
}

async function login(email, password) {
  const result = await api('/api/auth/login', {
    method:'POST',
    body:JSON.stringify({ email, password })
  });

  state.token = result.token;
  localStorage.setItem('pw_token', result.token);

  await enter(result.user);
}

function fileRow(doc) {
  const fileId = idOf(doc);

  return `<div class="upload-row">
    <div class="file-thumb">
      ${doc.mimeType?.startsWith('image/') ? '▧' : '▤'}
    </div>

    <div class="file-info">
      <strong>${esc(doc.originalName || doc.title || 'Uploaded file')}</strong>
      <span>
        ${esc(doc.store?.name || 'Your store')} ·
        ${fmt(doc.documentDate || doc.createdAt)}
      </span>
    </div>

    <button type="button" class="row-action"
      data-preview="${esc(fileId)}">View</button>

    <button type="button" class="row-action"
      data-download="${esc(fileId)}">↓</button>

    ${isAdmin() ? `
      <button type="button" class="row-action"
        data-edit-file="${esc(fileId)}">Edit</button>

      <button type="button" class="row-action danger-action"
        data-delete-file="${esc(fileId)}">Delete</button>
    ` : ''}
  </div>`;
}

async function loadHome() {
  try {
    const docs = await api('/api/documents');

    state.docs = Array.isArray(docs) ? docs : [];

    $('#homeUploads').innerHTML =
      state.docs.slice(0,10).map(fileRow).join('') ||
      '<div class="empty-state">No uploads yet.</div>';

    if (isAdmin()) {
      $('#adminStoreCount').textContent = state.stores.length;
      $('#adminFileCount').textContent = state.docs.length;

      const drive = await api('/api/drive/status');

      $('#driveStatus').textContent = drive.connected
        ? `Connected${drive.email ? ` as ${drive.email}` : ''}`
        : 'Not connected — connect the Google account for monthly workbooks.';

      $('#connectDrive').textContent = drive.connected
        ? 'Reconnect Google Drive'
        : 'Connect Google Drive';

      await loadUsers();
    }
  } catch (e) {
    toast(e.message, true);
  }
}

// STORE DIRECTORY AND STORE DETAILS

async function loadStores() {
  try {
    const result = await api('/api/stores');

    state.stores = Array.isArray(result) ? result : [];

    renderStores();
  } catch (e) {
    toast(e.message, true);
  }
}

function renderStores() {
  const host = $('#storeCards');
  if (!host) return;

  const query = ($('#storeSearch')?.value || '').trim().toLowerCase();

  const matches = state.stores.filter(s =>
    String(s.name || '').toLowerCase().includes(query)
  );

  host.innerHTML = matches.length
    ? matches.map(store => {
        const storeId = idOf(store);

        return `<div class="store-card-wrap">
          <button type="button" class="store-card"
            data-open-store="${esc(storeId)}">

            <span class="store-card-icon">▣</span>

            <span class="store-card-text">
              <strong>${esc(store.name || 'Unnamed store')}</strong>
              <small>
                ${Number(store._count?.documents || 0)} uploaded files ·
                ${store.active === false ? 'Inactive' : 'Active'}
              </small>
            </span>

            <span class="store-card-arrow">→</span>
          </button>

          <div class="admin-card-actions">
            <button type="button" class="row-action"
              data-edit-store="${esc(storeId)}">Edit</button>

            <button type="button" class="row-action"
              data-toggle-store="${esc(storeId)}"
              data-active="${store.active !== false}">
              ${store.active === false ? 'Activate' : 'Deactivate'}
            </button>

            <button type="button" class="row-action danger-action"
              data-delete-store="${esc(storeId)}">Delete</button>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty-state">No stores found.</div>';
}

async function openStore(id) {
  try {
    if (!id) {
      throw new Error('This store has no ID. Check the /api/stores response.');
    }

    let store = state.stores.find(s =>
      String(idOf(s)) === String(id)
    );

    if (!store) {
      const result = await api('/api/stores');

      state.stores = Array.isArray(result) ? result : [];

      store = state.stores.find(s =>
        String(idOf(s)) === String(id)
      );
    }

    if (!store) {
      throw new Error('Store not found. Refresh the store list and try again.');
    }

    state.selectedStore = {
      ...store,
      id: String(idOf(store))
    };

    nav('store-detail');
  } catch (e) {
    toast(e.message || 'Could not open this store.', true);
  }
}

async function loadStoreDetail() {
  const store = state.selectedStore;
  const storeId = idOf(store);

  if (!store || !storeId) {
    throw new Error('Select a valid store first.');
  }

  $('#storeTitle').textContent = store.name || 'Store details';

  const select = $('#monthYear');

  if (!select.options.length) {
    const currentYear = new Date().getFullYear();

    select.innerHTML = Array.from({length:12}, (_,i) =>
      currentYear + 5 - i
    ).map(y =>
      `<option value="${y}" ${y === currentYear ? 'selected' : ''}>
        ${y}${y === currentYear ? ' (Current year)' : ''}
      </option>`
    ).join('');
  }

  const year = Number(select.value) || new Date().getFullYear();

  const months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];

  $('#monthCards').innerHTML = months.map((month,i) =>
    `<button type="button" class="month-card" data-month="${i+1}">
      <span>${month}</span>
      <small>${year}</small>
      <b>Open workbook →</b>
    </button>`
  ).join('');

  const docs = await api(
    `/api/documents?storeId=${encodeURIComponent(storeId)}`
  );

  $('#storeUploads').innerHTML =
    (Array.isArray(docs) ? docs : []).map(fileRow).join('') ||
    '<div class="empty-state">No files uploaded for this store yet.</div>';
}

// MONTHLY EXCEL WORKBOOK

async function openMonth(month) {
  try {
    const storeId = idOf(state.selectedStore);

    if (!storeId) {
      throw new Error('Select a store before opening a month.');
    }

    const year = Number($('#monthYear').value) || new Date().getFullYear();
    const monthNumber = Number(month);

    if (!Number.isInteger(monthNumber) ||
        monthNumber < 1 ||
        monthNumber > 12) {
      throw new Error('Invalid month selected.');
    }

    const result = await api(
      `/api/stores/${encodeURIComponent(storeId)}/monthly.xlsx?year=${year}&month=${monthNumber}`
    );

    const target = result.webViewLink || result.url;

    if (!target) {
      throw new Error(
        result.error || 'The server did not return a Google Drive workbook link.'
      );
    }

    window.open(target, '_blank', 'noopener');
  } catch (e) {
    toast(e.message || 'Could not open the monthly workbook.', true);
  }
}

// MODAL HELPERS

function openModal(title, fields, submit) {
  let submitting = false;

  $('#modalTitle').textContent = title;
  $('#modalFields').innerHTML = fields;
  $('#modalError').textContent = '';
  $('#modalBackdrop').classList.remove('hidden');

  $('#modalForm').onsubmit = async event => {
    event.preventDefault();

    if (submitting) return;

    submitting = true;

    const button = $('#modalSubmit');
    button.disabled = true;

    try {
      await submit(new FormData(event.currentTarget));
      $('#modalBackdrop').classList.add('hidden');
    } catch (e) {
      $('#modalError').textContent = e.message;
    } finally {
      submitting = false;
      button.disabled = false;
    }
  };
}

// ADD STORE — prevents double submission in the modal.

function addStore() {
  openModal(
    'Add a store',
    '<label class="full-field">Store name<input name="name" required placeholder="Enter store name"></label>',
    async form => {
      await api('/api/stores', {
        method:'POST',
        body:JSON.stringify({name:form.get('name')})
      });

      await loadStores();
      toast('Store added.');
    }
  );
}
