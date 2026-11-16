# VI - FTU Schedule Sync (ENGLISH BELOW)

Tiện ích mở rộng trình duyệt hoàn toàn miễn phí, xử lý phía client để đồng bộ lịch học FTU với Google Calendar mà không phụ thuộc vào bất kỳ máy chủ bên thứ ba nào.

## Cài đặt

1. Tải về hoặc clone repository dưới dạng tệp `.zip`.
2. Mở trình duyệt sử dụng nhân Chromium của bạn (Chrome, Edge, Brave, v.v.).
3. Điều hướng đến trang quản lý tiện ích (`chrome://extensions` hoặc `edge://extensions`).
4. Bật **Developer Mode** (Chế độ dành cho nhà phát triển).
5. Nhấp vào **Load unpacked** (Tải tiện ích đã giải nén) và chọn thư mục chứa dự án này (thư mục gốc nơi đặt tệp `manifest.json`).
6. Liên hệ với chủ sở hữu dự án (chính là tôi) để tôi có thể duyệt email của bạn dưới quyền tester.

## Tính năng

- **Direct API Sync**: Kết nối trực tiếp tới `qldt.hcmc.ftu.edu.vn` để lấy lịch học. Hoàn toàn không qua trung gian.
- **Universal OAuth2**: Sử dụng `launchWebAuthFlow` tiêu chuẩn để hỗ trợ Edge, Brave và các bản phân nhánh khác của Chromium.
- **Auto-Login**: Tự động khôi phục mượt mà các phiên đăng nhập hết hạn bằng cách chạy quy trình đăng nhập ngầm (headless) trong offscreen document.
- **Offline Fallback**: Kéo và thả tệp `Export_TKB.xlsx` để xuất tệp lịch định dạng `.ics` tiêu chuẩn.
- **Hỗ trợ giao diện & Đa ngôn ngữ**: Chuyển đổi qua lại giữa tiếng Anh/tiếng Việt và hỗ trợ chế độ Dark/Light mode.

## Phát triển

Chạy kiểm thử:
```bash
npm install
npm run test:ui
```
#
# EN - FTU Schedule Sync

A completely free, client-side browser extension to synchronize FTU class schedules with Google Calendar without relying on third-party servers.

## Installation

1. Download or clone repository as a `.zip` file.
2. Open your Chromium-based browser (Chrome, Edge, Brave, etc.).
3. Navigate to the extensions page (`chrome://extensions` or `edge://extensions`).
4. Enable **Developer Mode**.
5. Click **Load unpacked** and select the directory containing this project (the root directory where `manifest.json` is located).
6. Contact the owner (aka me) so I can approve your email as a tester.

## Features

- **Direct API Sync**: Connects directly to `qldt.hcmc.ftu.edu.vn` to fetch the schedule. No intermediaries.
- **Universal OAuth2**: Uses standard `launchWebAuthFlow` to support Edge, Brave, and other Chromium forks.
- **Auto-Login**: Gracefully heals expired sessions by running a headless login routine in an offscreen document.
- **Offline Fallback**: Drag and drop `Export_TKB.xlsx` to generate standard `.ics` calendar files.
- **Theme Support & Localization**: English/Vietnamese toggles and Dark/Light mode support.

## Development

Run tests:
```bash
npm install
npm run test:ui
```
