// Portal APIs and Token Extraction
const isMockOrWeb = typeof window !== 'undefined' && 
  (!window.chrome?.runtime?.id || window.chrome?.runtime?.__isMock);
const BASE_URL = isMockOrWeb ? '/ftu-api' : 'https://qldt.hcmc.ftu.edu.vn';

export async function loginToPortal(studentId, password) {
  console.log(`[Login Flow] Initiating login for student ID: ${studentId}`);
  
  const body = new URLSearchParams();
  body.append('username', studentId);
  body.append('password', password);
  body.append('grant_type', 'password');

  const endpoint = `${BASE_URL}/api/auth/login`;
  console.log(`[Login Flow] Sending POST request to: ${endpoint}`);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    
    console.log(`[Login Flow] HTTP Status Code: ${res.status} ${res.statusText}`);
    
    const responseText = await res.text();
    console.log(`[Login Flow] Response Body Raw:`, responseText);

    if (!res.ok) {
      console.error(`[Login Flow] Request failed with status ${res.status}`);
      throw new Error(`HTTP ${res.status}: ${responseText}`);
    }

    let data;
    try {
      data = JSON.parse(responseText);
      console.log(`[Login Flow] Response JSON parsed successfully:`, data);
    } catch (e) {
      console.error(`[Login Flow] Failed to parse JSON from response.`);
      throw new Error("Invalid JSON response from portal.");
    }
    
    if (data.access_token) {
      console.log(`[Login Flow] Authentication successful! Access token received.`);
      const studentProfile = {
        name: data.name || 'Sinh viên',
        studentId: data.userName || studentId,
        email: data.principal || `${studentId}@ftu.edu.vn`,
        role: data.roles === 'SINHVIEN' ? 'Sinh viên' : (data.roles || 'Sinh viên')
      };
      return {
        token: data.access_token,
        tokenType: data.token_type,
        expiresIn: data.expires_in,
        expiresAt: Date.now() + Math.max(300, (Number(data.expires_in) || 1800) - 60) * 1000,
        refreshToken: data.refresh_token,
        profile: studentProfile,
        success: true
      };
    } else {
      console.warn(`[Login Flow] Authentication failed! Server message: ${data.message || 'Unknown error'}`);
      return { error: data.message || 'Login failed', success: false };
    }
  } catch (err) {
    console.error(`[Login Flow] Network or fatal error during fetch:`, err);
    throw err;
  }
}

/**
 * Retrieves a valid session token.
 * Automatically re-logs in to the FTU portal using saved credentials
 * if the session token is expired, missing, or was signed out by the system.
 */
export async function getSessionToken(forceRefresh = false) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve({ error: 'chrome.storage is not available', success: false });
      return;
    }

    chrome.storage.local.get(['studentId', 'password', 'portalToken', 'portalTokenExpiresAt', 'studentProfile'], async (res) => {
      const studentId = res.studentId ? String(res.studentId).trim() : '';
      const password = res.password ? String(res.password).trim() : '';

      if (!studentId || !password) {
        resolve({
          error: 'Vui lòng nhập Mã sinh viên và Mật khẩu trong phần Thông tin Cổng Đào Tạo',
          success: false
        });
        return;
      }

      const isExpired = !res.portalTokenExpiresAt || Date.now() >= res.portalTokenExpiresAt;

      // Return cached token if still valid and not forcing a re-login
      if (!forceRefresh && !isExpired && res.portalToken && res.studentProfile) {
        resolve({ token: res.portalToken, success: true, profile: res.studentProfile });
        return;
      }
      
      // Automatically authenticate using user-provided credentials
      try {
        console.log('[Login Flow] Authenticating to FTU portal with user-saved credentials...');
        const result = await loginToPortal(studentId, password);
        if (result.success) {
          chrome.storage.local.set({
            portalToken: result.token,
            portalTokenExpiresAt: result.expiresAt,
            studentProfile: result.profile
          });
          console.log('[Login Flow] Authentication successful! Fresh session token acquired.');
          resolve({ token: result.token, success: true, profile: result.profile });
        } else {
          console.warn('[Login Flow] Authentication failed:', result.error);
          resolve({ error: result.error, success: false });
        }
      } catch (e) {
        console.error('[Login Flow] Login threw an exception:', e);
        resolve({ error: e.message, success: false });
      }
    });
  });
}

export function clearSessionToken() {
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    chrome.storage.local.remove(['portalToken', 'portalTokenExpiresAt', 'portalVerification']);
  }
}

const COMMON_HEADERS = (token) => ({
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json',
  'ua': '0%MTcwOTMyODcwNjIxMQ==%U2FsdGVkX1+zRTzkjt/0w7va9zBWypT1sAkHxi/Y/PU='
});

/**
 * Fetch wrapper with automatic session recovery:
 * If FTU portal returns HTTP 401/403 or PSC JSON payload { code: 401, message: 'notallowed-' },
 * automatically re-authenticates with stored credentials and retries once.
 */
async function fetchWithAutoRelogin(url, body, currentToken) {
  let token = currentToken;
  let res = await fetch(url, {
    method: 'POST',
    headers: COMMON_HEADERS(token),
    body: JSON.stringify(body)
  });

  // PSC Edusoft server can return HTTP 200 with { result: false, code: 401, message: 'notallowed-' }
  let isUnauthorized = res.status === 401 || res.status === 403;
  if (!isUnauthorized && res.ok) {
    try {
      const clone = res.clone();
      const testJson = await clone.json();
      if (testJson && (testJson.code === 401 || testJson.code === 403 || (testJson.result === false && String(testJson.message || '').includes('notallowed')))) {
        isUnauthorized = true;
      }
    } catch (e) {}
  }

  // If session was signed out by the system, auto re-login and retry
  if (isUnauthorized) {
    console.warn(`[Portal API] Session expired or unauthorized for ${url}. Attempting automatic re-login...`);
    const session = await getSessionToken(true);
    if (session && session.success && session.token) {
      token = session.token;
      console.log(`[Portal API] Re-authenticated successfully. Retrying request to ${url}...`);
      res = await fetch(url, {
        method: 'POST',
        headers: COMMON_HEADERS(token),
        body: JSON.stringify(body)
      });
    }
  }

  return { res, token };
}

export async function getActiveSemesterInfo(token) {
  const { res } = await fetchWithAutoRelogin(`${BASE_URL}/api/sch/w-locdshockytkbuser`, {}, token);
  if (!res.ok) throw new Error(`Failed to fetch semester info (HTTP ${res.status})`);
  const json = await res.json();
  const semData = json.data || json;
  if (!semData) {
    if (json.code === 401 || String(json.message || '').includes('notallowed')) {
      throw new Error('Phiên đăng nhập Cổng Đào Tạo đã hết hạn. Vui lòng xác thực lại.');
    }
    throw new Error(json.message || 'Không tìm thấy dữ liệu học kỳ');
  }

  const currentHk = semData.hoc_ky_theo_ngay_hien_tai || semData.hoc_ky || 20261;
  const list = Array.isArray(semData.ds_hoc_ky) ? semData.ds_hoc_ky : (Array.isArray(semData.list_hoc_ky) ? semData.list_hoc_ky : []);
  
  let found = list.find(hk => hk.hoc_ky === currentHk);
  if (!found && list.length > 0) {
    found = list[0];
  }
  return {
    hoc_ky: currentHk || found?.hoc_ky || 20261,
    ten_hoc_ky: found?.ten_hoc_ky || `Học kỳ ${currentHk || 20261}`,
    list
  };
}

export async function getActiveSemester(token) {
  const info = await getActiveSemesterInfo(token);
  return info.hoc_ky;
}

export async function getSchedule(token, hoc_ky) {
  const { res } = await fetchWithAutoRelogin(`${BASE_URL}/api/sch/w-locdstkbtuanusertheohocky`, {
    filter: { hoc_ky },
    additional: { paging: { limit: 1000, page: 1 } }
  }, token);

  if (!res.ok) throw new Error(`Failed to fetch /tkb-tuan schedule (HTTP ${res.status})`);
  const data = await res.json();
  const scheduleObj = data.data || data;
  if (!scheduleObj) {
    if (data.code === 401 || String(data.message || '').includes('notallowed')) {
      throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng kết nối lại tài khoản FTU.');
    }
    throw new Error(data.message || 'No schedule data returned from /tkb-tuan');
  }

  if (!scheduleObj.ds_tuan_tkb && scheduleObj.ds_tuan) {
    scheduleObj.ds_tuan_tkb = scheduleObj.ds_tuan;
  }
  if (!scheduleObj.ds_tuan_tkb && scheduleObj.list_tuan) {
    scheduleObj.ds_tuan_tkb = scheduleObj.list_tuan;
  }

  if (Array.isArray(scheduleObj.ds_tuan_tkb)) {
    scheduleObj.ds_tuan_tkb.forEach(week => {
      if (!week.ngay_bat_dau) week.ngay_bat_dau = week.ngay_bd || week.tu_ngay || '';
      if (!week.ngay_ket_thuc) week.ngay_ket_thuc = week.ngay_kt || week.den_ngay || '';
      if (!week.ds_thoi_khoa_bieu) week.ds_thoi_khoa_bieu = week.ds_tkb || week.tkb || [];
    });
  }

  return scheduleObj;
}

/**
 * Generates a realistic FTU semester schedule spanning 20 academic weeks.
 * Used for development previews and offline fallback when student credentials aren't configured yet.
 */
export function generateDefaultFtuSchedule() {
  const weeks = [];
  const baseStart = new Date(2026, 8, 7); // Monday, September 7, 2026

  const standardScheduleTemplate = [
    {
      ma_mon: 'ESP341',
      ten_mon: 'Tiếng Anh thương mại 1',
      ma_lop: 'ESP341.1_LT',
      ten_lop: 'K62.KDQT',
      ma_phong: 'B301',
      ten_giang_vien: 'ThS. Nguyễn Thu Hằng',
      dayOfWeekOffset: 0, // Thứ 2
      tiet_bat_dau: 1,
      so_tiet: 3
    },
    {
      ma_mon: 'TMA408',
      ten_mon: 'Thanh toán Quốc tế',
      ma_lop: 'TMA408.2_LT',
      ten_lop: 'K62.TCDN',
      ma_phong: 'B205',
      ten_giang_vien: 'PGS.TS Trần Thị Phương',
      dayOfWeekOffset: 2, // Thứ 4
      tiet_bat_dau: 7,
      so_tiet: 3
    },
    {
      ma_mon: 'KTE306',
      ten_mon: 'Kinh tế lượng',
      ma_lop: 'KTE306.4_LT',
      ten_lop: 'K62.KTQT',
      ma_phong: 'A204',
      ten_giang_vien: 'TS. Lê Hoàng Phúc',
      dayOfWeekOffset: 3, // Thứ 5
      tiet_bat_dau: 4,
      so_tiet: 3
    },
    {
      ma_mon: 'MKT401',
      ten_mon: 'Marketing Quốc tế',
      ma_lop: 'MKT401.1_LT',
      ten_lop: 'K62.KDQT',
      ma_phong: 'B102',
      ten_giang_vien: 'ThS. Phạm Thu Trang',
      dayOfWeekOffset: 4, // Thứ 6
      tiet_bat_dau: 1,
      so_tiet: 3
    }
  ];

  for (let w = 0; w < 20; w++) {
    const weekStart = new Date(baseStart.getFullYear(), baseStart.getMonth(), baseStart.getDate() + w * 7);
    const weekEnd = new Date(baseStart.getFullYear(), baseStart.getMonth(), baseStart.getDate() + w * 7 + 6);
    const pad = (n) => String(n).padStart(2, '0');

    const startIso = `${weekStart.getFullYear()}-${pad(weekStart.getMonth() + 1)}-${pad(weekStart.getDate())}T00:00:00`;
    const endIso = `${weekEnd.getFullYear()}-${pad(weekEnd.getMonth() + 1)}-${pad(weekEnd.getDate())}T23:59:59`;

    const weekClasses = [];

    standardScheduleTemplate.forEach((tpl, idx) => {
      const classDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + tpl.dayOfWeekOffset);
      const classDateIso = `${classDate.getFullYear()}-${pad(classDate.getMonth() + 1)}-${pad(classDate.getDate())}T00:00:00`;

      weekClasses.push({
        id_tkb: 100000 + w * 100 + idx,
        ma_mon: tpl.ma_mon,
        ten_mon: tpl.ten_mon,
        ma_lop: tpl.ma_lop,
        ten_lop: tpl.ten_lop,
        ma_phong: tpl.ma_phong,
        ten_giang_vien: tpl.ten_giang_vien,
        ngay_hoc: classDateIso,
        tiet_bat_dau: tpl.tiet_bat_dau,
        so_tiet: tpl.so_tiet,
        is_day_bu: false,
        ghi_chu: ''
      });
    });

    // Add a makeup class in Week 2 and Week 5
    if (w === 1 || w === 4) {
      const makeupDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 5); // Saturday
      const makeupDateIso = `${makeupDate.getFullYear()}-${pad(makeupDate.getMonth() + 1)}-${pad(makeupDate.getDate())}T00:00:00`;
      weekClasses.push({
        id_tkb: 200000 + w * 100,
        ma_mon: 'TMA408',
        ten_mon: 'Thanh toán Quốc tế (Dạy bù)',
        ma_lop: 'TMA408.2_LT',
        ten_lop: 'K62.TCDN',
        ma_phong: 'B205',
        ten_giang_vien: 'PGS.TS Trần Thị Phương',
        ngay_hoc: makeupDateIso,
        tiet_bat_dau: 7,
        so_tiet: 3,
        is_day_bu: true,
        ghi_chu: 'Dạy bù theo kế hoạch khoa'
      });
    }

    weeks.push({
      id_tuan: w + 1,
      tuan_hoc_ky: w + 1,
      ten_tuan: `Tuần ${w + 1}`,
      ngay_bat_dau: startIso,
      ngay_ket_thuc: endIso,
      ds_thoi_khoa_bieu: weekClasses
    });
  }

  return {
    ds_tuan_tkb: weeks,
    hoc_ky: 20261
  };
}

/**
 * Verifies that the app can successfully access /tkb-tuan schedule data.
 * Connection is indicated as successful ONLY IF this verification passes.
 */
export async function verifyTkbTuanAccess(token) {
  try {
    const semInfo = await getActiveSemesterInfo(token);
    const scheduleData = await getSchedule(token, semInfo.hoc_ky);
    const weeks = scheduleData?.ds_tuan_tkb || [];
    let totalClasses = 0;
    weeks.forEach(w => {
      if (w.ds_thoi_khoa_bieu) totalClasses += w.ds_thoi_khoa_bieu.length;
    });

    if (weeks.length === 0) {
      return {
        success: false,
        error: 'TKB tuần rỗng hoặc không có dữ liệu tuần'
      };
    }

    const verificationResult = {
      success: true,
      hoc_ky: semInfo.hoc_ky,
      semesterName: semInfo.ten_hoc_ky,
      totalWeeks: weeks.length,
      totalClasses,
      verifiedAt: new Date().toISOString()
    };

    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      chrome.storage.local.set({
        portalVerification: verificationResult,
        cachedSchedule: scheduleData
      });
    }

    return {
      ...verificationResult,
      scheduleData
    };
  } catch (err) {
    console.error('[verifyTkbTuanAccess Error]', err);
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      chrome.storage.local.set({
        portalVerification: {
          success: false,
          error: err.message || 'Không thể truy cập /tkb-tuan',
          verifiedAt: new Date().toISOString()
        }
      });
    }
    return {
      success: false,
      error: err.message || 'Không thể truy cập /tkb-tuan'
    };
  }
}

/**
 * Extracts class sessions for a specific date (defaults to today Vietnam time UTC+7)
 */
export function extractClassesFromSchedule(scheduleData, targetDate = new Date()) {
  if (!scheduleData || !scheduleData.ds_tuan_tkb) return [];
  // Format targetDate in Vietnam timezone (UTC+7)
  const d = new Date(targetDate.getTime() + (7 * 60 + targetDate.getTimezoneOffset()) * 60000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const classes = [];
  scheduleData.ds_tuan_tkb.forEach(week => {
    (week.ds_thoi_khoa_bieu || []).forEach(item => {
      if (item.ngay_hoc && item.ngay_hoc.startsWith(dateStr)) {
        classes.push(item);
      }
    });
  });
  // Sort by start period
  classes.sort((a, b) => (Number(a.tiet_bat_dau) || 0) - (Number(b.tiet_bat_dau) || 0));
  return { classes, dateStr };
}

export const verifyPortalAccess = verifyTkbTuanAccess;
export const portalLogin = loginToPortal;

export async function getStoredPortalCredentials() {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve(null);
      return;
    }
    chrome.storage.local.get(['studentId', 'password'], (res) => {
      resolve({
        studentId: res.studentId || '',
        password: res.password || ''
      });
    });
  });
}

export async function savePortalCredentials(studentId, password) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve();
      return;
    }
    chrome.storage.local.set({ studentId, password }, () => {
      resolve();
    });
  });
}

/**
 * Parses Vietnamese date format DD/MM/YYYY into ISO YYYY-MM-DD
 */
export function parseVnDateToIso(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).trim().split('/');
  if (parts.length === 3) {
    const [d, m, y] = parts;
    return `${y.padStart(4, '2000')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return dateStr;
}

/**
 * Computes exam end time in HH:mm format given start time and duration in minutes
 */
export function calculateExamEndTime(startTimeStr, durationMinutes) {
  if (!startTimeStr) return '';
  const [hStr, mStr] = String(startTimeStr).split(':');
  const h = Number(hStr) || 0;
  const m = Number(mStr) || 0;
  const duration = Number(durationMinutes) || 90;
  const totalMin = h * 60 + m + duration;
  const endH = Math.floor(totalMin / 60) % 24;
  const endM = totalMin % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

/**
 * Fetches available semesters for student exam schedule
 * Endpoint: POST /api/report/w-locdshockylichthisinhvien
 */
export async function getExamSemesters(token) {
  const { res } = await fetchWithAutoRelogin(`${BASE_URL}/api/report/w-locdshockylichthisinhvien`, {
    filter: { is_tieng_anh: null },
    additional: {
      paging: { limit: 100, page: 1 },
      ordering: [{ name: null, order_type: 1 }]
    }
  }, token);

  if (!res.ok) throw new Error(`Không thể lấy danh sách học kỳ lịch thi (HTTP ${res.status})`);
  const json = await res.json();
  const list = json.data?.ds_hoc_ky || json.data?.list_hoc_ky || [];
  return list.map(item => ({
    hoc_ky: item.hoc_ky,
    ten_hoc_ky: item.ten_hoc_ky || `Học kỳ ${item.hoc_ky}`,
    ngay_bat_dau_hk: item.ngay_bat_dau_hk || '',
    ngay_ket_thuc_hk: item.ngay_ket_thuc_hk || ''
  }));
}

/**
 * Fetches exam schedule for a specific semester and exam type (Final: is_giua_ky = false, Midterm: is_giua_ky = true)
 * Endpoint: POST /api/epm/w-locdslichthisvtheohocky
 */
export async function getExamSchedule(token, hoc_ky, is_giua_ky = false) {
  const { res } = await fetchWithAutoRelogin(`${BASE_URL}/api/epm/w-locdslichthisvtheohocky`, {
    filter: {
      hoc_ky: hoc_ky ? Number(hoc_ky) : null,
      is_giua_ky: Boolean(is_giua_ky)
    },
    additional: {
      paging: { limit: 100, page: 1 },
      ordering: [{ name: null, order_type: null }]
    }
  }, token);

  if (!res.ok) throw new Error(`Không thể lấy lịch thi từ Cổng Đào Tạo (HTTP ${res.status})`);
  const json = await res.json();
  const rawList = json.data?.ds_lich_thi || [];
  const postponedList = json.data?.ds_lich_hoan_thi || [];
  const tuitionNotice = json.data?.thong_bao_no_hoc_phi || '';

  const normalized = rawList.map((item, idx) => {
    const isoDate = parseVnDateToIso(item.ngay_thi);
    const startTime = item.gio_bat_dau || '07:30';
    const duration = Number(item.so_phut) || 90;
    const endTime = calculateExamEndTime(startTime, duration);
    const startDateTime = isoDate ? `${isoDate}T${startTime}:00+07:00` : '';
    const endDateTime = isoDate ? `${isoDate}T${endTime}:00+07:00` : '';

    return {
      id_nhom_thi: item.id_nhom_thi || `exam_${idx}_${item.ma_mon}`,
      id_mon_hoc: item.id_mon_hoc,
      so_thu_tu: item.so_thu_tu || idx + 1,
      ma_mon: item.ma_mon || 'CHƯA_CÓ_MÃ',
      ten_mon: item.ten_mon || 'Môn thi',
      ten_mon_eg: item.ten_mon_eg || '',
      ngay_thi: item.ngay_thi,
      iso_date: isoDate,
      gio_bat_dau: startTime,
      gio_ket_thuc: endTime,
      so_phut: duration,
      tiet_bat_dau: Number(item.tiet_bat_dau) || 1,
      so_tiet: Number(item.so_tiet) || 3,
      ma_phong: item.ma_phong || 'Chưa xếp phòng',
      dia_diem_thi: item.dia_diem_thi || item.ma_phong || 'CS2',
      so_bao_danh: item.so_bao_danh || '',
      to_thi: item.to_thi || '',
      nhom_thi: item.nhom_thi || '',
      hinh_thuc_thi: item.hinh_thuc_thi || 'Thi viết',
      ky_thi: item.ky_thi || (is_giua_ky ? 'Thi giữa kỳ' : 'Thi kết thúc môn'),
      dot_thi: item.dot_thi || '',
      si_so: Number(item.si_so) || 0,
      ghi_chu_sv: item.ghi_chu_sv || '',
      ghi_chu_htt: item.ghi_chu_htt || '',
      cam_thi: item.cam_thi || '',
      is_giua_ky: Boolean(is_giua_ky),
      startDateTime,
      endDateTime
    };
  });

  return {
    exams: normalized,
    postponed: postponedList,
    tuitionNotice,
    total: normalized.length
  };
}

/**
 * Fetches all exams (both Cuối kỳ and Giữa kỳ) for a semester, sorted chronologically
 */
export async function getAllExamSchedules(token, hoc_ky) {
  const [finalRes, midRes] = await Promise.all([
    getExamSchedule(token, hoc_ky, false).catch(err => {
      console.warn('[Exam API] Error fetching final exams:', err);
      return { exams: [], total: 0 };
    }),
    getExamSchedule(token, hoc_ky, true).catch(err => {
      console.warn('[Exam API] Error fetching midterm exams:', err);
      return { exams: [], total: 0 };
    })
  ]);

  const combined = [
    ...finalRes.exams.map(e => ({ ...e, loai_ky_thi: 'Cuối kỳ' })),
    ...midRes.exams.map(e => ({ ...e, loai_ky_thi: 'Giữa kỳ' }))
  ];

  // Sort chronologically by date and start time
  combined.sort((a, b) => {
    const keyA = `${a.iso_date || '9999'} ${a.gio_bat_dau || '00:00'}`;
    const keyB = `${b.iso_date || '9999'} ${b.gio_bat_dau || '00:00'}`;
    return keyA.localeCompare(keyB);
  });

  return {
    exams: combined,
    finalCount: finalRes.total,
    midCount: midRes.total,
    total: combined.length,
    tuitionNotice: finalRes.tuitionNotice || midRes.tuitionNotice || ''
  };
}

/**
 * High-level fetcher: Authenticates or uses token to fetch all exam info from /#/lichthi
 */
export async function fetchLichThiFromPortal(credentials = null, requestedHocKy = null) {
  let token = null;
  let profile = null;

  if (credentials && credentials.studentId && credentials.password) {
    const loginResult = await loginToPortal(credentials.studentId, credentials.password);
    if (!loginResult.success) {
      throw new Error(loginResult.error || 'Đăng nhập thất bại');
    }
    token = loginResult.token;
    profile = loginResult.profile;
  } else {
    const session = await getSessionToken();
    if (!session.success || !session.token) {
      throw new Error(session.error || 'Chưa đăng nhập Cổng Đào Tạo FTU');
    }
    token = session.token;
    profile = session.profile;
  }

  const semesters = await getExamSemesters(token);
  const targetHocKy = requestedHocKy || (semesters.length > 0 ? semesters[0].hoc_ky : 20261);
  const semesterInfo = semesters.find(s => s.hoc_ky === Number(targetHocKy)) || semesters[0];

  const examData = await getAllExamSchedules(token, targetHocKy);

  return {
    success: true,
    studentProfile: profile,
    semesters,
    activeSemester: semesterInfo,
    exams: examData.exams,
    total: examData.total,
    finalCount: examData.finalCount,
    midCount: examData.midCount,
    tuitionNotice: examData.tuitionNotice
  };
}

/**
 * Tests direct connectivity to /#/lichthi API endpoints
 */
export async function verifyLichThiAccess(token) {
  const startTime = Date.now();
  try {
    const semesters = await getExamSemesters(token);
    const targetHocKy = semesters.length > 0 ? semesters[0].hoc_ky : null;
    const examData = targetHocKy ? await getExamSchedule(token, targetHocKy, false) : { exams: [], total: 0 };
    const latency = Date.now() - startTime;
    return {
      success: true,
      latency,
      semesterCount: semesters.length,
      examCount: examData.total,
      sampleSemester: semesters[0]?.ten_hoc_ky || 'N/A'
    };
  } catch (err) {
    return {
      success: false,
      latency: Date.now() - startTime,
      error: err.message
    };
  }
}

/**
 * Realistic default exams for offline preview or unauthenticated display
 */
export function generateDefaultFtuExams() {
  return [
    {
      id_nhom_thi: 'ex_default_1',
      so_thu_tu: 1,
      ma_mon: 'ESP341',
      ten_mon: 'Tiếng Anh chuyên ngành 4 (Thư tín thương mại)',
      ten_mon_eg: 'English for Specific Purpose 4',
      ngay_thi: '05/10/2026',
      iso_date: '2026-10-05',
      gio_bat_dau: '15:30',
      gio_ket_thuc: '17:00',
      so_phut: 90,
      tiet_bat_dau: 18,
      so_tiet: 3,
      ma_phong: 'CS2.A205',
      dia_diem_thi: 'CS2.A205',
      so_bao_danh: '015',
      to_thi: '003',
      hinh_thuc_thi: 'Tự luận',
      ky_thi: 'Thi kết thúc môn',
      loai_ky_thi: 'Cuối kỳ',
      dot_thi: 'D1',
      si_so: 37,
      is_giua_ky: false
    },
    {
      id_nhom_thi: 'ex_default_2',
      so_thu_tu: 2,
      ma_mon: 'KTE306',
      ten_mon: 'Quan hệ kinh tế quốc tế',
      ten_mon_eg: 'International Economic Relations',
      ngay_thi: '09/10/2026',
      iso_date: '2026-10-09',
      gio_bat_dau: '13:30',
      gio_ket_thuc: '15:00',
      so_phut: 90,
      tiet_bat_dau: 14,
      so_tiet: 3,
      ma_phong: 'CS2.B301',
      dia_diem_thi: 'CS2.B301',
      so_bao_danh: '028',
      to_thi: '002',
      hinh_thuc_thi: 'Tiểu Luận cá nhân',
      ky_thi: 'Thi kết thúc môn',
      loai_ky_thi: 'Cuối kỳ',
      dot_thi: 'D1',
      si_so: 48,
      is_giua_ky: false
    },
    {
      id_nhom_thi: 'ex_default_3',
      so_thu_tu: 3,
      ma_mon: 'TMA408',
      ten_mon: 'Sở hữu trí tuệ',
      ten_mon_eg: 'Intellectual Property',
      ngay_thi: '13/10/2026',
      iso_date: '2026-10-13',
      gio_bat_dau: '07:30',
      gio_ket_thuc: '09:00',
      so_phut: 90,
      tiet_bat_dau: 2,
      so_tiet: 3,
      ma_phong: 'CS2.A306',
      dia_diem_thi: 'CS2.A306',
      so_bao_danh: '012',
      to_thi: '002',
      hinh_thuc_thi: 'Thi kết hợp trắc nghiệm trên giấy và tự luận',
      ky_thi: 'Thi kết thúc môn',
      loai_ky_thi: 'Cuối kỳ',
      dot_thi: 'D1',
      si_so: 39,
      is_giua_ky: false
    },
    {
      id_nhom_thi: 'ex_default_4',
      so_thu_tu: 4,
      ma_mon: 'MKT401',
      ten_mon: 'Marketing quốc tế',
      ten_mon_eg: 'International Marketing',
      ngay_thi: '19/10/2026',
      iso_date: '2026-10-19',
      gio_bat_dau: '15:30',
      gio_ket_thuc: '17:00',
      so_phut: 90,
      tiet_bat_dau: 18,
      so_tiet: 3,
      ma_phong: 'CS2.A403',
      dia_diem_thi: 'CS2.A403',
      so_bao_danh: '019',
      to_thi: '003',
      hinh_thuc_thi: 'Thi kết hợp trắc nghiệm trên giấy và tự luận',
      ky_thi: 'Thi kết thúc môn',
      loai_ky_thi: 'Cuối kỳ',
      dot_thi: 'D1',
      si_so: 37,
      is_giua_ky: false
    },
    {
      id_nhom_thi: 'ex_default_5',
      so_thu_tu: 5,
      ma_mon: 'TMA302',
      ten_mon: 'Giao dịch thương mại quốc tế',
      ten_mon_eg: 'International Trade Transactions',
      ngay_thi: '23/12/2026',
      iso_date: '2026-12-23',
      gio_bat_dau: '13:30',
      gio_ket_thuc: '16:30',
      so_phut: 180,
      tiet_bat_dau: 14,
      so_tiet: 6,
      ma_phong: 'CS2.B401',
      dia_diem_thi: 'CS2.B401',
      so_bao_danh: '022',
      to_thi: '002',
      hinh_thuc_thi: 'Vấn đáp',
      ky_thi: 'Thi kết thúc môn',
      loai_ky_thi: 'Cuối kỳ',
      dot_thi: 'D2',
      si_so: 50,
      is_giua_ky: false
    },
    {
      id_nhom_thi: 'ex_default_6',
      so_thu_tu: 6,
      ma_mon: 'TMA301',
      ten_mon: 'Chính sách thương mại quốc tế',
      ten_mon_eg: 'International Trade Policy',
      ngay_thi: '04/01/2027',
      iso_date: '2027-01-04',
      gio_bat_dau: '09:30',
      gio_ket_thuc: '11:00',
      so_phut: 90,
      tiet_bat_dau: 6,
      so_tiet: 3,
      ma_phong: 'CS2.B402',
      dia_diem_thi: 'CS2.B402',
      so_bao_danh: '008',
      to_thi: '002',
      hinh_thuc_thi: 'Thi viết',
      ky_thi: 'Thi kết thúc môn',
      loai_ky_thi: 'Cuối kỳ',
      dot_thi: 'D2',
      si_so: 49,
      is_giua_ky: false
    },
    {
      id_nhom_thi: 'ex_default_7',
      so_thu_tu: 7,
      ma_mon: 'ESP451',
      ten_mon: 'Tiếng Anh chuyên ngành 5 (Diễn thuyết trước công chúng)',
      ten_mon_eg: 'English for Specific Purpose 5 (Public Speaking)',
      ngay_thi: '09/01/2027',
      iso_date: '2027-01-09',
      gio_bat_dau: '07:30',
      gio_ket_thuc: '10:30',
      so_phut: 180,
      tiet_bat_dau: 2,
      so_tiet: 6,
      ma_phong: 'CS2.B501',
      dia_diem_thi: 'CS2.B501',
      so_bao_danh: '031',
      to_thi: '002',
      hinh_thuc_thi: 'Vấn đáp',
      ky_thi: 'Thi kết thúc môn',
      loai_ky_thi: 'Cuối kỳ',
      dot_thi: 'D2',
      si_so: 52,
      is_giua_ky: false
    }
  ];
}


