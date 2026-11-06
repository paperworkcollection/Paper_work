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
// EDIT STORE
async function editStore(id) {
  const store = state.stores.find(s => String(idOf(s)) === String(id));

  if (!store) {
    toast('Store not found.', true);
    return;
  }

  openModal(
    'Edit store',
    `<label class="full-field">
      Store name
      <input name="name" required value="${esc(store.name)}">
    </label>`,
    async form => {
      await api(`/api/stores/${encodeURIComponent(id)}`, {
        method:'PATCH',
        body:JSON.stringify({name:form.get('name')})
      });

      await loadStores();
      toast('Store updated.');
    }
  );
}

// ACTIVATE / DEACTIVATE STORE

async function toggleStore(id, active) {
  const action = active ? 'deactivate' : 'activate';

  if (!confirm(`Are you sure you want to ${action} this store?`)) {
    return;
  }

  try {
    await api(`/api/stores/${encodeURIComponent(id)}`, {
      method:'PATCH',
      body:JSON.stringify({active:!active})
    });

    await loadStores();
    toast(`Store ${action}d.`);
  } catch (e) {
    toast(e.message, true);
  }
}

// DELETE STORE

async function deleteStore(id) {
  const store = state.stores.find(s => String(idOf(s)) === String(id));

  if (!store) {
    toast('Store not found.', true);
    return;
  }

  const confirmed = confirm(
    `PERMANENT DELETION\n\n` +
    `Delete "${store.name}"?\n\n` +
    `This action also deletes associated file records and uploaded files. ` +
    `It cannot be undone from Paper Work.\n\n` +
    `Make sure you have a backup before continuing.`
  );

  if (!confirmed) return;

  try {
    await api(`/api/stores/${encodeURIComponent(id)}`, {
      method:'DELETE'
    });

    await loadStores();
    toast('Store deleted.');
  } catch (e) {
    toast(e.message, true);
  }
}

// FILE MANAGEMENT

async function loadUploads() {
  try {
    const docs = await api('/api/documents');
    state.docs = Array.isArray(docs) ? docs : [];

    $('#allUploads').innerHTML =
      state.docs.map(fileRow).join('') ||
      '<div class="empty-state">No uploaded files found.</div>';
  } catch (e) {
    toast(e.message, true);
  }
}

async function editFile(id) {
  const doc = state.docs.find(d => String(idOf(d)) === String(id));

  if (!doc) {
    toast('File record not found. Refresh the list and try again.', true);
    return;
  }

  openModal(
    'Edit file details',
    `<label class="full-field">
      File name
      <input name="originalName" required value="${esc(doc.originalName || '')}">
    </label>
    <label class="full-field">
      Title
      <input name="title" value="${esc(doc.title || '')}">
    </label>
    <label class="full-field">
      Notes
      <textarea name="notes">${esc(doc.notes || '')}</textarea>
    </label>
    <label class="full-field">
      Amount
      <input name="amount" type="number" step="0.01" value="${esc(doc.amount ?? '')}">
    </label>`,
    async form => {
      const amount = form.get('amount');

      await api(`/api/documents/${encodeURIComponent(id)}`, {
        method:'PATCH',
        body:JSON.stringify({
          originalName:form.get('originalName'),
          title:form.get('title'),
          notes:form.get('notes'),
          amount
        })
      });

      await loadUploads();
      await loadHome();
      toast('File details updated.');
    }
  );
}

async function deleteFile(id) {
  const doc = state.docs.find(d => String(idOf(d)) === String(id));

  const confirmed = confirm(
    `Delete "${doc?.originalName || 'this file'}"?\n\n` +
    `This permanently deletes the file record and uploaded file. ` +
    `This cannot be undone.`
  );

  if (!confirmed) return;

  try {
    await api(`/api/documents/${encodeURIComponent(id)}`, {
      method:'DELETE'
    });

    await loadUploads();
    await loadHome();
    toast('File deleted.');
  } catch (e) {
    toast(e.message, true);
  }
}

async function downloadFile(id) {
  try {
    const response = await fetch(
      `/api/documents/${encodeURIComponent(id)}/file`,
      { headers: { Authorization:`Bearer ${state.token}` } }
    );

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'Could not download file.');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = 'paper-work-file';
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  } catch (e) {
    toast(e.message, true);
  }
}

async function previewFile(id) {
  try {
    const response = await fetch(
      `/api/documents/${encodeURIComponent(id)}/file`,
      { headers: { Authorization:`Bearer ${state.token}` } }
    );

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'Could not open file.');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    window.open(url, '_blank', 'noopener');

    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    toast(e.message, true);
  }
}

// USER MANAGEMENT

async function loadUsers() {
  if (!isAdmin()) return;

  try {
    const users = await api('/api/users');

    state.users = Array.isArray(users) ? users : [];

    const host = $('#userList');
    if (!host) return;

    host.innerHTML = state.users.map(user => `
      <div class="upload-row">
        <div class="file-thumb">👤</div>
        <div class="file-info">
          <strong>${esc(user.name)}</strong>
          <span>${esc(user.email)} · ${esc(user.role)}</span>
          <span>${esc(user.store?.name || 'No store assigned')} ·
            ${user.active === false ? 'Inactive' : 'Active'}
          </span>
        </div>
        <button type="button" class="row-action"
          data-edit-user="${esc(user.id)}">Edit</button>
        <button type="button" class="row-action danger-action"
          data-delete-user="${esc(user.id)}">Delete</button>
      </div>
    `).join('') || '<div class="empty-state">No users found.</div>';
  } catch (e) {
    toast(e.message, true);
  }
}

function addUser() {
  const storeOptions = state.stores.map(s =>
    `<option value="${esc(s.id)}">${esc(s.name)}</option>`
  ).join('');

  openModal(
    'Add user',
    `<label class="full-field">Name
      <input name="name" required>
    </label>
    <label class="full-field">Email
      <input name="email" type="email" required>
    </label>
    <label class="full-field">Password (minimum 10 characters)
      <input name="password" type="password" minlength="10" required>
    </label>
    <label class="full-field">Role
      <select name="role">
        <option value="STORE_MANAGER">Store Manager</option>
        <option value="SUPER_ADMIN">Super Admin</option>
      </select>
    </label>
    <label class="full-field">Store
      <select name="storeId">
        <option value="">No store</option>
        ${storeOptions}
      </select>
    </label>`,
    async form => {
      await api('/api/users', {
        method:'POST',
        body:JSON.stringify({
          name:form.get('name'),
          email:form.get('email'),
          password:form.get('password'),
          role:form.get('role'),
          storeId:form.get('storeId') || null
        })
      });

      await loadUsers();
      toast('User created.');
    }
  );
}

async function editUser(id) {
  const user = state.users.find(u => String(u.id) === String(id));

  if (!user) {
    toast('User not found.', true);
    return;
  }

  const storeOptions = state.stores.map(s =>
    `<option value="${esc(s.id)}" ${s.id === user.storeId ? 'selected' : ''}>
      ${esc(s.name)}
    </option>`
  ).join('');

  openModal(
    'Edit user',
    `<label class="full-field">Name
      <input name="name" required value="${esc(user.name)}">
    </label>
    <label class="full-field">Email
      <input name="email" type="email" required value="${esc(user.email)}">
    </label>
    <label class="full-field">New password (leave blank to keep current)
      <input name="password" type="password" minlength="10">
    </label>
    <label class="full-field">Role
      <select name="role">
        <option value="STORE_MANAGER" ${user.role === 'STORE_MANAGER' ? 'selected' : ''}>Store Manager</option>
        <option value="SUPER_ADMIN" ${user.role === 'SUPER_ADMIN' ? 'selected' : ''}>Super Admin</option>
      </select>
    </label>
    <label class="full-field">Store
      <select name="storeId">
        <option value="">No store</option>
        ${storeOptions}
      </select>
    </label>
    <label class="full-field">
      <input type="checkbox" name="active" ${user.active !== false ? 'checked' : ''}>
      Account active
    </label>`,
    async form => {
      const password = form.get('password');

      await api(`/api/users/${encodeURIComponent(id)}`, {
        method:'PATCH',
        body:JSON.stringify({
          name:form.get('name'),
          email:form.get('email'),
          ...(password ? {password} : {}),
          role:form.get('role'),
          storeId:form.get('storeId') || null,
          active:form.get('active') === 'on'
        })
      });

      await loadUsers();
      toast('User updated.');
    }
  );
}

async function deleteUser(id) {
  const user = state.users.find(u => String(u.id) === String(id));

  if (!confirm(
    `Permanently delete user "${user?.name || id}"?\n\nThis cannot be undone.`
  )) return;

  try {
    await api(`/api/users/${encodeURIComponent(id)}`, {
      method:'DELETE'
    });

    await loadUsers();
    toast('User deleted.');
  } catch (e) {
    toast(e.message, true);
  }
}

// GOOGLE DRIVE CONNECTION

async function connectDrive() {
  try {
    const result = await api('/api/drive/connect');

    if (!result.url) {
      throw new Error('Google connection URL was not returned.');
    }

    window.location.href = result.url;
  } catch (e) {
    toast(e.message, true);
  }
}

// EVENT LISTENERS

function bindEvents() {
  $('#loginForm')?.addEventListener('submit', async event => {
    event.preventDefault();

    const button = $('#loginButton');
    if (button?.disabled) return;

    button.disabled = true;

    try {
      await login(
        $('#loginEmail').value.trim(),
        $('#loginPassword').value
      );
    } catch (e) {
      toast(e.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $('#logoutButton')?.addEventListener('click', () => logout());

  $('#sidebarToggle')?.addEventListener('click', toggleMobileMenu);
  $('#sidebarBackdrop')?.addEventListener('click', closeMobileMenu);

  $$('.nav-item,.mobile-nav-item').forEach(el => {
    el.addEventListener('click', () => nav(el.dataset.page));
  });

  $('#addStoreButton')?.addEventListener('click', addStore);
  $('#addUserButton')?.addEventListener('click', addUser);
  $('#connectDrive')?.addEventListener('click', connectDrive);

  $('#storeSearch')?.addEventListener('input', renderStores);

  $('#monthYear')?.addEventListener('change', () => {
    if (state.selectedStore) {
      loadStoreDetail().catch(e => toast(e.message, true));
    }
  });

  $('#modalClose')?.addEventListener('click', () => {
    $('#modalBackdrop').classList.add('hidden');
  });

  $('#modalCancel')?.addEventListener('click', () => {
    $('#modalBackdrop').classList.add('hidden');
  });

  $('#modalBackdrop')?.addEventListener('click', event => {
    if (event.target.id === 'modalBackdrop') {
      $('#modalBackdrop').classList.add('hidden');
    }
  });

  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;

    if (target.dataset.openStore) {
      openStore(target.dataset.openStore);
    }

    if (target.dataset.editStore) {
      editStore(target.dataset.editStore);
    }

    if (target.dataset.toggleStore) {
      toggleStore(
        target.dataset.toggleStore,
        target.dataset.active === 'true'
      );
    }

    if (target.dataset.deleteStore) {
      deleteStore(target.dataset.deleteStore);
    }

    if (target.dataset.month) {
      openMonth(target.dataset.month);
    }

    if (target.dataset.editFile) {
      editFile(target.dataset.editFile);
    }

    if (target.dataset.deleteFile) {
      deleteFile(target.dataset.deleteFile);
    }

    if (target.dataset.download) {
      downloadFile(target.dataset.download);
    }

    if (target.dataset.preview) {
      previewFile(target.dataset.preview);
    }

    if (target.dataset.editUser) {
      editUser(target.dataset.editUser);
    }

    if (target.dataset.deleteUser) {
      deleteUser(target.dataset.deleteUser);
    }
  });
}

// STARTUP

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();

  if (!state.token) {
    showLogin();
    return;
  }

  try {
    const result = await api('/api/auth/me');
    await enter(result.user);
  } catch (e) {
    logout(false);
  }
});

})();
