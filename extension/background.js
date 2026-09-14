import { getSessionToken, getActiveSemesterInfo, getSchedule } from './portalService.js';
import { syncScheduleToGoogleCalendar, checkAuth } from './calendarService.js';
import { checkExtensionUpdate, dismissUpdateNotification, setUpdateOptOut } from './versionService.js';

// Background Service Worker (Manifest V3)

// Listen for alarm triggers
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'ftuAutoSyncAlarm') {
    console.log('[Background Service Worker] Executing scheduled auto-sync...');
    await runScheduledBackgroundSync();
  } else if (alarm.name === 'ftuVersionCheckAlarm') {
    console.log('[Background Service Worker] Checking for extension updates...');
    await checkExtensionUpdate({ force: false });
  }
});

// Listen for messages from popup or offscreen worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'RESCHEDULE_AUTO_SYNC') {
    configureAutoSyncAlarm()
      .then(res => sendResponse({ success: true, res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'TRIGGER_BACKGROUND_SYNC') {
    runScheduledBackgroundSync()
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'TRIGGER_OFFSCREEN_LOGIN') {
    handleOffscreenLoginRecovery(message.studentId, message.password)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'CHECK_FOR_UPDATES') {
    checkExtensionUpdate({ force: Boolean(message.force) })
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'DISMISS_UPDATE') {
    dismissUpdateNotification(message.version)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'SET_UPDATE_OPTOUT') {
    setUpdateOptOut(message.optOut)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

/**
 * Calculates the next epoch timestamp (ms) for the user-specified time & frequency.
 */
function calculateNextAlarmTime(timeStr = '06:00', frequency = 'daily', targetDayOfWeek = 1) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(hours || 6, minutes || 0, 0, 0);

  if (frequency === 'weekly') {
    // targetDayOfWeek: 0 = Sun, 1 = Mon, ..., 6 = Sat
    const currentDay = now.getDay();
    let daysUntilTarget = (targetDayOfWeek - currentDay + 7) % 7;
    if (daysUntilTarget === 0 && next.getTime() <= now.getTime()) {
      daysUntilTarget = 7;
    }
    next.setDate(next.getDate() + daysUntilTarget);
  } else {
    // daily
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1);
    }
  }

  return next.getTime();
}

/**
 * Dynamically configures chrome.alarms based on user's stored preferences.
 */
export async function configureAutoSyncAlarm() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['autoSyncEnabled', 'autoSyncFreq', 'autoSyncDay', 'autoSyncTime'], async (res) => {
      await chrome.alarms.clear('ftuAutoSyncAlarm');

      if (!res.autoSyncEnabled) {
        console.log('[Background Service Worker] Auto-sync is disabled by user.');
        return resolve({ enabled: false });
      }

      const freq = res.autoSyncFreq || 'daily';
      const timeStr = res.autoSyncTime || '06:00';
      const day = Number(res.autoSyncDay) || 1; // Monday default

      const nextWhen = calculateNextAlarmTime(timeStr, freq, day);
      const periodInMinutes = freq === 'weekly' ? 7 * 24 * 60 : 24 * 60;

      chrome.alarms.create('ftuAutoSyncAlarm', {
        when: nextWhen,
        periodInMinutes
      });

      console.log(`[Background Service Worker] Auto-sync alarm scheduled for ${new Date(nextWhen).toLocaleString()} (repeat every ${periodInMinutes} mins)`);
      resolve({ enabled: true, nextExecution: nextWhen, periodInMinutes });
    });
  });
}

/**
 * Manages offscreen document creation & ensures prompt cleanup to avoid hanging background processes.
 */
async function handleOffscreenLoginRecovery(studentId, password) {
  const offscreenUrl = chrome.runtime.getURL('extension/offscreen.html');
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'extension/offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Perform automated login DOM execution and session recovery'
    });
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'OFFSCREEN_PERFORM_LOGIN',
      studentId,
      password
    });
    return response;
  } finally {
    // Lifecycle Governance: Always close document immediately
    await chrome.offscreen.closeDocument().catch(() => {});
  }
}

/**
 * Runs the silent background synchronization with deduplication.
 */
async function runScheduledBackgroundSync() {
  try {
    const auth = await checkAuth();
    if (!auth || !auth.token) {
      console.warn('[Background Sync] Google account not authorized. Skipping sync.');
      return;
    }

    const session = await getSessionToken();
    if (!session || !session.success || !session.token) {
      console.warn('[Background Sync] FTU session expired. Auto-login needed.');
      return;
    }

    const semInfo = await getActiveSemesterInfo(session.token);
    const scheduleData = await getSchedule(session.token, semInfo.hoc_ky);

    // Default background sync scope: this_week to keep calendar up to date with any room changes
    const syncResult = await syncScheduleToGoogleCalendar(auth.token, scheduleData, {
      scope: 'this_week',
      activeWeekIndex: 0
    });

    // Notify user of background update if changes occurred
    if (syncResult && (syncResult.insertedCount > 0 || syncResult.updatedCount > 0 || syncResult.clearedCount > 0)) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: 'FTU Schedule Sync',
        message: `Tự động đồng bộ: ${syncResult.insertedCount} mới, ${syncResult.updatedCount} cập nhật, ${syncResult.clearedCount} đã xóa (${syncResult.skippedCount} giữ nguyên).`
      });
    } else if (syncResult && syncResult.skippedCount > 0) {
      console.log(`[Background Sync] All ${syncResult.skippedCount} classes are already up to date. No calendar writes needed.`);
    }

    return syncResult;
  } catch (err) {
    console.error('[Background Sync Error]', err);
    throw err;
  }
}

// Initialize alarms on extension load
configureAutoSyncAlarm();

// Configure periodic update check alarm (runs every 12 hours)
function configureVersionCheckAlarm() {
  if (typeof chrome !== 'undefined' && chrome.alarms) {
    chrome.alarms.get('ftuVersionCheckAlarm', (existing) => {
      if (!existing) {
        chrome.alarms.create('ftuVersionCheckAlarm', {
          periodInMinutes: 720, // 12 hours
          delayInMinutes: 5     // Initial check after 5 minutes
        });
      }
    });
  }
}
configureVersionCheckAlarm();
