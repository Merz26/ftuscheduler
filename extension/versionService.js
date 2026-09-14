/**
 * FTU Schedule Sync - Automated Update Notification Service
 * Checks GitHub releases for latest version tag and manages user update preferences.
 */

const GITHUB_RELEASES_API = 'https://api.github.com/repos/Merz26/ftuscheduler/releases/latest';
const FALLBACK_REPO_URL = 'https://github.com/Merz26/ftuscheduler/releases';

/**
 * Extracts a clean semantic version string (e.g. "1.4.0") from a tag or release name.
 * Examples:
 *   - "v1.4.0" -> "1.4.0"
 *   - "beta v1.3.0" -> "1.3.0"
 *   - "1.3.0" -> "1.3.0"
 *   - "beta" -> null
 *
 * @param {string} raw - Tag name or release title
 * @returns {string|null} Clean semver or null
 */
export function extractSemver(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const match = raw.match(/v?(\d+\.\d+(?:\.\d+)?)/i);
  return match ? match[1] : null;
}

/**
 * Compares two semantic version strings.
 * Returns:
 *   1 if v1 > v2
 *  -1 if v1 < v2
 *   0 if v1 === v2
 *
 * @param {string} v1
 * @param {string} v2
 * @returns {number}
 */
export function compareSemver(v1, v2) {
  const clean1 = extractSemver(v1) || '0.0.0';
  const clean2 = extractSemver(v2) || '0.0.0';

  const parts1 = clean1.split('.').map(Number);
  const parts2 = clean2.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * Checks if the remote release version is strictly newer than the local version.
 *
 * @param {string} remoteVersion
 * @param {string} localVersion
 * @returns {boolean}
 */
export function isNewerVersion(remoteVersion, localVersion) {
  return compareSemver(remoteVersion, localVersion) > 0;
}

/**
 * Gets the current extension version from manifest or fallback.
 *
 * @returns {string}
 */
export function getLocalVersion() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
      const manifest = chrome.runtime.getManifest();
      if (manifest?.version) return manifest.version;
    }
  } catch (e) {
    // ignore
  }
  return '1.4.0';
}

/**
 * Fetches latest release from GitHub and compares with local version.
 * Respects 'optOutUpdateChecks' and 'dismissedUpdateVersion' in chrome.storage.local.
 *
 * @param {object} options
 * @param {boolean} options.force - If true, bypasses optOut and dismissed checks (e.g. manual button click)
 * @param {string} [options.localVersion] - Override local version for testing
 * @returns {Promise<object>} Result object containing update info
 */
export async function checkExtensionUpdate({ force = false, localVersion = null } = {}) {
  const currentLocalVersion = localVersion || getLocalVersion();

  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return performFetch(currentLocalVersion, false, null, force, resolve);
    }

    chrome.storage.local.get(['optOutUpdateChecks', 'dismissedUpdateVersion'], (prefs) => {
      const optOut = Boolean(prefs.optOutUpdateChecks);
      const dismissedVer = prefs.dismissedUpdateVersion || null;

      // If user opted out and this is not a manual check, do not perform network request
      if (optOut && !force) {
        return resolve({
          status: 'opted_out',
          optedOut: true,
          hasUpdate: false,
          localVersion: currentLocalVersion
        });
      }

      performFetch(currentLocalVersion, optOut, dismissedVer, force, resolve);
    });
  });
}

/**
 * Network fetch helper with timeout and error handling.
 */
async function performFetch(localVersion, optOut, dismissedVersion, force, callback) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(GITHUB_RELEASES_API, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return callback({
        status: 'error',
        error: `HTTP ${response.status}`,
        hasUpdate: false,
        localVersion
      });
    }

    const releaseData = await response.json();
    const tagName = releaseData.tag_name || '';
    const releaseTitle = releaseData.name || tagName;
    
    // Extract semver from tag_name first, then release name
    let remoteSemver = extractSemver(tagName) || extractSemver(releaseTitle);

    // If tag_name was generic (e.g. 'beta') and no version in name, fallback to comparison
    const hasUpdate = Boolean(remoteSemver && isNewerVersion(remoteSemver, localVersion));
    const releaseUrl = releaseData.html_url || FALLBACK_REPO_URL;
    const releaseNotes = releaseData.body || '';
    const publishedAt = releaseData.published_at || new Date().toISOString();

    const result = {
      status: hasUpdate ? 'update_available' : 'up_to_date',
      hasUpdate,
      remoteVersion: remoteSemver || tagName,
      remoteTag: tagName,
      releaseTitle,
      localVersion,
      releaseUrl,
      releaseNotes,
      publishedAt,
      isDismissed: Boolean(dismissedVersion && (dismissedVersion === remoteSemver || dismissedVersion === tagName)),
      optedOut: optOut
    };

    // Cache latest release info in storage
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({
        lastUpdateCheckResult: result,
        lastUpdateCheckTime: new Date().toISOString()
      });
    }

    callback(result);
  } catch (err) {
    console.warn('[Version Service] Failed to check for updates:', err);
    callback({
      status: 'error',
      error: err.name === 'AbortError' ? 'Timeout' : err.message,
      hasUpdate: false,
      localVersion
    });
  }
}

/**
 * Persists the "Don't show again" choice for a specific version in chrome.storage.local.
 *
 * @param {string} versionTag - Version tag or semver to ignore
 * @returns {Promise<void>}
 */
export async function dismissUpdateNotification(versionTag) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ dismissedUpdateVersion: versionTag }, () => resolve());
    } else {
      resolve();
    }
  });
}

/**
 * Persists the opt-out preference in chrome.storage.local.
 *
 * @param {boolean} optOut - True to disable update checks entirely
 * @returns {Promise<void>}
 */
export async function setUpdateOptOut(optOut) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ optOutUpdateChecks: Boolean(optOut) }, () => resolve());
    } else {
      resolve();
    }
  });
}
