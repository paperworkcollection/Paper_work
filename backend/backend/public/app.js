
(() => {
  'use strict';

  // Vercel frontend → Render backend
  const API_BASE = 'https://paperwork-wo3n.onrender.com';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const state = {
    token: localStorage.getItem('pw_token') || '',
    user: null,
    stores: [],
    docs: [],
    selectedStore: null
  };

  const isAdmin = () => state.user?.role === 'SUPER_ADMIN';

  const idOf = value =>
    value?.id ?? value?._id ?? value?.storeId ?? null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));

  const formatDate = value => value
    ? new Date(value).toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric'
      })
    : '—';

  function apiUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };

    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }

    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    let response;

    try {
      response = await fetch(apiUrl(path), {
        ...options,
        headers,
        mode: 'cors',
        credentials: 'omit'
      });
    } catch {
      throw new Error(
        'Cannot reach the backend. Check Render status and CORS settings.'
      );
    }

    if (response.status === 401) {
      logout(false);
      throw new Error('Your session expired. Please sign in again.');
    }

    const contentType = response.headers.get('content-type') || '';
    let data = null;

    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      throw new Error(
        data?.error ||
        data?.message ||
        `Request failed (${response.status})`
      );
    }

    return data ?? response;
  }

  function toast(message, bad = false) {
    const element = $('#toast');
    if (!element) return;

    element.textContent = message;
    element.className = `toast show${bad ? ' toast-error' : ''}`;

    clearTimeout(toast.timer);

    toast.timer = setTimeout(() => {
      element.className = 'toast';
    }, 4000);
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
    const sidebar = $('#sidebar');
    if (!sidebar) return;

    const open = sidebar.classList.toggle('open');

    $('#sidebarBackdrop')?.classList.toggle('show', open);
    $('#sidebarToggle')?.setAttribute('aria-expanded', String(open));
  }

  function nav(page) {
    if (!isAdmin() && ['stores', 'store-detail'].includes(page)) {
      page = 'home';
    }

    $$('.page').forEach(element => {
      element.classList.toggle(
        'active',
        element.id === `page-${page}`
      );
    });

    $$('.nav-item,.mobile-nav-item').forEach(element => {
      element.classList.toggle(
        'active',
        element.dataset.page === (
          page === 'store-detail' ? 'stores' : page
        )
      );
    });

    closeMobileMenu();

    const crumb = $('#crumb');

    if (crumb) {
      crumb.textContent = page === 'store-detail'
        ? 'Store details'
        : page.charAt(0).toUpperCase() + page.slice(1);
    }

    if (page === 'home') loadHome();
    if (page === 'stores') loadStores();
    if (page === 'uploads') loadUploads();

    if (page === 'store-detail') {
      loadStoreDetail().catch(error => toast(error.message, true));
    }
  }

  async function enter(user) {
    if (!user) {
      throw new Error('Login response did not include a user.');
    }

    state.user = user;

    if ($('#userName')) {
      $('#userName').textContent = user.name || 'User';
    }

    if ($('#userRole')) {
      $('#userRole').textContent = isAdmin()
        ? 'Super Admin'
        : 'Store Manager';
    }

    if ($('#userAvatar')) {
      $('#userAvatar').textContent =
        (user.name || 'U').charAt(0).toUpperCase();
    }

    $$('[data-admin],.admin-only').forEach(element => {
      element.classList.toggle('hidden', !isAdmin());
    });

    $('#managerPanel')?.classList.toggle('hidden', isAdmin());
    $('#adminHome')?.classList.toggle('hidden', !isAdmin());

    if ($('#recentHeading')) {
      $('#recentHeading').textContent = isAdmin()
        ? 'Recent store uploads'
        : 'My uploaded images and files';
    }

    if ($('#welcomeTitle')) {
      $('#welcomeTitle').textContent =
        `Welcome, ${(user.name || 'User').split(' ')[0]}`;
    }

    const stores = await api('/api/stores');

    state.stores = Array.isArray(stores) ? stores : [];

    showApp();
    nav('home');
  }

  async function login(email, password) {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    if (!result?.token) {
      throw new Error('Server did not return an authentication token.');
    }

    state.token = result.token;

    localStorage.setItem('pw_token', result.token);

    await enter(result.user);
  }

  function fileRow(doc) {
    const fileId = idOf(doc);

    return `
      <div class="upload-row">
        <div class="file-thumb">
          ${doc.mimeType?.startsWith('image/') ? '▧' : '▤'}
        </div>

        <div class="file-info">
          <strong>
            ${esc(doc.originalName || doc.title || 'Uploaded file')}
          </strong>

          <span>
            ${esc(doc.store?.name || 'Your store')}
            · ${formatDate(doc.documentDate || doc.createdAt)}
          </span>
        </div>

        <button type="button"
          class="row-action"
          data-preview="${esc(fileId)}">
          View
        </button>

        <button type="button"
          class="row-action"
          data-download="${esc(fileId)}">
          ↓
        </button>
      </div>
    `;
  }

  async function loadHome() {
    try {
      const docs = await api('/api/documents');

      state.docs = Array.isArray(docs) ? docs : [];

      if ($('#homeUploads')) {
        $('#homeUploads').innerHTML =
          state.docs.slice(0, 10).map(fileRow).join('') ||
          '<div class="empty-state">No uploads yet.</div>';
      }

      if (isAdmin()) {
        if ($('#adminStoreCount')) {
          $('#adminStoreCount').textContent = state.stores.length;
        }

        if ($('#adminFileCount')) {
          $('#adminFileCount').textContent = state.docs.length;
        }

        const drive = await api('/api/drive/status');

        if ($('#driveStatus')) {
          $('#driveStatus').textContent = drive.connected
            ? `Connected${drive.email ? ` as ${drive.email}` : ''}`
            : 'Not connected — connect Google Drive.';
        }

        if ($('#connectDrive')) {
          $('#connectDrive').textContent = drive.connected
            ? 'Reconnect Google Drive'
            : 'Connect Google Drive';
        }
      }
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function loadStores() {
    try {
      const stores = await api('/api/stores');

      state.stores = Array.isArray(stores) ? stores : [];

      renderStores();
    } catch (error) {
      toast(error.message, true);
    }
  }

  function renderStores() {
    const host = $('#storeCards');
    if (!host) return;

    const query = ($('#storeSearch')?.value || '')
      .trim()
      .toLowerCase();

    const matches = state.stores.filter(store =>
      String(store.name || '').toLowerCase().includes(query)
    );

    host.innerHTML = matches.length
      ? matches.map(store => `
          <button type="button"
            class="store-card"
            data-open-store="${esc(idOf(store))}">

            <span class="store-card-icon">▣</span>

            <span class="store-card-text">
              <strong>${esc(store.name || 'Unnamed store')}</strong>
              <small>
                ${Number(store._count?.documents || 0)} uploaded files
              </small>
            </span>

            <span class="store-card-arrow">→</span>
          </button>
        `).join('')
      : '<div class="empty-state">No stores found.</div>';
  }

  async function openStore(id) {
    try {
      if (!id) {
        throw new Error('Store ID is missing.');
      }

      let store = state.stores.find(
        item => String(idOf(item)) === String(id)
      );

      if (!store) {
        const stores = await api('/api/stores');

        state.stores = Array.isArray(stores) ? stores : [];

        store = state.stores.find(
          item => String(idOf(item)) === String(id)
        );
      }

      if (!store) {
        throw new Error('Store not found.');
      }

      state.selectedStore = {
        ...store,
        id: String(idOf(store))
      };

      nav('store-detail');
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function loadStoreDetail() {
    const store = state.selectedStore;
    const storeId = idOf(store);

    if (!store || !storeId) {
      throw new Error('Select a valid store first.');
    }

    if ($('#storeTitle')) {
      $('#storeTitle').textContent = store.name || 'Store details';
    }

    const yearSelect = $('#monthYear');

    if (yearSelect && !yearSelect.options.length) {
      const currentYear = new Date().getFullYear();

      yearSelect.innerHTML =
        Array.from({ length: 12 }, (_, index) => currentYear + 5 - index)
          .map(year => `
            <option value="${year}"
              ${year === currentYear ? 'selected' : ''}>
              ${year}${year === currentYear ? ' (Current year)' : ''}
            </option>
          `).join('');
    }

    const year =
      Number(yearSelect?.value) || new Date().getFullYear();

    const months = [
      'January', 'February', 'March', 'April',
      'May', 'June', 'July', 'August',
      'September', 'October', 'November', 'December'
    ];

    if ($('#monthCards')) {
      $('#monthCards').innerHTML = months.map((month, index) => `
        <button type="button"
          class="month-card"
          data-month="${index + 1}">

          <span>${month}</span>
          <small>${year}</small>
          <b>Open workbook →</b>
        </button>
      `).join('');
    }

    const docs = await api(
      `/api/documents?storeId=${encodeURIComponent(storeId)}`
    );

    if ($('#storeUploads')) {
      $('#storeUploads').innerHTML =
        (Array.isArray(docs) ? docs : []).map(fileRow).join('') ||
        '<div class="empty-state">No files uploaded for this store yet.</div>';
    }
  }

  async function openMonth(month) {
    try {
      const storeId = idOf(state.selectedStore);

      if (!storeId) {
        throw new Error('Select a store first.');
      }

      const year =
        Number($('#monthYear')?.value) || new Date().getFullYear();

      const monthNumber = Number(month);

      if (
        !Number.isInteger(monthNumber) ||
        monthNumber < 1 ||
        monthNumber > 12
      ) {
        throw new Error('Invalid month selected.');
      }

      const result = await api(
        `/api/stores/${encodeURIComponent(storeId)}/monthly.xlsx?year=${year}&month=${monthNumber}`
      );

      const target = result.webViewLink || result.url;

      if (!target) {
        throw new Error(
          result.error || 'Google Drive workbook link was not returned.'
        );
      }

      window.open(target, '_blank', 'noopener');
    } catch (error) {
      toast(error.message, true);
    }
  }

  function openModal(title, fields, submit) {
    if (!$('#modalBackdrop') || !$('#modalForm')) {
      toast('Form dialog is missing from index.html.', true);
      return;
    }

    $('#modalTitle').textContent = title;
    $('#modalFields').innerHTML = fields;
    $('#modalError').textContent = '';

    $('#modalBackdrop').classList.remove('hidden');

    $('#modalForm').onsubmit = async event => {
      event.preventDefault();

      const button = $('#modalSubmit');

      if (button) button.disabled = true;

      try {
        await submit(new FormData(event.currentTarget));

        $('#modalBackdrop').classList.add('hidden');
      } catch (error) {
        $('#modalError').textContent = error.message;
      } finally {
        if (button) button.disabled = false;
      }
    };
  }

  function addStore() {
    openModal(
      'Add a store',
      `
        <label class="full-field">
          Store name
          <input name="name" required placeholder="Enter store name">
        </label>
      `,
      async form => {
        await api('/api/stores', {
          method: 'POST',
          body: JSON.stringify({
            name: form.get('name')
          })
        });

        await loadStores();

        toast('Store added.');
      }
    );
  }

  function createManager() {
    if (!state.stores.length) {
      toast('Add a store before creating a manager login.', true);
      return;
    }

    const options = state.stores.map(store => `
      <option value="${esc(idOf(store))}">
        ${esc(store.name)}
      </option>
    `).join('');

    openModal(
      'Create store login',
      `
        <label class="full-field">
          Manager display name
          <input name="name" required>
        </label>

        <label class="full-field">
          Email address
          <input name="email" type="email" required>
        </label>

        <label class="full-field">
          Temporary password (10+ characters)
          <input name="password" type="password" minlength="10" required>
        </label>

        <label class="full-field">
          Assigned store
          <select name="storeId" required>${options}</select>
        </label>
      `,
      async form => {
        await api('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            name: form.get('name'),
            email: form.get('email'),
            password: form.get('password'),
            role: 'STORE_MANAGER',
            storeId: form.get('storeId')
          })
        });

        toast('Store login created.');
      }
    );
  }

  function attachUploadForm(form, kind, errorId) {
    if (!form) return;

    form.addEventListener('submit', async event => {
      event.preventDefault();

      const file = form.elements.file?.files?.[0];

      if (!file) return;

      const data = new FormData();

      data.append('file', file);
      data.append('kind', kind);

      const now = new Date();

      const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
      ].join('-');

      data.append('documentDate', date);

      const button = form.querySelector(
        'button[type="submit"],button'
      );

      const error = $('#' + errorId);

      if (button) button.disabled = true;
      if (error) error.textContent = '';

      try {
        await api('/api/documents', {
          method: 'POST',
          body: data
        });

        form.reset();

        toast(
          kind === 'DAILY_SHIFT_REPORT'
            ? 'Daily Shift Report uploaded.'
            : 'Other file uploaded.'
        );

        await loadHome();
      } catch (uploadError) {
        if (error) {
          error.textContent = uploadError.message;
        } else {
          toast(uploadError.message, true);
        }
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  async function loadUploads() {
    try {
      const query = encodeURIComponent(
        $('#uploadSearch')?.value || ''
      );

      const date = $('#uploadDate')?.value || '';

      const docs = await api(
        `/api/documents?q=${query}${date ? `&date=${encodeURIComponent(date)}` : ''}`
      );

      if ($('#allUploads')) {
        $('#allUploads').innerHTML =
          (Array.isArray(docs) ? docs : []).map(fileRow).join('') ||
          '<div class="empty-state">No matching uploads.</div>';
      }
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function fileAction(id, preview) {
    let tab = null;

    try {
      if (preview) {
        tab = window.open('about:blank', '_blank');
      }

      const response = await fetch(
        apiUrl(`/api/documents/${encodeURIComponent(id)}/file`),
        {
          headers: {
            Authorization: `Bearer ${state.token}`
          },
          mode: 'cors',
          credentials: 'omit'
        }
      );

      if (!response.ok) {
        let message = `Could not open file (${response.status})`;

        try {
          const data = await response.json();
          message = data.error || data.message || message;
        } catch {}

        throw new Error(message);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      if (preview && tab) {
        tab.location.href = objectUrl;
      } else {
        const anchor = document.createElement('a');

        anchor.href = objectUrl;
        anchor.download = 'paper-work-file';

        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }

      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) {
      if (tab) tab.close();

      toast(error.message, true);
    }
  }

  function on(selector, event, handler) {
    const element = $(selector);

    if (element) {
      element.addEventListener(event, handler);
    }
  }

  // LOGIN
  on('#loginForm', 'submit', async event => {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    if ($('#loginError')) {
      $('#loginError').textContent = '';
    }

    const submit = event.currentTarget.querySelector(
      'button[type="submit"],button'
    );

    if (submit) submit.disabled = true;

    try {
      await login(
        form.get('email'),
        form.get('password')
      );
    } catch (error) {
      if ($('#loginError')) {
        $('#loginError').textContent = error.message;
      } else {
        toast(error.message, true);
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  // NAVIGATION
  on('#logoutBtn', 'click', () => logout());

  $$('.nav-item,.mobile-nav-item').forEach(button => {
    button.addEventListener('click', () => {
      nav(button.dataset.page);
    });
  });

  on('#sidebarToggle', 'click', toggleMobileMenu);
  on('#openStoresHome', 'click', () => nav('stores'));
  on('#sidebarBackdrop', 'click', closeMobileMenu);

  $$('[data-go]').forEach(button => {
    button.addEventListener('click', () => {
      nav(button.dataset.go);
    });
  });

  on('#addStoreBtn', 'click', addStore);
  on('#backStores', 'click', () => nav('stores'));

  on('#monthYear', 'change', () => {
    if (state.selectedStore) {
      loadStoreDetail().catch(error => toast(error.message, true));
    }
  });

  on('#closeModal', 'click', () => {
    $('#modalBackdrop')?.classList.add('hidden');
  });

  on('#cancelModal', 'click', () => {
    $('#modalBackdrop')?.classList.add('hidden');
  });

  on('#storeSearch', 'input', renderStores);
  on('#uploadSearch', 'input', loadUploads);
  on('#uploadDate', 'change', loadUploads);
  on('#createManager', 'click', createManager);

  // GOOGLE DRIVE
  on('#connectDrive', 'click', async () => {
    try {
      const result = await api('/api/drive/connect');

      if (!result.url) {
        throw new Error('Google authorization URL was not returned.');
      }

      window.location.href = result.url;
    } catch (error) {
      toast(error.message, true);
    }
  });

  // UPLOAD FORMS
  attachUploadForm(
    $('#dailyUploadForm'),
    'DAILY_SHIFT_REPORT',
    'dailyError'
  );

  attachUploadForm(
    $('#otherUploadForm'),
    'OTHER_FILE',
    'otherError'
  );

  // DYNAMIC BUTTON ACTIONS
  document.addEventListener('click', event => {
    const target = event.target;

    if (!(target instanceof Element)) return;

    const storeButton = target.closest('[data-open-store]');

    if (storeButton) {
      openStore(storeButton.dataset.openStore);
      return;
    }

    const monthButton = target.closest('[data-month]');

    if (monthButton) {
      openMonth(monthButton.dataset.month);
      return;
    }

    const previewButton = target.closest('[data-preview]');

    if (previewButton) {
      fileAction(previewButton.dataset.preview, true);
      return;
    }

    const downloadButton = target.closest('[data-download]');

    if (downloadButton) {
      fileAction(downloadButton.dataset.download, false);
    }
  });

  // RESTORE SESSION
  (async () => {
    if (!state.token) {
      showLogin();
      return;
    }

    try {
      const result = await api('/api/auth/me');

      await enter(result.user || result);
    } catch {
      logout(false);
    }
  })();

})();
