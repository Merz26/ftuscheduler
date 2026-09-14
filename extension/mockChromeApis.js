// Interactive Chrome APIs for Studio Preview & Standalone Web Testing

(function() {
  // If running inside a genuine Chrome Extension with native runtime id, do not mock!
  const isGenuineExtension = typeof chrome !== 'undefined' && 
                             chrome.runtime && 
                             chrome.runtime.id && 
                             !chrome.runtime.__isMock &&
                             typeof chrome.runtime.getURL === 'function';

  if (isGenuineExtension) {
    console.log('[FTU Sync] Genuine Chrome Extension environment detected.');
    return;
  }

  // Ensure no pre-baked test credentials
  try {
    if (localStorage.getItem('studentId') === JSON.stringify('2415115057')) {
      localStorage.removeItem('studentId');
      localStorage.removeItem('password');
      localStorage.removeItem('portalToken');
      localStorage.removeItem('portalTokenExpiresAt');
      localStorage.removeItem('portalVerification');
      localStorage.removeItem('studentProfile');
    }
  } catch (e) {
    console.warn('[Mock] localStorage check failed:', e);
  }

  function safeParse(val, fallback) {
    if (val === null || val === undefined) return fallback;
    try {
      return JSON.parse(val);
    } catch (e) {
      return val;
    }
  }

  const mockRuntime = {
    __isMock: true,
    getManifest: () => ({
      version: '1.4.0',
      oauth2: {
        client_id: '1068393903577-5g3l76neofv7fgdtkshfpcqcf9rprh1n.apps.googleusercontent.com',
        scopes: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile'
        ]
      }
    }),
    getURL: (path) => path,
    lastError: null,
    sendMessage: (msg, callback) => {
      console.log('[Mock chrome.runtime.sendMessage]', msg);
      if (typeof callback === 'function') {
        setTimeout(() => callback({ success: true }), 0);
      }
    },
    onMessage: {
      addListener: () => {},
      removeListener: () => {}
    }
  };

  const mockStorage = {
    local: {
      get: (keys, callback) => {
        return new Promise((resolve) => {
          let res = {};
          try {
            if (typeof keys === 'string') {
              res[keys] = safeParse(localStorage.getItem(keys), undefined);
            } else if (Array.isArray(keys)) {
              keys.forEach(k => {
                res[k] = safeParse(localStorage.getItem(k), undefined);
              });
            } else if (typeof keys === 'object' && keys !== null) {
              Object.keys(keys).forEach(k => {
                res[k] = safeParse(localStorage.getItem(k), keys[k]);
              });
            } else {
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k) res[k] = safeParse(localStorage.getItem(k), undefined);
              }
            }
          } catch (err) {
            console.warn('[Mock Storage] Error reading localStorage:', err);
          }

          if (typeof callback === 'function') {
            setTimeout(() => callback(res), 0);
          }
          resolve(res);
        });
      },
      set: (items, callback) => {
        return new Promise((resolve) => {
          try {
            if (items && typeof items === 'object') {
              Object.entries(items).forEach(([k, v]) => {
                try {
                  localStorage.setItem(k, JSON.stringify(v));
                } catch (e) {
                  localStorage.setItem(k, String(v));
                }
              });
            }
          } catch (err) {
            console.warn('[Mock Storage] Error writing localStorage:', err);
          }

          if (typeof callback === 'function') {
            setTimeout(callback, 0);
          }
          resolve();
        });
      },
      remove: (keys, callback) => {
        return new Promise((resolve) => {
          try {
            const arr = Array.isArray(keys) ? keys : [keys];
            arr.forEach(k => localStorage.removeItem(k));
          } catch (err) {
            console.warn('[Mock Storage] Error removing localStorage:', err);
          }

          if (typeof callback === 'function') {
            setTimeout(callback, 0);
          }
          resolve();
        });
      },
      clear: (callback) => {
        return new Promise((resolve) => {
          localStorage.clear();
          if (typeof callback === 'function') setTimeout(callback, 0);
          resolve();
        });
      }
    }
  };

  const mockIdentity = {
    getRedirectURL: () => 'https://lcjcknmplgfjdldbhgbaefbmheokkbdo.chromiumapp.org/',
    removeCachedAuthToken: ({ token }, callback) => {
      try {
        localStorage.removeItem('googleAccount');
      } catch (e) {}
      if (typeof callback === 'function') callback();
    },
    getAuthToken: (options, callback) => {
      let storedToken = null;
      try {
        const stored = localStorage.getItem('googleAccount');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.token) storedToken = parsed.token;
        }
      } catch (e) {}

      if (storedToken) {
        if (typeof callback === 'function') callback(storedToken);
        return;
      }

      if (options && options.interactive) {
        mockIdentity.launchWebAuthFlow({ interactive: true }, (url) => {
          if (url && url.includes('access_token=')) {
            const tok = new URL(url.replace('#', '?')).searchParams.get('access_token');
            if (typeof callback === 'function') callback(tok);
          } else {
            if (typeof callback === 'function') callback(null);
          }
        });
      } else {
        if (typeof callback === 'function') callback(null);
      }
    },
    launchWebAuthFlow: (options, callback) => {
      console.log('[Identity] Launching OAuth Sign-In flow modal');

      // Create modal container
      const modal = document.createElement('div');
      modal.id = 'mock_oauth_modal';
      modal.style.position = 'fixed';
      modal.style.inset = '0';
      modal.style.backgroundColor = 'rgba(0,0,0,0.6)';
      modal.style.display = 'flex';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      modal.style.zIndex = '999999';
      modal.style.padding = '16px';

      modal.innerHTML = `
        <div style="background:#ffffff; color:#1f2937; border-radius:12px; max-width:340px; width:100%; padding:20px; box-shadow:0 10px 25px rgba(0,0,0,0.25); font-family:system-ui,-apple-system,sans-serif; user-select:auto;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
            <div style="font-size:24px;">🇬</div>
            <div>
              <h3 style="margin:0; font-size:16px; font-weight:700;">Sign in with Google</h3>
              <p style="margin:0; font-size:12px; color:#6b7280;">Google Calendar Integration</p>
            </div>
          </div>
          <p style="font-size:13px; margin:0 0 14px 0; color:#4b5563; line-height:1.4;">
            Xác nhận tài khoản Google để phân quyền đồng bộ với Google Calendar:
          </p>
          <div style="margin-bottom:12px;">
            <label style="display:block; font-size:11px; font-weight:600; text-transform:uppercase; color:#6b7280; margin-bottom:4px;">Gmail Address</label>
            <input type="email" id="modal_google_email" value="lehoangphuc.contact@gmail.com" style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:13px;" />
          </div>
          <div style="margin-bottom:14px;">
            <label style="display:block; font-size:11px; font-weight:600; text-transform:uppercase; color:#6b7280; margin-bottom:4px;">Display Name</label>
            <input type="text" id="modal_google_name" value="Lê Hoàng Phúc" style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:13px;" />
          </div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <button id="modal_btn_confirm" style="background:#dc2626; color:white; border:none; padding:9px 12px; border-radius:6px; font-weight:600; font-size:13px; cursor:pointer;">
              Xác nhận kết nối Google
            </button>
            <button id="modal_btn_cancel" style="background:transparent; color:#6b7280; border:1px solid #e5e7eb; padding:8px 12px; border-radius:6px; font-size:13px; cursor:pointer;">
              Hủy bỏ
            </button>
          </div>
        </div>
      `;

      const target = document.body || document.documentElement;
      target.appendChild(modal);

      modal.querySelector('#modal_btn_confirm').onclick = () => {
        const email = modal.querySelector('#modal_google_email').value.trim() || 'lehoangphuc.contact@gmail.com';
        const name = modal.querySelector('#modal_google_name').value.trim() || 'Google User';
        const fakeToken = 'ya29.studio_' + btoa(email) + '_' + Date.now();
        
        try {
          localStorage.setItem('googleAccount', JSON.stringify({
            token: fakeToken,
            email,
            name,
            picture: null,
            authorizedAt: new Date().toISOString()
          }));
        } catch (e) {}

        if (modal.parentNode) modal.parentNode.removeChild(modal);
        if (typeof callback === 'function') {
          callback(`https://lcjcknmplgfjdldbhgbaefbmheokkbdo.chromiumapp.org/#access_token=${encodeURIComponent(fakeToken)}&token_type=Bearer&expires_in=3600`);
        }
      };

      modal.querySelector('#modal_btn_cancel').onclick = () => {
        if (modal.parentNode) modal.parentNode.removeChild(modal);
        mockRuntime.lastError = { message: 'User cancelled Google sign-in' };
        if (typeof callback === 'function') callback(null);
      };
    }
  };

  const mockAlarms = {
    create: (name, options) => console.log('[Mock alarm created]', name, options),
    clear: (name, callback) => { if (typeof callback === 'function') callback(true); },
    get: (name, callback) => { if (typeof callback === 'function') callback(null); }
  };

  const mockNotifications = {
    create: (id, options, callback) => {
      console.log('[Mock notification]', id, options);
      if (typeof callback === 'function') callback(id || 'mock-id');
    }
  };

  const mockOffscreen = {
    createDocument: () => Promise.resolve(),
    closeDocument: () => Promise.resolve()
  };

  // Safely mount to window.chrome without replacing read-only object
  try {
    if (typeof window.chrome !== 'object' || window.chrome === null) {
      window.chrome = {};
    }
  } catch (e) {}

  const apis = {
    runtime: mockRuntime,
    storage: mockStorage,
    identity: mockIdentity,
    alarms: mockAlarms,
    notifications: mockNotifications,
    offscreen: mockOffscreen
  };

  Object.entries(apis).forEach(([key, val]) => {
    try {
      if (!window.chrome[key] || !window.chrome[key].getManifest) {
        window.chrome[key] = val;
      }
    } catch (e) {
      try {
        Object.defineProperty(window.chrome, key, {
          value: val,
          writable: true,
          configurable: true,
          enumerable: true
        });
      } catch (err) {
        console.warn(`[Mock] Could not attach chrome.${key}:`, err);
      }
    }
  });

  // Also define on globalThis and parent window if accessible
  try {
    if (typeof globalThis !== 'undefined' && globalThis !== window) {
      globalThis.chrome = window.chrome;
    }
  } catch (e) {}

  console.log('[FTU Sync] Mock Chrome APIs initialized successfully.');
})();
