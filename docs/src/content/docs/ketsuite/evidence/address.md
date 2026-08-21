---
title: Address UI evidence
description: Responsive and localized browser evidence for KetSuite address flows.
draft: true
---

# Address UI evidence

Ảnh được chụp từ ứng dụng KetSuite thật bằng in-app browser sau khi seed database
riêng. Không dùng mock API hoặc ảnh dựng. Ma trận kiểm tra gồm desktop/mobile,
tiếng Việt/Anh, catalog đã cài/chưa cài và các module tiêu thụ địa chỉ.

| Luồng | Kích thước | Locale | Kết quả |
| --- | --- | --- | --- |
| Danh sách catalog đã cài | 1440×900 | vi | Không tràn trang/bảng; VN active, 3.355 đơn vị |
| Cây địa giới cấp tỉnh | 390×844 | en | 34 dòng; chỉ giữ cột chính trên mobile |
| Danh sách catalog chưa cài | 390×844 | vi | Hiện trạng thái và action cài; không tràn |
| Partner có catalog | 1440×900 và 390×844 | vi/en | Cascade tải 34 tỉnh, chọn TP.HCM tải 168 đơn vị + placeholder; có Phường Sài Gòn |
| Partner chưa có catalog | 390×844 | vi | Thông báo rõ và khóa toàn bộ action lưu địa chỉ |
| Company | 390×844 | en | Link địa chỉ pháp lý trỏ tới Partner đại diện |
| Hospitality Property | 1440×900 và 390×844 | vi/en | Hiển thị địa chỉ đã format, không tràn trang/bảng |

## Catalog Việt Nam

![Catalog địa chỉ Việt Nam trên desktop](/screenshots/address/catalog-vi-desktop.png)

![Cây địa giới Việt Nam trên mobile](/screenshots/address/divisions-en-mobile.png)

![Trạng thái catalog chưa cài trên mobile](/screenshots/address/catalog-uninstalled-vi-mobile.png)

## Module sử dụng địa chỉ

![Partner address trên desktop](/screenshots/address/partner-address-vi-desktop.png)

![Partner address trên mobile](/screenshots/address/partner-address-en-mobile.png)

![Partner khi catalog chưa cài](/screenshots/address/partner-uninstalled-vi-mobile.png)

![Hospitality Property dùng địa chỉ chuẩn](/screenshots/address/hospitality-property-vi-desktop.png)
