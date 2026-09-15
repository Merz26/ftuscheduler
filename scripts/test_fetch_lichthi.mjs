/**
 * Test script to fetch Exam Schedule from FTU Student Portal
 * Target URL: https://qldt.hcmc.ftu.edu.vn/#/lichthi
 * 
 * Default Credentials:
 * Student ID: 2415115057
 * Password:   @NMPKisreal261021
 */

const BASE_URL = process.env.PORTAL_BASE_URL || 'https://qldt.hcmc.ftu.edu.vn';
const STUDENT_ID = process.argv[2] || '2415115057';
const PASSWORD = process.argv[3] || '@NMPKisreal261021';

console.log('====================================================');
console.log('FTU PORTAL EXAM SCHEDULE FETCHER (/#/lichthi)');
console.log(`Target Portal: ${BASE_URL}`);
console.log(`Student ID:    ${STUDENT_ID}`);
console.log('====================================================\n');

async function login(studentId, password) {
  console.log('[1/4] Authenticating via POST /api/auth/login...');
  const body = new URLSearchParams();
  body.append('username', studentId);
  body.append('password', password);
  body.append('grant_type', 'password');

  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Login failed with HTTP ${res.status}: ${txt}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Authentication rejected: ${data.message || 'Unknown error'}`);
  }

  console.log(`  ✓ Logged in successfully as: ${data.name} (${data.userName})`);
  console.log(`  ✓ Email: ${data.principal}`);
  console.log(`  ✓ Token Type: ${data.token_type}, Expires in: ${data.expires_in}s\n`);

  return {
    token: data.access_token,
    profile: {
      name: data.name,
      studentId: data.userName,
      email: data.principal,
      role: data.roles
    }
  };
}

async function getExamSemesters(token) {
  console.log('[2/4] Fetching available exam semesters via POST /api/report/w-locdshockylichthisinhvien...');
  const res = await fetch(`${BASE_URL}/api/report/w-locdshockylichthisinhvien`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'ua': '0%MTcwOTMyODcwNjIxMQ==%U2FsdGVkX1+zRTzkjt/0w7va9zBWypT1sAkHxi/Y/PU='
    },
    body: JSON.stringify({
      filter: { is_tieng_anh: null },
      additional: {
        paging: { limit: 100, page: 1 },
        ordering: [{ name: null, order_type: 1 }]
      }
    })
  });

  if (!res.ok) {
    throw new Error(`Semester fetch failed with HTTP ${res.status}`);
  }

  const json = await res.json();
  const list = json.data?.ds_hoc_ky || [];
  console.log(`  ✓ Found ${list.length} available semesters in portal.`);
  if (list.length > 0) {
    console.log(`  ✓ Most recent: [${list[0].hoc_ky}] ${list[0].ten_hoc_ky} (${list[0].ngay_bat_dau_hk} - ${list[0].ngay_ket_thuc_hk})\n`);
  }
  return list;
}

async function getExamSchedule(token, hocKy, isGiuaKy = false) {
  const typeLabel = isGiuaKy ? 'Giữa kỳ (Midterm)' : 'Cuối kỳ (Final)';
  console.log(`[3/4] Querying ${typeLabel} exam schedule via POST /api/epm/w-locdslichthisvtheohocky...`);
  
  const res = await fetch(`${BASE_URL}/api/epm/w-locdslichthisvtheohocky`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'ua': '0%MTcwOTMyODcwNjIxMQ==%U2FsdGVkX1+zRTzkjt/0w7va9zBWypT1sAkHxi/Y/PU='
    },
    body: JSON.stringify({
      filter: {
        hoc_ky: hocKy,
        is_giua_ky: isGiuaKy
      },
      additional: {
        paging: { limit: 100, page: 1 },
        ordering: [{ name: null, order_type: null }]
      }
    })
  });

  if (!res.ok) {
    throw new Error(`Exam query failed with HTTP ${res.status}`);
  }

  const json = await res.json();
  const rawList = json.data?.ds_lich_thi || [];
  console.log(`  ✓ Retrieved ${rawList.length} ${typeLabel} exams.`);
  return rawList;
}

function calculateEndTime(startTime, durationMinutes) {
  if (!startTime) return '';
  const [hStr, mStr] = startTime.split(':');
  const total = (Number(hStr) || 0) * 60 + (Number(mStr) || 0) + (Number(durationMinutes) || 90);
  const endH = Math.floor(total / 60) % 24;
  const endM = total % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

async function main() {
  try {
    const { token, profile } = await login(STUDENT_ID, PASSWORD);
    const semesters = await getExamSemesters(token);

    if (!semesters.length) {
      console.log('No semesters found.');
      return;
    }

    const currentSem = semesters[0];
    const finalExams = await getExamSchedule(token, currentSem.hoc_ky, false);
    const midExams = await getExamSchedule(token, currentSem.hoc_ky, true);

    const allExams = [
      ...finalExams.map(e => ({ ...e, is_giua_ky: false, loai_ky_thi: 'Cuối kỳ' })),
      ...midExams.map(e => ({ ...e, is_giua_ky: true, loai_ky_thi: 'Giữa kỳ' }))
    ];

    console.log(`\n[4/4] Summary of Exam Schedule for ${currentSem.ten_hoc_ky}:`);
    console.log('---------------------------------------------------------------------------------------------------');
    console.log(
      'STT'.padEnd(5) + 
      'Mã môn'.padEnd(10) + 
      'Tên môn học'.padEnd(35) + 
      'Ngày thi'.padEnd(12) + 
      'Giờ thi'.padEnd(14) + 
      'Phòng'.padEnd(12) + 
      'Tổ'.padEnd(6) + 
      'Hình thức'
    );
    console.log('---------------------------------------------------------------------------------------------------');

    allExams.forEach((ex, idx) => {
      const endTime = calculateEndTime(ex.gio_bat_dau, ex.so_phut);
      const timeStr = `${ex.gio_bat_dau}-${endTime}`;
      const nameTrunc = (ex.ten_mon || '').length > 33 ? (ex.ten_mon || '').slice(0, 30) + '...' : (ex.ten_mon || '');
      
      console.log(
        String(idx + 1).padEnd(5) +
        (ex.ma_mon || '').padEnd(10) +
        nameTrunc.padEnd(35) +
        (ex.ngay_thi || '').padEnd(12) +
        timeStr.padEnd(14) +
        (ex.ma_phong || '').padEnd(12) +
        (ex.to_thi || '').padEnd(6) +
        (ex.hinh_thuc_thi || '')
      );
    });
    console.log('---------------------------------------------------------------------------------------------------');
    console.log(`Total Exams: ${allExams.length} (Cuối kỳ: ${finalExams.length}, Giữa kỳ: ${midExams.length})`);
    console.log('\n✓ Exam fetch completed successfully!');

  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
    process.exit(1);
  }
}

main();
